import fs from 'node:fs';

function readSecret(envVar: string, fileVar?: string): string {
  if (fileVar) {
    const filePath = process.env[fileVar];
    if (filePath) {
      try {
        return fs.readFileSync(filePath, 'utf8').trim();
      } catch {
        // fall through to env var
      }
    }
  }
  return process.env[envVar] || '';
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  supabaseUrl: process.env.SUPABASE_URL || 'https://xradpyucukbqaulzhdab.supabase.co',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: readSecret('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY_FILE'),

  authToken: process.env.LIDFE_AUTH_TOKEN || '',
  hmacEnforce: process.env.LIDFE_HMAC_ENFORCE === 'true',
  hmacTtlSeconds: parseInt(process.env.LIDFE_HMAC_TTL_SECONDS || '60', 10),
  hmacClockSkewSeconds: parseInt(process.env.LIDFE_HMAC_CLOCK_SKEW_SECONDS || '5', 10),

  publicDir: process.env.PUBLIC_DIR || 'public',
} as const;

export function validateConfig(): void {
  const required = [
    ['SUPABASE_ANON_KEY', config.supabaseAnonKey],
    ['SUPABASE_SERVICE_ROLE_KEY', config.supabaseServiceKey],
    ['LIDFE_AUTH_TOKEN', config.authToken],
  ] as const;

  for (const [name, value] of required) {
    if (!value) {
      console.error(`[BACKEND] Variável obrigatória não configurada: ${name}`);
      process.exit(1);
    }
  }
}
