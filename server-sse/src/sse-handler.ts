import { Request, Response } from 'express';
import type { RedisClientType } from 'redis';
import type { ChatEvent } from './types.js';

interface SSEClient {
  userId: string;
  threadId: string;
  response: Response;
  connectionKey: string;
}

class SSEHandler {
  private static clients: Map<string, SSEClient[]> = new Map();
  private static connectionCount = 0;
  // Tipagem ampla para evitar conflito entre tipos internos do redis.
  private static redisClient: RedisClientType<any, any, any> | null = null;
  private static readonly MAX_BACKLOG = 200;
  private static readonly BACKLOG_TTL_SECONDS = 60 * 60; // 1 hora

  static setRedisClient(client: RedisClientType<any, any, any>) {
    this.redisClient = client;
  }

  static handleConnection() {
    return async (req: Request, res: Response) => {
      const userId = (req.query.user_id || req.query.userId) as string;
      const threadId = (req.query.thread_id || req.query.threadId) as string;
      const lastEventId = (req.query.last_event_id || req.query.lastEventId) as string | undefined;

      if (!userId || !threadId) {
        return res.status(400).json({ error: 'user_id e thread_id são obrigatórios' });
      }

      const connectionKey = `${userId}_${threadId}`;

      // Configurar headers SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control, Last-Event-ID');

      // Criar cliente
      const client: SSEClient = {
        userId,
        threadId,
        response: res,
        connectionKey,
      };

      // Adicionar à lista de clientes
      if (!this.clients.has(connectionKey)) {
        this.clients.set(connectionKey, []);
      }
      this.clients.get(connectionKey)!.push(client);
      this.connectionCount++;

      console.log(`[SSE-SERVER] ✅ Cliente conectado: ${connectionKey} (total: ${this.connectionCount})`);

      // Enviar mensagem de conexão estabelecida
      this.sendEvent(res, {
        type: 'connected',
        timestamp: new Date().toISOString(),
      });

      // Reenviar backlog quando houver last_event_id.
      if (lastEventId) {
        await this.sendBacklog(connectionKey, lastEventId, res);
      }

      // Limpar quando desconectar
      req.on('close', () => {
        this.removeClient(connectionKey, client);
        console.log(`[SSE-SERVER] ❌ Cliente desconectado: ${connectionKey} (total: ${this.connectionCount})`);
      });

      // Manter conexão viva com heartbeat
      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
        } catch (error) {
          clearInterval(heartbeat);
          this.removeClient(connectionKey, client);
        }
      }, 30000); // A cada 30 segundos

      req.on('close', () => {
        clearInterval(heartbeat);
      });
    };
  }

  static broadcast(event: ChatEvent) {
    const connectionKey = `${event.user_id}_${event.thread_id}`;
    const clients = this.clients.get(connectionKey);

    if (!clients || clients.length === 0) {
      console.log(`[SSE-SERVER] ⚠️  Nenhum cliente conectado para ${connectionKey}`);
      return false;
    }

    const sseEvent = {
      type: 'new_message',
      id: event.id,
      event: 'new_message',
      data: {
        user_id: event.user_id,
        thread_id: event.thread_id,
        message: event.message,
        role: event.role || 'assistant',
        type: event.type || 'text',
        audio_base64: event.audio_base64,
        timestamp: event.timestamp || new Date().toISOString(),
      },
    };

    let sentCount = 0;
    const clientsToRemove: SSEClient[] = [];

    clients.forEach((client) => {
      try {
        this.sendEvent(client.response, sseEvent);
        sentCount++;
      } catch (error) {
        console.error(`[SSE-SERVER] ❌ Erro ao enviar para cliente:`, error);
        clientsToRemove.push(client);
      }
    });

    // Remover clientes com erro
    clientsToRemove.forEach((client) => {
      this.removeClient(connectionKey, client);
    });

    console.log(`[SSE-SERVER] 📤 Evento enviado para ${sentCount}/${clients.length} clientes de ${connectionKey}`);
    return sentCount > 0;
  }

  static async storeAndBroadcast(event: ChatEvent) {
    const connectionKey = `${event.user_id}_${event.thread_id}`;
    const normalized = await this.withEventId(event);
    await this.storeBacklog(connectionKey, normalized);
    return this.broadcast(normalized);
  }

  private static async withEventId(event: ChatEvent): Promise<ChatEvent> {
    if (event.id) return event;
    if (!this.redisClient) {
      return { ...event, id: Date.now().toString() };
    }
    const id = await this.redisClient.incr('chat:events:seq');
    return { ...event, id: id.toString() };
  }

  private static async storeBacklog(connectionKey: string, event: ChatEvent) {
    if (!this.redisClient) return;
    const listKey = `chat:events:${connectionKey}`;
    await this.redisClient.rPush(listKey, JSON.stringify(event));
    await this.redisClient.lTrim(listKey, -this.MAX_BACKLOG, -1);
    await this.redisClient.expire(listKey, this.BACKLOG_TTL_SECONDS);
  }

  private static async sendBacklog(connectionKey: string, lastEventId: string, res: Response) {
    if (!this.redisClient) return;
    const listKey = `chat:events:${connectionKey}`;
    const entries = await this.redisClient.lRange(listKey, 0, -1);
    const lastId = Number(lastEventId);
    if (!Number.isFinite(lastId)) return;

    entries.forEach((entry) => {
      try {
        const parsed = JSON.parse(entry) as ChatEvent;
        const parsedId = Number(parsed.id);
        if (Number.isFinite(parsedId) && parsedId > lastId) {
          this.sendEvent(res, {
            type: 'new_message',
            id: parsed.id,
            event: 'new_message',
            data: parsed,
          });
        }
      } catch (error) {
        console.error('[SSE-SERVER] ❌ Erro ao reenviar backlog:', error);
      }
    });
  }

  private static sendEvent(res: Response, event: any) {
    const data = JSON.stringify(event);
    if (event.id) {
      res.write(`id: ${event.id}\n`);
    }
    if (event.event) {
      res.write(`event: ${event.event}\n`);
    }
    res.write(`data: ${data}\n\n`);
  }

  private static removeClient(connectionKey: string, client: SSEClient) {
    const clients = this.clients.get(connectionKey);
    if (clients) {
      const index = clients.indexOf(client);
      if (index > -1) {
        clients.splice(index, 1);
        this.connectionCount--;
      }
      if (clients.length === 0) {
        this.clients.delete(connectionKey);
      }
    }
  }

  static getConnectionCount(): number {
    return this.connectionCount;
  }

  static getConnectionsByKey(): Record<string, number> {
    const result: Record<string, number> = {};
    this.clients.forEach((clients, key) => {
      result[key] = clients.length;
    });
    return result;
  }
}

export { SSEHandler };
