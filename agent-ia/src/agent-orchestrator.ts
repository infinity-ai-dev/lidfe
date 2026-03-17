// Orquestrador principal do Agente IA (modularizado para performance e escala)
import { GeminiClient } from './gemini-client';
import { SupabaseClientService } from './supabase-client';
import { FunctionExecutor } from './function-executor';
import { RedisClient } from './redis-client';
import { CacheManager } from './cache-manager';
import { HistoryManager } from './history-manager';
import { MessageProcessor } from './message-processor';
import { MessagePreparer } from './message-preparer';
import { RateLimiter } from './rate-limiter';
import { SSENotifier } from './sse-notifier';
import { getTools } from './tools';
import {
  ProcessMessageRequest,
  ProcessMessageResponse,
  GeminiMessage,
  FunctionCallResult,
} from './types';

export class AgentOrchestrator {
  private geminiClient: GeminiClient;
  private supabaseClient: SupabaseClientService;
  private functionExecutor: FunctionExecutor;
  private geminiApiKey: string;
  private redisClient: RedisClient;
  private cacheManager: CacheManager;
  private historyManager: HistoryManager;
  private messageProcessor: MessageProcessor;
  private messagePreparer: MessagePreparer;
  private rateLimiter: RateLimiter;
  private sseNotifier: SSENotifier;

  constructor(
    geminiApiKey: string,
    supabaseUrl: string,
    supabaseServiceRoleKey: string,
    redisUrl?: string
  ) {
    this.geminiApiKey = geminiApiKey;
    this.geminiClient = new GeminiClient(geminiApiKey);
    this.supabaseClient = new SupabaseClientService(supabaseUrl, supabaseServiceRoleKey);
    this.redisClient = new RedisClient(redisUrl);
    this.cacheManager = new CacheManager(this.redisClient);
    this.historyManager = new HistoryManager(this.supabaseClient, this.cacheManager);
    this.messageProcessor = new MessageProcessor(this.geminiClient);
    this.messagePreparer = new MessagePreparer(this.geminiClient); // Passar geminiClient para transcrição
    this.rateLimiter = new RateLimiter(this.redisClient);
    this.sseNotifier = new SSENotifier();
    this.functionExecutor = new FunctionExecutor(
      this.supabaseClient,
      geminiApiKey,
      this.redisClient
    );
  }

