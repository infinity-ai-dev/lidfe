/**
 * SSE Notifier - Notifica frontend via Server-Sent Events
 * Envia eventos quando mensagens do agente estão prontas
 */

import axios from 'axios';
import { createServiceSignatureHeaders } from './utils/lidfe-signature';

export class SSENotifier {
  private sseServerUrl: string;
  private authToken: string;

  constructor() {
    const raw = process.env.SSE_SERVER_URL || 'http://sse-server:3001';
    // Aceita URLs legadas com sufixos /events, /notify ou /publish
    this.sseServerUrl = raw.replace(/\/(events|notify|publish)\/?$/i, '').replace(/\/+$/, '');
    this.authToken = process.env.SSE_AUTH_TOKEN || process.env.LIDFE_AUTH_TOKEN || '';
  }

  private async publishChatEvent(event: {
    user_id: string;
    thread_id: string;
    message: string;
    role: string;
    type: 'text' | 'audio';
    audio_base64?: string | null;
    timestamp?: string;
  }): Promise<void> {
    const payload = {
      channel: 'chat:events',
      message: JSON.stringify(event),
    };
    const body = JSON.stringify(payload);
    const signatureHeaders = this.authToken
      ? createServiceSignatureHeaders({
          secret: this.authToken,
          method: 'POST',
          path: '/publish',
          body,
        })
      : {};

    await axios.post(`${this.sseServerUrl}/publish`, payload, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        ...signatureHeaders,
      },
    });
  }

  /**
   * Notifica frontend que nova mensagem do agente está disponível
   */
  async notifyNewMessage(userId: string, threadId: string, messageData: {
    id?: number;
    message: string;
    role: string;
    type: 'text' | 'audio';
    mimeType?: string | null;
    audioBase64?: string | null;
    createdAt: string;
  }): Promise<void> {
    try {
      console.log(`[SSE] Notificando frontend - User: ${userId}, Thread: ${threadId}, Type: ${messageData.type}`);
      
      const isAudio = messageData.type === 'audio';
      const payloadMessage = isAudio && messageData.audioBase64
        ? messageData.audioBase64
        : messageData.message;

      // Publicar no Redis via servidor SSE (canal chat:events)
      await this.publishChatEvent({
        user_id: userId,
        thread_id: threadId,
        message: payloadMessage || '',
        role: messageData.role,
        type: messageData.type,
        audio_base64: messageData.audioBase64 ?? null,
        timestamp: messageData.createdAt,
      });

      console.log('[SSE] Notificação enviada com sucesso');
    } catch (error: any) {
      // Não bloquear o fluxo se SSE falhar
      console.error('[SSE] Erro ao notificar (não-crítico):', error.message);
    }
  }

  /**
   * Notifica que agente está processando (typing indicator)
   */
  async notifyProcessing(userId: string, threadId: string): Promise<void> {
    // Evento de status não é consumido pelo frontend atual; evitar chamadas inúteis.
    void userId;
    void threadId;
  }

  /**
   * Notifica que processamento foi concluído
   */
  async notifyComplete(userId: string, threadId: string): Promise<void> {
    // Evento de status não é consumido pelo frontend atual; evitar chamadas inúteis.
    void userId;
    void threadId;
  }
}
