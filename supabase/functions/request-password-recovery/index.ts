import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const textEncoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

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
  const raw =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    null;

  if (!raw) return null;
  const first = raw.split(',')[0]?.trim();
  return first || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email || typeof email !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Email inválido.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return new Response(
        JSON.stringify({ error: 'Email inválido.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const maxPerEmailPerHour = Number(Deno.env.get('RECOVERY_RATE_LIMIT_EMAIL_PER_HOUR') ?? '5');
    const maxPerIpPerHour = Number(Deno.env.get('RECOVERY_RATE_LIMIT_IP_PER_HOUR') ?? '10');
    const cooldownSeconds = Number(Deno.env.get('RECOVERY_RATE_LIMIT_EMAIL_COOLDOWN_SECONDS') ?? '60');

    const now = Date.now();
    const hourWindowStart = new Date(now - 60 * 60 * 1000).toISOString();
    const cooldownWindowStart = new Date(now - cooldownSeconds * 1000).toISOString();

    const { count: emailCount, error: emailCountError } = await supabase
      .from('password_recovery_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('email', normalizedEmail)
      .gte('created_at', hourWindowStart);

    if (emailCountError) {
      console.error('[REQUEST-PASSWORD-RECOVERY] Rate limit email count error:', emailCountError);
      return new Response(
        JSON.stringify({ error: 'Não foi possível processar a solicitação.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (emailCount !== null && emailCount >= maxPerEmailPerHour) {
      return new Response(
        JSON.stringify({ error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (cooldownSeconds > 0) {
      const { count: cooldownCount, error: cooldownError } = await supabase
        .from('password_recovery_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('email', normalizedEmail)
        .gte('created_at', cooldownWindowStart);

      if (cooldownError) {
        console.error('[REQUEST-PASSWORD-RECOVERY] Cooldown error:', cooldownError);
        return new Response(
          JSON.stringify({ error: 'Não foi possível processar a solicitação.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (cooldownCount !== null && cooldownCount > 0) {
        return new Response(
          JSON.stringify({ error: 'Aguarde alguns segundos e tente novamente.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const requestIp = getClientIp(req);
    if (requestIp) {
      const { count: ipCount, error: ipCountError } = await supabase
        .from('password_recovery_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('request_ip', requestIp)
        .gte('created_at', hourWindowStart);

      if (ipCountError) {
        console.error('[REQUEST-PASSWORD-RECOVERY] Rate limit ip count error:', ipCountError);
        return new Response(
          JSON.stringify({ error: 'Não foi possível processar a solicitação.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (ipCount !== null && ipCount >= maxPerIpPerHour) {
        return new Response(
          JSON.stringify({ error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const token = generateToken();
    const tokenHash = await sha256(token);

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const requestUserAgent = req.headers.get('user-agent');

    const { error } = await supabase
      .from('password_recovery_tokens')
      .insert({
        email: normalizedEmail,
        token_hash: tokenHash,
        expires_at: expiresAt,
        request_ip: requestIp,
        request_user_agent: requestUserAgent,
      });

    if (error) {
      console.error('[REQUEST-PASSWORD-RECOVERY] Insert error:', error);
      return new Response(
        JSON.stringify({ error: 'Não foi possível processar a solicitação.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, token }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[REQUEST-PASSWORD-RECOVERY] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Falha ao processar a solicitação.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
