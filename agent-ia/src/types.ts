// Tipos TypeScript para o Agente IA

export interface ProcessMessageRequest {
  threadId: string;
  userId: string;
  message: string;
  audioBase64?: string;
  messageType?: 'text' | 'audio' | 'file';
  userName?: string;
  userEmail?: string;
  userCpf?: string;
  // Suporte para arquivos de exame (PDF ou imagem)
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
  functionArgs?: Record<string, any> | null;
  hasFunctionCall: boolean;
}

export interface ConversationHistoryItem {
  role: 'user' | 'model'; // Alterado de 'assistant' para 'model' (padrão Gemini)
  message: string; // Contém texto OU base64 do áudio (decoder usa 'type' para identificar)
  type: 'text' | 'audio' | 'file';
  mime_type?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  created_at?: string;
}

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    };
    functionCall?: {
      name: string;
      args: Record<string, any>;
    };
    functionResponse?: {
      name: string;
      response: {
        output: string;
      };
    };
  }>;
}

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text?: string;
        functionCall?: {
          name: string;
          args: Record<string, any>;
        };
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface FunctionCallResult {
  success: boolean;
  output: string;
  error?: string;
  tokensUsed?: number;
}
