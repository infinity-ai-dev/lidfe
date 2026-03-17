// Processador de mensagens com suporte a processamento assíncrono e paralelo
import { GeminiClient } from './gemini-client';
import { ProcessMessageRequest, ProcessMessageResponse } from './types';

export class MessageProcessor {
  private geminiClient: GeminiClient;

  constructor(geminiClient: GeminiClient) {
    this.geminiClient = geminiClient;
  }

  /**
   * Processa transcrição de áudio de forma assíncrona
   */
  async transcribeAudio(
    audioBase64: string,
    mimeType: string = 'audio/wav'
  ): Promise<{ text: string; mimeType: string; tokensUsed: number }> {
    try {
      console.log('[MESSAGE-PROCESSOR] Transcrevendo áudio...');

      // Limpar prefixo data: se existir
      const cleanBase64 = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');

      // Detectar mimeType real a partir do base64 (web costuma ser OGG/WEBM)
      let detectedMime = mimeType;
      if (cleanBase64.startsWith('UklGR')) {
        detectedMime = 'audio/wav';
      } else if (cleanBase64.startsWith('T2dnUw')) {
        detectedMime = 'audio/ogg';
      } else if (cleanBase64.startsWith('GkXf')) {
        detectedMime = 'audio/webm';
      } else if (cleanBase64.startsWith('SUQz') || cleanBase64.startsWith('AAA')) {
        detectedMime = 'audio/mpeg';
      }

      const transcribed = await this.geminiClient.transcribeAudio(cleanBase64, detectedMime);
      console.log(`[MESSAGE-PROCESSOR] Transcrição concluída: ${transcribed.text.substring(0, 100)}...`);
      return { text: transcribed.text, mimeType: detectedMime, tokensUsed: transcribed.tokensUsed };
    } catch (error: any) {
      console.error('[MESSAGE-PROCESSOR] Erro ao transcrever áudio:', error);
      throw new Error(`Falha na transcrição: ${error.message}`);
    }
  }

  /**
   * Gera TTS de forma assíncrona
   */
  async generateTTS(text: string): Promise<{ audioBase64: string | null; tokensUsed: number }> {
    try {
      console.log('[MESSAGE-PROCESSOR] Gerando TTS...');
      const { audioBase64, tokensUsed } = await this.geminiClient.generateTTS(text);
      console.log('[MESSAGE-PROCESSOR] TTS gerado com sucesso');
      return { audioBase64, tokensUsed };
    } catch (error: any) {
      console.error('[MESSAGE-PROCESSOR] Erro ao gerar TTS:', error);
      return { audioBase64: null, tokensUsed: 0 }; // Não falhar se TTS falhar
    }
  }

  /**
   * Processa mensagem de áudio: transcreve e prepara para processamento
   */
  async processAudioMessage(
    audioBase64: string,
    mimeType: string = 'audio/wav'
  ): Promise<{ transcribedText: string; audioBase64: string; tokensUsed: number }> {
    const transcribed = await this.transcribeAudio(audioBase64, mimeType);
    return {
      transcribedText: transcribed.text,
      audioBase64,
      tokensUsed: transcribed.tokensUsed,
    };
  }

  /**
   * Processa múltiplas mensagens em paralelo (útil para batch)
   */
  async processMultipleMessages(
    requests: ProcessMessageRequest[]
  ): Promise<ProcessMessageResponse[]> {
    try {
      console.log(`[MESSAGE-PROCESSOR] Processando ${requests.length} mensagens em paralelo...`);
      
      // Processar transcrições em paralelo (se houver áudio)
      const transcriptionPromises = requests.map(async (req) => {
        if (req.audioBase64 && req.audioBase64.length > 0) {
          const transcribed = await this.transcribeAudio(req.audioBase64);
          return { ...req, message: transcribed.text };
        }
        return req;
      });

      const processedRequests = await Promise.all(transcriptionPromises);
      console.log('[MESSAGE-PROCESSOR] Todas as transcrições concluídas');

      return processedRequests as any; // Retornar para processamento posterior
    } catch (error: any) {
      console.error('[MESSAGE-PROCESSOR] Erro ao processar múltiplas mensagens:', error);
      throw error;
    }
  }

  /**
   * Valida mensagem antes do processamento
   */
  validateMessage(request: ProcessMessageRequest): { valid: boolean; error?: string } {
    if (!request.threadId || !request.userId) {
      return { valid: false, error: 'threadId e userId são obrigatórios' };
    }

    // Verificar se há pelo menos uma forma de entrada (mensagem, áudio ou arquivo)
    const hasMessage = request.message && request.message.length > 0;
    const hasAudio = request.audioBase64 && request.audioBase64.length > 0;
    const hasFile = request.fileUrl || (request.fileBase64 && request.fileBase64.length > 0);

    if (!hasMessage && !hasAudio && !hasFile) {
      return { valid: false, error: 'message, audioBase64 ou fileUrl/fileBase64 é obrigatório' };
    }

    if (request.audioBase64 && request.audioBase64.length > 10 * 1024 * 1024) {
      return { valid: false, error: 'Áudio muito grande (máximo 10MB)' };
    }

    // Validar tamanho do arquivo base64 (base64 é ~33% maior que binário)
    // Limite: 20MB binário = ~27MB base64 aproximadamente
    if (request.fileBase64) {
      const base64Size = request.fileBase64.length;
      const estimatedBinarySize = (base64Size * 3) / 4;
      const maxSizeBytes = 20 * 1024 * 1024; // 20MB binário
      
      if (estimatedBinarySize > maxSizeBytes) {
        return {
          valid: false,
          error: `Arquivo muito grande (estimado ${Math.round(estimatedBinarySize / 1024 / 1024)}MB). Tamanho máximo: 20MB`,
        };
      }
    }

    return { valid: true };
  }
}
