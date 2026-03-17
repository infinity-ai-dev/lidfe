// Executor de function calls
import { FunctionCallResult } from './types';
import { SupabaseClientService } from './supabase-client';
import { RedisClient } from './redis-client';

export class FunctionExecutor {
  private supabaseClient: SupabaseClientService;
  private geminiApiKey: string;
  private redisClient: RedisClient;

  constructor(
    supabaseClient: SupabaseClientService,
    geminiApiKey: string,
    redisClient: RedisClient
  ) {
    this.supabaseClient = supabaseClient;
    this.geminiApiKey = geminiApiKey;
    this.redisClient = redisClient;
  }

  private getUsageTokens(data: any): number {
    const usage = data?.usageMetadata;
    if (!usage) return 0;

    const total = usage?.totalTokenCount;
    if (typeof total === 'number' && Number.isFinite(total)) return total;

    const prompt = typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0;
    const candidates = typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0;
    const sum = prompt + candidates;
    return Number.isFinite(sum) ? sum : 0;
  }

  /**
   * Executa uma function call
   */
  async executeFunction(
    functionName: string,
    functionArgs: Record<string, any>,
    threadId: string,
    userId: string
  ): Promise<FunctionCallResult> {
    try {
      console.log(`[FUNCTION] Executando: ${functionName}`);
      console.log(`[FUNCTION] Args:`, JSON.stringify(functionArgs, null, 2));

      switch (functionName) {
        case 'solicitar_exames':
          return await this.executeSolicitarExames(functionArgs, threadId, userId);

        case 'gerar_prescricao_assinada':
          return await this.executeGerarPrescricaoAssinada(userId);
        
        // TODO: Implementar outras functions
        // case 'executar_deep_research':
        //   return await this.executeDeepResearch(functionArgs);
        // case 'consultar_rag_executor':
        //   return await this.executeConsultarRAG(functionArgs);

        default:
          return {
            success: false,
            output: `Função "${functionName}" não implementada`,
            error: `Função desconhecida: ${functionName}`,
          };
      }
    } catch (error: any) {
      console.error(`[FUNCTION] ❌ Erro ao executar ${functionName}:`, error);
      return {
        success: false,
        output: `Erro ao executar função: ${error.message}`,
        error: error.message,
      };
    }
  }