  /**
   * Processa uma mensagem do usuário (otimizado com cache e processamento paralelo)
   */
  async processMessage(
    request: ProcessMessageRequest
  ): Promise<ProcessMessageResponse> {
    try {
      console.log(`[ORCHESTRATOR] Processando mensagem - Thread: ${request.threadId}, User: ${request.userId}`);

      let transcriptionTokens = 0;
      let examAnalysisTokens = 0;
      let generationTokens = 0;
      let functionTokens = 0;
      const hasFileAttachment = Boolean(request.fileUrl || request.fileBase64);
      let persistedFileUrl: string | null = request.fileUrl || null;
      let uploadedStorageBucket: string | null = null;
      let uploadedStoragePath: string | null = null;
      const supabaseStorageBase = process.env.SUPABASE_URL || '';
      const isSupabaseStorageUrl = (url?: string | null) => {
        if (!url) return false;
        if (url.includes('/storage/v1/')) return true;
        if (supabaseStorageBase && url.startsWith(supabaseStorageBase) && url.includes('/storage/v1/')) return true;
        return false;
      };
      const isGeminiFileUri = (url?: string | null) => {
        if (!url) return false;
        return url.includes('generativelanguage.googleapis.com') || url.startsWith('files/');
      };

      // 0. Notificar frontend que está processando
      await this.sseNotifier.notifyProcessing(request.userId, request.threadId);

      // 0. Validar mensagem
      const validation = this.messageProcessor.validateMessage(request);
      if (!validation.valid) {
        throw new Error(validation.error || 'Mensagem inválida');
      }

      // 0.1. Verificar rate limits
      const [userLimit, threadLimit, globalLimit] = await Promise.all([
        this.rateLimiter.checkUserLimit(request.userId),
        this.rateLimiter.checkThreadLimit(request.threadId),
        this.rateLimiter.checkGlobalLimit(),
      ]);

      if (!userLimit.allowed || !threadLimit.allowed || !globalLimit.allowed) {
        throw new Error('Limite de requisições excedido. Tente novamente em alguns instantes.');
      }

      // 1. Processar áudio (se houver) e salvar mensagem do usuário
      // 1.1. Processar arquivo de exame (se houver)
      let exameInterpretation: string | null = null;
      let exameAnalysisError: string | null = null;

      // Upload em storage não é necessário para análise via chat.
      
      if (request.fileUrl || request.fileBase64) {
        console.log('[ORCHESTRATOR] Arquivo de exame detectado, iniciando análise...');
        console.log(`[ORCHESTRATOR] fileUrl: ${request.fileUrl ? 'presente' : 'não presente'}`);
        console.log(`[ORCHESTRATOR] fileBase64: ${request.fileBase64 ? `presente (${request.fileBase64.length} chars)` : 'não presente'}`);
        console.log(`[ORCHESTRATOR] fileType: ${request.fileType || 'não especificado'}`);
        console.log(`[ORCHESTRATOR] fileMimeType: ${request.fileMimeType || 'não especificado'}`);
        
        try {
          // Detectar MIME type baseado no tipo fornecido ou inferir
          let mimeType = request.fileMimeType;
          
          if (!mimeType) {
            // Tentar inferir do fileType
            if (request.fileType === 'pdf') {
              mimeType = 'application/pdf';
            } else if (request.fileType === 'image') {
              // Tentar inferir do URL ou base64
              if (request.fileUrl) {
                if (request.fileUrl.includes('.png')) mimeType = 'image/png';
                else if (request.fileUrl.includes('.webp')) mimeType = 'image/webp';
                else if (request.fileUrl.includes('.gif')) mimeType = 'image/gif';
                else mimeType = 'image/jpeg'; // padrão
              } else {
                mimeType = 'image/jpeg'; // padrão para imagens
              }
            } else {
              // Tentar inferir do URL
              if (request.fileUrl) {
                if (request.fileUrl.includes('.pdf')) mimeType = 'application/pdf';
                else if (request.fileUrl.includes('.png')) mimeType = 'image/png';
                else if (request.fileUrl.includes('.webp')) mimeType = 'image/webp';
                else if (request.fileUrl.includes('.gif')) mimeType = 'image/gif';
                else mimeType = 'image/jpeg';
              } else {
                mimeType = 'image/jpeg'; // padrão se não conseguir inferir
              }
            }
          }
          
          console.log(`[ORCHESTRATOR] MIME type detectado: ${mimeType}`);

          const cleanBase64 = request.fileBase64
            ? request.fileBase64.replace(/^data:[^;]+;base64,/, '')
            : null;

          if (!request.fileUrl && cleanBase64) {
            try {
              console.log('[ORCHESTRATOR] Enviando arquivo para Google Files...');
              const upload = await this.geminiClient.uploadExamFileToGoogle({
                fileBase64: cleanBase64,
                mimeType,
                fileName: request.fileName ?? null,
              });
              request.fileUrl = upload.fileUri;
              persistedFileUrl = upload.fileUri;
              console.log('[ORCHESTRATOR] ✅ Arquivo enviado para Google Files:', upload.fileUri);
            } catch (uploadError: any) {
              console.warn('[ORCHESTRATOR] ⚠️ Falha ao enviar arquivo para Google Files:', uploadError?.message || uploadError);
            }
          }

          const fileUrlToSave = request.fileUrl || persistedFileUrl;
          const resolvedFileType =
            request.fileType ||
            (mimeType && mimeType.includes('application/pdf') ? 'pdf' : 'image');
          const titulo = request.fileName ?? null;

          const saveResultadoPromise = fileUrlToSave && isSupabaseStorageUrl(fileUrlToSave)
            ? this.supabaseClient
                .saveExameResultado({
                  userId: request.userId,
                  fileUrl: fileUrlToSave,
                  fileName: request.fileName ?? null,
                  mimeType: mimeType ?? null,
                  fileType: resolvedFileType ?? null,
                  titulo,
                  threadId: request.threadId,
                  source: 'chat',
                  storageBucket: uploadedStorageBucket,
                  storagePath: uploadedStoragePath,
                })
                .catch((error: any) => {
                  console.warn('[ORCHESTRATOR] ⚠️ Falha ao registrar upload do exame:', error?.message || error);
                })
            : null;
          
          if (request.fileUrl && isGeminiFileUri(request.fileUrl)) {
            console.log('[ORCHESTRATOR] Analisando exame via File URI...');
            const analysis = await this.geminiClient.analyzeExameFromFileUri(
              request.fileUrl,
              mimeType
            );
            exameInterpretation = analysis.interpretation;
            examAnalysisTokens += analysis.tokensUsed || 0;
          } else if (request.fileUrl) {
            // Analisar a partir de URL
            console.log('[ORCHESTRATOR] Analisando exame a partir de URL...');
            const analysis = await this.geminiClient.analyzeExameFromUrl(
              request.fileUrl,
              mimeType
            );
            exameInterpretation = analysis.interpretation;
            examAnalysisTokens += analysis.tokensUsed || 0;
          } else if (cleanBase64) {
            // Analisar a partir de base64
            console.log(`[ORCHESTRATOR] Analisando exame a partir de base64 (${cleanBase64.length} caracteres)...`);
            const analysis = await this.geminiClient.analyzeExame(
              cleanBase64,
              mimeType
            );
            exameInterpretation = analysis.interpretation;
            examAnalysisTokens += analysis.tokensUsed || 0;
          }

          if (saveResultadoPromise) {
            await saveResultadoPromise;
          }
          
          if (exameInterpretation && exameInterpretation.length > 0) {
            console.log(`[ORCHESTRATOR] ✅ Análise de exame concluída (${exameInterpretation.length} caracteres)`);
            
            // Salvar análise em analises_exames para exibição na tela de exames
            // Extrair fontes da interpretação se possível (pode estar no formato da resposta do Gemini)
            const fontes: Array<{ titulo: string; url?: string; tipo: string }> = [];
            
            // Tentar extrair fontes do texto (se o Gemini incluir no formato)
            // Por enquanto, deixar vazio - pode ser melhorado depois se necessário
            
            try {
              const fileUrlToSave = request.fileUrl || persistedFileUrl || '';
              const fileTypeToSave = request.fileType || (mimeType.startsWith('application/pdf') ? 'pdf' : 'image');
              
              await this.supabaseClient.saveExameAnalysis(
                request.userId,
                fileUrlToSave,
                fileTypeToSave,
                mimeType,
                exameInterpretation,
                examAnalysisTokens,
                fontes.length > 0 ? fontes : undefined
              );
              
              console.log('[ORCHESTRATOR] ✅ Análise salva em analises_exames para exibição na tela de exames');
            } catch (saveError: any) {
              // Não falhar o processo se não conseguir salvar em analises_exames
              // A interpretação já será salva em anamnesechathistorico
              console.warn('[ORCHESTRATOR] ⚠️ Erro ao salvar em analises_exames (continuando):', saveError.message);
            }
            
            // Adicionar contexto à mensagem do usuário de forma contextual
            if (request.message && request.message.trim().length > 0) {
              // Manter a mensagem original, a interpretação será adicionada na resposta
            } else {
              request.message = 'Analisei o exame anexado. Veja abaixo a interpretação dos resultados.';
            }
          } else {
            throw new Error('Interpretação do exame está vazia');
          }
        } catch (error: any) {
          console.error('[ORCHESTRATOR] ❌ Erro ao analisar exame:', error);
          exameAnalysisError = error.message || 'Erro desconhecido ao analisar exame';
          exameInterpretation = null;
          
          // Não bloquear a conversa, mas informar o erro
          if (request.message && request.message.trim().length > 0) {
            // Manter mensagem original, o erro será tratado na resposta
          } else {
            request.message = `Houve um erro ao analisar o exame anexado: ${exameAnalysisError}. Por favor, tente novamente ou descreva o exame em texto.`;
          }
        }
      }
      
      let finalMessage = request.message;
      let inputAudioMimeType: string | null = null;

      // 1.0. Salvar arquivo anexado (se houver) no histórico do usuário
      if (hasFileAttachment && request.fileBase64) {
        await this.supabaseClient.saveMessage(
          request.threadId,
          request.userId,
          '',
          'user',
          'file',
          request.fileBase64,
          request.fileMimeType || null,
          0,
          {
            fileName: request.fileName ?? null,
            fileSize: typeof request.fileSize === 'number' ? request.fileSize : null,
            fileType: request.fileType ?? null,
          }
        );

        // Salvar texto da mensagem (se houver) no contexto interno do Gemini
        if (request.message && request.message.trim().length > 0) {
          await this.supabaseClient.saveGeminiThreadMessage(
            request.threadId,
            request.userId,
            request.message.trim(),
            'user',
            0
          );
        }
      }

      if (request.audioBase64 && request.audioBase64.length > 0) {
        // CRÍTICO: saveMessage agora normaliza o áudio automaticamente
        // Mas precisamos transcrever antes, então vamos normalizar manualmente aqui também
        // para garantir que a transcrição funcione corretamente
        
        // Normalizar áudio (remover prefixo se existir) para transcrição
        const cleanAudioBase64 = request.audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');

        // Detectar mimeType e transcrever
        let transcribed: { text: string; mimeType: string; tokensUsed: number } | null = null;
        try {
          transcribed = await this.messageProcessor.transcribeAudio(cleanAudioBase64);
          finalMessage = transcribed.text;
          inputAudioMimeType = transcribed.mimeType;
          transcriptionTokens = transcribed.tokensUsed || 0;
        } catch (error) {
          finalMessage = '[Áudio não pôde ser transcrito]';
          inputAudioMimeType = 'audio/wav'; // Fallback
        }

        // Salvar áudio base64 em anamnesechathistorico (saveMessage normaliza automaticamente)
        // Passar o áudio original - saveMessage vai normalizar e detectar mimeType
        await this.supabaseClient.saveMessage(
          request.threadId,
          request.userId,
          '',
          'user',
          'audio',
          request.audioBase64, // Passar original - saveMessage normaliza
          inputAudioMimeType, // MimeType detectado na transcrição (será usado se normalização falhar)
          transcriptionTokens
        );

        // Salvar texto transcrito em Threads_Gemini (contexto interno)
        if (finalMessage && finalMessage.length > 0) {
          await this.supabaseClient.saveGeminiThreadMessage(
            request.threadId,
            request.userId,
            finalMessage, // Texto transcrito
            'user',
            transcriptionTokens
          );
        }
      } else if (!hasFileAttachment && finalMessage && finalMessage.length > 0) {
        // Salvar texto em anamnesechathistorico (formato original)
        await this.supabaseClient.saveMessage(
          request.threadId,
          request.userId,
          finalMessage,
          'user',
          'text',
          null,
          null,
          0
        );

        // Salvar texto em Threads_Gemini (contexto interno)
        await this.supabaseClient.saveGeminiThreadMessage(
          request.threadId,
          request.userId,
          finalMessage, // Mesmo texto
          'user',
          0
        );
      }

      // Invalidar cache após salvar nova mensagem
      await this.historyManager.invalidateCache(request.threadId, request.userId);

      // 2. Buscar ambos históricos e transcrição em paralelo (otimização)
      const { anamneseHistory, geminiThreadHistory, transcript } = await this.historyManager.getBothHistories(
        request.threadId,
        request.userId
      );

      // 4. Preparar mensagens no formato Gemini (usando módulo dedicado)
      // IMPORTANTE: Usa Threads_Gemini para contexto interno (apenas texto)
      // Usa anamneseHistory para dados coletados (pode ter áudios)
      const geminiMessages = await this.messagePreparer.prepareGeminiMessages(
        geminiThreadHistory, // Histórico interno (Threads_Gemini) - apenas texto
        anamneseHistory, // Histórico anamnese (para dados coletados) - texto + áudio
        finalMessage,
        transcript
      );

      // 5. Buscar tools disponíveis
      const tools = getTools();

      // 6. Chamar Gemini API
      const geminiResponse = await this.geminiClient.generateContent(geminiMessages, tools);
      generationTokens += this.getUsageTokens(geminiResponse);
      
      // Verificar se houve rate limit (429)
      if (geminiResponse instanceof Response && geminiResponse.status === 429) {
        throw new Error('RATE_LIMIT_429');
      }

      // 7. Processar resposta (verificar function calls)
      const response = this.processGeminiResponse(geminiResponse);

      // 6.0. Se houver interpretação de exame, integrar na resposta de forma natural
      let messageText = response.message || '';
      if (exameInterpretation) {
        // Combinar a resposta do agente com a interpretação do exame
        if (messageText && messageText.trim().length > 0) {
          messageText = `${messageText}\n\n---\n\n📋 **Interpretação do Exame**\n\n${exameInterpretation}`;
        } else {
          messageText = `📋 **Interpretação do Exame**\n\n${exameInterpretation}`;
        }
      } else if (exameAnalysisError) {
        // Se houver erro na análise, informar de forma clara
        const errorMessage = `⚠️ **Erro ao analisar exame**: ${exameAnalysisError}\n\nPor favor, verifique:\n- O arquivo está em formato suportado (PDF, JPEG, PNG)?\n- O arquivo não excede 20MB?\n- O arquivo está acessível?\n\nVocê pode tentar novamente ou descrever o exame em texto.`;
        if (messageText && messageText.trim().length > 0) {
          messageText = `${messageText}\n\n---\n\n${errorMessage}`;
        } else {
          messageText = errorMessage;
        }
      }

      // 7.1. Se NÃO houver function call E não for requisição de áudio, salvar resposta agora e RETORNAR
      if (!response.hasFunctionCall && request.messageType !== 'audio') {
        const assistantTokens = generationTokens + functionTokens + examAnalysisTokens;
        // Salvar texto em Threads_Gemini (contexto interno - sempre texto)
        if (messageText && messageText.length > 0) {
          await this.supabaseClient.saveGeminiThreadMessage(
            request.threadId,
            request.userId,
            messageText,
            'model',
            assistantTokens
          );
        }

        // Salvar texto em anamnesechathistorico (comunicação - formato original)
        await this.supabaseClient.saveMessage(
          request.threadId,
          request.userId,
          messageText,
          'model',
          'text',
          null,
          null,
          assistantTokens
        );
        
        // Notificar frontend via SSE que mensagem está pronta
        await this.sseNotifier.notifyNewMessage(request.userId, request.threadId, {
          message: messageText,
          role: 'model',
          type: 'text',
          createdAt: new Date().toISOString(),
        });

        // Invalidar cache após salvar resposta
        await this.historyManager.invalidateCache(request.threadId, request.userId);

        console.log(`[ORCHESTRATOR] Mensagem de texto salva e retornando (sem function call, sem audio)`);

        // RETORNAR aqui para evitar salvar novamente
        return {
          message: messageText,
          audioBase64: null,
          type: 'text',
          functionCall: response.functionCall || null,
          functionArgs: response.functionArgs || null,
          hasFunctionCall: false,
        };
      }

      // 8. Se houver function call, executar
      if (response.hasFunctionCall && response.functionCall) {
        console.log(`[ORCHESTRATOR] Function call detectada: ${response.functionCall}`);

        // Se for solicitar_exames, enviar mensagem ao usuário informando conclusão da coleta
        const isSolicitarExames = response.functionCall === 'solicitar_exames' || response.functionCall === 'solicitarExames';
        
        if (isSolicitarExames) {
          const completionMessage = 'A coleta da anamnese foi concluída com sucesso! Estou gerando sua lista de exames. Por favor, aguarde...';
          
          // Salvar mensagem de conclusão em Threads_Gemini (contexto interno)
          await this.supabaseClient.saveGeminiThreadMessage(
            request.threadId,
            request.userId,
            completionMessage,
            'model',
            0
          );

          // Gerar TTS se usuário enviou áudio
          let completionAudioBase64: string | null = null;
          let completionTtsTokens = 0;
          if (request.messageType === 'audio') {
            const ttsResult = await this.messageProcessor.generateTTS(completionMessage);
            completionAudioBase64 = ttsResult.audioBase64;
            completionTtsTokens = ttsResult.tokensUsed || 0;
          }

          // Salvar mensagem de conclusão em anamnesechathistorico (comunicação)
          await this.supabaseClient.saveMessage(
            request.threadId,
            request.userId,
            completionMessage,
            'model',
            completionAudioBase64 ? 'audio' : 'text',
            completionAudioBase64,
            completionAudioBase64 ? 'audio/wav' : null,
            completionAudioBase64 ? completionTtsTokens : 0
          );

          // Notificar frontend via SSE sobre conclusão
          await this.sseNotifier.notifyNewMessage(request.userId, request.threadId, {
            message: completionMessage,
            role: 'model',
            type: completionAudioBase64 ? 'audio' : 'text',
            audioBase64: completionAudioBase64,
            mimeType: completionAudioBase64 ? 'audio/wav' : null,
            createdAt: new Date().toISOString(),
          });

          // Invalidar cache
          await this.historyManager.invalidateCache(request.threadId, request.userId);
        }

        const functionResult = await this.functionExecutor.executeFunction(
          response.functionCall,
          response.functionArgs || {},
          request.threadId,
          request.userId
        );
        functionTokens += functionResult.tokensUsed || 0;

        // 8. Chamar Gemini novamente com resultado da function
        const finalResponse = await this.geminiClient.generateContentWithFunctionResult(
          geminiMessages,
          {
            name: response.functionCall,
            args: response.functionArgs || {},
          },
          functionResult
        );
        generationTokens += this.getUsageTokens(finalResponse);

        // 9. Extrair mensagem final
        let finalMessageText =
          finalResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Garantir que o resumo/hipóteses/fontes do solicitar_exames seja entregue ao paciente.
        if (response.functionCall === 'solicitar_exames' || response.functionCall === 'solicitarExames') {
          if (functionResult?.output) {
            finalMessageText = functionResult.output;
          }
        }

        // 9.1. Se houver interpretação de exame, integrar na resposta final
        if (exameInterpretation) {
          if (finalMessageText && finalMessageText.trim().length > 0) {
            finalMessageText = `${finalMessageText}\n\n---\n\n📋 **Interpretação do Exame**\n\n${exameInterpretation}`;
          } else {
            finalMessageText = `📋 **Interpretação do Exame**\n\n${exameInterpretation}`;
          }
        } else if (exameAnalysisError) {
          // Se houver erro na análise, informar de forma clara
          const errorMessage = `⚠️ **Erro ao analisar exame**: ${exameAnalysisError}\n\nPor favor, verifique:\n- O arquivo está em formato suportado (PDF, JPEG, PNG)?\n- O arquivo não excede 20MB?\n- O arquivo está acessível?\n\nVocê pode tentar novamente ou descrever o exame em texto.`;
          if (finalMessageText && finalMessageText.trim().length > 0) {
            finalMessageText = `${finalMessageText}\n\n---\n\n${errorMessage}`;
          } else {
            finalMessageText = errorMessage;
          }
        }

        // 10. Salvar texto em Threads_Gemini (contexto interno - sempre apenas texto)
        // IMPORTANTE: Sempre salvar texto aqui, mesmo que vá gerar áudio depois
        const assistantTokens = generationTokens + functionTokens + examAnalysisTokens;

        if (finalMessageText && finalMessageText.length > 0) {
          await this.supabaseClient.saveGeminiThreadMessage(
            request.threadId,
            request.userId,
            finalMessageText,
            'model',
            assistantTokens
          );
        }

        // 11. Gerar TTS se necessário (se usuário enviou áudio, responder em áudio)
        let responseAudioBase64: string | null = null;
        let responseTtsTokens = 0;
        if (request.messageType === 'audio') {
          const ttsResult = await this.messageProcessor.generateTTS(finalMessageText);
          responseAudioBase64 = ttsResult.audioBase64;
          responseTtsTokens = ttsResult.tokensUsed || 0;
        }

        // 12. Salvar em anamnesechathistorico (comunicação - formato original: texto OU áudio)
        // Se usuário enviou áudio → salvar áudio base64, senão → salvar texto
        await this.supabaseClient.saveMessage(
          request.threadId,
          request.userId,
          finalMessageText, // Texto da resposta (usado tanto para texto quanto para áudio base64)
          'model',
          responseAudioBase64 ? 'audio' : 'text',
          responseAudioBase64, // Se houver TTS, enviar base64 do áudio
          responseAudioBase64 ? 'audio/wav' : null,
          assistantTokens + (responseAudioBase64 ? responseTtsTokens : 0)
        );

        // 13. Notificar frontend via SSE que mensagem está pronta
        await this.sseNotifier.notifyNewMessage(request.userId, request.threadId, {
          message: finalMessageText, // Já inclui interpretação do exame se houver
          role: 'model',
          type: responseAudioBase64 ? 'audio' : 'text',
          audioBase64: responseAudioBase64,
          mimeType: responseAudioBase64 ? 'audio/wav' : null,
          createdAt: new Date().toISOString(),
        });

        // Invalidar cache após salvar resposta
        await this.historyManager.invalidateCache(request.threadId, request.userId);

        return {
          message: finalMessageText,
          audioBase64: responseAudioBase64,
          type: responseAudioBase64 ? 'audio' : 'text',
          hasFunctionCall: false,
        };
      }

      // 12. Se houver interpretação de exame e não houve function call, incluir na mensagem final
      let finalResponseMessage = response.message || '';
      if (exameInterpretation && !response.hasFunctionCall) {
        if (finalResponseMessage) {
          finalResponseMessage = `${finalResponseMessage}\n\n---\n\n📋 **Interpretação do Exame**\n\n${exameInterpretation}`;
        } else {
          finalResponseMessage = `📋 **Interpretação do Exame**\n\n${exameInterpretation}`;
        }
      }

      // 13. Salvar texto em Threads_Gemini (contexto interno - sempre apenas texto)
      // IMPORTANTE: Sempre salvar texto aqui, mesmo que vá gerar áudio depois
      const assistantTokens = generationTokens + functionTokens + examAnalysisTokens;

      if (finalResponseMessage && finalResponseMessage.length > 0) {
        await this.supabaseClient.saveGeminiThreadMessage(
          request.threadId,
          request.userId,
          finalResponseMessage,
          'model',
          assistantTokens
        );
      }

      // 14. Gerar TTS se necessário (se usuário enviou áudio, responder em áudio)
      let responseAudioBase64: string | null = null;
      let responseTtsTokens = 0;
      if (request.messageType === 'audio') {
        const ttsResult = await this.messageProcessor.generateTTS(finalResponseMessage);
        responseAudioBase64 = ttsResult.audioBase64;
        responseTtsTokens = ttsResult.tokensUsed || 0;
      }

      // 15. Salvar em anamnesechathistorico (comunicação - formato original: texto OU áudio)
      // Se usuário enviou áudio → salvar áudio base64, senão → salvar texto
      await this.supabaseClient.saveMessage(
        request.threadId,
        request.userId,
        finalResponseMessage, // Texto da resposta (usado tanto para texto quanto para áudio base64)
        'model',
        responseAudioBase64 ? 'audio' : 'text',
        responseAudioBase64, // Se houver TTS, enviar base64 do áudio
        responseAudioBase64 ? 'audio/wav' : null,
        assistantTokens + (responseAudioBase64 ? responseTtsTokens : 0)
      );

      // 16. Notificar frontend via SSE que mensagem está pronta
      await this.sseNotifier.notifyNewMessage(request.userId, request.threadId, {
        message: finalResponseMessage, // Já inclui interpretação do exame se houver
        role: 'model',
        type: responseAudioBase64 ? 'audio' : 'text',
        audioBase64: responseAudioBase64,
        mimeType: responseAudioBase64 ? 'audio/wav' : null,
        createdAt: new Date().toISOString(),
      });

      // Invalidar cache após salvar resposta
      await this.historyManager.invalidateCache(request.threadId, request.userId);

      return {
        message: finalResponseMessage, // Já inclui interpretação do exame se houver
        audioBase64: responseAudioBase64,
        type: responseAudioBase64 ? 'audio' : 'text',
        functionCall: response.functionCall,
        functionArgs: response.functionArgs,
        hasFunctionCall: response.hasFunctionCall,
      };
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Erro ao processar mensagem:', error);
      throw error;
    }
  }

