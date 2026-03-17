import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const textEncoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
  return toHex(digest);
}

function getClientIp(req: Request): string | null {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    null
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const token = body?.token as string | undefined;
    const consume = Boolean(body?.consume);

    if (!token || typeof token !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Token inválido.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user?.email) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const tokenHash = await sha256(token);
    const email = user.email.toLowerCase();

    const { data: tokenRow, error: tokenError } = await adminClient
      .from('password_recovery_tokens')
      .select('id, used_at, expires_at')
      .eq('token_hash', tokenHash)
      .eq('email', email)
      .maybeSingle();

    if (tokenError || !tokenRow) {
      return new Response(
        JSON.stringify({ error: 'Token inválido ou expirado.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (tokenRow.used_at) {
      return new Response(
        JSON.stringify({ error: 'Token já utilizado.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (tokenRow.expires_at && Date.parse(tokenRow.expires_at) <= Date.now()) {
      return new Response(
        JSON.stringify({ error: 'Token expirado.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (consume) {
      const usedIp = getClientIp(req);
      const usedUserAgent = req.headers.get('user-agent');

      const { data: updatedRows, error: updateError } = await adminClient
        .from('password_recovery_tokens')
        .update({
          used_at: new Date().toISOString(),
          used_ip: usedIp,
          used_user_agent: usedUserAgent,
        })
        .eq('id', tokenRow.id)
        .is('used_at', null)
        .select('id');

      if (updateError || !updatedRows || updatedRows.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Token já utilizado.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[VERIFY-PASSWORD-RECOVERY-TOKEN] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Falha ao validar token.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