  /**
   * Executa a function solicitar_exames
   * Fluxo interno para solicitar exames:
   * 1. Chama Deep Research Agent do Gemini
   * 2. Processa resposta com sub-agente (Gemini para gerar JSON estruturado)
   * 3. Salva exames no banco via Supabase
   * 4. Usa Redis para coordenação/estado
   */
  private async executeSolicitarExames(
    args: Record<string, any>,
    threadId: string,
    userId: string
  ): Promise<FunctionCallResult> {
    try {
      console.log('[FUNCTION] Executando solicitar_exames...');
      console.log('[FUNCTION] Dados recebidos:', JSON.stringify(args, null, 2));

      // Conectar ao Redis se ainda não estiver conectado
      await this.redisClient.connect();
      if (!this.geminiApiKey) {
        throw new Error('GEMINI_API_KEY ausente para deep-research');
      }

      // 1. Preparar dados para analise clinica (modelo normal)
      // Deep Research fica reservado para receitas/prescricoes/dosagens
      const deepResearchQuery = this.buildDeepResearchQuery(args);
      const deepResearchResponse: any = await this.fallbackDeepResearch(deepResearchQuery);

      // 2. Processar resposta do modelo com sub-agente
      // Workflow usa gemini-2.5-flash-lite para processar e gerar JSON estruturado
      console.log('[FUNCTION] Processando resposta com sub-agente (Gemini)...');
      const examesData = await this.processDeepResearchResponse(deepResearchResponse, args);
      const totalTokensUsed =
        (deepResearchResponse?.tokensUsed || 0) + (examesData?.tokensUsed || 0);

      // 3. Salvar exames na tabela tasks_listaexames via Supabase
      console.log('[FUNCTION] Salvando exames no banco de dados...');
      const savedExams = await this.supabaseClient.saveExams(
        userId,
        threadId,
        examesData.exames,
        examesData.fontes
      );
      console.log('[FUNCTION] Gerando PDFs assinados no Supabase...');
      const pdfGenerationResult = await this.supabaseClient.generateSignedExams(savedExams);

      // 4. Limpar chaves temporárias do Redis (se houver)
      if (deepResearchResponse?.interaction_id) {
        const interactionKey = `interaction_id:${deepResearchResponse.interaction_id}`;
        const lastEventKey = `last_event_id:${deepResearchResponse.interaction_id}`;
        await this.redisClient.del(interactionKey);
        await this.redisClient.del(lastEventKey);
      }

      // 5. Preparar mensagem de resposta ao paciente
      let output = `Exames solicitados com sucesso!\n\n${examesData.mensagem}\n\nOs exames foram registrados no sistema.`;

      // Resumo obrigatório antes de orientar o usuário ao histórico de exames
      const hipotesesLista = (args.hipoteses_investigacao || '')
        .split(',')
        .map((hipotese: string) => hipotese.trim())
        .filter((hipotese: string) => hipotese.length > 0);

      const examesResumo = examesData.exames.map((exame: any, index: number) => {
        const urgenciaTexto = exame.urgencia ? ` (Urgência: ${exame.urgencia})` : '';
        const descricaoTexto = exame.descricao ? ` - ${exame.descricao}` : '';
        return `${index + 1}. ${exame.titulo}${descricaoTexto}${urgenciaTexto}`;
      });

      const resumoExames = [
        'Resumo dos exames e hipóteses:',
        '',
        `Hipóteses de investigação: ${hipotesesLista.length > 0 ? hipotesesLista.join(', ') : 'Não informado'}.`,
        args.justificativa_hipoteses ? `Justificativa das hipóteses: ${args.justificativa_hipoteses}` : null,
        'Exames solicitados:',
        examesResumo.length > 0 ? examesResumo.join('\n') : 'Não informado',
      ]
        .filter((linha: string | null) => linha && linha.length > 0)
        .join('\n');

      output += `\n\n${resumoExames}`;

      if (pdfGenerationResult.failed === 0) {
        output += `\n\nAs guias de exames estão prontas. Acesse a área de Histórico de Exames para visualizar.`;
      } else {
        output += `\n\nAlgumas guias não puderam ser geradas no momento (${pdfGenerationResult.failed} exame${pdfGenerationResult.failed > 1 ? 's' : ''}). Você pode tentar gerar novamente mais tarde na área de Histórico de Exames.`;
      }

      return {
        success: true,
        output,
        tokensUsed: totalTokensUsed,
      };
    } catch (error: any) {
      console.error('[FUNCTION] ❌ Erro ao executar solicitar_exames:', error);
      return {
        success: false,
        output: `Erro ao solicitar exames: ${error.message}`,
        error: error.message,
      };
    }
  }

