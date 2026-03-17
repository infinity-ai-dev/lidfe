import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buscarTemplate, createBlankTemplateBytes, preencherTemplate, addDownloadQrToGuia } from '../utils/exame-template-helper.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? 'https://xradpyucukbqaulzhdab.supabase.co';
    const apiKeyHeader = req.headers.get('apikey');
    let supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (apiKeyHeader && apiKeyHeader.length > 180) {
      supabaseServiceKey = apiKeyHeader;
    } else if (authHeader && authHeader.replace('Bearer ', '').length > 180) {
      supabaseServiceKey = authHeader.replace('Bearer ', '');
    }
    
    if (!supabaseServiceKey) {
      throw new Error('Service Role Key não encontrada');
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          apikey: supabaseServiceKey,
        },
      },
    });
    const body = await req.json().catch(() => ({}));
    const { exame_id, user_id } = body;

    if (!exame_id) {
      throw new Error('exame_id é obrigatório');
    }

    console.log(`[GENERATE-SINGLE-EXAME-PDF] Gerando PDF para exame ID: ${exame_id}`);

    // Buscar registro do exame
    const { data: record, error: recordError } = await supabase
      .from('tasks_listaexames')
      .select('id, titulo, descricao, user_id, created_at, urlpdf')
      .eq('id', exame_id)
      .single();

    if (recordError || !record) {
      throw new Error(`Exame não encontrado: ${recordError?.message || 'Registro não existe'}`);
    }

    // Verificar se já tem PDF
    if (record.urlpdf) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'PDF já existe',
          pdf_url: record.urlpdf,
          exame_id: record.id,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Verificar user_id se fornecido
    if (user_id && record.user_id !== user_id) {
      throw new Error('Usuário não autorizado para este exame');
    }

    // Buscar dados do usuário
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('*')
      .eq('user_id', record.user_id)
      .single();

    const nomePaciente = usuario?.['nome completo'] || usuario?.nome || 'Paciente';
    const cpfPaciente = usuario?.CPF || '';

    // Dados do médico
    const medicoNome = Deno.env.get('MEDICO_NOME') || 'LUCAS EDUARDO FRANÇA DA ROCHA MEDRADO TAVARES';
    const medicoCRM = Deno.env.get('MEDICO_CRM') || '7597 - MT';
    const medicoRQE = Deno.env.get('MEDICO_RQE') || 'RQE no 7495';
    const medicoEspecialidade = Deno.env.get('MEDICO_ESPECIALIDADE') || 'PSIQUIATRIA';
    const medicoCPF = Deno.env.get('MEDICO_CPF') || '024.817.781-89';
    const medicoEndereco = Deno.env.get('MEDICO_ENDERECO') || 'Rua Benedito de Melo, 80, Lixeira, Cuiabá - MT';
    const medicoTelefone = Deno.env.get('MEDICO_TELEFONE') || '(65) 98443-1993';

    // Data de emissão
    const dataEmissao = record.created_at 
      ? new Date(record.created_at).toLocaleDateString('pt-BR')
      : new Date().toLocaleDateString('pt-BR');

    // Forçar uso do layout único de guias de exame
    const templateName = Deno.env.get('EXAME_TEMPLATE_NAME') || 'consulta_documento';
    console.log(`[GENERATE-SINGLE-EXAME-PDF] Usando template padrão: ${templateName}`);

    const templateBytes = await buscarTemplate(supabase, templateName) || await createBlankTemplateBytes();

    const pdfBytes = await preencherTemplate(templateBytes, {
      nomePaciente,
      cpfPaciente,
      nomeMedico: medicoNome,
      crmMedico: medicoCRM,
      rqeMedico: medicoRQE,
      especialidadeMedico: medicoEspecialidade,
      cpfMedico: medicoCPF,
      enderecoMedico: medicoEndereco,
      telefoneMedico: medicoTelefone,
      dataEmissao,
      tituloExame: record.titulo || '',
      descricaoExame: record.descricao || record.titulo || '',
    });
    
    // Converter para base64
    let pdfBase64 = '';
    for (let i = 0; i < pdfBytes.length; i += 1024) {
      const chunk = pdfBytes.slice(i, i + 1024);
      pdfBase64 += String.fromCharCode(...chunk);
    }
    pdfBase64 = btoa(pdfBase64);

    // Assinar PDF
    const signResponse = await fetch(`${supabaseUrl}/functions/v1/sign-pdf`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseServiceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pdf_base64: pdfBase64,
        signer_name: medicoNome,
        signer_crm: medicoCRM,
        document_type: 'exame',
        document_id: record.id,
        place_qr_on_first_page: true,
      }),
    });

    if (!signResponse.ok) {
      throw new Error(`Erro ao assinar PDF: ${signResponse.status}`);
    }

    const signResult = await signResponse.json();
    if (!signResult.success) {
      throw new Error(`Erro na assinatura: ${signResult.error}`);
    }

    const signedPdfBase64 = signResult.signed_pdf_base64;
    const signedPdfBytes = Uint8Array.from(atob(signedPdfBase64), c => c.charCodeAt(0));

    // Upload para Storage
    const fileName = `exame_${nomePaciente.replace(/\s+/g, '_')}_${record.id}_${Date.now()}.pdf`;
    
    let pdfUrl: string | null = null;
    let usedBucketName: string | null = null;
    const bucketsToTry = [
      { name: 'pdfs', id: '86ed541f-62ef-47cc-9999-cb3e94464cf9' },
      { name: 'guiapdf', id: '30f60c91-11c3-4efc-927c-cdfb5f87043e' },
    ];

    for (const bucket of bucketsToTry) {
      if (pdfUrl) break;

      if (bucket.name) {
        try {
          const { error: uploadError } = await supabase.storage
            .from(bucket.name)
            .upload(fileName, signedPdfBytes, {
              contentType: 'application/pdf',
              upsert: false,
            });

          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from(bucket.name)
              .getPublicUrl(fileName);
            pdfUrl = urlData.publicUrl;
            usedBucketName = bucket.name;
            break;
          }
        } catch (e) {
          console.warn(`[GENERATE-SINGLE-EXAME-PDF] Erro ao usar bucket ${bucket.name}:`, e);
        }
      }

      if (!pdfUrl && bucket.id) {
        try {
          const { error: uploadError } = await supabase.storage
            .from(bucket.id)
            .upload(fileName, signedPdfBytes, {
              contentType: 'application/pdf',
              upsert: false,
            });

          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from(bucket.id)
              .getPublicUrl(fileName);
            pdfUrl = urlData.publicUrl;
            usedBucketName = bucket.id;
            break;
          }
        } catch (e) {
          console.warn(`[GENERATE-SINGLE-EXAME-PDF] Erro ao usar bucket ${bucket.id}:`, e);
        }
      }
    }

    if (!pdfUrl || !usedBucketName) {
      throw new Error('Erro ao fazer upload: Nenhum bucket disponível');
    }

    // Adicionar QR Code grande para download/impressão e re-fazer upload
    try {
      const pdfWithDownloadQr = await addDownloadQrToGuia(signedPdfBytes, pdfUrl);
      await supabase.storage
        .from(usedBucketName)
        .upload(fileName, pdfWithDownloadQr, { contentType: 'application/pdf', upsert: true });
      console.log('[GENERATE-SINGLE-EXAME-PDF] ✅ QR de download/impressão adicionado ao PDF');
    } catch (qrError: any) {
      console.warn('[GENERATE-SINGLE-EXAME-PDF] ⚠️ Erro ao adicionar QR de download:', qrError?.message);
    }

    // Atualizar registro
    const { error: updateError } = await supabase
      .from('tasks_listaexames')
      .update({ urlpdf: pdfUrl })
      .eq('id', record.id);

    if (updateError) {
      throw new Error(`Erro ao atualizar registro: ${updateError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'PDF gerado com sucesso',
        pdf_url: pdfUrl,
        exame_id: record.id,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('[GENERATE-SINGLE-EXAME-PDF] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
