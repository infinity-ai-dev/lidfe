import { agentIAService, type ProcessMessageResponse } from './agent-ia/api';

export type AnamneseAgentResponse = ProcessMessageResponse;

export const anamneseAgentService = {
  async sendMessage(
    threadId: string,
    userId: string,
    message: string,
    messageType: 'text' | 'audio' = 'text',
    options?: {
      userName?: string;
      userEmail?: string;
      userCpf?: string;
    }
  ): Promise<AnamneseAgentResponse> {
    try {
      if (messageType === 'audio') {
        return await agentIAService.sendAudioMessage(threadId, userId, message, options);
      }
      return await agentIAService.sendTextMessage(threadId, userId, message, options);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error('[ANAMNESE-AGENT] Erro:', errorMessage);
      throw error;
    }
  },

  async sendAudioMessage(
    threadId: string,
    userId: string,
    audioBase64: string,
    options?: {
      userName?: string;
      userEmail?: string;
      userCpf?: string;
    }
  ): Promise<AnamneseAgentResponse> {
    return this.sendMessage(threadId, userId, audioBase64, 'audio', options);
  },

  async sendFileMessage(
    threadId: string,
    userId: string,
    fileBase64: string,
    fileType: 'pdf' | 'image',
    fileMimeType: string,
    fileName?: string,
    fileSize?: number,
    message?: string,
    options?: {
      userName?: string;
      userEmail?: string;
      userCpf?: string;
    }
  ): Promise<AnamneseAgentResponse> {
    try {
      return await agentIAService.sendFileMessage(
        threadId,
        userId,
        fileBase64,
        fileType,
        fileMimeType,
        fileName,
        fileSize,
        message,
        options
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      console.error('[ANAMNESE-AGENT] Erro ao enviar arquivo:', errorMessage);
      throw error;
    }
  },
};

export default anamneseAgentService;
