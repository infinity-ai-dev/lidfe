import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type UploadLayoutRequest = {
  bucket: string;
  file_name: string;
  base64: string;
  content_type?: string;
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados');
    }

    // Esta função usa service role internamente para upload controlado
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      },
    });

    const body: UploadLayoutRequest = await req.json();
    const bucket = body.bucket?.trim();
    const fileName = body.file_name?.trim();
    const base64 = body.base64;
    const contentType = body.content_type || 'application/pdf';

    if (!bucket || !fileName || !base64) {
      throw new Error('bucket, file_name e base64 são obrigatórios');
    }

    const bytes = base64ToBytes(base64);

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(fileName, bytes, { contentType, upsert: true });

    if (uploadError) {
      throw new Error(`Erro ao fazer upload: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName);

    return new Response(
      JSON.stringify({
        success: true,
        bucket,
        file_name: fileName,
        public_url: urlData?.publicUrl || null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('[UPLOAD-LAYOUT-TEMPLATE] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Erro ao enviar template' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
