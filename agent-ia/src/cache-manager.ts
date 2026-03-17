// Gerenciador de Cache para melhorar performance
import { RedisClient } from './redis-client';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live em segundos
}

export class CacheManager {
  private redisClient: RedisClient;
  private memoryCache: Map<string, CacheEntry<any>>;
  private readonly DEFAULT_TTL = 300; // 5 minutos
  private readonly MAX_MEMORY_CACHE_SIZE = 1000; // Máximo de itens em cache em memória

  constructor(redisClient: RedisClient) {
    this.redisClient = redisClient;
    this.memoryCache = new Map();
    
    // Limpar cache em memória periodicamente
    setInterval(() => this.cleanMemoryCache(), 60000); // A cada 1 minuto
  }

  /**
   * Obtém valor do cache (primeiro memória, depois Redis)
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      // 1. Tentar memória primeiro (mais rápido)
      const memoryEntry = this.memoryCache.get(key);
      if (memoryEntry) {
        const age = Date.now() - memoryEntry.timestamp;
        if (age < memoryEntry.ttl * 1000) {
          return memoryEntry.data as T;
        } else {
          // Expirou, remover
          this.memoryCache.delete(key);
        }
      }

      // 2. Tentar Redis
      const redisValue = await this.redisClient.get(key);
      if (redisValue) {
        try {
          const parsed = JSON.parse(redisValue) as CacheEntry<T>;
          const age = Date.now() - parsed.timestamp;
          if (age < parsed.ttl * 1000) {
            // Adicionar ao cache em memória para próximas consultas
            this.memoryCache.set(key, parsed);
            return parsed.data;
          }
        } catch (e) {
          // Valor inválido no Redis, ignorar
        }
      }

      return null;
    } catch (error: any) {
      console.error('[CACHE] ❌ Erro ao buscar cache:', error);
      return null;
    }
  }

  /**
   * Armazena valor no cache (memória e Redis)
   */
  async set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): Promise<void> {
    try {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl,
      };

      // 1. Armazenar em memória
      if (this.memoryCache.size >= this.MAX_MEMORY_CACHE_SIZE) {
        // Remover item mais antigo
        const firstKey = this.memoryCache.keys().next().value;
        if (firstKey) {
          this.memoryCache.delete(firstKey);
        }
      }
      this.memoryCache.set(key, entry);

      // 2. Armazenar no Redis (assíncrono, não bloquear)
      this.redisClient.set(key, JSON.stringify(entry), ttl).catch((error) => {
        console.warn('[CACHE] ⚠️ Erro ao salvar no Redis (não crítico):', error);
      });
    } catch (error: any) {
      console.error('[CACHE] ❌ Erro ao salvar cache:', error);
    }
  }

  /**
   * Remove valor do cache
   */
  async delete(key: string): Promise<void> {
    try {
      this.memoryCache.delete(key);
      await this.redisClient.del(key);
    } catch (error: any) {
      console.error('[CACHE] ❌ Erro ao deletar cache:', error);
    }
  }

  /**
   * Remove múltiplas chaves do cache
   */
  async deletePattern(pattern: string): Promise<void> {
    try {
      // Limpar memória
      for (const key of this.memoryCache.keys()) {
        if (key.includes(pattern)) {
          this.memoryCache.delete(key);
        }
      }

      // Redis não suporta pattern delete diretamente, mas podemos tentar
      // (implementação simplificada - em produção usar SCAN)
      console.log(`[CACHE] Limpando cache com padrão: ${pattern}`);
    } catch (error: any) {
      console.error('[CACHE] ❌ Erro ao deletar padrão:', error);
    }
  }

  /**
   * Limpa cache expirado em memória
   */
  private cleanMemoryCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      const age = now - entry.timestamp;
      if (age >= entry.ttl * 1000) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Limpa todo o cache
   */
  async clear(): Promise<void> {
    try {
      this.memoryCache.clear();
      // Redis clear seria mais complexo, deixar para implementação futura
      console.log('[CACHE] Cache em memória limpo');
    } catch (error: any) {
      console.error('[CACHE] ❌ Erro ao limpar cache:', error);
    }
  }

  /**
   * Gera chave de cache para histórico
   */
  static getHistoryKey(threadId: string, userId: string): string {
    return `history:${threadId}:${userId}`;
  }

  /**
   * Gera chave de cache para contexto Gemini
   */
  static getGeminiContextKey(userId: string): string {
    return `gemini_context:${userId}`;
  }

  /**
   * Gera chave de cache para transcrição
   */
  static getTranscriptKey(threadId: string, userId: string): string {
    return `transcript:${threadId}:${userId}`;
  }
}
