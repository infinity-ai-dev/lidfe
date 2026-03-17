import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

// Cliente com service role key — bypassa RLS, uso interno apenas
let _serviceClient: SupabaseClient | null = null;
export function getServiceClient(): SupabaseClient {
  if (!_serviceClient) {
    _serviceClient = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false },
    });
  }
  return _serviceClient;
}

// Cliente com anon key — respeita RLS, uso em operações autenticadas pelo JWT do usuário
export function getUserClient(accessToken: string): SupabaseClient {
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  return client;
}

// Valida JWT do Supabase e retorna o userId
export async function validateSupabaseJwt(token: string): Promise<string | null> {
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: config.supabaseAnonKey,
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { id?: string };
    return typeof data?.id === 'string' && data.id.trim() ? data.id : null;
  } catch {
    return null;
  }
}

// Chama uma Supabase Edge Function com service role key
export async function callEdgeFunction(
  functionName: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const url = `${config.supabaseUrl}/functions/v1/${functionName}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.supabaseServiceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Edge function ${functionName} falhou (${response.status}): ${text}`);
  }

  return response.json();
}
