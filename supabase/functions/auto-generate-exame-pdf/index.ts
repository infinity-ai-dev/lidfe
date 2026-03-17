import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
// Removido PDFDocument, rgb, StandardFonts - não são mais necessários
// Agora sempre usamos templates do bucket 'guias-exames-templates' e preencherTemplate usa pdf-lib internamente

// Reaproveitar helpers de template para garantir layout único
import { buscarTemplate, createBlankTemplateBytes, preencherTemplate, addDownloadQrToGuia } from '../utils/exame-template-helper.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: {
    id: number;
    titulo?: string;
    descricao?: string;
    user_id?: string;
    id_threadconversa?: string;
    urlpdf?: string;
    created_at?: string;
  };
  old_record?: any;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Mantem contexto para erro sem quebrar CORS quando falhar antes do record existir
  let record: WebhookPayload['record'] | undefined;
  let payload: WebhookPayload | undefined;

  try {
    // Autenticação opcional - pode ser chamado por webhook do Supabase ou por cliente autenticado
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? 'https://xradpyucukbqaulzhdab.supabase.co';
    const apiKeyHeader = req.headers.get('apikey');
    let supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Detectar chamadas internas com service role key (header muito longo)
    let isInternalCall = false;
    if (apiKeyHeader && apiKeyHeader.length > 180) {
      isInternalCall = true;
      supabaseServiceKey = apiKeyHeader;
      console.log('[AUTO-GENERATE-EXAME-PDF] Chamada interna detectada via apikey');
    } else if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      if (token.length > 180 && token.split('.').length === 3) {
        isInternalCall = true;
        supabaseServiceKey = token;
        console.log('[AUTO-GENERATE-EXAME-PDF] Chamada interna detectada via Authorization');
      }
    }

    if (!supabaseServiceKey) {
      throw new Error('Service Role Key não encontrada. Configure SUPABASE_SERVICE_ROLE_KEY como secret ou forneça via header.');
    }

    // Usar service role key para bypass de RLS
    // NÃO usar Authorization do usuário aqui, para evitar que RLS seja aplicado.
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          apikey: supabaseServiceKey,
        },
      },
    });

    payload = await req.json();
    
    // Verificar se é um INSERT em tasks_listaexames
    if (payload.type !== 'INSERT' || payload.table !== 'tasks_listaexames') {
      console.log('[AUTO-GENERATE-EXAME-PDF] Ignorando evento:', payload.type, payload.table);
      return new Response(
        JSON.stringify({ success: true, message: 'Evento ignorado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    record = payload.record;
    
    // Verificar se já tem PDF
    if (record.urlpdf) {
      console.log('[AUTO-GENERATE-EXAME-PDF] Registro já possui PDF, ignorando');
      return new Response(
        JSON.stringify({ success: true, message: 'PDF já existe' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Verificar campos obrigatórios
    if (!record.titulo || !record.user_id) {
      console.error('[AUTO-GENERATE-EXAME-PDF] Campos obrigatórios faltando: titulo ou user_id');
      return new Response(
        JSON.stringify({ success: false, error: 'Campos obrigatórios faltando' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log('[AUTO-GENERATE-EXAME-PDF] Gerando PDF para exame:', record.id, record.titulo);

    // Buscar dados do usuário
    const { data: usuario, error: usuarioError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('user_id', record.user_id)
      .single();

    if (usuarioError || !usuario) {
      console.error('[AUTO-GENERATE-EXAME-PDF] Erro ao buscar usuário:', usuarioError);
      // Continuar mesmo sem dados do usuário, usar valores padrão
    }

    const nomePaciente = usuario?.['nome completo'] || usuario?.nome || 'Paciente';
    const cpfPaciente = usuario?.CPF || '';

    // Dados do médico (podem ser configurados via env vars ou tabela de configuração)
    const medicoNome = Deno.env.get('MEDICO_NOME') || 'LUCAS EDUARDO FRANÇA DA ROCHA MEDRADO TAVARES';
    const medicoCRM = Deno.env.get('MEDICO_CRM') || '7597 - MT';
    const medicoRQE = Deno.env.get('MEDICO_RQE') || 'RQE no 7495';
    const medicoEspecialidade = Deno.env.get('MEDICO_ESPECIALIDADE') || 'PSIQUIATRIA';
    const medicoCPF = Deno.env.get('MEDICO_CPF') || '024.817.781-89';
    const medicoEndereco = Deno.env.get('MEDICO_ENDERECO') || 'Rua Benedito de Melo, 80, Lixeira, Cuiabá - MT';
    const medicoTelefone = Deno.env.get('MEDICO_TELEFONE') || '(65) 98443-1993';

    // Data de emissão (usar created_at ou data atual)
    const dataEmissao = record.created_at 
      ? new Date(record.created_at).toLocaleDateString('pt-BR')
      : new Date().toLocaleDateString('pt-BR');

    // Sempre usar o layout único para guias de exame (com fallback configurável)
    const templateName = Deno.env.get('EXAME_TEMPLATE_NAME') || 'consulta_documento';
    console.log(`[AUTO-GENERATE-EXAME-PDF] Usando template padrão: ${templateName}`);
    
    let templateBytes: Uint8Array | null = null;
    let templateUsed: string = templateName;
    
    try {
      templateBytes = await buscarTemplate(supabase, templateName);
      if (templateBytes) {
        console.log(`[AUTO-GENERATE-EXAME-PDF] ✅ Template específico encontrado: ${templateName}.pdf`);
      } else {
        console.log(`[AUTO-GENERATE-EXAME-PDF] ⚠️ Template específico não encontrado, tentando template genérico...`);
        // Tentar template genérico como fallback
        templateBytes = await buscarTemplate(supabase, 'exame_generico');
        if (templateBytes) {
          templateUsed = 'exame_generico';
          console.log(`[AUTO-GENERATE-EXAME-PDF] ✅ Template genérico encontrado: exame_generico.pdf`);
        }
      }
    } catch (error) {
      console.error(`[AUTO-GENERATE-EXAME-PDF] ❌ Erro ao buscar template específico:`, error);
      // Tentar template genérico como último recurso
      try {
        templateBytes = await buscarTemplate(supabase, 'exame_generico');
        if (templateBytes) {
          templateUsed = 'exame_generico';
          console.log(`[AUTO-GENERATE-EXAME-PDF] ✅ Template genérico encontrado após erro: exame_generico.pdf`);
        }
      } catch (fallbackError) {
        console.error(`[AUTO-GENERATE-EXAME-PDF] ❌ Erro ao buscar template genérico:`, fallbackError);
      }
    }

    if (!templateBytes) {
      console.warn(`[AUTO-GENERATE-EXAME-PDF] ⚠️ Nenhum template encontrado; usando layout A4 interno`);
      templateBytes = await createBlankTemplateBytes();
      templateUsed = 'blank_a4_internal';
    }

    // Preencher template com dados do paciente (SEMPRE usar template)
    console.log(`[AUTO-GENERATE-EXAME-PDF] Preenchendo template '${templateUsed}' com dados do paciente...`);
    
    let pdfBytes: Uint8Array;
    
    try {
      // Preencher template com dados
      pdfBytes = await preencherTemplate(templateBytes, {
        nomePaciente: nomePaciente,
        cpfPaciente: cpfPaciente,
        nomeMedico: medicoNome,
        crmMedico: medicoCRM,
        rqeMedico: medicoRQE,
        especialidadeMedico: medicoEspecialidade,
        cpfMedico: medicoCPF,
        enderecoMedico: medicoEndereco,
        telefoneMedico: medicoTelefone,
        dataEmissao: dataEmissao,
        tituloExame: record.titulo || '',
        descricaoExame: record.descricao || record.titulo || '',
      });
      
      console.log(`[AUTO-GENERATE-EXAME-PDF] ✅ Template preenchido com sucesso. Tamanho: ${pdfBytes.length} bytes`);
    } catch (fillError: any) {
      console.error(`[AUTO-GENERATE-EXAME-PDF] ❌ Erro ao preencher template:`, fillError);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Erro ao preencher template de guia de exame: ${fillError.message || 'Erro desconhecido'}`,
          template_usado: templateUsed,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }
    
    // Converter Uint8Array para base64 de forma segura (suporta PDFs grandes)
    console.log('[AUTO-GENERATE-EXAME-PDF] Convertendo PDF para base64...');
    console.log('[AUTO-GENERATE-EXAME-PDF] Tamanho do PDF:', pdfBytes.length, 'bytes');
    
    let pdfBase64 = '';
    try {
      // Método seguro para conversão base64 que funciona com qualquer tamanho
      // Dividir em chunks para evitar stack overflow
      const chunkSize = 8192; // 8KB por vez
      let binaryString = '';
      
      for (let i = 0; i < pdfBytes.length; i += chunkSize) {
        const chunk = pdfBytes.slice(i, i + chunkSize);
        const chunkString = String.fromCharCode.apply(null, Array.from(chunk));
        binaryString += chunkString;
      }
      
      pdfBase64 = btoa(binaryString);
      console.log('[AUTO-GENERATE-EXAME-PDF] PDF convertido para base64. Tamanho base64:', pdfBase64.length, 'chars');
    } catch (error: any) {
      console.error('[AUTO-GENERATE-EXAME-PDF] Erro ao converter PDF para base64:', error);
      console.error('[AUTO-GENERATE-EXAME-PDF] Tipo de erro:', error.name);
      console.error('[AUTO-GENERATE-EXAME-PDF] Mensagem:', error.message);
      throw new Error(`Erro ao converter PDF para base64: ${error.message || 'Erro desconhecido'}`);
    }

    console.log('[AUTO-GENERATE-EXAME-PDF] PDF gerado. Tamanho:', pdfBytes.length, 'bytes');

    // Assinar PDF chamando sign-pdf (OBRIGATÓRIO - todos os documentos devem ser assinados)
    console.log('[AUTO-GENERATE-EXAME-PDF] Assinando PDF...');
    console.log('[AUTO-GENERATE-EXAME-PDF] Tamanho do PDF para assinar:', pdfBase64.length, 'chars base64');
    
    let signResponse: Response;
    try {
      // Criar AbortController para timeout (5 minutos)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutos
      
      signResponse = await fetch(`${supabaseUrl}/functions/v1/sign-pdf`, {
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
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('[AUTO-GENERATE-EXAME-PDF] Timeout ao assinar PDF (5 minutos)');
        throw new Error('Timeout ao assinar PDF. O arquivo pode ser muito grande ou a função sign-pdf pode estar sobrecarregada.');
      }
      console.error('[AUTO-GENERATE-EXAME-PDF] Erro na chamada para sign-pdf:', error);
      throw new Error(`Erro ao chamar função sign-pdf: ${error.message || 'Erro desconhecido'}`);
    }

    if (!signResponse.ok) {
      let errorText = '';
      try {
        errorText = await signResponse.text();
      } catch (e) {
        errorText = `HTTP ${signResponse.status} ${signResponse.statusText}`;
      }
      console.error('[AUTO-GENERATE-EXAME-PDF] Erro ao assinar PDF:', errorText);
      console.error('[AUTO-GENERATE-EXAME-PDF] Status:', signResponse.status);
      console.error('[AUTO-GENERATE-EXAME-PDF] Headers:', Object.fromEntries(signResponse.headers.entries()));
      throw new Error(`Erro ao assinar PDF: ${signResponse.status} - ${errorText}`);
    }

    const signResult = await signResponse.json();
    if (!signResult.success) {
      console.error('[AUTO-GENERATE-EXAME-PDF] Erro na assinatura:', signResult.error);
      throw new Error(`Erro na assinatura: ${signResult.error || 'Falha desconhecida'}`);
    }

    const signedPdfBase64 = signResult.signed_pdf_base64;
    if (!signedPdfBase64) {
      throw new Error('PDF assinado não retornado pela função sign-pdf');
    }

    // Converter base64 para Uint8Array de forma eficiente
    console.log('[AUTO-GENERATE-EXAME-PDF] Convertendo PDF assinado de base64 para bytes...');
    let signedPdfBytes: Uint8Array;
    try {
      // Método eficiente para conversão base64 -> Uint8Array
      const binaryString = atob(signedPdfBase64);
      const len = binaryString.length;
      signedPdfBytes = new Uint8Array(len);
      
      for (let i = 0; i < len; i++) {
        signedPdfBytes[i] = binaryString.charCodeAt(i);
      }
      
      console.log('[AUTO-GENERATE-EXAME-PDF] PDF assinado convertido com sucesso. Tamanho:', signedPdfBytes.length, 'bytes');
    } catch (error: any) {
      console.error('[AUTO-GENERATE-EXAME-PDF] Erro ao converter PDF assinado:', error);
      throw new Error(`Erro ao converter PDF assinado: ${error.message || 'Erro desconhecido'}`);
    }

    console.log('[AUTO-GENERATE-EXAME-PDF] PDF pronto para upload. Tamanho:', signedPdfBytes.length, 'bytes');

    // Upload para Supabase Storage
    // Gerar nome de arquivo seguro (remover caracteres especiais)
    const safeNomePaciente = nomePaciente.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 50);
    const fileName = `exame_${safeNomePaciente}_${record.id}_${Date.now()}.pdf`;
    
    console.log('[AUTO-GENERATE-EXAME-PDF] Iniciando upload para Storage...');
    console.log('[AUTO-GENERATE-EXAME-PDF] Nome do arquivo:', fileName);
    console.log('[AUTO-GENERATE-EXAME-PDF] Tamanho do arquivo:', signedPdfBytes.length, 'bytes');
    
    let pdfUrl: string | null = null;
    let usedBucketName: string | null = null;
    const uploadErrors: Array<{ bucket: string; error: string }> = [];

    // Lista de buckets para tentar (em ordem de preferência)
    const buckets = ['pdfs', 'guiapdf'];

    for (const bucketName of buckets) {
      try {
        console.log(`[AUTO-GENERATE-EXAME-PDF] Tentando upload para bucket: ${bucketName}...`);

        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(fileName, signedPdfBytes, {
            contentType: 'application/pdf',
            upsert: false,
            cacheControl: '3600',
          });

        if (uploadError) {
          uploadErrors.push({ bucket: bucketName, error: uploadError.message || 'Erro desconhecido' });
          console.warn(`[AUTO-GENERATE-EXAME-PDF] Erro ao fazer upload no bucket ${bucketName}:`, uploadError);
          continue; // Tentar próximo bucket
        }

        // Obter URL pública
        const { data: urlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(fileName);

        if (urlData?.publicUrl) {
          pdfUrl = urlData.publicUrl;
          usedBucketName = bucketName;
          console.log(`[AUTO-GENERATE-EXAME-PDF] ✅ PDF enviado com sucesso para bucket ${bucketName}:`, pdfUrl);
          break; // Sucesso, sair do loop
        } else {
          uploadErrors.push({ bucket: bucketName, error: 'URL pública não retornada' });
        }
      } catch (error: any) {
        uploadErrors.push({ bucket: bucketName, error: error.message || 'Erro desconhecido' });
        console.error(`[AUTO-GENERATE-EXAME-PDF] Exceção ao fazer upload no bucket ${bucketName}:`, error);
        continue; // Tentar próximo bucket
      }
    }

    if (!pdfUrl || !usedBucketName) {
      const uploadErrorDetails = uploadErrors.map(e => `${e.bucket}: ${e.error}`).join('; ');
      console.error('[AUTO-GENERATE-EXAME-PDF] ❌ Falha ao fazer upload em todos os buckets:', uploadErrorDetails);
      throw new Error(`Erro ao fazer upload: Nenhum bucket disponível. Erros: ${uploadErrorDetails}`);
    }

    console.log('[AUTO-GENERATE-EXAME-PDF] PDF enviado com sucesso:', pdfUrl);

    // Adicionar QR Code grande para download/impressão e re-fazer upload
    try {
      const pdfWithDownloadQr = await addDownloadQrToGuia(signedPdfBytes, pdfUrl);
      await supabase.storage
        .from(usedBucketName)
        .upload(fileName, pdfWithDownloadQr, { contentType: 'application/pdf', upsert: true });
      console.log('[AUTO-GENERATE-EXAME-PDF] ✅ QR de download/impressão adicionado ao PDF');
    } catch (qrError: any) {
      console.warn('[AUTO-GENERATE-EXAME-PDF] ⚠️ Erro ao adicionar QR de download:', qrError?.message);
    }

    // Atualizar registro em tasks_listaexames
    console.log('[AUTO-GENERATE-EXAME-PDF] Atualizando registro tasks_listaexames com URL do PDF...');
    const { error: updateError, data: updateData } = await supabase
      .from('tasks_listaexames')
      .update({ urlpdf: pdfUrl })
      .eq('id', record.id)
      .select('id, urlpdf');

    if (updateError) {
      console.error('[AUTO-GENERATE-EXAME-PDF] ❌ Erro ao atualizar registro:', updateError);
      console.error('[AUTO-GENERATE-EXAME-PDF] Detalhes do erro:', JSON.stringify(updateError, null, 2));
      
      // Não falhar o processo se o upload foi bem-sucedido
      // O PDF já está disponível na URL, apenas o registro não foi atualizado
      console.warn('[AUTO-GENERATE-EXAME-PDF] ⚠️ PDF gerado e enviado com sucesso, mas falha ao atualizar registro. URL:', pdfUrl);
      
      // Tentar novamente uma vez
      try {
        const { error: retryError } = await supabase
          .from('tasks_listaexames')
          .update({ urlpdf: pdfUrl })
          .eq('id', record.id);
        
        if (retryError) {
          console.error('[AUTO-GENERATE-EXAME-PDF] ❌ Erro ao tentar atualizar registro novamente:', retryError);
          // Ainda assim, retornar sucesso pois o PDF foi gerado
        } else {
          console.log('[AUTO-GENERATE-EXAME-PDF] ✅ Registro atualizado com sucesso na segunda tentativa');
        }
      } catch (retryException: any) {
        console.error('[AUTO-GENERATE-EXAME-PDF] ❌ Exceção ao tentar atualizar registro novamente:', retryException);
      }
    } else {
      console.log('[AUTO-GENERATE-EXAME-PDF] ✅ Registro atualizado com sucesso:', updateData);
    }

    console.log('[AUTO-GENERATE-EXAME-PDF] ✅ PDF gerado, assinado e salvo com sucesso para exame ID:', record.id);
    console.log('[AUTO-GENERATE-EXAME-PDF] URL do PDF:', pdfUrl);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'PDF gerado e salvo com sucesso',
        pdf_url: pdfUrl,
        exame_id: record.id,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    // Log detalhado do erro para debug
    console.error('[AUTO-GENERATE-EXAME-PDF] ❌ ERRO CRÍTICO:', error);
    console.error('[AUTO-GENERATE-EXAME-PDF] Tipo de erro:', error?.name || 'Unknown');
    console.error('[AUTO-GENERATE-EXAME-PDF] Mensagem:', error?.message || 'Erro desconhecido');
    console.error('[AUTO-GENERATE-EXAME-PDF] Stack:', error?.stack || 'Sem stack trace');
    
    // Se tiver contexto adicional, logar
    if (error?.cause) {
      console.error('[AUTO-GENERATE-EXAME-PDF] Causa:', error.cause);
    }
    
    // Extrair informações úteis do erro
    const errorMessage = error?.message || 'Erro desconhecido ao gerar PDF';
    const errorDetails = error?.stack || error?.toString() || 'Sem detalhes';
    
    // Tentar identificar o tipo de erro
    let userFriendlyMessage = errorMessage;
    if (errorMessage.includes('stack') || errorMessage.includes('stack overflow')) {
      userFriendlyMessage = 'PDF muito grande. Tente reduzir o tamanho do arquivo.';
    } else if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      userFriendlyMessage = 'Timeout ao processar PDF. O arquivo pode ser muito grande ou o servidor está sobrecarregado.';
    } else if (errorMessage.includes('bucket') || errorMessage.includes('Storage')) {
      userFriendlyMessage = 'Erro ao fazer upload do PDF. Verifique se os buckets de Storage estão configurados corretamente.';
    } else if (errorMessage.includes('sign') || errorMessage.includes('assin')) {
      userFriendlyMessage = 'Erro ao assinar PDF. Verifique se a função sign-pdf está funcionando corretamente.';
    }
    
    return new Response(
      JSON.stringify({
        success: false,
        error: userFriendlyMessage,
        error_details: errorMessage,
        // Incluir detalhes apenas em desenvolvimento
        details: Deno.env.get('SUPABASE_PROJECT_REF') ? undefined : errorDetails,
        exame_id: record?.id || payload?.record?.id || null,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
