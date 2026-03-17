import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalyzeExameRequest {
  file_url: string;
  file_type: 'image' | 'pdf';
  resultado_id?: number;
  task_exame_id?: number; // ID do exame sugerido em tasks_listaexames
  user_id?: string;
}

interface GeminiResponse {
  tipo_exame?: string;
  valores_principais?: Record<string, any>;
  alteracoes?: Record<string, any>;
  interpretacao?: string;
  proximos_passos?: string;
  fontes?: Array<{
    titulo: string;
    url?: string;
    tipo: string;
  }>;
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const body: AnalyzeExameRequest = await req.json();
    const { file_url, file_type, resultado_id, task_exame_id, user_id } = body;

    if (!file_url || !file_type) {
      throw new Error('Missing required fields: file_url, file_type');
    }

    const userId = user_id || user.id;

    console.log('[ANALYZE-EXAME] Iniciando análise de exame');
    console.log('[ANALYZE-EXAME] URL do arquivo:', file_url);
    console.log('[ANALYZE-EXAME] Tipo:', file_type);
    console.log('[ANALYZE-EXAME] User ID:', userId);

    // Obter API key do Gemini
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY não configurada');
    }

    // Se task_exame_id não foi fornecido, tentar encontrar automaticamente pelo urlfoto
    let finalTaskExameId = task_exame_id || null;
    if (!finalTaskExameId) {
      const { data: exameTask } = await supabase
        .from('tasks_listaexames')
        .select('id')
        .eq('user_id', userId)
        .eq('urlfoto', file_url)
        .limit(1)
        .single();
      
      if (exameTask?.id) {
        finalTaskExameId = exameTask.id;
        console.log('[ANALYZE-EXAME] Exame vinculado automaticamente pelo urlfoto:', finalTaskExameId);
      }
    }

    // Criar registro inicial na tabela de análises
    const { data: analiseData, error: insertError } = await supabase
      .from('analises_exames')
      .insert({
        user_id: userId,
        resultado_id: resultado_id || null,
        task_exame_id: finalTaskExameId,
        url_arquivo: file_url,
        tipo_arquivo: file_type,
        status: 'processando',
      })
      .select()
      .single();

    if (insertError || !analiseData) {
      console.error('[ANALYZE-EXAME] Erro ao criar registro:', insertError);
      throw new Error(`Erro ao criar registro: ${insertError?.message}`);
    }

    const analiseId = analiseData.id;
    console.log('[ANALYZE-EXAME] Registro criado com ID:', analiseId);

    try {
      // Preparar prompt para o Gemini
      const prompt = `Você é um assistente médico especializado em análise de exames. Analise o exame fornecido e forneça uma resposta estruturada em JSON com os seguintes campos:

1. tipo_exame: Identifique o tipo de exame (ex: Hemograma, Glicemia, Colesterol, etc.)
2. valores_principais: Objeto JSON com os principais valores encontrados no exame, organizados por categoria
3. alteracoes: Objeto JSON identificando valores fora dos limites de normalidade, incluindo o valor encontrado, valor de referência e se está acima ou abaixo
4. interpretacao: Uma interpretação clara, acessível e didática do exame, explicando o que significam os resultados de forma que o paciente possa entender
5. fontes: Array de objetos com as fontes científicas, bases intelectuais e compêndios médicos utilizados para a interpretação. Cada objeto deve ter:
   - titulo: Título da fonte (ex: "Diretrizes da Sociedade Brasileira de Cardiologia", "Harrison's Principles of Internal Medicine")
   - url: URL da fonte (se disponível, ex: "https://...")
   - tipo: Tipo da fonte (ex: "artigo", "diretriz", "compendio", "livro")
   Sempre apresente as fontes para tal conclusão, mesmo que sejam fontes gerais de referência médica.
6. proximos_passos: Sugestões de próximos passos, enfatizando a importância de:
   - Fazer upload de exames adicionais na plataforma para acompanhamento
   - Consultar com médico através da plataforma
   - Manter um histórico completo de exames na plataforma
   - NÃO mencione SUS, UBS, Unidades Básicas de Saúde ou Disque Saúde

IMPORTANTE: 
- Responda APENAS em formato JSON válido
- Não inclua markdown ou formatação adicional
- Seja preciso e objetivo
- Use linguagem clara e acessível
- Foque em orientar o uso da plataforma para acompanhamento médico`;

      // Preparar requisição para o Gemini
      // Para imagens, usar o modelo gemini-1.5-pro com vision
      // Para PDFs, precisamos extrair o texto primeiro ou usar o modelo apropriado
      
      let geminiRequest: any;
      let exameBase64 = ''; // Base64 para envio ao Gemini
      
      if (file_type === 'image') {
        // Para imagens, usar vision API
        // Determinar MIME type baseado na extensão ou Content-Type
        let mimeType = 'image/jpeg'; // padrão
        if (file_url.includes('.png')) {
          mimeType = 'image/png';
        } else if (file_url.includes('.jpg') || file_url.includes('.jpeg')) {
          mimeType = 'image/jpeg';
        } else if (file_url.includes('.webp')) {
          mimeType = 'image/webp';
        } else if (file_url.includes('.gif')) {
          mimeType = 'image/gif';
        }

        geminiRequest = {
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: '', // Será preenchido após baixar a imagem
                }
              }
            ]
          }]
        };

        // Baixar a imagem
        console.log('[ANALYZE-EXAME] Baixando imagem...');
        const imageResponse = await fetch(file_url);
        if (!imageResponse.ok) {
          throw new Error(`Erro ao baixar imagem: ${imageResponse.status} ${imageResponse.statusText}`);
        }
        
        // Verificar tamanho do arquivo (limite do Gemini: ~20MB para inline_data)
        const contentLength = imageResponse.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 20 * 1024 * 1024) {
          throw new Error('Imagem muito grande. Tamanho máximo: 20MB');
        }
        
        const imageBytes = await imageResponse.arrayBuffer();
        console.log('[ANALYZE-EXAME] Imagem baixada. Tamanho:', imageBytes.byteLength, 'bytes');
        
        // Converter para base64
        exameBase64 = btoa(String.fromCharCode(...new Uint8Array(imageBytes)));
        geminiRequest.contents[0].parts[1].inline_data.data = exameBase64;
      } else {
        // Para PDFs, baixar e enviar como inline_data
        // O Gemini 1.5 Pro suporta PDFs diretamente
        console.log('[ANALYZE-EXAME] Baixando PDF...');
        const pdfResponse = await fetch(file_url);
        if (!pdfResponse.ok) {
          throw new Error(`Erro ao baixar PDF: ${pdfResponse.status} ${pdfResponse.statusText}`);
        }
        
        // Verificar tamanho do arquivo (limite do Gemini: ~20MB para inline_data)
        const contentLength = pdfResponse.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 20 * 1024 * 1024) {
          throw new Error('PDF muito grande. Tamanho máximo: 20MB');
        }
        
        const pdfBytes = await pdfResponse.arrayBuffer();
        console.log('[ANALYZE-EXAME] PDF baixado. Tamanho:', pdfBytes.byteLength, 'bytes');
        
        // Converter para base64
        exameBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));
        
        geminiRequest = {
          contents: [{
            parts: [
              { text: prompt + '\n\nO arquivo é um PDF. Analise o conteúdo do PDF fornecido.' },
              {
                inline_data: {
                  mime_type: 'application/pdf',
                  data: exameBase64,
                }
              }
            ]
          }]
        };
      }

      // Chamar API do Gemini
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiApiKey}`;
      
      console.log('[ANALYZE-EXAME] Chamando API do Gemini...');
      
      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiRequest),
      });

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error('[ANALYZE-EXAME] Erro na API do Gemini:', errorText);
        throw new Error(`Erro na API do Gemini: ${geminiResponse.status} - ${errorText}`);
      }

      const geminiData = await geminiResponse.json();
      console.log('[ANALYZE-EXAME] Resposta do Gemini recebida');

      // Extrair texto da resposta
      const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error('Resposta do Gemini não contém texto');
      }

      // Tentar parsear como JSON
      let parsedResponse: GeminiResponse;
      try {
        // Remover markdown code blocks se existirem
        const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsedResponse = JSON.parse(cleanedText);
      } catch (parseError) {
        console.error('[ANALYZE-EXAME] Erro ao parsear JSON:', parseError);
        // Se não conseguir parsear, criar uma resposta estruturada a partir do texto
        parsedResponse = {
          interpretacao: responseText,
          proximos_passos: 'Recomendamos fazer upload de exames adicionais na plataforma e consultar com médico através da plataforma para acompanhamento completo.',
        };
      }

      // Obter informações de uso de tokens
      const usageMetadata = geminiData.usageMetadata;
      const tokensUsed = usageMetadata?.totalTokenCount || 0;

      // Preparar dados para atualização
      const updateData: any = {
        tipo_exame: parsedResponse.tipo_exame || null,
        valores_principais: parsedResponse.valores_principais || null,
        alteracoes: parsedResponse.alteracoes || null,
        interpretacao: parsedResponse.interpretacao || null,
        proximos_passos: parsedResponse.proximos_passos || null,
        status: 'concluida',
        modelo_usado: 'gemini-1.5-pro',
        tokens_usados: tokensUsed,
      };

      // Atualizar fontes se disponíveis
      if (parsedResponse.fontes && Array.isArray(parsedResponse.fontes)) {
        updateData.fontes = parsedResponse.fontes;
      }

      // Atualizar registro com os resultados
      const { error: updateError } = await supabase
        .from('analises_exames')
        .update(updateData)
        .eq('id', analiseId);

      if (updateError) {
        console.error('[ANALYZE-EXAME] Erro ao atualizar registro:', updateError);
        throw new Error(`Erro ao atualizar registro: ${updateError.message}`);
      }

      // Se houver task_exame_id vinculado, atualizar também tasks_listaexames
      if (finalTaskExameId) {
        const taskUpdateData: any = {
          urlfoto: file_url,
          interpretacao: parsedResponse.interpretacao || null,
          complete: true, // Marcar como concluído
        };

        // Atualizar fontes se disponíveis
        if (parsedResponse.fontes && Array.isArray(parsedResponse.fontes)) {
          taskUpdateData.fontes = parsedResponse.fontes;
        }

        const { error: taskUpdateError } = await supabase
          .from('tasks_listaexames')
          .update(taskUpdateData)
          .eq('id', finalTaskExameId)
          .eq('user_id', userId);

        if (taskUpdateError) {
          console.error('[ANALYZE-EXAME] Erro ao atualizar task exame:', taskUpdateError);
          // Não falhar a análise se a atualização da task falhar
        } else {
          console.log('[ANALYZE-EXAME] Task exame atualizada:', finalTaskExameId);
        }

        // Verificar se todos os exames do usuário foram concluídos para gerar prescrição assinada
        try {
          const { count: pendingCount, error: pendingError } = await supabase
            .from('tasks_listaexames')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('complete', false);

          const { count: totalCount, error: totalError } = await supabase
            .from('tasks_listaexames')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

          if (pendingError || totalError) {
            console.error('[ANALYZE-EXAME] Erro ao verificar exames pendentes:', pendingError || totalError);
          } else if ((totalCount || 0) > 0 && (pendingCount || 0) === 0) {
            // Disparar geração da prescrição assinada quando todos estiverem completos
            const { data: prescricaoData, error: prescricaoError } = await supabase.functions.invoke(
              'auto-generate-prescricao-pdf',
              { body: { user_id: userId } }
            );

            if (prescricaoError || prescricaoData?.success === false) {
              console.error(
                '[ANALYZE-EXAME] Erro ao gerar prescrição assinada:',
                prescricaoError || prescricaoData?.error
              );
            } else {
              console.log('[ANALYZE-EXAME] Prescrição assinada gerada com sucesso');
            }
          }
        } catch (checkError) {
          console.error('[ANALYZE-EXAME] Erro ao checar conclusão de exames:', checkError);
        }
      }

      console.log('[ANALYZE-EXAME] Análise concluída com sucesso');

      return new Response(
        JSON.stringify({
          success: true,
          analise_id: analiseId,
          tipo_exame: parsedResponse.tipo_exame,
          valores_principais: parsedResponse.valores_principais,
          alteracoes: parsedResponse.alteracoes,
          interpretacao: parsedResponse.interpretacao,
          proximos_passos: parsedResponse.proximos_passos,
          fontes: parsedResponse.fontes || null,
          tokens_usados: tokensUsed,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    } catch (analysisError) {
      console.error('[ANALYZE-EXAME] Erro durante análise:', analysisError);
      
      // Atualizar registro com erro
      await supabase
        .from('analises_exames')
        .update({
          status: 'erro',
          erro_mensagem: analysisError.message || 'Erro desconhecido',
        })
        .eq('id', analiseId);

      throw analysisError;
    }
  } catch (error) {
    console.error('[ANALYZE-EXAME] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Erro desconhecido ao processar análise',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
