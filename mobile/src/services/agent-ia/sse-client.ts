import { APP_CONFIG } from '@/utils/constants';

export interface SSEEvent {
  type: string;
  data: any;
  id?: string;
  event?: string;
}

export class SSEClient {
  private url: string;
  private headers?: Record<string, string>;
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isClosed = false;
  private listeners: Map<string, Set<(event: SSEEvent) => void>> = new Map();

  constructor(url: string, headers?: Record<string, string>) {
    this.url = url;
    this.headers = headers;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Para React Native, usar EventSource polyfill ou fetch com streaming
        // Por enquanto, usar EventSource se disponível (web)
        if (typeof EventSource !== 'undefined') {
          this.eventSource = new EventSource(this.url);
        } else {
          // Para React Native, usar fetch com streaming
          this.connectWithFetch();
          resolve();
          return;
        }

        this.eventSource!.onopen = () => {
          console.log('[SSE] Conexão estabelecida');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.eventSource!.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.emit('message', {
              type: data.type || 'message',
              data: data.data || data,
              id: event.lastEventId || data.id,
              event: data.event || 'message',
            });
          } catch (e) {
            this.emit('message', {
              type: 'message',
              data: event.data,
            });
          }
        };

        this.eventSource!.onerror = (error) => {
          console.error('[SSE] Erro:', error);
          if (!this.isClosed) {
            this.scheduleReconnect();
          }
          reject(error);
        };

        // Escutar eventos customizados
        Array.from(this.listeners.keys()).forEach((eventType) => {
          if (eventType === 'message') return;
          this.attachEventListener(eventType);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private async connectWithFetch() {
    try {
      const response = await fetch(this.url, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...this.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const processChunk = async () => {
        while (!this.isClosed) {
          const { done, value } = await reader.read();
          
          if (done) {
            if (!this.isClosed) {
              this.scheduleReconnect();
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEventType: string | null = null;
          let currentEventId: string | undefined;
          let currentDataLines: string[] = [];

          const flushEvent = () => {
            if (currentDataLines.length === 0) return;
            const raw = currentDataLines.join('\n');
            try {
              const json = JSON.parse(raw);
              this.emit('message', {
                type: currentEventType || json.type || 'message',
                data: json.data || json,
                id: currentEventId || json.id,
                event: currentEventType || json.event || 'message',
              });
            } catch (e) {
              this.emit('message', {
                type: currentEventType || 'message',
                data: raw,
                id: currentEventId,
                event: currentEventType || 'message',
              });
            }
            currentEventType = null;
            currentEventId = undefined;
            currentDataLines = [];
          };

          for (const line of lines) {
            if (line.trim().length === 0) {
              flushEvent();
              continue;
            }

            if (line.startsWith('id:')) {
              currentEventId = line.substring(3).trim();
              continue;
            }

            if (line.startsWith('event:')) {
              currentEventType = line.substring(6).trim() || 'message';
              continue;
            }

            if (line.startsWith('data:')) {
              const dataLine = line.substring(5).trimStart();
              if (dataLine.length === 0) continue;
              currentDataLines.push(dataLine);
              continue;
            }

          }

          flushEvent();
        }
      };

      processChunk();
    } catch (error) {
      console.error('[SSE] Erro na conexão:', error);
      if (!this.isClosed) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[SSE] Máximo de tentativas de reconexão atingido');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[SSE] Tentando reconectar (tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(console.error);
    }, this.reconnectDelay);
  }

  private attachEventListener(eventType: string) {
    if (!this.eventSource) return;
    // Evitar listener duplicado para eventos padrão.
    if (eventType === 'message') return;
    this.eventSource.addEventListener(eventType, (event: any) => {
      try {
        const data = JSON.parse(event.data);
        this.emit(eventType, {
          type: eventType,
          data: data.data || data,
          id: event.lastEventId || data.id,
          event: eventType,
        });
      } catch (e) {
        this.emit(eventType, {
          type: eventType,
          data: event.data,
          id: event.lastEventId,
          event: eventType,
        });
      }
    });
  }

  on(event: string, callback: (event: SSEEvent) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    // Registrar listener imediatamente se já houver conexão.
    if (this.eventSource) {
      this.attachEventListener(event);
    }
  }

  off(event: string, callback: (event: SSEEvent) => void) {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: SSEEvent) {
    this.listeners.get(event)?.forEach((callback) => callback(data));
    this.listeners.get('*')?.forEach((callback) => callback(data));
  }

  close() {
    this.isClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.listeners.clear();
  }
}

export function createSSEClient(
  threadId: string,
  userId: string,
  lastEventId?: string | null,
  authToken?: string | null
): SSEClient {
  // SSE usa endpoint dedicado (/sse) para evitar 404 em /agent/sse
  const params = new URLSearchParams({
    thread_id: threadId,
    user_id: userId,
  });
  const finalToken = authToken || APP_CONFIG.SSE_AUTH_TOKEN || APP_CONFIG.AGENT_IA_AUTH_TOKEN;
  if (finalToken) {
    params.set('token', finalToken);
  }
  if (lastEventId) {
    params.set('last_event_id', lastEventId);
  }
  const url = `${APP_CONFIG.AGENT_IA_SSE_URL}?${params.toString()}`;
  return new SSEClient(url);
}
