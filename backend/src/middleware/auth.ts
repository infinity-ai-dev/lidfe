import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { validateSupabaseJwt } from '../lib/supabase';

export interface AuthLocals {
  userId: string;
  isService: boolean;
  accessToken: string;
}

function extractToken(req: Request): string | undefined {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const key = req.headers['x-api-key'];
  if (typeof key === 'string' && key.trim()) return key.trim();
  return undefined;
}

function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function verifyHmacSignature(req: Request): boolean {
  if (!config.authToken) return false;

  const ts = req.headers['x-lidfe-ts'];
  const nonce = req.headers['x-lidfe-nonce'];
  const sig = req.headers['x-lidfe-signature'];
  const bodyHash = req.headers['x-lidfe-body-sha256'];

  if (typeof ts !== 'string' || typeof nonce !== 'string' || typeof sig !== 'string') return false;
  if (!/^[0-9a-f]{64}$/i.test(sig)) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;

  const now = Math.floor(Date.now() / 1000);
  const maxDrift = config.hmacTtlSeconds + config.hmacClockSkewSeconds;
  if (Math.abs(now - tsNum) > maxDrift) return false;

  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';
  const computedBodyHash =
    typeof bodyHash === 'string' && /^[0-9a-f]{64}$/i.test(bodyHash)
      ? bodyHash
      : sha256Hex(rawBody);

  const sigBase = `${tsNum}.${nonce}.${req.method}.${req.path}.${computedBodyHash}`;
  const expected = hmacHex(config.authToken, sigBase);
  return safeEqualHex(expected, sig);
}

// Middleware: valida JWT do usuário (Supabase) e injeta userId em res.locals
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Token de autenticação obrigatório' });
    return;
  }

  // Serviços internos (agent-ia, sse-server) podem usar HMAC ou bearer token fixo
  const isService =
    verifyHmacSignature(req) ||
    (!config.hmacEnforce && token === config.authToken);

  if (isService) {
    (res.locals as AuthLocals).isService = true;
    (res.locals as AuthLocals).userId = 'service';
    (res.locals as AuthLocals).accessToken = token;
    next();
    return;
  }

  // Usuários finais: validar JWT Supabase
  const userId = await validateSupabaseJwt(token);
  if (!userId) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
    return;
  }

  (res.locals as AuthLocals).isService = false;
  (res.locals as AuthLocals).userId = userId;
  (res.locals as AuthLocals).accessToken = token;
  next();
}

// Middleware: permite apenas chamadas de serviço interno (agent-ia, etc.)
export function requireService(req: Request, res: Response, next: NextFunction): void {
  if (!(res.locals as AuthLocals).isService) {
    res.status(403).json({ error: 'Acesso restrito a serviços internos' });
    return;
  }
  next();
}
