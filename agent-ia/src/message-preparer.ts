// Preparador de mensagens para Gemini (lógica extraída do orchestrator)
import { GeminiMessage } from './types';
import { ConversationHistoryItem } from './types';
import { GeminiClient } from './gemini-client';

export class MessagePreparer {
  private geminiClient: GeminiClient;

  constructor(geminiClient: GeminiClient) {
    this.geminiClient = geminiClient;
  }
  /**
   * Remove prefixo data:audio se existir, retorna base64 puro
   */
  private cleanAudioBase64(audioData: string): string {
    if (audioData.startsWith('data:audio/')) {
      // Remover prefixo data:audio/wav;base64, ou similar
      const base64Start = audioData.indexOf('base64,');
      if (base64Start !== -1) {
        return audioData.substring(base64Start + 7);
      }
    }
    return audioData;
  }

  /**
   * Detecta se uma mensagem é arquivo base64 (PDF ou imagem)
   */
  private isFileBase64(message: string): boolean {
    if (!message || message.length === 0) return false;
    if (message.startsWith('data:application/pdf')) return true;
    if (message.startsWith('data:image/')) return true;
    // Magic numbers base64 comuns
    if (message.startsWith('JVBERi0')) return true; // PDF
    if (message.startsWith('iVBORw0KGgo')) return true; // PNG
    if (message.startsWith('/9j/')) return true; // JPEG
    if (message.startsWith('R0lGOD')) return true; // GIF
    // Base64 muito longo sem espaços pode ser arquivo
    const isBase64Pattern = /^[A-Za-z0-9+/=]+$/.test(message);
    if (isBase64Pattern && message.length > 2000 && !message.includes(' ')) {
      return true;
    }
    return false;
  }

  private isMediaBase64(message: string): boolean {
    return this.isAudioBase64(message) || this.isFileBase64(message);
  }

  /**
   * Prepara mensagens no formato Gemini
   * IMPORTANTE: Usa Threads_Gemini (contexto interno - apenas texto) para construir mensagens do Gemini
   * anamnesechathistorico é usado apenas para dados coletados (extractCollectedData)
   * CRÍTICO: NUNCA enviar base64 de áudio para o Gemini - sempre usar texto transcrito
   */
  async prepareGeminiMessages(
    geminiThreadHistory: ConversationHistoryItem[], // Histórico interno (Threads_Gemini) - apenas texto
    anamneseHistory: ConversationHistoryItem[], // Histórico anamnese (para dados coletados) - texto + áudio
    currentMessage: string,
    fullTranscript: string // Deve ser gerado de Threads_Gemini (apenas texto)
  ): Promise<GeminiMessage[]> {
    const messages: GeminiMessage[] = [];

    // Usar histórico de Threads_Gemini (contexto interno - apenas texto transcrito)
    console.log('[MESSAGE-PREPARER] Preparando mensagens do histórico interno (Threads_Gemini)');
    const historyMessages = this.buildMessagesFromGeminiThread(geminiThreadHistory);
    messages.push(...historyMessages);

    // Adicionar contexto sobre perguntas já feitas e dados coletados
    // CRÍTICO: Usar geminiThreadHistory para perguntas (apenas texto) e anamneseHistory apenas para dados coletados (filtrando base64)
    if (geminiThreadHistory.length > 0 || anamneseHistory.length > 0) {
      const contextMessage = this.buildContextMessage(geminiThreadHistory, anamneseHistory, fullTranscript);
      if (contextMessage) {
        messages.push({
          role: 'user',
          parts: [{ text: contextMessage }],
        });
      }
    }

    // Adicionar mensagem atual SOMENTE se ela ainda não estiver representada no histórico.
    // CRÍTICO: Verificar se currentMessage não é base64 de áudio (não deveria ser, mas por segurança)
    // Observação: o AgentOrchestrator salva a mensagem do usuário antes de buscar o histórico.
    // Então, para evitar duplicação (que pode confundir o modelo e causar perguntas redundantes),
    // comparamos com o último conteúdo efetivo do histórico já convertido para Gemini.
    if (currentMessage && currentMessage.length > 0) {
      // Verificar se currentMessage é base64 de áudio (não deveria ser, mas por segurança)
      if (this.isMediaBase64(currentMessage)) {
        console.warn('[MESSAGE-PREPARER] ⚠️ currentMessage contém base64 de mídia - ignorando');
        // Não adicionar base64 de áudio - já deve estar transcrito no histórico
      } else {
        const last = messages.length > 0 ? messages[messages.length - 1] : null;
        const lastText = last?.parts?.[0]?.text?.trim?.() ?? '';
        const currentText = currentMessage.trim();

        const alreadyIncluded = last?.role === 'user' && lastText.length > 0 && lastText === currentText;

        if (!alreadyIncluded) {
          messages.push({
            role: 'user',
            parts: [{ text: currentMessage }],
          });
        } else {
          console.log('[MESSAGE-PREPARER] Mensagem atual já presente no histórico; evitando duplicação');
        }
      }
    }

    return messages;
  }