  private buildDeepResearchQuery(args: Record<string, any>): string {
    const lines: string[] = [];

    lines.push('Realize uma análise clínica detalhada do caso apresentado e identifique as causas diagnósticas mais prováveis.');
    lines.push('');
    lines.push('## DADOS DO PACIENTE');
    lines.push('');

    if (args.queixa_principal) {
      lines.push(`**Queixa Principal:** ${args.queixa_principal}`);
      lines.push('');
    }

    if (args.sintoma_principal) {
      lines.push('**Sintoma Principal:**');
      lines.push(`- Nome: ${args.sintoma_principal.nome || 'Não especificado'}`);
      lines.push(`- Duração: ${args.sintoma_principal.duracao || 'Não especificado'}`);
      lines.push(`- Intensidade: ${args.sintoma_principal.intensidade || 'Não especificado'}`);
      lines.push(`- Característica: ${args.sintoma_principal.caracteristica || 'Não especificado'}`);
      lines.push(`- Localização: ${args.sintoma_principal.localizacao || 'Não especificado'}`);
      lines.push('');
    }

    if (args.sintomas_associados) {
      lines.push(`**Sintomas Associados:** ${args.sintomas_associados}`);
    }
    if (args.fatores_agravantes_ou_melhora) {
      lines.push(`**Fatores Agravantes ou Melhora:** ${args.fatores_agravantes_ou_melhora}`);
    }
    if (args.tratamentos_tentados) {
      lines.push(`**Tratamentos Tentados:** ${args.tratamentos_tentados}`);
    }
    if (args.idade) {
      lines.push(`**Idade:** ${args.idade}`);
    }
    if (args.sexo) {
      lines.push(`**Sexo:** ${args.sexo}`);
    }
    if (args.antecedentes_relevantes) {
      lines.push(`**Antecedentes Relevantes:** ${args.antecedentes_relevantes}`);
    }
    if (args.sinais_alerta_identificados) {
      lines.push(`**Sinais de Alerta:** ${args.sinais_alerta_identificados}`);
    }

    lines.push('');
    lines.push('## TAREFA DE PESQUISA');
    lines.push('');
    lines.push('Com base nos dados clínicos apresentados, realize uma pesquisa médica aprofundada e estruture sua resposta no seguinte formato:');
    lines.push('');
    lines.push('### 1. RESUMO EXECUTIVO');
    lines.push('Forneça um resumo conciso (2-3 parágrafos) do quadro clínico apresentado, destacando os aspectos mais relevantes para o diagnóstico diferencial.');
    lines.push('');
    lines.push('### 2. HIPÓTESES DIAGNÓSTICAS (ORDENADAS POR PROBABILIDADE)');
    lines.push('Para cada hipótese diagnóstica, inclua:');
    lines.push('- **Nome da condição/doença**');
    lines.push('- **Probabilidade estimada** (alta/média/baixa)');
    lines.push('- **Justificativa clínica** (por que esta hipótese é provável baseada nos sintomas e dados apresentados)');
    lines.push('- **Fatores de risco presentes** (se houver)');
    lines.push('- **Critérios diagnósticos relevantes**');
    lines.push('');
    lines.push('Apresente as hipóteses em ordem decrescente de probabilidade, priorizando as mais prováveis.');
    lines.push('');
    lines.push('### 3. EXAMES COMPLEMENTARES RECOMENDADOS');
    lines.push('Para cada exame recomendado, inclua:');
    lines.push('- **Nome completo e específico do exame** (ex: "Hemograma completo com contagem de plaquetas", não apenas "Hemograma")');
    lines.push('- **Justificativa para solicitação** (por que este exame é necessário para confirmar/descartar as hipóteses)');
    lines.push('- **Urgência** (crítica/alta/média/baixa)');
    lines.push('- **Hipótese diagnóstica que o exame ajuda a confirmar/descartar**');
    lines.push('');
    lines.push('Priorize exames essenciais (máximo 5-7 exames) que sejam mais relevantes para o diagnóstico diferencial.');
    lines.push('');
    lines.push('### 4. CONSIDERAÇÕES CLÍNICAS ADICIONAIS');
    lines.push('- Sinais de alerta que requerem atenção imediata (se houver)');
    lines.push('- Diagnósticos diferenciais importantes que não devem ser esquecidos');
    lines.push('- Recomendações gerais para investigação complementar');
    lines.push('');
    lines.push('## INSTRUÇÕES IMPORTANTES');
    lines.push('');
    lines.push('- Base sua análise em evidências médicas atualizadas e literatura científica relevante');
    lines.push('- Seja específico e objetivo nas recomendações');
    lines.push('- Priorize exames que tenham maior impacto no diagnóstico diferencial');
    lines.push('- Evite recomendar exames redundantes ou desnecessários');
    lines.push('- Cite fontes confiáveis quando apropriado');
    lines.push('- Considere a idade, sexo e antecedentes do paciente nas recomendações');
    lines.push('- Se houver sinais de alerta, destaque-os claramente');

    if (args.dados_conversa_completa) {
      lines.push('');
      lines.push('## CONTEXTO ADICIONAL DA CONVERSA');
      lines.push(String(args.dados_conversa_completa));
    }

    return lines.join('\n').trim();
  }

  private async executeGerarPrescricaoAssinada(
    userId: string
  ): Promise<FunctionCallResult> {
    try {
      // Solicitar geração da prescrição assinada no Supabase
      const result = await this.supabaseClient.generateSignedPrescricao(userId);

      if (!result.success) {
        return {
          success: false,
          output: 'Não foi possível gerar a prescrição assinada no momento.',
          error: result.error || 'Falha ao gerar prescrição',
        };
      }

      return {
        success: true,
        output: 'Prescrição assinada gerada com sucesso.',
      };
    } catch (error: any) {
      console.error('[FUNCTION] ❌ Erro ao gerar prescrição assinada:', error);
      return {
        success: false,
        output: `Erro ao gerar prescrição assinada: ${error.message}`,
        error: error.message,
      };
    }
  }

