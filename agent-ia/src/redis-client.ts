// Cliente Redis para coordenação e comunicação
import Redis from 'ioredis';

export class RedisClient {
  private redis: Redis | null = null;
  private redisUrl: string;

  constructor(redisUrl?: string) {
    // Se não fornecido, usar padrão do Docker Swarm
    this.redisUrl = redisUrl || process.env.REDIS_URL || 'redis://redis:6379';
  }

  /**
   * Conecta ao Redis
   */
  async connect(): Promise<void> {
    try {
      if (this.redis) {
        return; // Já conectado
      }

      console.log(`[REDIS] Conectando ao Redis: ${this.redisUrl}`);
      
      // Parse da URL do Redis
      const url = new URL(this.redisUrl);
      const host = url.hostname;
      const port = parseInt(url.port || '6379', 10);
      const db = parseInt(url.pathname?.substring(1) || process.env.REDIS_DB || '0', 10);
      const password = url.password || undefined;

      this.redis = new Redis({
        host,
        port,
        db,
        password,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          console.log(`[REDIS] Tentando reconectar (tentativa ${times}) em ${delay}ms...`);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      this.redis.on('connect', () => {
        console.log('[REDIS] ✅ Conectado ao Redis');
      });

      this.redis.on('error', (error: Error) => {
        console.error('[REDIS] ❌ Erro no Redis:', error);
      });

      // Testar conexão
      await this.redis.ping();
      console.log('[REDIS] ✅ Conexão testada com sucesso');
    } catch (error: any) {
      console.error('[REDIS] ❌ Erro ao conectar ao Redis:', error);
      throw error;
    }
  }

  /**
   * Publica mensagem em um canal Redis
   */
  async publish(channel: string, message: string): Promise<number> {
    try {
      if (!this.redis) {
        await this.connect();
      }

      const result = await this.redis!.publish(channel, message);
      console.log(`[REDIS] ✅ Mensagem publicada no canal ${channel}`);
      return result;
    } catch (error: any) {
      console.error(`[REDIS] ❌ Erro ao publicar no canal ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Define um valor no Redis
   */
  async set(key: string, value: string, expirySeconds?: number): Promise<void> {
    try {
      if (!this.redis) {
        await this.connect();
      }

      if (expirySeconds) {
        await this.redis!.setex(key, expirySeconds, value);
      } else {
        await this.redis!.set(key, value);
      }
      console.log(`[REDIS] ✅ Valor definido para chave ${key}`);
    } catch (error: any) {
      console.error(`[REDIS] ❌ Erro ao definir chave ${key}:`, error);
      throw error;
    }
  }

  /**
   * Obtém um valor do Redis
   */
  async get(key: string): Promise<string | null> {
    try {
      if (!this.redis) {
        await this.connect();
      }

      const value = await this.redis!.get(key);
      return value;
    } catch (error: any) {
      console.error(`[REDIS] ❌ Erro ao obter chave ${key}:`, error);
      return null;
    }
  }

  /**
   * Remove uma chave do Redis
   */
  async del(key: string): Promise<void> {
    try {
      if (!this.redis) {
        await this.connect();
      }

      await this.redis!.del(key);
      console.log(`[REDIS] ✅ Chave ${key} removida`);
    } catch (error: any) {
      console.error(`[REDIS] ❌ Erro ao remover chave ${key}:`, error);
      throw error;
    }
  }

  /**
   * Fecha conexão com Redis
   */
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      console.log('[REDIS] ✅ Desconectado do Redis');
    }
  }
}
