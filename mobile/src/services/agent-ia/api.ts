import { APP_CONFIG } from '@/utils/constants';
import { supabase } from '@/services/supabase/client';

export interface ProcessMessageRequest {
  threadId: string;
  userId: string;
  message: string;
  audioBase64?: string;
  messageType?: 'text' | 'audio' | 'file';
  userName?: string;
  userEmail?: string;
  userCpf?: string;
  // Campos para arquivos de exame (PDF ou imagem)
  fileUrl?: string;
  fileBase64?: string;
  fileType?: 'pdf' | 'image';
  fileMimeType?: string;
  fileName?: string;
  fileSize?: number;
}

export interface ProcessMessageResponse {
  message: string;
  audioBase64?: string | null;
  type: 'text' | 'audio';
  functionCall?: string | null;
  functionArgs?: Record<string, unknown> | null;
  hasFunctionCall: boolean;
}

const sseTokenCache = new Map<string, { token: string; expiresAt: number }>();

export const agentIAService = {
  async getSseToken(threadId: string): Promise<string | null> {
    try {
      const cached = sseTokenCache.get(threadId);
      const now = Date.now();
      if (cached && cached.expiresAt - 15_000 > now) {
        return cached.token;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData.session?.access_token;
      if (!jwt) return null;

      const response = await fetch(`${APP_CONFIG.AGENT_IA_URL}/sse/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ threadId }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json().catch(() => null);
      if (data?.token && typeof data?.expires_in === 'number') {
        sseTokenCache.set(threadId, {
          token: data.token,
          expiresAt: now + data.expires_in * 1000,
        });
      }
      return data?.token || null;
    } catch (error) {
      return null;
    }
  },

  async processMessage(request: ProcessMessageRequest): Promise<ProcessMessageResponse> {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData.session?.access_token;
      const authToken = jwt || APP_CONFIG.AGENT_IA_AUTH_TOKEN;
      const response = await fetch(`${APP_CONFIG.AGENT_IA_URL}/process-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        
        // Verificar se é rate limit (429)
        if (response.status === 429 || errorData.error === 'RATE_LIMIT') {
          const rateLimitError: any = new Error('RATE_LIMIT_429');
          rateLimitError.status = 429;
          rateLimitError.retryAfter = errorData.retryAfter || 60;
          rateLimitError.message = errorData.message || 'Limite de requisições excedido. Por favor, aguarde 1 minuto antes de tentar novamente.';
          throw rateLimitError;
        }
        
        throw new Error(errorData.error || `HTTP ${response.status}: Erro ao processar mensagem`);
      }

      const data: ProcessMessageResponse = await response.json();
      return data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Erro de conexão';
      throw new Error(errorMessage);
    }
  },

  async processAttachment(request: ProcessMessageRequest): Promise<ProcessMessageResponse> {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData.session?.access_token;
      const authToken = jwt || APP_CONFIG.AGENT_IA_AUTH_TOKEN;
      const response = await fetch(`${APP_CONFIG.AGENT_IA_URL}/attachments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        
        if (response.status === 429 || errorData.error === 'RATE_LIMIT') {
          const rateLimitError: any = new Error('RATE_LIMIT_429');
          rateLimitError.status = 429;
          rateLimitError.retryAfter = errorData.retryAfter || 60;
          rateLimitError.message = errorData.message || 'Limite de requisições excedido. Por favor, aguarde 1 minuto antes de tentar novamente.';
          throw rateLimitError;
        }
        
        throw new Error(errorData.error || `HTTP ${response.status}: Erro ao processar anexo`);
      }

      const data: ProcessMessageResponse = await response.json();
      return data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Erro de conexão';
      throw new Error(errorMessage);
    }
  },

  async sendTextMessage(
    threadId: string,
    userId: string,
    message: string,
    options?: {
      userName?: string;
      userEmail?: string;
      userCpf?: string;
    }
  ): Promise<ProcessMessageResponse> {
    return this.processMessage({
      threadId,
      userId,
      message,
      messageType: 'text',
      ...options,
    });
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
  ): Promise<ProcessMessageResponse> {
    return this.processMessage({
      threadId,
      userId,
      message: '', // Mensagem vazia quando é áudio
      audioBase64,
      messageType: 'audio',
      ...options,
    });
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
  ): Promise<ProcessMessageResponse> {
    return this.processAttachment({
      threadId,
      userId,
      message: message || '',
      messageType: 'file',
      fileBase64,
      fileType,
      fileMimeType,
      fileName,
      fileSize,
      ...options,
    });
  },

  async getHealth(): Promise<{ status: string; service?: string; timestamp?: string }> {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const jwt = sessionData.session?.access_token;
      const authToken = jwt || APP_CONFIG.AGENT_IA_AUTH_TOKEN;
      const response = await fetch(`${APP_CONFIG.AGENT_IA_URL}/health`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      return {
        status: 'error',
      };
    }
  },
};

export default agentIAService;
