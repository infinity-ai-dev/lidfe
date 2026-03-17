import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { SSEHandler } from './sse-handler.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
// Redis URL do environment (configurado no docker-compose)
// Usa o Redis compartilhado da infraestrutura
// Formato: redis://redis:6379 (nome do serviço no Docker Swarm)
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10);
const SSE_AUTH_TOKEN = process.env.LIDFE_AUTH_TOKEN || process.env.SSE_AUTH_TOKEN || '';
const LIDFE_HMAC_TTL_SECONDS = parseInt(process.env.LIDFE_HMAC_TTL_SECONDS || '60', 10);
const LIDFE_HMAC_CLOCK_SKEW_SECONDS = parseInt(process.env.LIDFE_HMAC_CLOCK_SKEW_SECONDS || '5', 10);
const LIDFE_HMAC_ENFORCE = process.env.LIDFE_HMAC_ENFORCE === 'true';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xradpyucukbqaulzhdab.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// Middleware
app.use(cors());
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf.toString('utf8');
  },
}));

if (!SSE_AUTH_TOKEN) {
  console.error('[SSE-SERVER] ❌ SSE auth token não configurado (LIDFE_AUTH_TOKEN/SSE_AUTH_TOKEN).');
  process.exit(1);
}
if (!SUPABASE_ANON_KEY) {
  console.error('[SSE-SERVER] ❌ SUPABASE_ANON_KEY não configurada para validar JWT.');
  process.exit(1);
}

function extractToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
    return apiKey.trim();
  }
  const tokenQuery = req.query.token;
  // Garantir retorno somente quando o token for string
  if (Array.isArray(tokenQuery)) {
    const firstToken = tokenQuery[0];
    if (typeof firstToken === 'string' && firstToken.trim().length > 0) {
      return firstToken.trim();
    }
    return undefined;
  }
  if (typeof tokenQuery === 'string' && tokenQuery.trim().length > 0) {
    return tokenQuery.trim();
  }
  return undefined;
}

function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const normalized = padded + '='.repeat(padLength);
  return Buffer.from(normalized, 'base64');
}

