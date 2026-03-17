import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { AgentOrchestrator } from './agent-orchestrator';
import { ProcessMessageRequest } from './types';
import { SupabaseClientService } from './supabase-client';
import { RedisClient } from './redis-client';
import { buildSignatureBase, hmacHex, safeEqualHex, sha256Hex } from './utils/lidfe-signature';
import { createSseToken } from './utils/sse-token';

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;
const AGENT_AUTH_TOKEN = process.env.LIDFE_AUTH_TOKEN || process.env.AGENT_IA_AUTH_TOKEN || '';
const LIDFE_HMAC_TTL_SECONDS = parseInt(process.env.LIDFE_HMAC_TTL_SECONDS || '60', 10);
const LIDFE_HMAC_CLOCK_SKEW_SECONDS = parseInt(process.env.LIDFE_HMAC_CLOCK_SKEW_SECONDS || '5', 10);
const LIDFE_HMAC_ENFORCE = process.env.LIDFE_HMAC_ENFORCE === 'true';
const LIDFE_SSE_TOKEN_TTL_SECONDS = parseInt(process.env.LIDFE_SSE_TOKEN_TTL_SECONDS || '300', 10);

// Middleware CORS (primeiro, para permitir requisições do frontend)
app.use(cors({
  origin: '*', // Permitir todas as origens (em produção, especificar domínios)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Middleware de log para todas as requisições (ANTES do body parser para capturar método e path)
app.use((req, res, next) => {
  console.log('');
  console.log('[AGENT-IA] ==========================================');
  console.log('[AGENT-IA] 📥 REQUISIÇÃO RECEBIDA');
  console.log('[AGENT-IA] ==========================================');
  console.log('[AGENT-IA] Método:', req.method);
  console.log('[AGENT-IA] Path:', req.path);
  console.log('[AGENT-IA] URL completa:', req.url);
  console.log('[AGENT-IA] Query params:', JSON.stringify(req.query, null, 2));
  const safeHeaders = { ...req.headers } as Record<string, any>;
  if (safeHeaders.authorization) safeHeaders.authorization = 'Bearer [REDACTED]';
  if (safeHeaders['x-api-key']) safeHeaders['x-api-key'] = '[REDACTED]';
  if (safeHeaders.apikey) safeHeaders.apikey = '[REDACTED]';
  if (safeHeaders.cookie) safeHeaders.cookie = '[REDACTED]';
  console.log('[AGENT-IA] Headers:', JSON.stringify(safeHeaders, null, 2));
  console.log('[AGENT-IA] ==========================================');
  next();
});

// Normalizar prefixo /agent quando o Traefik não aplicar strip corretamente
app.use((req, _res, next) => {
  if (req.url.startsWith('/agent/')) {
    req.url = req.url.replace(/^\/agent/, '');
  }
  next();
});

// Body parser (DEPOIS do log inicial)
app.use(express.json({
  limit: '30mb',
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf.toString('utf8');
  },
}));

// Middleware adicional para logar body após parsing
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
    const safeBody = { ...req.body } as Record<string, any>;
    if (typeof safeBody.audioBase64 === 'string') {
      safeBody.audioBase64 = `[base64:${safeBody.audioBase64.length}]`;
    }
    if (typeof safeBody.fileBase64 === 'string') {
      safeBody.fileBase64 = `[base64:${safeBody.fileBase64.length}]`;
    }
    if (typeof safeBody.message === 'string' && safeBody.message.length > 200) {
      safeBody.message = `${safeBody.message.substring(0, 200)}...`;
    }
    console.log('[AGENT-IA] 📦 Body recebido:', JSON.stringify(safeBody, null, 2));
  }
  next();
});

