import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buscarTemplate, createBlankTemplateBytes, preencherTemplate, preencherTemplateGuiaGeral, addDownloadQrToGuia } from '../utils/exame-template-helper.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const wrapText = (text: string, maxLength: number): string[] => {
  if (!text) return [];
  const words = text.split(/\s+/g);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxLength) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const buildGeneralGuidePdf = async (options: {
  supabase: any;
  exames: Array<{ titulo?: string | null; descricao?: string | null }>;
  nomePaciente: string;
  cpfPaciente: string;
  emailPaciente?: string;
  dataEmissao: string;
  medicoNome: string;
  medicoCRM: string;
  medicoRQE: string;
  medicoEspecialidade: string;
  medicoCPF: string;
  medicoEndereco: string;
  medicoTelefone: string;
  templateName: string;
}) => {
  const {
    supabase,
    exames,
    nomePaciente,
    cpfPaciente,
    emailPaciente,
    dataEmissao,
    medicoNome,
    medicoCRM,
    medicoRQE,
    medicoEspecialidade,
    medicoCPF,
    medicoEndereco,
    medicoTelefone,
    templateName,
  } = options;

  // Preparar descrição única com todos os exames para o template A5
  const linhasExames: string[] = [];
  exames.forEach((exame, index) => {
    const titulo = exame.titulo || `Exame ${index + 1}`;
    const descricao = exame.descricao || '';
    linhasExames.push(`${index + 1}. ${titulo}`);
    if (descricao) {
      linhasExames.push(...wrapText(descricao, 90).map((line) => `   ${line}`));
    }
  });

  const templateBytes = await buscarTemplate(supabase, templateName) || await createBlankTemplateBytes();

  // Usar layout do guia geral para evitar sobreposição de texto no template A5
  return await preencherTemplateGuiaGeral(templateBytes, {
    nomePaciente,
    cpfPaciente,
    emailPaciente,
    nomeMedico: medicoNome,
    crmMedico: medicoCRM,
    rqeMedico: medicoRQE,
    especialidadeMedico: medicoEspecialidade,
    cpfMedico: medicoCPF,
    enderecoMedico: medicoEndereco,
    telefoneMedico: medicoTelefone,
    dataEmissao,
    linhasExames,
  });
};


interface GenerateAllRequest {
  user_id?: string; // Opcional: gerar apenas para um usuário específico
  limit?: number; // Opcional: limite de registros a processar (padrão: 100)
  dry_run?: boolean; // Opcional: apenas contar, não gerar (padrão: false)
  force_new?: boolean; // Opcional: regenerar mesmo com URL existente (padrão: false)
  skip_guia_geral?: boolean; // Opcional: ignorar guia geral (padrão: false)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Autenticação
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? 'https://xradpyucukbqaulzhdab.supabase.co';
    const apiKeyHeader = req.headers.get('apikey');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const providedToken = apiKeyHeader || (authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : '');
    
