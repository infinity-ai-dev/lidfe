// Rate Limiter para proteger APIs e evitar abuso
import { RedisClient } from './redis-client';

interface RateLimitConfig {
  windowMs: number; // Janela de tempo em milissegundos
  maxRequests: number; // Máximo de requisições na janela
}

export class RateLimiter {
  private redisClient: RedisClient;
  private defaultConfig: RateLimitConfig = {
    windowMs: 60000, // 1 minuto
    maxRequests: 60, // 60 requisições por minuto
  };

  constructor(redisClient: RedisClient) {
    this.redisClient = redisClient;
  }

  /**
   * Verifica se uma requisição está dentro do limite
   */
  async checkLimit(
    identifier: string,
    config: RateLimitConfig = this.defaultConfig
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    try {
      const key = `ratelimit:${identifier}`;
      const windowKey = `ratelimit:${identifier}:window`;

      // Obter contador atual
      const current = await this.redisClient.get(key);
      const count = current ? parseInt(current, 10) : 0;

      // Verificar se excedeu o limite
      if (count >= config.maxRequests) {
        const resetAt = await this.redisClient.get(windowKey);
        return {
          allowed: false,
          remaining: 0,
          resetAt: resetAt ? parseInt(resetAt, 10) : Date.now() + config.windowMs,
        };
      }

      // Incrementar contador
      if (count === 0) {
        // Primeira requisição na janela, definir TTL
        await this.redisClient.set(key, '1', Math.ceil(config.windowMs / 1000));
        await this.redisClient.set(
          windowKey,
          String(Date.now() + config.windowMs),
          Math.ceil(config.windowMs / 1000)
        );
      } else {
        // Incrementar contador existente
        await this.redisClient.set(key, String(count + 1), Math.ceil(config.windowMs / 1000));
      }

      return {
        allowed: true,
        remaining: config.maxRequests - (count + 1),
        resetAt: Date.now() + config.windowMs,
      };
    } catch (error: any) {
      console.error('[RATE-LIMITER] ❌ Erro ao verificar limite:', error);
      // Em caso de erro, permitir requisição (fail-open)
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetAt: Date.now() + config.windowMs,
      };
    }
  }

  /**
   * Rate limit por usuário
   */
  async checkUserLimit(userId: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    return this.checkLimit(`user:${userId}`, {
      windowMs: 60000, // 1 minuto
      maxRequests: 30, // 30 requisições por minuto por usuário
    });
  }

  /**
   * Rate limit por thread
   */
  async checkThreadLimit(threadId: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    return this.checkLimit(`thread:${threadId}`, {
      windowMs: 60000, // 1 minuto
      maxRequests: 20, // 20 requisições por minuto por thread
    });
  }

  /**
   * Rate limit global (todos os usuários)
   */
  async checkGlobalLimit(): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    return this.checkLimit('global', {
      windowMs: 60000, // 1 minuto
      maxRequests: 1000, // 1000 requisições por minuto globalmente
    });
  }
}