// Verificar variáveis de ambiente obrigatórias
// Gemini API Key pode vir de variável de ambiente ou de arquivo (Docker Secret)
let GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Se não estiver em variável de ambiente, tentar ler do arquivo (Docker Secret)
if (!GEMINI_API_KEY && process.env.GEMINI_API_KEY_FILE) {
  try {
    const secretPath = process.env.GEMINI_API_KEY_FILE;
    if (fs.existsSync(secretPath)) {
      GEMINI_API_KEY = fs.readFileSync(secretPath, 'utf8').trim();
      console.log('[CONFIG] ✅ Gemini API Key lida do Docker Secret');
    }
  } catch (error: any) {
    console.warn('[CONFIG] ⚠️  Erro ao ler Gemini API Key do arquivo:', error.message);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xradpyucukbqaulzhdab.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Service Role Key tem permissões administrativas e bypassa RLS
// É necessário para salvar mensagens no banco de dados
// Pode vir de variável de ambiente ou de arquivo (Docker Secret)
let SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let SUPABASE_SERVICE_JWT = process.env.SUPABASE_SERVICE_JWT;

// Se não estiver em variável de ambiente, tentar ler do arquivo (Docker Secret)
if (!SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY_FILE) {
  try {
    const secretPath = process.env.SUPABASE_SERVICE_ROLE_KEY_FILE;
    if (fs.existsSync(secretPath)) {
      SUPABASE_SERVICE_ROLE_KEY = fs.readFileSync(secretPath, 'utf8').trim();
      console.log('[CONFIG] ✅ Service Role Key lida do Docker Secret');
    }
  } catch (error: any) {
    console.warn('[CONFIG] ⚠️  Erro ao ler Service Role Key do arquivo:', error.message);
  }
}

if (!SUPABASE_SERVICE_JWT && process.env.SUPABASE_SERVICE_JWT_FILE) {
  try {
    const secretPath = process.env.SUPABASE_SERVICE_JWT_FILE;
    if (fs.existsSync(secretPath)) {
      SUPABASE_SERVICE_JWT = fs.readFileSync(secretPath, 'utf8').trim();
      console.log('[CONFIG] ✅ Service JWT lida do Docker Secret');
    }
  } catch (error: any) {
    console.warn('[CONFIG] ⚠️  Erro ao ler Service JWT do arquivo:', error.message);
  }
}

const SUPABASE_SERVICE_KEY = SUPABASE_SERVICE_JWT || SUPABASE_SERVICE_ROLE_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ ERRO: GEMINI_API_KEY não configurada!');
  process.exit(1);
}

// Verificar se SERVICE_ROLE_KEY está disponível (obrigatória para operações de escrita)
if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ ERRO: SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SERVICE_JWT não configurada! Necessária para acesso administrativo.');
  process.exit(1);
}

if (!AGENT_AUTH_TOKEN) {
  console.error('❌ ERRO: LIDFE_AUTH_TOKEN/AGENT_IA_AUTH_TOKEN não configurada! Necessária para autenticação das rotas do agente.');
  process.exit(1);
}

// Inicializar orquestrador do agente
let agentOrchestrator: AgentOrchestrator | null = null;
let supabaseAdmin: SupabaseClientService | null = null;
try {
  if (!GEMINI_API_KEY || !SUPABASE_SERVICE_KEY) {
    throw new Error('GEMINI_API_KEY e SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_JWT são obrigatórios');
  }
  
  // Redis URL (opcional, padrão do Docker Swarm)
  const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
  
  agentOrchestrator = new AgentOrchestrator(
    GEMINI_API_KEY,
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY!, // Usar service key para operações administrativas
    REDIS_URL // Redis para coordenação
  );
  supabaseAdmin = new SupabaseClientService(SUPABASE_URL, SUPABASE_SERVICE_KEY!);
  console.log('✅ AgentOrchestrator inicializado');
  if (SUPABASE_SERVICE_JWT) {
    console.log('✅ Usando SUPABASE_SERVICE_JWT (role lidfe_service)');
  } else if (SUPABASE_SERVICE_ROLE_KEY) {
    console.log('✅ Usando SUPABASE_SERVICE_ROLE_KEY (bypassa RLS)');
  } else if (SUPABASE_ANON_KEY) {
    console.warn('⚠️  Usando SUPABASE_ANON_KEY (pode ter restrições de RLS)');
  }
} catch (error: any) {
  console.error('❌ Erro ao inicializar AgentOrchestrator:', error);
  process.exit(1);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  🚀 AGENTE IA - LIDFE');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('📋 CONFIGURAÇÃO:');
console.log(`   Porta: ${PORT}`);
console.log(`   Ambiente: ${process.env.NODE_ENV || 'not set'}`);
console.log('');
      console.log('🔑 CHAVES DE API:');
      if (GEMINI_API_KEY) {
        console.log(`   ✅ Gemini API Key: configurada (${GEMINI_API_KEY.length} caracteres)`);
      } else {
        console.log('   ❌ Gemini API Key: NÃO CONFIGURADA!');
      }
      if (SUPABASE_SERVICE_JWT) {
        console.log(`   ✅ Supabase Service JWT: configurada (${SUPABASE_SERVICE_JWT.length} caracteres)`);
      } else if (SUPABASE_SERVICE_ROLE_KEY) {
        console.log(`   ✅ Supabase Service Role Key: configurada (${SUPABASE_SERVICE_ROLE_KEY.length} caracteres) - BYPASSA RLS`);
      } else if (SUPABASE_ANON_KEY) {
        console.log(`   ⚠️  Supabase Anon Key: configurada (${SUPABASE_ANON_KEY.length} caracteres) - PODE TER RESTRIÇÕES RLS`);
      } else {
        console.log('   ❌ Supabase Key: NÃO CONFIGURADA');
      }
console.log(`   ✅ Supabase URL: ${SUPABASE_URL}`);
console.log(`   ✅ Auth Token: configurado (${AGENT_AUTH_TOKEN.length} caracteres)`);
console.log('');
console.log('🌐 ENDPOINTS:');
// Health check removido para evitar chamadas frequentes que pressionam o backend

const SUPABASE_AUTH_KEY = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_JWT || '';
const supabaseAuthClient = SUPABASE_AUTH_KEY
  ? createClient(SUPABASE_URL, SUPABASE_AUTH_KEY)
  : null;

function extractAuthToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
    return apiKey.trim();
  }
  const queryToken = (req.query.token || req.query.auth_token) as string | string[] | undefined;
  if (Array.isArray(queryToken)) {
    return queryToken[0];
  }
  if (typeof queryToken === 'string' && queryToken.trim().length > 0) {
    return queryToken.trim();
  }
  return undefined;
}