  /**
   * Constrói mensagens a partir do histórico interno (Threads_Gemini)
   * IMPORTANTE: Threads_Gemini já contém apenas texto transcrito (não precisa transcrever áudios)
   */
  private buildMessagesFromGeminiThread(history: ConversationHistoryItem[]): GeminiMessage[] {
    const messages: GeminiMessage[] = [];

    console.log(`[MESSAGE-PREPARER] Construindo mensagens do histórico interno (${history.length} itens)`);

    for (let i = 0; i < history.length; i++) {
      const item = history[i];
      
      try {
        // Roles já estão normalizados no banco: 'user' ou 'model'
        const role = item.role;
        
        // Threads_Gemini sempre contém apenas texto transcrito
        const content = item.message || '';
        
        // Verificar se por algum motivo contém base64 de áudio (não deveria)
        if (this.isMediaBase64(content)) {
          console.warn(`[MESSAGE-PREPARER] ⚠️ Item ${i+1}/${history.length} contém mídia base64 em Threads_Gemini - ignorando`);
          continue; // Ignorar áudios em Threads_Gemini
        }

        if (content.length > 0) {
          messages.push({
            role,
            parts: [{ text: content }],
          });
        }
      } catch (error: any) {
        console.error(`[MESSAGE-PREPARER] Erro ao processar item ${i+1}/${history.length} do histórico interno:`, error);
        // Continuar processando outros itens mesmo se houver erro
      }
    }

    console.log(`[MESSAGE-PREPARER] ${messages.length} mensagens construídas do histórico interno`);
    return messages;
  }

