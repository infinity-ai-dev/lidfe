// Encoder/Decoder para mensagens
// Centraliza lógica de codificação de áudio e texto

export class MessageEncoder {
  /**
   * Codifica uma mensagem para salvar no banco
   * Se for áudio: salva base64 no campo message
   * Se for texto: salva texto direto
   */
  static encode(
    message: string,
    type: 'text' | 'audio',
    audioBase64?: string | null
  ): { message: string; type: 'text' | 'audio' } {
    if (type === 'audio' && audioBase64) {
      // Para áudio: salvar base64 no campo message
      return {
        message: audioBase64,
        type: 'audio',
      };
    }

    // Para texto: salvar texto direto
    return {
      message: message || '',
      type: 'text',
    };
  }

  /**
   * Decodifica uma mensagem do banco
   * Se type === 'audio': message contém base64
   * Se type === 'text': message contém texto
   */
  static decode(message: string, type: 'text' | 'audio'): {
    text: string;
    audioBase64: string | null;
  } {
    if (type === 'audio') {
      // Message contém base64 do áudio
      // Extrair texto do base64 não é possível, então retornamos indicador
      return {
        text: '[Mensagem de áudio]',
        audioBase64: message,
      };
    }

    // Message contém texto direto
    return {
      text: message,
      audioBase64: null,
    };
  }

  /**
   * Extrai apenas o texto de uma mensagem (para transcrições)
   * Se for áudio e tiver transcrição, retorna a transcrição
   * Se for áudio sem transcrição, retorna indicador
   */
  static extractText(message: string, type: 'text' | 'audio'): string {
    if (type === 'audio') {
      // Para áudio, message pode conter a transcrição ou o base64
      // Se começar com "data:audio" ou caracteres base64, é base64
      if (message.startsWith('data:audio') || message.match(/^[A-Za-z0-9+/=]+$/)) {
        return '[Mensagem de áudio]';
      }
      // Caso contrário, é a transcrição
      return message;
    }

    return message;
  }
}
