import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UploadExameRequest {
  file_base64: string;
  filename: string;
  mime_type: string;
  file_size: number;
  user_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const body: UploadExameRequest = await req.json();
    const { file_base64, filename, mime_type, file_size } = body;

    if (!file_base64 || !filename || !mime_type) {
      throw new Error('Missing required fields: file_base64, filename, mime_type');
    }

    console.log('[UPLOAD-EXAME] Recebendo upload de exame');
    console.log('[UPLOAD-EXAME] Nome do arquivo:', filename);
    console.log('[UPLOAD-EXAME] Tipo MIME:', mime_type);
    console.log('[UPLOAD-EXAME] Tamanho:', file_size, 'bytes');

    // Decodificar arquivo base64
    const fileBytes = Uint8Array.from(atob(file_base64), c => c.charCodeAt(0));
    console.log('[UPLOAD-EXAME] Arquivo decodificado. Tamanho real:', fileBytes.length, 'bytes');

    // Determinar bucket baseado no tipo de arquivo
    const isPdf = mime_type === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
    const isImage = !isPdf && mime_type.startsWith('image/');
    if (!isPdf && !isImage) {
      throw new Error(`Tipo de arquivo não suportado: ${mime_type}`);
    }

    const pdfBucket = Deno.env.get('EXAM_RESULTS_PDF_BUCKET') ?? 'pdfresultadosexames';
    const imageBucket = Deno.env.get('EXAM_RESULTS_IMAGE_BUCKET') ?? 'imagensresultadosexames';
    const bucketsToTry = isPdf
      ? [pdfBucket, 'pdfs', 'guiapdf']
      : [imageBucket, 'guias-gerais'];

    // Gerar nome único para o arquivo
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${user.id}/${timestamp}_${sanitizedFilename}`;

    let uploadBucket: string | null = null;
    let publicUrl: string | null = null;
    let lastError: string | null = null;

    for (const candidateBucket of bucketsToTry) {
      console.log('[UPLOAD-EXAME] Tentando upload no bucket:', candidateBucket);
      console.log('[UPLOAD-EXAME] Caminho de armazenamento:', storagePath);

      const { error: uploadError } = await supabase.storage
        .from(candidateBucket)
        .upload(storagePath, fileBytes, {
          contentType: mime_type,
          upsert: false,
        });

      if (uploadError) {
        lastError = uploadError.message || String(uploadError);
        console.warn(`[UPLOAD-EXAME] Erro ao fazer upload no bucket ${candidateBucket}:`, lastError);
        continue;
      }

      const { data: urlData } = supabase.storage
        .from(candidateBucket)
        .getPublicUrl(storagePath);

      if (!urlData?.publicUrl) {
        lastError = 'URL pública não retornada pelo storage';
        console.warn(`[UPLOAD-EXAME] URL pública não retornada no bucket ${candidateBucket}`);
        continue;
      }

      uploadBucket = candidateBucket;
      publicUrl = urlData.publicUrl;
      break;
    }

    if (!uploadBucket || !publicUrl) {
      const bucketList = bucketsToTry.join(', ');
      throw new Error(`Erro ao fazer upload: nenhum bucket disponível (${bucketList}). Último erro: ${lastError ?? 'desconhecido'}`);
    }

    console.log('[UPLOAD-EXAME] Upload concluído com sucesso no bucket:', uploadBucket);
    console.log('[UPLOAD-EXAME] URL pública gerada:', publicUrl);

    return new Response(
      JSON.stringify({
        success: true,
        file_url: publicUrl,
        storage_path: storagePath,
        bucket: uploadBucket,
        filename: filename,
        mime_type: mime_type,
        file_size: fileBytes.length,
        uploaded_at: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('[UPLOAD-EXAME] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Erro desconhecido ao processar upload',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});