async function getUserIdFromJwt(token: string): Promise<string | null> {
  if (!supabaseAuthClient) {
    console.error('[AUTH] Supabase auth client não configurado (SUPABASE_ANON_KEY ausente).');
    return null;
  }
  try {
    const { data, error } = await supabaseAuthClient.auth.getUser(token);
    if (error || !data?.user) {
      return null;
    }
    return data.user.id;
  } catch (error) {
    console.error('[AUTH] Erro ao validar JWT:', error);
    return null;
  }
}

const nonceCache = new Map<string, number>();
let authRedis: RedisClient | null = null;
let authRedisReady = false;

async function getAuthRedis(): Promise<RedisClient | null> {
  if (!process.env.REDIS_URL) return null;
  if (authRedisReady && authRedis) return authRedis;
  try {
    authRedis = authRedis ?? new RedisClient(process.env.REDIS_URL);
    await authRedis.connect();
    authRedisReady = true;
    return authRedis;
  } catch (error: any) {
    console.warn('[AUTH] ⚠️ Redis indisponível para nonce (fallback em memória):', error.message);
    authRedisReady = false;
    return null;
  }
}

function cleanupNonceCache(nowSec: number) {
  for (const [key, expiresAt] of nonceCache.entries()) {
    if (expiresAt <= nowSec) {
      nonceCache.delete(key);
    }
  }
}