  /**
   * Constrói mensagem de contexto sobre perguntas já feitas E DADOS JÁ COLETADOS
   * IMPORTANTE: Extrai informações estruturadas para facilitar o acesso do agente
   * CRÍTICO: Usar geminiThreadHistory para perguntas (apenas texto) e anamneseHistory apenas para dados coletados (filtrando base64)
   */
  private buildContextMessage(
    geminiThreadHistory: ConversationHistoryItem[], // Histórico interno (apenas texto) - para perguntas
    anamneseHistory: ConversationHistoryItem[], // Histórico anamnese (texto + áudio) - apenas para dados coletados
    fullTranscript: string // Deve ser gerado de Threads_Gemini (apenas texto)
  ): string | null {
    // Usar geminiThreadHistory para perguntas (apenas texto transcrito)
    const assistantMessages = geminiThreadHistory.filter(item => item.role === 'model' && item.message);
    
    if (assistantMessages.length === 0 && anamneseHistory.length === 0) {
      return null;
    }

    // Extrair DADOS JÁ COLETADOS do histórico anamnese (filtrando base64 automaticamente)
    // extractCollectedData já filtra base64 de áudio
    const collectedData = this.extractCollectedData(anamneseHistory);

    // Usar perguntas do histórico interno (Threads_Gemini) - sempre texto transcrito
    const questionsList = assistantMessages
      .map((item, idx) => `${idx + 1}. ${item.message}`)
      .join('\n');

    // fullTranscript deve vir de Threads_Gemini (apenas texto) - verificar se contém base64 por segurança
    // Se contiver base64, usar apenas geminiThreadHistory para gerar transcrição
    let safeTranscript = fullTranscript;
    if (this.isMediaBase64(fullTranscript) || fullTranscript.includes('[Mensagem de áudio]')) {
      console.warn('[MESSAGE-PREPARER] ⚠️ fullTranscript contém mídia - gerando transcrição segura de geminiThreadHistory');
      safeTranscript = geminiThreadHistory
        .map(item => {
          const roleLabel = item.role === 'user' ? 'Paciente' : 'Assistente';
          return `${roleLabel}: ${item.message || '[Sem conteúdo]'}`;
        })
        .join('\n');
    }

    let contextMessage = `\n\n[CONTEXTO INTERNO - NÃO MOSTRAR AO PACIENTE]

=== DADOS JÁ COLETADOS DO PACIENTE ===
IMPORTANTE: SEMPRE consulte esta seção antes de fazer qualquer pergunta!
NÃO pergunte sobre dados que já estão listados aqui!

${collectedData}

=== PERGUNTAS JÁ FEITAS ===
${questionsList || '(Nenhuma pergunta feita ainda)'}

=== TRANSCRIÇÃO COMPLETA ===
${safeTranscript || '(Nenhuma transcrição disponível)'}

REGRA CRÍTICA: 
1. CONSULTE os "DADOS JÁ COLETADOS" acima antes de perguntar
2. NÃO repita perguntas já feitas
3. NÃO peça informações já fornecidas (veja "DADOS JÁ COLETADOS")
4. Continue com a próxima pergunta do protocolo
5. Se todos os dados obrigatórios estiverem coletados, chame solicitar_exames

[FIM DO CONTEXTO INTERNO]\n`;

    return contextMessage;
  }

  /**
   * Detecta se uma mensagem é áudio base64
   * CRÍTICO: Previne que áudios não transcritos sejam incluídos nos dados coletados
   */
  private isAudioBase64(message: string): boolean {
    if (!message || message.length === 0) return false;
    
    // Verificar se começa com prefixo de áudio
    if (message.startsWith('data:audio')) return true;
    
    // Verificar se começa com base64 de WAV (UklGR)
    if (message.startsWith('UklGR')) return true;
    
    // Verificar se é base64 puro (caracteres alfanuméricos, +, /, = apenas)
    // Base64 de áudio geralmente é muito longo (>1000 caracteres) e não contém espaços
    const isBase64Pattern = /^[A-Za-z0-9+/=]+$/.test(message);
    if (isBase64Pattern && message.length > 1000 && !message.includes(' ')) {
      return true;
    }
    
    return false;
  }