  private async fallbackDeepResearch(query: string): Promise<{ response_data: string; tokensUsed: number }> {
    const systemInstruction = `Você é um especialista clínico. Liste as causas mais provaveis, em ordem, com justificativas curtas. Seja direto.`;
    const requestBody = {
      contents: [
        {
          parts: [{ text: query }],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      generationConfig: {
        temperature: 0.2,
      },
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.geminiApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fallback Gemini error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();
    const tokensUsed = this.getUsageTokens(data);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { response_data: text, tokensUsed };
  }

  private async callDeepResearchAgent(input: any, useStreaming: boolean = false): Promise<any> {
    let interactionId: string | null = null;
    let lastEventId: string | null = null;
    let isComplete = false;
    let fullResponse = '';
    let interactionData: any = null;

    // Helper para processar eventos do stream
    const handleStreamChunk = (chunk: any) => {
      // 1. Capturar Interaction ID
      if (chunk.event_type === 'interaction.start') {
        interactionId = chunk.interaction?.id || chunk.interaction_id;
        console.log(`[FUNCTION] Deep Research iniciado. Interaction ID: ${interactionId}`);
        if (interactionId) {
          // Salvar no Redis para possível reconexão
          this.redisClient.set(`interaction_id:${interactionId}`, interactionId, 3600).catch(() => {});
        }
      }

      // 2. Rastrear IDs para reconexão
      if (chunk.event_id) {
        lastEventId = chunk.event_id;
        if (interactionId && lastEventId) {
          this.redisClient.set(`last_event_id:${interactionId}`, lastEventId, 3600).catch(() => {});
        }
      }

      // 3. Processar conteúdo
      if (chunk.event_type === 'content.delta') {
        if (chunk.delta?.type === 'text') {
          const text = chunk.delta.text || '';
          fullResponse += text;
          // Log incremental (opcional, pode ser removido em produção)
          if (text.length > 0) {
            process.stdout.write(text);
          }
        } else if (chunk.delta?.type === 'thought_summary') {
          const thoughtText = chunk.delta.content?.text || '';
          if (thoughtText) {
            console.log(`\n[FUNCTION] 💭 Pensamento do agente: ${thoughtText}`);
          }
        }
      } else if (chunk.event_type === 'interaction.complete') {
        isComplete = true;
        interactionData = chunk;
        console.log('\n[FUNCTION] ✅ Deep Research concluído');
      }
    };

    // Log do payload para debug
    console.log('[FUNCTION] Payload enviado ao Deep Research:', JSON.stringify(input, null, 2));
    console.log('[FUNCTION] Usando streaming:', useStreaming);
    
    // Se não usar streaming, fazer chamada simples e polling
    if (!useStreaming) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/interactions?key=${this.geminiApiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[FUNCTION] ❌ Erro na resposta da API (sem streaming):', errorText);
          throw new Error(`Deep Research API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as any;
        const interactionId = data.id || data.interaction_id;

        if (!interactionId) {
          throw new Error('Não foi possível obter interaction_id da resposta');
        }

        console.log(`[FUNCTION] Deep Research iniciado (sem streaming). Interaction ID: ${interactionId}`);
        return await this.pollDeepResearchResult(interactionId);
      } catch (error: any) {
        console.error('[FUNCTION] ❌ Erro ao chamar Deep Research Agent (sem streaming):', error);
        throw error;
      }
    }
    
    // 1. Iniciar tarefa com streaming
    const decoder = new TextDecoder(); // Definir decoder no escopo externo para uso em reconexão
    
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/interactions?key=${this.geminiApiKey}&alt=sse`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[FUNCTION] ❌ Erro na resposta da API:', errorText);
        throw new Error(`Deep Research API error: ${response.status} - ${errorText}`);
      }

      // Processar stream SSE
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('Response body não possui reader para streaming');
      }

      // Ler stream inicial
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6).trim();
            if (!data || data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              handleStreamChunk(parsed);
            } catch (e) {
              // Ignorar linhas que não são JSON válido
            }
          }
        }

        if (isComplete) break;
      }
    } catch (error: any) {
      console.error('[FUNCTION] ❌ Erro no stream inicial:', error.message);
      // Continuar para tentar reconexão se tivermos interactionId
    }

    // 2. Loop de reconexão (se necessário)
    const maxReconnectAttempts = 120; // Máximo de tentativas de reconexão
    let reconnectAttempts = 0;

    while (!isComplete && interactionId && reconnectAttempts < maxReconnectAttempts) {
      // Buscar last_event_id do Redis se disponível
      const cachedLastEventId = await this.redisClient.get(`last_event_id:${interactionId}`).catch(() => null);
      const eventIdToUse: string | null = cachedLastEventId || lastEventId;

      if (!eventIdToUse) {
        // Se não temos event_id, usar polling como fallback
        console.log(`[FUNCTION] Sem event_id, usando polling para interaction ${interactionId}...`);
        return await this.pollDeepResearchResult(interactionId);
      }

      console.log(`[FUNCTION] Reconectando ao interaction ${interactionId} a partir do evento ${eventIdToUse}...`);

      try {
        const reconnectResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/interactions/${interactionId}?key=${this.geminiApiKey}&stream=true&last_event_id=${eventIdToUse}&alt=sse`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (!reconnectResponse.ok) {
          throw new Error(`Reconexão falhou: ${reconnectResponse.status}`);
        }

        const reconnectReader = reconnectResponse.body?.getReader();
        if (!reconnectReader) {
          throw new Error('Response body não possui reader para reconexão');
        }

        // Processar stream de reconexão
        while (true) {
          const { done, value } = await reconnectReader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.substring(6).trim();
              if (!data || data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                handleStreamChunk(parsed);
              } catch (e) {
                // Ignorar linhas que não são JSON válido
              }
            }
          }

          if (isComplete) break;
        }
      } catch (error: any) {
        console.error(`[FUNCTION] Reconexão falhou (tentativa ${reconnectAttempts + 1}), tentando novamente em 2s...`, error.message);
        await new Promise(resolve => setTimeout(resolve, 2000));
        reconnectAttempts++;
      }
    }

    if (!isComplete) {
      throw new Error('Timeout ao aguardar conclusão do Deep Research (máximo de tentativas de reconexão atingido)');
    }

    if (!interactionId) {
      throw new Error('Não foi possível obter interaction_id');
    }

    // Limpar chaves do Redis após conclusão
    await this.redisClient.del(`interaction_id:${interactionId}`).catch(() => {});
    await this.redisClient.del(`last_event_id:${interactionId}`).catch(() => {});

    return {
      interaction_id: interactionId,
      response_data: fullResponse,
      interaction_data: interactionData,
    };
  }

  /**
   * Faz polling do resultado do Deep Research Agent
   * Segue a documentação oficial: https://ai.google.dev/gemini-api/docs/deep-research
   */
  private async pollDeepResearchResult(interactionId: string): Promise<any> {
    // Limites configuráveis para evitar bloqueio prolongado
    const pollInterval = Number(process.env.DEEP_RESEARCH_POLL_INTERVAL_MS ?? 10000);
    const maxWaitMs = Number(process.env.DEEP_RESEARCH_MAX_WAIT_MS ?? 180000);
    const maxAttempts = Math.max(1, Math.ceil(maxWaitMs / pollInterval));
    const startTime = Date.now();
    let attempts = 0;

    while (attempts < maxAttempts) {
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= maxWaitMs) {
        throw new Error(`Timeout ao aguardar resposta do Deep Research Agent (${Math.round(elapsedMs / 1000)}s)`);
      }

      try {
        // Polling conforme documentação oficial usando GET /interactions/{id}
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/interactions/${interactionId}?key=${this.geminiApiKey}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Deep Research polling error: ${response.status} - ${errorText}`);
        }

        const result = await response.json() as any;

        // Verificar status conforme documentação oficial
        if (result.status === 'completed') {
          // Extrair texto da última saída conforme documentação
          const lastOutput = result.outputs && result.outputs.length > 0
            ? result.outputs[result.outputs.length - 1]
            : null;

          const responseText = lastOutput?.text || result.text || '';

          console.log(`[FUNCTION] ✅ Deep Research concluído. Interaction ID: ${interactionId}`);

          return {
            interaction_id: interactionId,
            response_data: responseText,
            interaction_data: result,
          };
        } else if (result.status === 'failed') {
          throw new Error(`Deep Research falhou: ${result.error || 'Erro desconhecido'}`);
        }

        // Status ainda em processamento (pending, running, etc.)
        console.log(`[FUNCTION] Deep Research em processamento... Status: ${result.status} (tentativa ${attempts + 1}/${maxAttempts}) - Próxima verificação em ${Math.round(pollInterval / 1000)}s`);

        await new Promise(resolve => setTimeout(resolve, pollInterval));
        attempts++;
      } catch (error: any) {
        console.error(`[FUNCTION] Erro no polling (tentativa ${attempts + 1}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        attempts++;
      }
    }

    throw new Error('Timeout ao aguardar resposta do Deep Research Agent (máximo de tentativas atingido)');
  }

  /**
   * Extrai fontes da resposta do Deep Research
   * As fontes podem estar em interaction_data.outputs ou em uma estrutura de citações
   */
  private extractSourcesFromDeepResearch(deepResearchResponse: any): Array<{
    titulo: string;
    url?: string;
    tipo: string;
  }> {
    const fontes: Array<{ titulo: string; url?: string; tipo: string }> = [];
    
    try {
      // Tentar extrair fontes de interaction_data
      const interactionData = deepResearchResponse.interaction_data;
      
      if (interactionData?.outputs) {
        // Percorrer outputs para encontrar citações/fontes
        for (const output of interactionData.outputs) {
          if (output.citations || output.sources) {
            const sources = output.citations || output.sources;
            for (const source of sources) {
              fontes.push({
                titulo: source.title || source.name || 'Fonte não identificada',
                url: source.url || source.link,
                tipo: source.type || 'artigo',
              });
            }
          }
          
          // Verificar se há referências no texto
          if (output.text) {
            // Procurar por padrões de URLs e referências no texto
            const urlPattern = /https?:\/\/[^\s]+/g;
            const urls = output.text.match(urlPattern);
            if (urls && urls.length > 0) {
              urls.forEach((url: string) => {
                fontes.push({
                  titulo: url,
                  url: url,
                  tipo: 'artigo',
                });
              });
            }
          }
        }
      }
      
      // Tentar extrair de response_data se houver referências
      if (deepResearchResponse.response_data) {
        const urlPattern = /https?:\/\/[^\s]+/g;
        const urls = deepResearchResponse.response_data.match(urlPattern);
        if (urls && urls.length > 0) {
          urls.forEach((url: string) => {
            // Evitar duplicatas
            if (!fontes.find(f => f.url === url)) {
              fontes.push({
                titulo: url,
                url: url,
                tipo: 'artigo',
              });
            }
          });
        }
      }
    } catch (error) {
      console.error('[FUNCTION] Erro ao extrair fontes do Deep Research:', error);
    }
    
    return fontes;
  }

  /**
   * Processa resposta do Deep Research Agent com sub-agente (Gemini)
   * Usa gemini-2.5-flash-lite para gerar JSON estruturado
   */
  private async processDeepResearchResponse(
    deepResearchResponse: any,
    originalArgs: Record<string, any>
  ): Promise<{ exames: Array<any>; mensagem: string; fontes: Array<any>; tokensUsed: number }> {
    try {
      // Extrair fontes da resposta do Deep Research
      const fontes = this.extractSourcesFromDeepResearch(deepResearchResponse);
      
      // Chamar Gemini para processar resposta do Deep Research e gerar JSON estruturado
      const systemInstruction = `Você é um assistente médico especializado em análise de casos clínicos.

## TAREFA
Analise o relatório clínico fornecido e recomende:
1. Exames necessários
2. Hipótese diagnóstica provável
3. Fontes e referências utilizadas

## FORMATO DE SAÍDA

Use o schema estruturado fornecido. Seja objetivo e direto.

### HIPÓTESE DIAGNÓSTICA
- Identifique a causa mais provável baseada na análise
- Justifique em 1-2 frases

### EXAMES
Para cada exame:
- Nome completo e específico
- Por que solicitar (1 frase)
- Urgência: crítica/alta/média

### FONTES
- Liste todas as fontes, bases intelectuais e compêndios médicos utilizados
- Inclua artigos científicos, diretrizes clínicas, livros-texto e outras referências
- Formato: título, tipo (artigo/diretriz/compendio) e URL se disponível

## REGRAS
- Máximo 5-7 exames essenciais
- Seja específico: "Endoscopia digestiva alta" não "endoscopia"
- Priorize exames que confirmam/descartam a hipótese principal
- Remova redundâncias
- Sempre apresente as fontes para tal conclusão

Analise e gere a recomendação concisa.`;

      const requestBody = {
        contents: [
          {
            parts: [{ text: deepResearchResponse.response_data || '' }],
          },
        ],
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              hipotese_principal: {
                type: 'OBJECT',
                properties: {
                  diagnostico: {
                    type: 'STRING',
                    description: 'Nome da causa diagnóstica mais provável',
                  },
                  justificativa: {
                    type: 'STRING',
                    description: 'Justificativa em 1-2 frases',
                  },
                },
                required: ['diagnostico', 'justificativa'],
              },
              exames_recomendados: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    exame: {
                      type: 'STRING',
                      description: 'Nome completo do exame',
                    },
                    justificativa: {
                      type: 'STRING',
                      description: 'Por que solicitar este exame (máximo 1 frase)',
                    },
                    urgencia: {
                      type: 'STRING',
                      description: 'Nível de urgência',
                    },
                  },
                  required: ['exame', 'justificativa', 'urgencia'],
                },
                description: 'Lista de 5-7 exames essenciais',
              },
              prazo_realizacao: {
                type: 'STRING',
                description: 'Prazo recomendado para realizar os exames (ex: "24 horas", "2-3 dias", "1 semana")',
              },
              fontes: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    titulo: {
                      type: 'STRING',
                      description: 'Título da fonte (artigo, diretriz, compêndio, etc.)',
                    },
                    url: {
                      type: 'STRING',
                      description: 'URL da fonte se disponível',
                    },
                    tipo: {
                      type: 'STRING',
                      description: 'Tipo da fonte: artigo, diretriz, compendio, ou outro',
                    },
                  },
                  required: ['titulo', 'tipo'],
                },
                description: 'Lista de fontes, bases intelectuais e compêndios médicos utilizados',
              },
            },
            required: ['hipotese_principal', 'exames_recomendados', 'prazo_realizacao', 'fontes'],
          },
        },
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${this.geminiApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data: any = await response.json();
      const tokensUsed = this.getUsageTokens(data);
      const examesData = JSON.parse(data.candidates[0].content.parts[0].text);

      // Combinar fontes extraídas do Deep Research com fontes identificadas pelo Gemini
      const fontesCombinadas = [
        ...fontes,
        ...(examesData.fontes || []),
      ];
      
      // Remover duplicatas baseado em URL ou título
      const fontesUnicas = fontesCombinadas.filter((fonte: any, index: number, self: any[]) => {
        if (fonte.url) {
          return index === self.findIndex((f: any) => f.url === fonte.url);
        }
        return index === self.findIndex((f: any) => f.titulo === fonte.titulo);
      });

      // Converter para formato de exames
      const exames = examesData.exames_recomendados.map((exame: any) => ({
        titulo: exame.exame,
        descricao: exame.justificativa,
        urgencia: exame.urgencia,
        interpretacao: examesData.hipotese_principal.justificativa,
      }));

      const mensagem = `Com base na análise do seu caso, foram identificadas as seguintes hipóteses diagnósticas: ${examesData.hipotese_principal.diagnostico}.\n\n${examesData.hipotese_principal.justificativa}\n\nPrazo recomendado para realização dos exames: ${examesData.prazo_realizacao}`;

      return { exames, mensagem, fontes: fontesUnicas, tokensUsed };
    } catch (error: any) {
      console.error('[FUNCTION] ❌ Erro ao processar resposta do Deep Research:', error);
      
      // Fallback: usar dados originais se processamento falhar
      const examesEssenciais = (originalArgs.exames_essenciais || '')
        .split(',')
        .map((exame: string) => exame.trim())
        .filter((exame: string) => exame.length > 0);

      const exames = examesEssenciais.map((exame: string) => ({
        titulo: exame,
        descricao: originalArgs.justificativa_cada_exame || 'Exame solicitado para investigação do caso',
        urgencia: originalArgs.urgencia_exames || 'média',
        interpretacao: originalArgs.justificativa_hipoteses || '',
      }));

      const mensagem = `Exames solicitados com base na anamnese coletada.`;

      return { exames, mensagem, fontes: [], tokensUsed: 0 };
    }
  }
}