  // Método removido - lógica movida para MessagePreparer

  /**
   * Processa resposta do Gemini e extrai function calls se houver
   */
  private processGeminiResponse(geminiResponse: any): {
    message: string;
    functionCall?: string;
    functionArgs?: Record<string, any>;
    hasFunctionCall: boolean;
  } {
    try {
      const parts = geminiResponse.candidates?.[0]?.content?.parts || [];
      let message = '';
      let functionCall: string | undefined;
      let functionArgs: Record<string, any> | undefined;

      for (const part of parts) {
        if (part.text) {
          message += part.text;
        }

        if (part.functionCall) {
          functionCall = part.functionCall.name;
          functionArgs = part.functionCall.args || {};
        }
      }

      // Sanitizar qualquer vazamento de contexto interno antes de retornar ao usuário.
      const rawMessage = message.trim();
      const sanitizedMessage = rawMessage
        // Remover blocos explícitos de contexto interno caso apareçam na saída.
        .replace(/\[CONTEXTO INTERNO[\s\S]*?\[FIM DO CONTEXTO INTERNO\]/gi, '')
        // Remover cabeçalhos internos isolados.
        .replace(/===\s*DADOS JÁ COLETADOS[\s\S]*?===/gi, '')
        .replace(/===\s*PERGUNTAS JÁ FEITAS[\s\S]*?===/gi, '')
        .replace(/===\s*TRANSCRIÇÃO COMPLETA[\s\S]*?===/gi, '')
        .trim();

      return {
        message: sanitizedMessage || 'Desculpe, não consegui processar sua mensagem.',
        functionCall,
        functionArgs,
        hasFunctionCall: !!functionCall,
      };
    } catch (error: any) {
      console.error('[ORCHESTRATOR] ❌ Erro ao processar resposta Gemini:', error);
      return {
        message: 'Erro ao processar resposta do agente.',
        hasFunctionCall: false,
      };
    }
  }

  private getUsageTokens(geminiResponse: any): number {
    if (!geminiResponse || geminiResponse instanceof Response) return 0;
    const usage = geminiResponse?.usageMetadata;
    if (!usage) return 0;

    const total = usage?.totalTokenCount;
    if (typeof total === 'number' && Number.isFinite(total)) return total;

    const prompt = typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : 0;
    const candidates = typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0;
    const sum = prompt + candidates;
    return Number.isFinite(sum) ? sum : 0;
  }
}
