import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buscarTemplate, createBlankTemplateBytes, preencherTemplatePrescricao } from '../utils/exame-template-helper.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AutoGeneratePrescricaoRequest {
  user_id?: string;
  force_new?: boolean;
}

const chunkSize = 8192;

// Converter bytes em base64 com chunks para evitar stack overflow
const bytesToBase64 = (bytes: Uint8Array): string => {
  let binaryString = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binaryString += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binaryString);
};

// Formatar medicamentos para saída textual simples
const formatMedicamentos = (medicamentos: any): string[] => {
  if (!medicamentos) return [];
  if (Array.isArray(medicamentos)) {
    return medicamentos.map((med: any, index: number) => {
      const nome = med?.nome || `Medicamento ${index + 1}`;
      const dose = med?.dosagem ? ` - Dosagem: ${med.dosagem}` : '';
      const freq = med?.frequencia ? ` - Frequência: ${med.frequencia}` : '';
      const dur = med?.duracao ? ` - Duração: ${med.duracao}` : '';
      const obs = med?.observacoes ? ` - Obs: ${med.observacoes}` : '';
      return `${nome}${dose}${freq}${dur}${obs}`;
    });
  }

  if (typeof medicamentos === 'string') {
    try {
      const parsed = JSON.parse(medicamentos);
      return formatMedicamentos(parsed);
    } catch {
      return [medicamentos];
    }
  }

  return [String(medicamentos)];
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const apiKeyHeader = req.headers.get('apikey') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY não configurados');
    }

    // Detectar chamadas internas com service role key
    let isInternalCall = false;
    if (apiKeyHeader && apiKeyHeader.length > 180) {
      isInternalCall = true;
      console.log('[AUTO-GENERATE-PRESCRICAO-PDF] Chamada interna detectada via apikey');
    } else if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      if (token.length > 180 && token.split('.').length === 3) {
        isInternalCall = true;
        console.log('[AUTO-GENERATE-PRESCRICAO-PDF] Chamada interna detectada via Authorization');
      }
    }

    const supabaseAuth = createClient(
      supabaseUrl,
      isInternalCall ? serviceRoleKey : anonKey,
      {
        global: {
          headers: {
            Authorization: authHeader || (isInternalCall ? `Bearer ${serviceRoleKey}` : ''),
            ...(apiKeyHeader ? { apikey: apiKeyHeader } : {}),
          },
        },
      }
    );

    // Para escrita, sempre usar service role
    const supabaseService = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
          },
        },
      }
    );

    let authenticatedUserId: string | null = null;
    if (!isInternalCall) {
      const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
      if (userError || !user) {
        throw new Error('Unauthorized');
      }
      authenticatedUserId = user.id;
    }

    const body: AutoGeneratePrescricaoRequest = await req.json();
    const userId = isInternalCall ? body.user_id : authenticatedUserId;
    const forceNew = body.force_new === true;
    if (!userId) {
      throw new Error('user_id é obrigatório');
    }

    if (!isInternalCall && body.user_id && body.user_id !== authenticatedUserId) {
      // Garantir que o usuário autenticado não gere prescrição de terceiros
      throw new Error('user_id não corresponde ao usuário autenticado');
    }

    console.log('[AUTO-GENERATE-PRESCRICAO-PDF] Iniciando geração para usuário:', userId);

    // Buscar a última prescrição do usuário
    const { data: prescricao, error: prescricaoError } = await supabaseService
      .from('goals_prescricao')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prescricaoError || !prescricao) {
      throw new Error(`Prescrição não encontrada para o usuário: ${prescricaoError?.message || 'Sem dados'}`);
    }

    if (prescricao.pdfurlprescricao && !forceNew) {
      return new Response(
        JSON.stringify({ success: true, pdf_url: prescricao.pdfurlprescricao, message: 'Prescrição já gerada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    let prescricaoToSign = prescricao;
    if (forceNew) {
      // Criar uma nova prescrição baseada na última para gerar um novo PDF.
      const { id: _, created_at: __, pdfurlprescricao: ___, ...prescricaoPayload } = prescricao;
      const { data: novaPrescricao, error: insertError } = await supabaseService
        .from('goals_prescricao')
        .insert({
          ...prescricaoPayload,
          user_id: userId,
          pdfurlprescricao: null,
        })
        .select('*')
        .single();

      if (insertError || !novaPrescricao) {
        throw new Error(`Erro ao criar nova prescrição: ${insertError?.message || 'Sem dados'}`);
      }

      prescricaoToSign = novaPrescricao;
    }

    // Gerar PDF usando layout de template quando disponível
    const templateName = Deno.env.get('PRESCRICAO_TEMPLATE_NAME') || 'consulta_documento';
    const templateBytes = await buscarTemplate(supabaseService, templateName, 'prescricao-templates');
    const effectiveTemplateBytes = templateBytes || await createBlankTemplateBytes();

    const pacienteNome = prescricaoToSign.paciente_nome || 'Paciente';
    const pacienteCpf = prescricaoToSign.paciente_cpf || '';
    const dataTexto = prescricaoToSign.created_at
      ? new Date(prescricaoToSign.created_at).toLocaleDateString('pt-BR')
      : new Date().toLocaleDateString('pt-BR');
    const validadeBaseDate = prescricaoToSign.created_at ? new Date(prescricaoToSign.created_at) : new Date();
    validadeBaseDate.setDate(validadeBaseDate.getDate() + 10);
    const dataValidade = validadeBaseDate.toLocaleDateString('pt-BR');
    const meds = formatMedicamentos(prescricaoToSign.medicamentos);
    const observacoes = prescricaoToSign.observacoes || prescricaoToSign.descricao || 'Não informado.';
    const medicoNome = Deno.env.get('MEDICO_NOME') || 'LUCAS EDUARDO FRANÇA DA ROCHA MEDRADO TAVARES';
    const medicoCRM = Deno.env.get('MEDICO_CRM') || '7597 - MT';

    const pdfBytes = await preencherTemplatePrescricao(effectiveTemplateBytes, {
      titulo: prescricaoToSign.titulo || 'Receita Médica',
      nomePaciente: pacienteNome,
      cpfPaciente: pacienteCpf,
      dataEmissao: dataTexto,
      dataValidade,
      nomeMedico: medicoNome,
      crmMedico: medicoCRM,
      rqeMedico: Deno.env.get('MEDICO_RQE') || 'RQE no 7495',
      especialidadeMedico: Deno.env.get('MEDICO_ESPECIALIDADE') || 'PSIQUIATRIA',
      enderecoMedico: Deno.env.get('MEDICO_ENDERECO') || 'Rua Benedito de Melo, 80, Lixeira, Cuiabá - MT',
      telefoneMedico: Deno.env.get('MEDICO_TELEFONE') || '(65) 98443-1993',
      clinicaNome: Deno.env.get('CLINICA_NOME') || 'LIDFE',
      medicamentos: meds,
      observacoes: String(observacoes),
    });

    const pdfBase64 = bytesToBase64(pdfBytes);

    // Assinar PDF com a Edge Function sign-pdf
    const { data: signData, error: signError } = await supabaseService.functions.invoke(
      'sign-pdf',
      {
        body: {
          pdf_base64: pdfBase64,
          signer_name: medicoNome,
          signer_crm: medicoCRM,
          document_type: 'prescricao',
          document_id: prescricaoToSign.id,
          place_qr_on_first_page: true,
        },
      }
    );

    if (signError || signData?.success === false) {
      throw new Error(signError?.message || signData?.error || 'Erro ao assinar PDF');
    }

    const signedBase64 = signData?.signed_pdf_base64;
    if (!signedBase64) {
      throw new Error('PDF assinado não retornado pela função sign-pdf');
    }

    // Converter base64 assinado para bytes
    const signedBytes = Uint8Array.from(atob(signedBase64), c => c.charCodeAt(0));

    // Upload para bucket prescricao
    const fileName = `receita_${userId}_${prescricaoToSign.id}_${Date.now()}.pdf`;
    const { error: uploadError } = await supabaseService.storage
      .from('prescricao')
      .upload(fileName, signedBytes, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      throw new Error(`Erro ao fazer upload do PDF assinado: ${uploadError.message}`);
    }

    const { data: urlData } = supabaseService.storage
      .from('prescricao')
      .getPublicUrl(fileName);

    const pdfUrl = urlData?.publicUrl;
    if (!pdfUrl) {
      throw new Error('URL pública não gerada para o PDF assinado');
    }

    // Atualizar goals_prescricao com a URL do PDF assinado
    const { error: updateError } = await supabaseService
      .from('goals_prescricao')
      .update({ pdfurlprescricao: pdfUrl })
      .eq('id', prescricaoToSign.id);

    if (updateError) {
      throw new Error(`Erro ao atualizar goals_prescricao: ${updateError.message}`);
    }

    console.log('[AUTO-GENERATE-PRESCRICAO-PDF] ✅ Prescrição assinada gerada com sucesso');

    return new Response(
      JSON.stringify({ success: true, pdf_url: pdfUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('[AUTO-GENERATE-PRESCRICAO-PDF] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Erro ao gerar prescrição assinada' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