async function checkAndStoreNonce(nonce: string, ttlSeconds: number): Promise<boolean> {
  const maxDrift = ttlSeconds + LIDFE_HMAC_CLOCK_SKEW_SECONDS;
  const redis = await getAuthRedis();
  if (redis) {
    const key = `lidfe:nonce:${nonce}`;
    const existing = await redis.get(key);
    if (existing) return false;
    await redis.set(key, '1', maxDrift);
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  cleanupNonceCache(now);
  if (nonceCache.has(nonce)) return false;
  nonceCache.set(nonce, now + maxDrift);
  return true;
}

async function verifyServiceSignature(req: Request): Promise<boolean> {
  if (!AGENT_AUTH_TOKEN) return false;
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

  const signatureBase = buildSignatureBase({
    ts,
    nonce: nonceHeader,
    method: req.method,
    path: req.path,
    bodyHash,
  });
  const expected = hmacHex(AGENT_AUTH_TOKEN, signatureBase);
  if (!safeEqualHex(expected, sigHeader)) return false;

  return checkAndStoreNonce(nonceHeader, LIDFE_HMAC_TTL_SECONDS);
}

// Middleware de autenticação para todas as rotas do agente
app.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  // /consulta permanece público para validação de documentos assinados
  if (req.path === '/consulta' && req.method === 'GET') return next();
  const token = extractAuthToken(req);
  const signatureValid = await verifyServiceSignature(req);
  if (!token) {
    if (!signatureValid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const bearerIsService = token === AGENT_AUTH_TOKEN;
  const isServiceToken = signatureValid || (bearerIsService && !LIDFE_HMAC_ENFORCE);
  (res.locals as any).isServiceToken = isServiceToken;

  const isAdminRoute = req.path === '/config/check' || req.path.startsWith('/test');
  // Rotas administrativas exigem token de serviço
  if (isAdminRoute && !isServiceToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (isAdminRoute && isServiceToken) {
    return next();
  }

  // Permitir token de serviço somente se explicitamente habilitado
  if (isServiceToken && process.env.ALLOW_SERVICE_TOKEN_FOR_AGENT === 'true') {
    return next();
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Validar JWT do Supabase para todas as rotas de usuário
  const authUserId = await getUserIdFromJwt(token);
  if (!authUserId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  (res.locals as any).authUserId = authUserId;

  const bodyUserId = (req.body?.userId || req.body?.user_id) as string | undefined;
  const queryUserId = (req.query.user_id || req.query.userId) as string | undefined;
  const claimedUserId = bodyUserId || queryUserId;

  if (claimedUserId && claimedUserId !== authUserId) {
    return res.status(403).json({ error: 'User mismatch' });
  }

  return next();
});


// Endpoint de verificação de configuração (para debug/deploy)
app.get('/config/check', (req: Request, res: Response) => {
  const config = {
    service: 'agent-ia',
    timestamp: new Date().toISOString(),
    environment: {
      port: PORT,
      nodeEnv: process.env.NODE_ENV || 'not set',
    },
    apiKeys: {
      gemini: {
        configured: !!GEMINI_API_KEY,
        keyLength: GEMINI_API_KEY ? GEMINI_API_KEY.length : 0,
        keyPreview: GEMINI_API_KEY ? '[REDACTED]' : 'NOT CONFIGURED',
      },
            supabase: {
              url: SUPABASE_URL ? 'configured' : 'not configured',
              serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY ? {
                configured: true,
                keyLength: SUPABASE_SERVICE_ROLE_KEY.length,
                keyPreview: '[REDACTED]',
                bypassesRLS: true,
              } : {
                configured: false,
              },
              serviceJwt: SUPABASE_SERVICE_JWT ? {
                configured: true,
                keyLength: SUPABASE_SERVICE_JWT.length,
                keyPreview: '[REDACTED]',
                bypassesRLS: false,
                role: 'lidfe_service',
              } : {
                configured: false,
              },
              anonKey: SUPABASE_ANON_KEY ? {
                configured: true,
                keyLength: SUPABASE_ANON_KEY.length,
                keyPreview: '[REDACTED]',
                bypassesRLS: false,
              } : {
                configured: false,
              },
              keyInUse: SUPABASE_SERVICE_JWT ? 'service_jwt (role lidfe_service)' : SUPABASE_SERVICE_ROLE_KEY ? 'service_role (bypasses RLS)' : SUPABASE_ANON_KEY ? 'anon (may have RLS restrictions)' : 'none',
            },
    },
    status: GEMINI_API_KEY ? 'ready' : 'error',
    message: GEMINI_API_KEY 
      ? '✅ Agente IA configurado corretamente' 
      : '❌ ERRO: GEMINI_API_KEY não configurada!',
  };

  // Retornar status HTTP apropriado
  const statusCode = GEMINI_API_KEY ? 200 : 503;
  res.status(statusCode).json(config);
});

// Endpoint para emitir token curto do SSE (exige JWT do usuário)
app.post('/sse/token', (req: Request, res: Response) => {
  const authUserId = (res.locals as any).authUserId as string | undefined;
  if (!authUserId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if ((res.locals as any).isServiceToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const threadId = (req.body?.threadId || req.body?.thread_id) as string | undefined;
  if (!threadId) {
    return res.status(400).json({ error: 'threadId é obrigatório' });
  }

  const token = createSseToken({
    secret: AGENT_AUTH_TOKEN,
    userId: authUserId,
    threadId,
    ttlSeconds: LIDFE_SSE_TOKEN_TTL_SECONDS,
  });

  return res.json({
    token,
    expires_in: LIDFE_SSE_TOKEN_TTL_SECONDS,
    token_type: 'lidfe_sse',
  });
});

// Endpoint de teste (para verificar se o roteamento está funcionando)
app.get('/test', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'Roteamento funcionando!',
    timestamp: new Date().toISOString(),
    path: req.path,
    url: req.url,
  });
});

// Endpoint público para validar/visualizar documentos assinados
// Ex: GET /consulta?exame_id=123
app.get('/consulta', async (req: Request, res: Response) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).send('Supabase admin não inicializado');
    }

    const exameIdParam = (req.query.exame_id || req.query.exameId) as string | undefined;
    if (!exameIdParam) {
      return res.status(400).send('Parâmetro exame_id é obrigatório');
    }

    const exameId = Number(exameIdParam);
    if (!Number.isFinite(exameId)) {
      return res.status(400).send('Parâmetro exame_id inválido');
    }

    const exam = await supabaseAdmin.getTaskExameById(exameId);
    if (!exam || !exam.urlpdf) {
      return res.status(404).send('Documento não encontrado');
    }

    return res.redirect(302, exam.urlpdf);
  } catch (error: any) {
    console.error('[AGENT-IA] ❌ Erro no endpoint /consulta:', error);
    return res.status(500).send('Erro interno');
  }
});