  /**
   * Extrai dados estruturados do histórico da conversa
   * Analisa respostas do usuário e identifica informações-chave
   * IMPORTANTE: Ignora áudios base64 para evitar estourar limite de tokens
   */
  private extractCollectedData(history: ConversationHistoryItem[]): string {
    const collectedData: string[] = [];
    const dataMap: { [key: string]: string } = {};

    for (let i = 0; i < history.length; i++) {
      const current = history[i];
      const previous = i > 0 ? history[i - 1] : null;

      // Se é uma resposta do usuário
      if (current.role === 'user' && current.message) {
        // CRÍTICO: Ignorar mensagens de áudio base64 (já devem estar transcritas no histórico)
        // Mas por segurança, verificar aqui também para evitar incluir base64 nos dados coletados
        if (current.type === 'file' || this.isAudioBase64(current.message) || this.isFileBase64(current.message)) {
          console.log(`[MESSAGE-PREPARER] Ignorando mensagem de mídia base64 no extractCollectedData (índice ${i})`);
          continue; // Pular esta mensagem - áudios devem estar transcritos no histórico
        }
        
        const userResponse = current.message.toLowerCase().trim();
        const originalMessage = current.message.trim();
        const questionBefore = previous?.role === 'model' && previous.message 
          ? (this.isMediaBase64(previous.message) ? '' : previous.message.toLowerCase())
          : '';

        // ====================================================================
        // PRIORIDADE 1: EXTRAÇÃO INTELIGENTE DE DADOS ESPONTÂNEOS
        // (Captura dados mesmo sem pergunta anterior)
        // ====================================================================
        
        // IMPORTANTE: Detectar SINTOMAS COMUNS automaticamente
        const sintomasComuns = [
          'dor', 'febre', 'tosse', 'náusea', 'nausea', 'vômito', 'vomito', 
          'tontura', 'fraqueza', 'cansaço', 'cansaco', 'mal-estar', 'mal estar',
          'diarreia', 'prisão de ventre', 'constipação', 'constipacao',
          'falta de ar', 'dificuldade para respirar', 'chiado',
          'palpitação', 'palpitacao', 'taquicardia',
          'formigamento', 'dormência', 'dormencia',
          'inchaço', 'inchaco', 'edema',
          'sangramento', 'hemorragia',
          'coceira', 'prurido', 'erupção', 'erupcao', 'mancha',
          'desmaio', 'perda de consciência', 'perda de consciencia'
        ];

        // Verificar se mensagem contém sintomas
        const temSintoma = sintomasComuns.some(sintoma => userResponse.includes(sintoma));

        // Se for a PRIMEIRA mensagem do usuário E contém sintomas E não é só saudação
        const isFirstUserMessage = i === 0 || history.slice(0, i).filter(h => h.role === 'user').length === 0;
        const isSaudacao = userResponse.match(/^(olá|ola|oi|bom dia|boa tarde|boa noite)\s*$/i);
        
        if (isFirstUserMessage && temSintoma && !isSaudacao && !dataMap['queixa_principal']) {
          // Remover saudações do início
          let queixa = originalMessage.replace(/^(Olá|Ola|Oi|Bom dia|Boa tarde|Boa noite)[,!.\s]*/i, '').trim();
          if (queixa.length > 3) {
            dataMap['queixa_principal'] = queixa;
            // Aproveitar a queixa como nome do sintoma principal quando possível.
            dataMap['sintoma_principal_nome'] = queixa;
          }
        }

        // Detectar duração/tempo (há X dias/horas/semanas/meses)
        const duracaoMatch = userResponse.match(/há\s+(\d+)\s+(dia|dias|hora|horas|semana|semanas|mes|meses|mês|mêses)/i);
        if (duracaoMatch && !dataMap['sintoma_principal_duracao']) {
          dataMap['sintoma_principal_duracao'] = duracaoMatch[0];
        }

        // Detectar intensidade (X/10 ou escala numérica)
        const intensidadeMatch = userResponse.match(/(\d+)\s*\/\s*10|intensidade\s+(\d+)|nota\s+(\d+)/i);
        if (intensidadeMatch && !dataMap['sintoma_principal_intensidade']) {
          const intensidade = intensidadeMatch[1] || intensidadeMatch[2] || intensidadeMatch[3];
          dataMap['sintoma_principal_intensidade'] = `${intensidade}/10`;
        }

        // Detectar características de dor
        const caracteristicas = ['queimação', 'queimacao', 'pontada', 'pontadas', 'latejante', 'aperto', 'peso', 'pulsátil', 'pulsatil', 'ardência', 'ardencia', 'cólica', 'colica', 'fisgada', 'fisgadas'];
        for (const caract of caracteristicas) {
          if (userResponse.includes(caract) && !dataMap['sintoma_principal_caracteristica']) {
            dataMap['sintoma_principal_caracteristica'] = caract;
            break;
          }
        }

        // Detectar localização (dor no/na X)
        // Capturar até vírgula, ponto, "e" seguido de sintoma, ou fim da frase
        const localizacaoMatch = userResponse.match(/dor\s+(?:no|na|nas|nos)\s+([a-záàâãéèêíïóôõöúçñ]+(?:\s+[a-záàâãéèêíïóôõöúçñ]+)?)(?:\s*[,.]|\s+e\s+(?:febre|tosse|vômito|vomito|náusea|nausea|tontura|fraqueza|cansaço|cansaco|diarreia|falta|palpitação|palpitacao|formigamento|desmaio|coceira|inchaço|inchaco|sangramento|hemorragia|dor|$))/i);
        if (localizacaoMatch && !dataMap['sintoma_principal_localizacao']) {
          let loc = localizacaoMatch[1].trim();
          // Se terminar com "e" seguido de sintoma, remover
          loc = loc.replace(/\s+e\s+(?:febre|tosse|vômito|vomito|náusea|nausea|tontura|fraqueza|cansaço|cansaco|diarreia|falta|palpitação|palpitacao|formigamento|desmaio|coceira|inchaço|inchaco|sangramento|hemorragia|dor).*$/i, '');
          dataMap['sintoma_principal_localizacao'] = loc.trim();
        }
        // Detectar localização alternativa (ex: "dor de cabeça", "dor atrás dos olhos")
        // Capturar até vírgula, ponto, "e" seguido de sintoma, ou fim da frase
        if (!dataMap['sintoma_principal_localizacao']) {
          const locAlt = userResponse.match(/dor\s+(?:de|atrás|atras)\s+([a-záàâãéèêíïóôõöúçñ]+(?:\s+[a-záàâãéèêíïóôõöúçñ]+)*?)(?:\s*[,.]|\s+e\s+(?:febre|tosse|vômito|vomito|náusea|nausea|tontura|fraqueza|cansaço|cansaco|diarreia|falta|palpitação|palpitacao|formigamento|desmaio|coceira|inchaço|inchaco|sangramento|hemorragia|dor|$))/i);
          if (locAlt) {
            let localizacao = locAlt[1].trim();
            // Remover "e" seguido de sintoma se capturado incorretamente
            localizacao = localizacao.replace(/\s+e\s+(?:febre|tosse|vômito|vomito|náusea|nausea|tontura|fraqueza|cansaço|cansaco|diarreia|falta|palpitação|palpitacao|formigamento|desmaio|coceira|inchaço|inchaco|sangramento|hemorragia|dor).*$/i, '');
            // Remover "dos" ou "das" se for a única palavra (erro de parsing)
            if (localizacao.match(/^(dos|das)$/i)) {
              localizacao = '';
            }
            if (localizacao.length > 0) {
              dataMap['sintoma_principal_localizacao'] = localizacao.trim();
            }
          }
        }

        // Detectar sintomas específicos mencionados
        const sintomasDetectados: string[] = [];

        // Sintomas/sinais comuns (expandido para cobrir o fluxo do app)
        if (userResponse.includes('dor de cabeça') || userResponse.includes('dor na cabeça') || userResponse.includes('cefale')) {
          sintomasDetectados.push('dor de cabeça');
        }
        if (userResponse.includes('dor atrás dos olhos') || userResponse.includes('dor atras dos olhos')) {
          sintomasDetectados.push('dor atrás dos olhos');
        }
        if (userResponse.includes('dor no corpo') || userResponse.includes('dores no corpo') || userResponse.includes('dor no corpo todo')) {
          sintomasDetectados.push('dor no corpo');
        }

        if (userResponse.includes('febre')) sintomasDetectados.push('febre');
        if (userResponse.includes('tontura')) sintomasDetectados.push('tontura');
        if (userResponse.includes('vômito') || userResponse.includes('vomito')) sintomasDetectados.push('vômito');
        if (userResponse.includes('náusea') || userResponse.includes('nausea')) sintomasDetectados.push('náusea');
        if (userResponse.includes('tosse')) sintomasDetectados.push('tosse');
        if (userResponse.includes('diarreia')) sintomasDetectados.push('diarreia');
        if (userResponse.includes('falta de ar')) sintomasDetectados.push('falta de ar');
        if (userResponse.includes('fraqueza')) sintomasDetectados.push('fraqueza');
        if (userResponse.includes('cansaço') || userResponse.includes('cansaco')) sintomasDetectados.push('cansaço');

        // Deduplicar mantendo ordem
        const sintomasUnicos = Array.from(new Set(sintomasDetectados));

        // Se o usuário já listou múltiplos sintomas numa mesma mensagem,
        // isso já responde a Pergunta 13 ("Tem algum outro sintoma?").
        // Armazenar como sintomas_associados para evitar o modelo perguntar novamente.
        if (sintomasUnicos.length > 0 && !dataMap['sintomas_associados']) {
          dataMap['sintomas_associados'] = sintomasUnicos.join(', ');
        }

        // ====================================================================
        // PRIORIDADE 2: DADOS BASEADOS EM PERGUNTA ANTERIOR
        // (Mantém lógica original)
        // ====================================================================
        
        if (questionBefore) {
          // Mapear respostas para o schema simplificado (máx. 15 perguntas).
          if (questionBefore.includes('principal problema') || questionBefore.includes('trouxe aqui')) {
            if (!dataMap['queixa_principal']) dataMap['queixa_principal'] = originalMessage;
            if (!dataMap['sintoma_principal_nome']) dataMap['sintoma_principal_nome'] = originalMessage;
          }
          else if (questionBefore.includes('quando') && (questionBefore.includes('começou') || questionBefore.includes('há quanto'))) {
            if (!dataMap['sintoma_principal_duracao']) dataMap['sintoma_principal_duracao'] = originalMessage;
          }
          else if (questionBefore.includes('intensidade') || questionBefore.includes('0 a 10')) {
            if (!dataMap['sintoma_principal_intensidade']) dataMap['sintoma_principal_intensidade'] = originalMessage;
          }
          else if (questionBefore.includes('descreveria') || questionBefore.includes('queimação') || questionBefore.includes('pontada')) {
            if (!dataMap['sintoma_principal_caracteristica']) dataMap['sintoma_principal_caracteristica'] = originalMessage;
          }
          else if (questionBefore.includes('onde') || questionBefore.includes('região')) {
            if (!dataMap['sintoma_principal_localizacao']) dataMap['sintoma_principal_localizacao'] = originalMessage;
          }
          else if (questionBefore.includes('piora') || questionBefore.includes('melhora')) {
            dataMap['fatores_agravantes_ou_melhora'] = originalMessage;
          }
          else if (questionBefore.includes('tratamento') || questionBefore.includes('já tentou')) {
            dataMap['tratamentos_tentados'] = originalMessage;
          }
          else if (questionBefore.includes('idade')) {
            dataMap['idade'] = originalMessage;
          }
          else if (questionBefore.includes('sexo')) {
            dataMap['sexo'] = originalMessage;
          }
          else if (
            questionBefore.includes('doenças crônicas') ||
            questionBefore.includes('doença crônica') ||
            questionBefore.includes('medicamento') ||
            questionBefore.includes('remédio') ||
            questionBefore.includes('alergia')
          ) {
            dataMap['antecedentes_relevantes'] = originalMessage;
          }
          else if (questionBefore.includes('sinal de alerta') || questionBefore.includes('emergência')) {
            dataMap['sinais_alerta_identificados'] = originalMessage;
          }
        }
      }
    }

    // ====================================================================
    // FORMATAR SAÍDA ESTRUTURADA
    // ====================================================================
    
    if (Object.keys(dataMap).length === 0) {
      return '(Nenhum dado coletado ainda)';
    }

    for (const [key, value] of Object.entries(dataMap)) {
      const label = key.replace(/_/g, ' ').toUpperCase();
      collectedData.push(`• ${label}: ${value}`);
    }

    const summary = collectedData.join('\n');
    console.log(`[MESSAGE-PREPARER] Dados coletados (${Object.keys(dataMap).length} itens):\n${summary}`);
    
    return summary || '(Nenhum dado coletado ainda)';
  }
}