function base64UrlEncode(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function deriveSseKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('lidfe-sse-token-v1', 'utf8').digest();
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function safeEqualBase64Url(a: string, b: string): boolean {
  const aBuf = base64UrlDecode(a);
  const bBuf = base64UrlDecode(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function verifySseToken(token: string): { userId: string; threadId?: string } | null {
  if (!SSE_AUTH_TOKEN) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  try {
    const header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8')) as { alg?: string };
    if (!header || header.alg !== 'HS256') return null;
    const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8')) as {
      sub?: string;
      tid?: string;
      typ?: string;
      aud?: string;
      iat?: number;
      exp?: number;
    };
    if (!payload?.sub || payload.typ !== 'sse' || payload.aud !== 'sse') return null;
    if (!payload.iat || !payload.exp) return null;

    const now = Math.floor(Date.now() / 1000);
    const skew = LIDFE_HMAC_CLOCK_SKEW_SECONDS;
    if (payload.iat > now + skew) return null;
    if (payload.exp < now - skew) return null;

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac('sha256', deriveSseKey(SSE_AUTH_TOKEN))
      .update(signingInput, 'utf8')
      .digest();
    const expected = base64UrlEncode(signature);
    if (!safeEqualBase64Url(expected, encodedSignature)) return null;

    return { userId: payload.sub, threadId: payload.tid };
  } catch (error) {
    return null;
  }
}

async function verifyServiceSignature(req: express.Request): Promise<boolean> {
  if (!SSE_AUTH_TOKEN) return false;
  const hexPattern = /^[0-9a-f]+$/i;
  const tsHeader = req.headers['x-lidfe-ts'];
  const nonceHeader = req.headers['x-lidfe-nonce'];
  const sigHeader = req.headers['x-lidfe-signature'];
  const bodyHashHeader = req.headers['x-lidfe-body-sha256'];

  if (
    typeof tsHeader !== 'string' ||
    typeof nonceHeader !== 'string' ||
    typeof sigHeader !== 'string'
  ) {
    return false;
  }
  if (!hexPattern.test(sigHeader) || sigHeader.length !== 64) return false;

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  const maxDrift = LIDFE_HMAC_TTL_SECONDS + LIDFE_HMAC_CLOCK_SKEW_SECONDS;
  if (Math.abs(now - ts) > maxDrift) return false;

  const rawBody = (req as any).rawBody ?? '';
  const bodyHash = typeof bodyHashHeader === 'string' && bodyHashHeader.length === 64 && hexPattern.test(bodyHashHeader)
    ? bodyHashHeader
    : sha256Hex(rawBody);

  const signatureBase = `${ts}.${nonceHeader}.${req.method}.${req.path}.${bodyHash}`;
  const expected = hmacHex(SSE_AUTH_TOKEN, signatureBase);
  if (!safeEqualHex(expected, sigHeader)) return false;

  try {
    if (redis.isOpen) {
      const nonceKey = `lidfe:nonce:${nonceHeader}`;
      const existing = await redis.get(nonceKey);
      if (existing) return false;
      await redis.set(nonceKey, '1', { EX: maxDrift });
    }
  } catch (error) {
    console.warn('[SSE-SERVER] ⚠️ Falha ao validar nonce no Redis:', (error as Error).message);
  }

  return true;
}

app.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const token = extractToken(req);
  const signatureValid = await verifyServiceSignature(req);

  if (!token && !signatureValid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  (res.locals as any).token = token;
  const bearerIsService = token === SSE_AUTH_TOKEN;
  (res.locals as any).isServiceToken = signatureValid || (bearerIsService && !LIDFE_HMAC_ENFORCE);
  return next();
});

async function validateSupabaseJwt(token: string): Promise<string | null> {
  if (!SUPABASE_ANON_KEY) {
    console.error('[SSE-SERVER] SUPABASE_ANON_KEY não configurada.');
    return null;
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { id?: string };
    // Garantir que o ID retornado é uma string válida
    return typeof data?.id === 'string' && data.id.trim().length > 0 ? data.id : null;
  } catch (error) {
    console.error('[SSE-SERVER] Erro ao validar JWT:', error);
    return null;
  }
}

async function validateUserToken(token: string): Promise<{ userId: string | null; threadId?: string }> {
  const ssePayload = verifySseToken(token);
  if (ssePayload) {
    return { userId: ssePayload.userId, threadId: ssePayload.threadId };
  }
  const supabaseUserId = await validateSupabaseJwt(token);
  return { userId: supabaseUserId };
}

// Cliente Redis - Conecta ao Redis compartilhado da infraestrutura
const redis = createClient({ 
  url: REDIS_URL,
  database: REDIS_DB,
});

// Inicializar Redis
redis.on('error', (err) => console.error('[SSE-SERVER] Redis Client Error:', err));
redis.on('connect', () => console.log(`[SSE-SERVER] ✅ Redis conectado (DB=${REDIS_DB})`));

// Função assíncrona para inicializar
async function initialize() {
  try {
    await redis.connect();
    console.log('[SSE-SERVER] ✅ Redis conectado com sucesso');
    SSEHandler.setRedisClient(redis);
  } catch (error) {
    console.error('[SSE-SERVER] ❌ Erro ao conectar Redis:', error);
  }
}

// Servir página de debug (apenas serviço)
app.use('/debug', (req, res, next) => {
  if (!(res.locals as any).isServiceToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}, express.static(path.join(__dirname, '../public')));

// Endpoint de status (API)
app.get('/status', (req, res) => {
  if (!(res.locals as any).isServiceToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json({
    status: 'online',
    connections: SSEHandler.getConnectionCount(),
    uptime: process.uptime(),
  });
});

// Endpoint SSE para conexão
app.get('/sse', async (req, res) => {
  const token = (res.locals as any).token as string;
  const isServiceToken = (res.locals as any).isServiceToken as boolean;
  if (isServiceToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const requestedThreadId = (req.query.thread_id || req.query.threadId) as string | undefined;
  const tokenData = await validateUserToken(token);
  if (!tokenData.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const requestedUserId = (req.query.user_id || req.query.userId) as string | undefined;
  if (requestedUserId && requestedUserId !== tokenData.userId) {
    return res.status(403).json({ error: 'User mismatch' });
  }
  if (tokenData.threadId && requestedThreadId && tokenData.threadId !== requestedThreadId) {
    return res.status(403).json({ error: 'Thread mismatch' });
  }

  return SSEHandler.handleConnection()(req, res);
});

// Endpoint para receber publicação do Redis (chamado pela edge function)
app.post('/publish', async (req, res) => {
  if (!(res.locals as any).isServiceToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { channel, message } = req.body;
  
  if (!channel || !message) {
    return res.status(400).json({ error: 'channel e message são obrigatórios' });
  }
  
  try {
    await redis.publish(channel, message);
    res.json({ success: true, message: 'Evento publicado no Redis' });
  } catch (error) {
    console.error('[SSE-SERVER] Erro ao publicar no Redis:', error);
    res.status(500).json({ error: 'Erro ao publicar no Redis' });
  }
});

// Endpoint para enviar mensagem de teste (debug)
app.post('/test', async (req, res) => {
  if (!(res.locals as any).isServiceToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { user_id, thread_id, message, role, type, audio_base64 } = req.body;
  
  if (!user_id || !thread_id || !message) {
    return res.status(400).json({ error: 'user_id, thread_id e message são obrigatórios' });
  }
  
  // Publicar no Redis (mesmo fluxo da edge function)
  const event = {
    user_id,
    thread_id,
    message,
    role: role || 'assistant',
    type: type || 'text',
    audio_base64,
    timestamp: new Date().toISOString(),
  };
  
  await redis.publish('chat:events', JSON.stringify(event));
  
  res.json({ success: true, message: 'Evento publicado no Redis' });
});

// Escutar eventos do Redis
async function setupRedisSubscription() {
  try {
    const subscriber = redis.duplicate();
    await subscriber.connect();
    
    await subscriber.subscribe('chat:events', (message: string) => {
      try {
        const event = JSON.parse(message);
        console.log('[SSE-SERVER] 📨 Evento recebido do Redis:', event.user_id, event.thread_id);
        void SSEHandler.storeAndBroadcast(event);
      } catch (error) {
        console.error('[SSE-SERVER] ❌ Erro ao processar evento do Redis:', error);
      }
    });
    
    console.log('[SSE-SERVER] ✅ Inscrito no canal chat:events do Redis');
  } catch (error) {
    console.error('[SSE-SERVER] ❌ Erro ao configurar subscription Redis:', error);
  }
}

// Inicializar e iniciar servidor
initialize().then(async () => {
  await setupRedisSubscription();
  
  // Iniciar servidor
  app.listen(PORT, () => {
    console.log(`[SSE-SERVER] 🚀 Servidor SSE rodando na porta ${PORT}`);
    console.log(`[SSE-SERVER] 📊 Status: http://localhost:${PORT}/status`);
    console.log(`[SSE-SERVER] 🐛 Debug: http://localhost:${PORT}/debug`);
    console.log(`[SSE-SERVER] 🔌 SSE: http://localhost:${PORT}/sse`);
  });
}).catch((error) => {
  console.error('[SSE-SERVER] ❌ Erro ao inicializar:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[SSE-SERVER] ⚠️  SIGTERM recebido, encerrando...');
  await redis.quit();
  process.exit(0);
});