    if (!supabaseServiceKey) {
      throw new Error('Service Role Key não encontrada');
    }
    if (!providedToken) {
      console.warn('[GENERATE-ALL-EXAME-PDFS] Chamada sem token; verifique verify_jwt');
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          apikey: supabaseServiceKey,
        },
      },
    });

    const body: GenerateAllRequest = await req.json().catch(() => ({}));
    const { user_id, limit = 100, dry_run = false, force_new = false, skip_guia_geral = false } = body;

    console.log('[GENERATE-ALL-EXAME-PDFS] Iniciando geração em lote');
    console.log('[GENERATE-ALL-EXAME-PDFS] Filtros:', { user_id, limit, dry_run, force_new, skip_guia_geral });

    // Buscar todos os registros sem PDF
    let query = supabase
      .from('tasks_listaexames')
      .select('id, titulo, descricao, user_id, created_at, urlpdf')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!force_new) {
      query = query.or('urlpdf.is.null,urlpdf.eq.');
    }

    if (user_id) {
      query = query.eq('user_id', user_id);
    }

    const { data: registros, error: queryError } = await query;

    if (queryError) {
      throw new Error(`Erro ao buscar registros: ${queryError.message}`);
    }

    if (!registros || registros.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Nenhum registro sem PDF encontrado',
          total: 0,
          processed: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log(`[GENERATE-ALL-EXAME-PDFS] Encontrados ${registros.length} registros sem PDF`);

    if (dry_run) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Dry run - apenas contagem',
          total: registros.length,
          registros: registros.map(r => ({ id: r.id, titulo: r.titulo, user_id: r.user_id })),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Dados do médico (configuráveis via env vars)
    const medicoNome = Deno.env.get('MEDICO_NOME') || 'LUCAS EDUARDO FRANÇA DA ROCHA MEDRADO TAVARES';
    const medicoCRM = Deno.env.get('MEDICO_CRM') || '7597 - MT';
    const medicoRQE = Deno.env.get('MEDICO_RQE') || 'RQE no 7495';
    const medicoEspecialidade = Deno.env.get('MEDICO_ESPECIALIDADE') || 'PSIQUIATRIA';
    const medicoCPF = Deno.env.get('MEDICO_CPF') || '024.817.781-89';
    const medicoEndereco = Deno.env.get('MEDICO_ENDERECO') || 'Rua Benedito de Melo, 80, Lixeira, Cuiabá - MT';
    const medicoTelefone = Deno.env.get('MEDICO_TELEFONE') || '(65) 98443-1993';

    // IDs dos buckets (fallback)
    const bucketPdfsId = '86ed541f-62ef-47cc-9999-cb3e94464cf9';
    const bucketGuiapdfId = '30f60c91-11c3-4efc-927c-cdfb5f87043e';
    const bucketGuiasGeraisName = 'guias-gerais';

    const resultados = {
      sucesso: 0,
      erro: 0,
      detalhes: [] as Array<{ id: number; titulo: string; status: string; url?: string; erro?: string }>,
      guia_geral: [] as Array<{ batch_id: string; url: string; total: number }>,
    };

    const userCache = new Map<string, any>();

    // Processar cada registro
    for (const record of registros) {
      try {
        console.log(`[GENERATE-ALL-EXAME-PDFS] Processando registro ID: ${record.id} - ${record.titulo}`);

        // Buscar dados do usuário
        let usuario = userCache.get(record.user_id);
        if (!usuario) {
          const { data } = await supabase
            .from('usuarios')
            .select('*')
            .eq('user_id', record.user_id)
            .single();
          usuario = data;
          userCache.set(record.user_id, usuario);
        }

        const nomePaciente = usuario?.['nome completo'] || usuario?.nome || 'Paciente';
        const cpfPaciente = usuario?.CPF || '';
        const emailPaciente = usuario?.email || '';

        // Data de emissão
        const dataEmissao = record.created_at 
          ? new Date(record.created_at).toLocaleDateString('pt-BR')
          : new Date().toLocaleDateString('pt-BR');

        // Forçar uso do layout único de guias de exames
        const templateName = Deno.env.get('EXAME_TEMPLATE_NAME') || 'consulta_documento';
        console.log(`[GENERATE-ALL-EXAME-PDFS] Usando template padrão: ${templateName}`);

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
        
        // Converter Uint8Array para base64
        let pdfBase64 = '';
        for (let i = 0; i < pdfBytes.length; i += 1024) {
          const chunk = pdfBytes.slice(i, i + 1024);
          pdfBase64 += String.fromCharCode(...chunk);
        }
        pdfBase64 = btoa(pdfBase64);

        // Assinar PDF (OBRIGATÓRIO)
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
          { name: 'pdfs', id: bucketPdfsId },
          { name: 'guiapdf', id: bucketGuiapdfId },
          { name: 'audios', id: null },
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
              console.warn(`[GENERATE-ALL-EXAME-PDFS] Erro ao usar bucket ${bucket.name}:`, e);
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
              console.warn(`[GENERATE-ALL-EXAME-PDFS] Erro ao usar bucket ${bucket.id}:`, e);
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
        } catch (qrError: any) {
          console.warn(`[GENERATE-ALL-EXAME-PDFS] ⚠️ Erro ao adicionar QR de download:`, qrError?.message);
        }

        // Atualizar registro
        const { error: updateError } = await supabase
          .from('tasks_listaexames')
          .update({ urlpdf: pdfUrl })
          .eq('id', record.id);

        if (updateError) {
          throw new Error(`Erro ao atualizar registro: ${updateError.message}`);
        }

        resultados.sucesso++;
        resultados.detalhes.push({
          id: record.id,
          titulo: record.titulo || '',
          status: 'sucesso',
          url: pdfUrl,
        });

        console.log(`[GENERATE-ALL-EXAME-PDFS] ✅ PDF gerado para registro ${record.id}`);

      } catch (error) {
        resultados.erro++;
        resultados.detalhes.push({
          id: record.id,
          titulo: record.titulo || '',
          status: 'erro',
          erro: error.message,
        });
        console.error(`[GENERATE-ALL-EXAME-PDFS] ❌ Erro ao processar registro ${record.id}:`, error);
      }
    }

    // Gerar guia geral por grupos de exames na mesma janela de tempo (mesmo usuário)
    if (skip_guia_geral) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Processamento concluído (guia geral ignorada)',
          total: registros.length,
          sucesso: resultados.sucesso,
          erro: resultados.erro,
          detalhes: resultados.detalhes,
          guia_geral: [],
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }
    const windowMs = 10 * 60 * 1000; // 10 minutos
    const recordsByUser = new Map<string, typeof registros>();
    registros.forEach((record) => {
      const list = recordsByUser.get(record.user_id) || [];
      list.push(record);
      recordsByUser.set(record.user_id, list);
    });

    for (const [userId, items] of recordsByUser.entries()) {
      const sorted = items
        .filter((item) => item.created_at)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      let group: typeof sorted = [];
      let groupStart = 0;

      const flushGroup = async () => {
        if (group.length < 2) {
          group = [];
          return;
        }

        try {
          const usuario = userCache.get(userId);
          const nomePaciente = usuario?.['nome completo'] || usuario?.nome || 'Paciente';
          const cpfPaciente = usuario?.CPF || '';
          const emailPaciente = usuario?.email || '';
          const dataEmissao = group[0]?.created_at
            ? new Date(group[0].created_at).toLocaleDateString('pt-BR')
            : new Date().toLocaleDateString('pt-BR');

          const guiaGeralTemplateName = Deno.env.get('GUIA_GERAL_TEMPLATE_NAME') || 'consulta_documento';
          const guideBytes = await buildGeneralGuidePdf({
            supabase,
            exames: group.map((item) => ({ titulo: item.titulo, descricao: item.descricao })),
            nomePaciente,
            cpfPaciente,
            emailPaciente,
            dataEmissao,
            medicoNome,
            medicoCRM,
            medicoRQE,
            medicoEspecialidade,
            medicoCPF,
            medicoEndereco,
            medicoTelefone,
            templateName: guiaGeralTemplateName,
          });

          let pdfBase64 = '';
          for (let i = 0; i < guideBytes.length; i += 1024) {
            const chunk = guideBytes.slice(i, i + 1024);
            pdfBase64 += String.fromCharCode(...chunk);
          }
          pdfBase64 = btoa(pdfBase64);

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
              document_type: 'guia_exames',
              place_qr_on_first_page: true,
            }),
          });

          if (!signResponse.ok) {
            throw new Error(`Erro ao assinar guia geral: ${signResponse.status}`);
          }

          const signResult = await signResponse.json();
          if (!signResult.success) {
            throw new Error(`Erro na assinatura da guia geral: ${signResult.error}`);
          }

          const signedPdfBase64 = signResult.signed_pdf_base64;
          const signedPdfBytes = Uint8Array.from(atob(signedPdfBase64), c => c.charCodeAt(0));

          const batchId = crypto.randomUUID();
          const fileName = `guia_geral_${userId}_${batchId}_${Date.now()}.pdf`;

          let pdfUrl: string | null = null;
          let usedBucketGuia: string | null = null;
          const bucketsToTry = [
            { name: bucketGuiasGeraisName, id: null },
            { name: 'pdfs', id: bucketPdfsId },
            { name: 'guiapdf', id: bucketGuiapdfId },
          ];

          for (const bucket of bucketsToTry) {
            if (pdfUrl) break;
            const bucketName = bucket.name || bucket.id;
            if (!bucketName) continue;
            try {
              const { error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(fileName, signedPdfBytes, { contentType: 'application/pdf', upsert: false });
              if (!uploadError) {
                const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(fileName);
                pdfUrl = urlData.publicUrl;
                usedBucketGuia = bucketName;
              }
            } catch (e) {
              console.warn(`[GENERATE-ALL-EXAME-PDFS] Erro ao usar bucket ${bucketName} para guia geral:`, e);
            }
          }

          if (!pdfUrl || !usedBucketGuia) {
            throw new Error('Erro ao fazer upload da guia geral: nenhum bucket disponível');
          }

          // Adicionar QR Code grande para download/impressão e re-fazer upload
          try {
            const pdfWithDownloadQr = await addDownloadQrToGuia(signedPdfBytes, pdfUrl);
            await supabase.storage
              .from(usedBucketGuia)
              .upload(fileName, pdfWithDownloadQr, { contentType: 'application/pdf', upsert: true });
          } catch (qrError: any) {
            console.warn(`[GENERATE-ALL-EXAME-PDFS] ⚠️ Erro ao adicionar QR de download na guia geral:`, qrError?.message);
          }

          const ids = group.map((item) => item.id);
          const { error: updateError } = await supabase
            .from('tasks_listaexames')
            .update({
              guia_geral_url: pdfUrl,
              guia_geral_batch_id: batchId,
              guia_geral_created_at: new Date().toISOString(),
            })
            .in('id', ids);

          if (updateError) {
            throw new Error(`Erro ao atualizar guia geral: ${updateError.message}`);
          }

          resultados.guia_geral.push({ batch_id: batchId, url: pdfUrl, total: group.length });
        } catch (error) {
          console.warn('[GENERATE-ALL-EXAME-PDFS] Falha ao gerar guia geral:', error);
        } finally {
          group = [];
        }
      };

      for (const item of sorted) {
        const createdAt = new Date(item.created_at).getTime();
        if (group.length === 0) {
          group = [item];
          groupStart = createdAt;
          continue;
        }
        if (createdAt - groupStart <= windowMs) {
          group.push(item);
        } else {
          await flushGroup();
          group = [item];
          groupStart = createdAt;
        }
      }
      await flushGroup();
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Processamento concluído',
        total: registros.length,
        sucesso: resultados.sucesso,
        erro: resultados.erro,
        detalhes: resultados.detalhes,
        guia_geral: resultados.guia_geral,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('[GENERATE-ALL-EXAME-PDFS] Error:', error);
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