// Gerar guia de exame via backend (usa Service Role Key - NÃO expor no frontend)
app.post('/exames/generate-pdf', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Authorization Bearer token ausente' });
    }
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Supabase admin não inicializado' });
    }

    const { exameId } = req.body || {};
    if (!exameId) {
      return res.status(400).json({ error: 'exameId é obrigatório' });
    }

    // Validar usuário via JWT
    const supabaseAuthKey = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_JWT;
    if (!supabaseAuthKey) {
      return res.status(500).json({ error: 'Supabase Key não configurada para validar usuário' });
    }

    const supabaseAuth = createClient(SUPABASE_URL, supabaseAuthKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !userData?.user) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    // Validar propriedade do exame
    const exam = await supabaseAdmin.getTaskExameById(Number(exameId));
    if (!exam) {
      return res.status(404).json({ error: 'Exame não encontrado' });
    }
    if (exam.user_id !== userData.user.id) {
      return res.status(403).json({ error: 'Exame não pertence ao usuário' });
    }

    if (exam.urlpdf) {
      return res.json({ success: true, pdf_url: exam.urlpdf, exame_id: exam.id });
    }

    const result = await supabaseAdmin.generateSignedExamById(Number(exameId), userData.user.id);
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || 'Falha ao gerar PDF' });
    }

    return res.json({ success: true, pdf_url: result.pdf_url, exame_id: exam.id });
  } catch (error: any) {
    console.error('[AGENT-IA] ❌ Erro ao gerar guia PDF:', error);
    return res.status(500).json({ error: error.message || 'Erro interno' });
  }
});

// Endpoint para anexos (base64) e envio ao Gemini no contexto da conversa
app.post('/attachments', async (req: Request, res: Response) => {
  try {
    const {
      threadId,
      userId,
      message,
      fileBase64,
      fileType,
      fileMimeType,
      fileName,
      fileSize,
    } = req.body || {};

    if (!threadId || !userId || !fileBase64) {
      return res.status(400).json({
        error: 'Campos obrigatórios: threadId, userId, fileBase64',
      });
    }

    if (!agentOrchestrator) {
      return res.status(500).json({ error: 'AgentOrchestrator não inicializado' });
    }

    const request: ProcessMessageRequest = {
      threadId,
      userId,
      message: message || '',
      messageType: 'file',
      fileBase64,
      fileType: fileType as 'pdf' | 'image' | undefined,
      fileMimeType,
      fileName,
      fileSize,
    };

    const response = await agentOrchestrator.processMessage(request);
    return res.json(response);
  } catch (error: any) {
    console.error('[AGENT-IA] ❌ Erro no endpoint /attachments:', error);
    return res.status(500).json({
      error: 'Erro ao processar anexo',
      message: error.message || 'Erro desconhecido',
    });
  }
});

