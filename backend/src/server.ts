import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { config, validateConfig } from './config';
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/error';
import healthRouter from './routes/health';
import examesRouter from './routes/exames';
import prescricaoRouter from './routes/prescricao';
import anamneseRouter from './routes/anamnese';

validateConfig();

const app = express();

// ─── Segurança e parsing ──────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: false, // Expo web usa scripts inline
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody: string }).rawBody = buf.toString('utf8');
  },
}));

// ─── Log de requests ──────────────────────────────────────────────────────────

app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[BACKEND] ${req.method} ${req.path}`);
  }
  next();
});

// ─── Rotas de API (autenticadas) ─────────────────────────────────────────────

app.use('/api/health', healthRouter);
app.use('/api/exames', requireAuth, examesRouter);
app.use('/api/prescricao', requireAuth, prescricaoRouter);
app.use('/api/anamnese', requireAuth, anamneseRouter);

// ─── Frontend estático (Expo web build) ───────────────────────────────────────

const publicDir = path.resolve(__dirname, '..', config.publicDir);
app.use(express.static(publicDir));

// SPA fallback — qualquer rota não-API retorna index.html
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use(errorHandler);

// ─── Iniciar servidor ─────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[BACKEND] Servidor iniciado na porta ${config.port} (${config.nodeEnv})`);
  console.log(`[BACKEND] Supabase URL:    ${config.supabaseUrl}`);
  console.log(`[BACKEND] Service Key:     ${config.supabaseServiceKey ? '✅ configurada' : '❌ NÃO CONFIGURADA'}`);
  console.log(`[BACKEND] Anon Key:        ${config.supabaseAnonKey ? '✅ configurada' : '❌ NÃO CONFIGURADA'}`);
  console.log(`[BACKEND] Auth Token:      ${config.authToken ? '✅ configurado' : '❌ NÃO CONFIGURADO'}`);
  console.log(`[BACKEND] HMAC Enforce:    ${config.hmacEnforce}`);
  console.log(`[BACKEND] Static dir:      ${publicDir}`);
});

process.on('SIGTERM', () => {
  console.log('[BACKEND] SIGTERM recebido, encerrando...');
  process.exit(0);
});