// Endpoint de teste para executar diretamente a function solicitar_exames
// Permite testar o deep-research sem passar pelo fluxo completo do modelo
app.post('/test/solicitar-exames', async (req: Request, res: Response) => {
  console.log('');
  console.log('[AGENT-IA] ==========================================');
  console.log('[AGENT-IA] 🧪 ENDPOINT DE TESTE /test/solicitar-exames');
  console.log('[AGENT-IA] ==========================================');
  
  try {
    const { threadId, userId, functionArgs } = req.body;
    
    if (!threadId || !userId || !functionArgs) {
      return res.status(400).json({
        error: 'Campos obrigatórios: threadId, userId, functionArgs',
      });
    }

    if (!agentOrchestrator) {
      return res.status(500).json({
        error: 'AgentOrchestrator não inicializado',
      });
    }

    // Criar FunctionExecutor diretamente para o teste
    const { FunctionExecutor } = await import('./function-executor');
    const { SupabaseClientService } = await import('./supabase-client');
    const { RedisClient } = await import('./redis-client');
    
    const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
    const supabaseClient = new SupabaseClientService(SUPABASE_URL, SUPABASE_SERVICE_KEY!);
    const redisClient = new RedisClient(REDIS_URL);
    const functionExecutor = new FunctionExecutor(
      supabaseClient,
      GEMINI_API_KEY!,
      redisClient
    );

    console.log('[AGENT-IA] Executando function solicitar_exames diretamente...');
    console.log('[AGENT-IA] Thread:', threadId);
    console.log('[AGENT-IA] User:', userId);
    console.log('[AGENT-IA] Args:', JSON.stringify(functionArgs, null, 2));

    const result = await functionExecutor.executeFunction(
      'solicitar_exames',
      functionArgs,
      threadId,
      userId
    );

    console.log('[AGENT-IA] ✅ Function executada com sucesso');
    console.log('[AGENT-IA] Resultado:', JSON.stringify(result, null, 2));

    res.json({
      success: true,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[AGENT-IA] ❌ Erro no endpoint de teste:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
  }
});

// Endpoint principal: processar mensagem (com rate limiting)
// Timeout de 5 minutos para processamento longo (transcrições, etc.)
app.post('/process-message', async (req: Request, res: Response) => {
  // Configurar timeout de 5 minutos
  req.setTimeout(300000); // 5 minutos
  res.setTimeout(300000); // 5 minutos
  console.log('');
  console.log('[AGENT-IA] ==========================================');
  console.log('[AGENT-IA] 📨 ENDPOINT /process-message CHAMADO');
  console.log('[AGENT-IA] ==========================================');
  console.log('[AGENT-IA] Timestamp:', new Date().toISOString());
  console.log('[AGENT-IA] Path:', req.path);
  console.log('[AGENT-IA] URL:', req.url);
  const safeHeaders = { ...req.headers } as Record<string, any>;
  if (safeHeaders.authorization) safeHeaders.authorization = 'Bearer [REDACTED]';
  if (safeHeaders['x-api-key']) safeHeaders['x-api-key'] = '[REDACTED]';
  if (safeHeaders.apikey) safeHeaders.apikey = '[REDACTED]';
  if (safeHeaders.cookie) safeHeaders.cookie = '[REDACTED]';
  console.log('[AGENT-IA] Headers:', JSON.stringify(safeHeaders, null, 2));
  const safeBody = { ...req.body } as Record<string, any>;
  if (typeof safeBody.audioBase64 === 'string') {
    safeBody.audioBase64 = `[base64:${safeBody.audioBase64.length}]`;
  }
  if (typeof safeBody.fileBase64 === 'string') {
    safeBody.fileBase64 = `[base64:${safeBody.fileBase64.length}]`;
  }
  if (typeof safeBody.message === 'string' && safeBody.message.length > 200) {
    safeBody.message = `${safeBody.message.substring(0, 200)}...`;
  }
  console.log('[AGENT-IA] Body:', JSON.stringify(safeBody, null, 2));
  console.log('[AGENT-IA] ==========================================');
  
  try {
    const {
      threadId,
      userId,
      message,
      audioBase64,
      messageType = 'text',
      userName,
      userEmail,
      userCpf,
      // Campos para arquivos de exame (PDF ou imagem)
      fileUrl,
      fileBase64,
      fileType,
      fileMimeType,
      fileName,
      fileSize,
    } = req.body;
    
    console.log('[AGENT-IA] Dados extraídos:');
    console.log('[AGENT-IA]   - threadId:', threadId);
    console.log('[AGENT-IA]   - userId:', userId);
    console.log('[AGENT-IA]   - message:', message?.substring(0, 100) || '(vazio)');
    console.log('[AGENT-IA]   - messageType:', messageType);
    console.log('[AGENT-IA]   - audioBase64:', audioBase64 ? `presente (${audioBase64.length} chars)` : 'não presente');

    if (!threadId || !userId || (!message && !audioBase64)) {
      console.log('[AGENT-IA] ❌ ERRO: Campos obrigatórios faltando');
      console.log('[AGENT-IA]   - threadId:', threadId ? 'presente' : 'FALTANDO');
      console.log('[AGENT-IA]   - userId:', userId ? 'presente' : 'FALTANDO');
      console.log('[AGENT-IA]   - message:', message ? 'presente' : 'FALTANDO');
      console.log('[AGENT-IA]   - audioBase64:', audioBase64 ? 'presente' : 'FALTANDO');
      return res.status(400).json({
        error: 'Campos obrigatórios: threadId, userId, message (ou audioBase64)',
      });
    }

    if (!agentOrchestrator) {
      console.log('[AGENT-IA] ❌ ERRO: AgentOrchestrator não inicializado');
      return res.status(500).json({
        error: 'AgentOrchestrator não inicializado',
      });
    }

    console.log(`[AGENT-IA] ✅ Dados válidos, processando mensagem...`);
    console.log(`[AGENT-IA] Thread: ${threadId}, User: ${userId}`);

    // Preparar request
    const request: ProcessMessageRequest = {
      threadId,
      userId,
      message: message || '',
      audioBase64,
      messageType: (fileUrl || fileBase64) ? 'file' : (messageType as 'text' | 'audio'),
      userName,
      userEmail,
      userCpf,
      // Campos para arquivos de exame
      fileUrl,
      fileBase64,
      fileType: fileType as 'pdf' | 'image' | undefined,
      fileMimeType,
      fileName,
      fileSize,
    };

    // Processar mensagem
    const response = await agentOrchestrator.processMessage(request);

    console.log(`[AGENT-IA] ✅ Resposta gerada - Type: ${response.type}, HasFunctionCall: ${response.hasFunctionCall}`);
    console.log(`[AGENT-IA] 📤 Enviando resposta ao frontend:`, JSON.stringify({
      message: response.message?.substring(0, 100) + '...',
      type: response.type,
      hasFunctionCall: response.hasFunctionCall,
      audioBase64: response.audioBase64 ? `[${response.audioBase64.length} bytes]` : null,
    }));

    // Verificar se a resposta já foi enviada
    if (res.headersSent) {
      console.error('[AGENT-IA] ⚠️ Resposta já foi enviada, ignorando...');
      return;
    }

    // Enviar resposta
    try {
      res.json(response);
      console.log(`[AGENT-IA] ✅ Resposta enviada ao frontend com sucesso`);
    } catch (sendError: any) {
      console.error('[AGENT-IA] ❌ Erro ao enviar resposta:', sendError);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Erro ao enviar resposta',
          message: sendError.message,
        });
      }
    }
  } catch (error: any) {
    console.error('[AGENT-IA] ❌ Erro ao processar mensagem:', error);
    console.error('[AGENT-IA] Stack trace:', error.stack);
    
    // Verificar se a resposta já foi enviada
    if (!res.headersSent) {
      // Verificar se é erro de rate limit (429)
      if (error.message === 'RATE_LIMIT_429' || error.message?.includes('Rate limit')) {
        res.status(429).json({
          error: 'RATE_LIMIT',
          message: 'Limite de requisições excedido. Por favor, aguarde 1 minuto antes de tentar novamente.',
          retryAfter: 60, // 60 segundos
        });
      } else {
        res.status(500).json({
          error: 'Erro ao processar mensagem',
          message: error.message || 'Erro desconhecido',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
      }
    } else {
      console.error('[AGENT-IA] ⚠️ Resposta já foi enviada, não é possível enviar erro');
    }
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor Agente IA rodando na porta ${PORT}`);
});
