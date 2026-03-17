// Cliente Supabase para histórico e persistência
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConversationHistoryItem } from './types';

export class SupabaseClientService {
  private supabase: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    // Usar service_role_key para bypassar RLS e permitir escrita
    this.supabase = createClient(url, serviceRoleKey);
  }

  /**
   * Normaliza e limpa áudio base64 para salvamento padronizado
   * CRÍTICO: Garante que todos os áudios sejam salvos no mesmo formato (base64 puro)
   * e que o mimeType seja detectado corretamente para permitir transcrição
   */
  private normalizeAudioBase64(audioBase64: string): { cleanBase64: string; mimeType: string } {
    if (!audioBase64 || audioBase64.length === 0) {
      throw new Error('Áudio base64 vazio');
    }

    // Remover qualquer prefixo data: se existir (data:audio/wav;base64, ou data:audio/webm;base64, etc)
    let cleanBase64 = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
    
    // Se ainda tiver prefixo data: sem base64, remover também
    cleanBase64 = cleanBase64.replace(/^data:audio\/[^,]+,\s*/, '');

    // Detectar mimeType a partir do base64 (magic bytes)
    // Isso é crítico para permitir transcrição correta
    let detectedMimeType = 'audio/wav'; // Padrão seguro

    if (cleanBase64.startsWith('UklGR')) {
      // WAV: RIFF header em base64
      detectedMimeType = 'audio/wav';
    } else if (cleanBase64.startsWith('T2dnUw') || cleanBase64.startsWith('SUQz')) {
      // OGG: OggS header em base64
      detectedMimeType = 'audio/ogg';
    } else if (cleanBase64.startsWith('GkXf')) {
      // WEBM: EBML header em base64
      detectedMimeType = 'audio/webm';
    } else if (cleanBase64.startsWith('AAAA')) {
      // MP4/M4A: base64 geralmente começa com 'AAAA' (ftyp)
      detectedMimeType = 'audio/mp4';
    } else if (cleanBase64.startsWith('/9j/') || cleanBase64.startsWith('iVBOR')) {
      // Não é áudio, é imagem (não deveria acontecer, mas por segurança)
      throw new Error('Dados não são de áudio (parece ser imagem)');
    } else if (cleanBase64.startsWith('JVBERi')) {
      // PDF (não deveria acontecer)
      throw new Error('Dados não são de áudio (parece ser PDF)');
    } else {
      // Se não conseguir detectar, assumir WAV (mais comum e compatível)
      // Mas logar warning para investigação
      console.warn('[SUPABASE] ⚠️ Não foi possível detectar mimeType do áudio, usando audio/wav como padrão');
      detectedMimeType = 'audio/wav';
    }

    // Validar que é base64 válido (caracteres alfanuméricos, +, /, =)
    // Mas permitir que tenha espaços/quebras de linha (alguns sistemas enviam assim)
    const base64Pattern = /^[A-Za-z0-9+/=\s\n\r]*$/;
    if (!base64Pattern.test(cleanBase64)) {
      throw new Error('Áudio base64 contém caracteres inválidos');
    }

    // Remover espaços e quebras de linha (normalizar base64)
    cleanBase64 = cleanBase64.replace(/\s+/g, '');

    // Validar tamanho mínimo (áudio muito pequeno provavelmente está errado)
    if (cleanBase64.length < 100) {
      throw new Error('Áudio base64 muito pequeno (provavelmente inválido)');
    }

    return {
      cleanBase64,
      mimeType: detectedMimeType,
    };
  }

  /**
   * Normaliza base64 de arquivo (PDF ou imagem)
   * Remove prefixo data: e tenta detectar MIME type
   */
  private normalizeFileBase64(
    fileBase64: string,
    mimeType?: string | null
  ): { cleanBase64: string; mimeType: string | null } {
    if (!fileBase64 || fileBase64.length < 100) {
      throw new Error('Arquivo base64 muito pequeno (provavelmente inválido)');
    }

    let cleanBase64 = fileBase64;
    let detectedMimeType: string | null = mimeType || null;

    // Remover prefixo data:...;base64, se existir
    if (cleanBase64.startsWith('data:')) {
      const base64Start = cleanBase64.indexOf('base64,');
      if (base64Start !== -1) {
        const prefix = cleanBase64.substring(0, base64Start);
        const mimeMatch = prefix.match(/data:([^;]+);/);
        if (mimeMatch && mimeMatch[1]) {
          detectedMimeType = detectedMimeType || mimeMatch[1];
        }
        cleanBase64 = cleanBase64.substring(base64Start + 7);
      }
    }

    // Remover espaços e quebras de linha (normalizar base64)
    cleanBase64 = cleanBase64.replace(/\s+/g, '');

    // Detectar MIME type pelo magic number base64 se ainda não definido
    if (!detectedMimeType) {
      if (cleanBase64.startsWith('JVBERi0')) {
        detectedMimeType = 'application/pdf';
      } else if (cleanBase64.startsWith('iVBORw0KGgo')) {
        detectedMimeType = 'image/png';
      } else if (cleanBase64.startsWith('/9j/')) {
        detectedMimeType = 'image/jpeg';
      } else if (cleanBase64.startsWith('R0lGOD')) {
        detectedMimeType = 'image/gif';
      } else if (cleanBase64.startsWith('UklGR')) {
        // Evitar confundir com áudio WAV
        detectedMimeType = 'application/octet-stream';
      } else {
        detectedMimeType = 'application/octet-stream';
      }
    }

    return {
      cleanBase64,
      mimeType: detectedMimeType,
    };
  }

  private getExamResultBuckets(isPdf: boolean): string[] {
    const primary = isPdf
      ? process.env.EXAM_RESULTS_PDF_BUCKET || 'pdfresultadosexames'
      : process.env.EXAM_RESULTS_IMAGE_BUCKET || 'imagensresultadosexames';
    const fallbacks = isPdf ? ['pdfs', 'guiapdf'] : ['guias-gerais'];
    return [primary, ...fallbacks].filter((bucket, index, list) => Boolean(bucket) && list.indexOf(bucket) === index);
  }

  /**
   * Faz upload de arquivo de exame (PDF ou imagem) para o Supabase Storage
   * Retorna a URL pública para persistência e acesso do usuário
   */
  async uploadExamFileFromBase64(params: {
    userId: string;
    fileBase64: string;
    fileMimeType?: string | null;
    fileName?: string | null;
    fileType?: string | null;
  }): Promise<{
    publicUrl: string;
    mimeType: string;
    fileType: 'pdf' | 'image';
    bucket: string;
    storagePath: string;
  }> {
    const { userId, fileBase64, fileMimeType, fileName, fileType } = params;

    const normalized = this.normalizeFileBase64(fileBase64, fileMimeType || null);
    const cleanBase64 = normalized.cleanBase64;
    const finalMimeType = normalized.mimeType || fileMimeType || 'application/octet-stream';

    const isPdf =
      fileType === 'pdf' ||
      finalMimeType === 'application/pdf' ||
      (fileName || '').toLowerCase().endsWith('.pdf');
    const isImage = !isPdf && finalMimeType.startsWith('image/');

    if (!isPdf && !isImage) {
      throw new Error(`Tipo de arquivo não suportado para upload: ${finalMimeType}`);
    }

    const safeName = (fileName || (isPdf ? 'exame.pdf' : 'exame.jpg')).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${userId}/${Date.now()}_${safeName}`;

    const fileBuffer = Buffer.from(cleanBase64, 'base64');

    const bucketsToTry = this.getExamResultBuckets(isPdf);
    let lastError: any = null;

    for (const bucketName of bucketsToTry) {
      const { error: uploadError } = await this.supabase.storage
        .from(bucketName)
        .upload(storagePath, fileBuffer, {
          contentType: finalMimeType,
          upsert: false,
        });

      if (uploadError) {
        lastError = uploadError;
        console.warn(`[SUPABASE] ⚠️ Falha ao fazer upload no bucket ${bucketName}:`, uploadError.message || uploadError);
        continue;
      }

      const { data: urlData } = this.supabase.storage
        .from(bucketName)
        .getPublicUrl(storagePath);

      if (!urlData?.publicUrl) {
        lastError = new Error('URL pública não retornada pelo storage');
        console.warn(`[SUPABASE] ⚠️ URL pública não retornada no bucket ${bucketName}`);
        continue;
      }

      return {
        publicUrl: urlData.publicUrl,
        mimeType: finalMimeType,
        fileType: isPdf ? 'pdf' : 'image',
        bucket: bucketName,
        storagePath,
      };
    }

    const bucketList = bucketsToTry.length > 0 ? bucketsToTry.join(', ') : 'nenhum bucket configurado';
    const lastMessage = lastError?.message || 'Erro desconhecido';
    throw new Error(`Erro ao fazer upload no storage (${bucketList}): ${lastMessage}`);
  }

  /**
   * Registra o upload do resultado de exame para exibição no histórico
   */
  async saveExameResultado(params: {
    userId: string;
    fileUrl: string;
    fileName?: string | null;
    mimeType?: string | null;
    fileType?: string | null;
    titulo?: string | null;
    taskExameId?: number | null;
    threadId?: string | null;
    source?: string | null;
    storageBucket?: string | null;
    storagePath?: string | null;
  }): Promise<void> {
    const {
      userId,
      fileUrl,
      fileName,
      mimeType,
      fileType,
      titulo,
      taskExameId,
      threadId,
      source,
      storageBucket,
      storagePath,
    } = params;

    const { error } = await this.supabase.from('exames_resultados').insert({
      user_id: userId,
      task_exame_id: taskExameId ?? null,
      id_threadconversa: threadId ?? null,
      titulo: titulo ?? null,
      file_url: fileUrl,
      file_name: fileName ?? null,
      mime_type: mimeType ?? null,
      file_type: fileType ?? null,
      source: source ?? null,
      storage_bucket: storageBucket ?? null,
      storage_path: storagePath ?? null,
    });

    if (error) {
      throw new Error(error.message || 'Erro ao registrar upload do exame');
    }
  }

  /**
   * Busca histórico de conversa do banco (anamnesechathistorico)
   * Usado para comunicação com o usuário - pode conter texto e áudio
   */
  async getConversationHistory(threadId: string, userId: string): Promise<ConversationHistoryItem[]> {
    try {
      console.log(`[SUPABASE] Buscando histórico para thread: ${threadId}, user: ${userId}`);

      // Buscar de anamnesechathistorico (fonte única de verdade para comunicação com usuário)
      const { data: chatHistory, error: chatError } = await this.supabase
        .from('anamnesechathistorico')
        .select('*')
        .eq('id_threadconversa', threadId)
        .order('created_at', { ascending: true });

      if (chatError) {
        console.error('[SUPABASE] Erro ao buscar histórico de anamnesechathistorico:', chatError);
        return [];
      }

      // Converter mensagens para formato padrão com roles user/model
      const history: ConversationHistoryItem[] = (chatHistory || []).map((row: any) => {
        // Normalizar role: 'assistant' -> 'model' (para compatibilidade)
        let role: 'user' | 'model' = row.role === 'assistant' ? 'model' : row.role;
        
        // Se role ainda não está correto, forçar baseado no contexto
        if (role !== 'user' && role !== 'model') {
          role = 'user'; // Fallback seguro
        }

        return {
          role,
          message: row.message || '',
          type: row.type || 'text',
          mime_type: row.mime_type || null,
          file_name: row.file_name || null,
          file_size: typeof row.file_size === 'number' ? row.file_size : (row.file_size ? Number(row.file_size) : null),
          file_type: row.file_type || null,
          created_at: row.created_at,
        };
      });

      console.log(`[SUPABASE] Histórico encontrado: ${history.length} mensagens de anamnesechathistorico`);
      return history;
    } catch (error: any) {
      console.error('[SUPABASE] Erro ao buscar histórico:', error);
      return [];
    }
  }

  /**
   * Busca histórico interno do agente (Threads_Gemini)
   * Usado para contexto interno do Gemini - APENAS texto (áudios devem estar transcritos)
   */
  async getGeminiThreadHistory(threadId: string, userId: string): Promise<ConversationHistoryItem[]> {
    try {
      console.log(`[SUPABASE] Buscando histórico interno (Threads_Gemini) para thread: ${threadId}, user: ${userId}`);

      // Buscar de Threads_Gemini (contexto interno do agente - apenas texto)
      const { data: threadHistory, error: threadError } = await this.supabase
        .from('Threads_Gemini')
        .select('*')
        .eq('id_threadconversa', threadId)
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (threadError) {
        console.error('[SUPABASE] Erro ao buscar histórico de Threads_Gemini:', threadError);
        // Se a tabela não existir ou der erro, retornar array vazio (não bloquear)
        return [];
      }

      // Converter mensagens para formato padrão
      const history: ConversationHistoryItem[] = (threadHistory || []).map((row: any) => {
        let role: 'user' | 'model' = row.role === 'assistant' ? 'model' : row.role;
        
        if (role !== 'user' && role !== 'model') {
          role = 'user'; // Fallback seguro
        }

        return {
          role,
          message: row.message || row.content || '', // Suportar ambos 'message' e 'content'
          type: 'text', // Threads_Gemini sempre é texto
          mime_type: null,
          created_at: row.created_at,
        };
      });

      console.log(`[SUPABASE] Histórico interno encontrado: ${history.length} mensagens de Threads_Gemini`);
      return history;
    } catch (error: any) {
      console.error('[SUPABASE] Erro ao buscar histórico interno:', error);
      // Não bloquear se der erro - retornar array vazio
      return [];
    }
  }


  /**
   * Salva mensagem no banco de dados
   * Salva em anamnesechathistorico (para comunicação com usuário - texto + áudio)
   * CRÍTICO: Normaliza áudios antes de salvar para garantir formato consistente
   */
  async saveMessage(
    threadId: string,
    userId: string,
    message: string,
    role: 'user' | 'model',
    type: 'text' | 'audio' | 'file',
    audioBase64?: string | null,
    mimeType?: string | null,
    tokensUsed?: number,
    fileMeta?: {
      fileName?: string | null;
      fileSize?: number | null;
      fileType?: string | null;
    }
  ): Promise<void> {
    try {
      console.log(`[SUPABASE] Salvando mensagem - Thread: ${threadId}, Role: ${role}, Type: ${type}`);
      console.log(`[SUPABASE] Mensagem: ${message ? message.substring(0, 100) + '...' : '(vazia)'}`);
      
      // Para anamnesechathistorico: pode ter texto, áudio base64 ou arquivo base64
      let finalMessage = message;
      let finalMimeType = mimeType || null;
      let fileName = fileMeta?.fileName ?? null;
      let fileSize = typeof fileMeta?.fileSize === 'number' ? fileMeta?.fileSize : null;
      let fileType = fileMeta?.fileType ?? null;

      if (type === 'audio' && audioBase64) {
        // CRÍTICO: Normalizar áudio base64 para formato padronizado
        // Isso garante que todos os usuários tenham áudios salvos no mesmo formato
        try {
          const normalized = this.normalizeAudioBase64(audioBase64);
          finalMessage = normalized.cleanBase64; // Base64 puro (sem prefixo)
          finalMimeType = normalized.mimeType; // MimeType detectado corretamente
          
          console.log(`[SUPABASE] Áudio normalizado - MimeType detectado: ${finalMimeType}`);
          console.log(`[SUPABASE] Tamanho do base64: ${finalMessage.length} caracteres`);
        } catch (normalizeError: any) {
          console.error('[SUPABASE] Erro ao normalizar áudio:', normalizeError);
          // Se falhar na normalização, tentar salvar como está (compatibilidade)
          finalMessage = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
          finalMimeType = mimeType || 'audio/wav'; // Fallback para WAV
          console.warn('[SUPABASE] ⚠️ Usando áudio sem normalização completa (modo compatibilidade)');
        }
      } else if (type === 'file' && audioBase64) {
        try {
          const normalized = this.normalizeFileBase64(audioBase64, mimeType);
          finalMessage = normalized.cleanBase64;
          finalMimeType = normalized.mimeType;
        } catch (normalizeError: any) {
          console.error('[SUPABASE] Erro ao normalizar arquivo:', normalizeError);
          // Fallback: remover prefixo data: básico
          finalMessage = audioBase64.replace(/^data:[^;]+;base64,/, '');
          finalMimeType = mimeType || 'application/octet-stream';
          console.warn('[SUPABASE] ⚠️ Usando arquivo sem normalização completa (modo compatibilidade)');
        }
      }

      // Salvar em anamnesechathistorico (comunicação com usuário)
      const { error: chatError } = await this.supabase.from('anamnesechathistorico').insert({
        id_threadconversa: threadId,
        user_id: userId,
        message: finalMessage,
        role,
        type,
        mime_type: finalMimeType, // Sempre salvar mimeType correto para permitir transcrição
        file_name: fileName,
        file_size: fileSize,
        file_type: fileType,
        total_tokens: typeof tokensUsed === 'number' ? tokensUsed : null,
        created_at: new Date().toISOString(),
      });

      if (chatError) {
        console.error('[SUPABASE] Erro ao salvar em anamnesechathistorico:', chatError);
        throw chatError;
      }

      console.log('[SUPABASE] Mensagem salva em anamnesechathistorico');
      if (type === 'audio') {
        console.log(`[SUPABASE] ✅ Áudio salvo com mimeType: ${finalMimeType} (formatado para transcrição)`);
      } else if (type === 'file') {
        console.log(`[SUPABASE] ✅ Arquivo salvo com mimeType: ${finalMimeType}`);
      }
    } catch (error: any) {
      console.error('[SUPABASE] Erro ao salvar mensagem:', error);
      throw error;
    }
  }

  /**
   * Salva mensagem na tabela Threads_Gemini (contexto interno do agente)
   * IMPORTANTE: Apenas texto (áudios devem ser transcritos antes de salvar)
   */
  async saveGeminiThreadMessage(
    threadId: string,
    userId: string,
    message: string, // Texto transcrito (não deve conter base64 de áudio)
    role: 'user' | 'model',
    tokensUsed?: number
  ): Promise<void> {
    try {
      console.log(`[SUPABASE] Salvando mensagem interna (Threads_Gemini) - Thread: ${threadId}, Role: ${role}`);
      console.log(`[SUPABASE] Mensagem texto: ${message ? message.substring(0, 100) + '...' : '(vazia)'}`);

      // Verificar se mensagem contém base64 de áudio (não deveria, mas por segurança)
      if (message.startsWith('data:audio') || message.startsWith('UklGR') || 
          (message.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(message) && !message.includes(' '))) {
        console.warn('[SUPABASE] ⚠️ Tentativa de salvar áudio base64 em Threads_Gemini - ignorando');
        return; // Não salvar áudio em Threads_Gemini
      }

      // Salvar em Threads_Gemini (contexto interno - apenas texto)
      // Tentar campos 'message' e 'content' (dependendo da estrutura da tabela)
      const { error: threadError } = await this.supabase.from('Threads_Gemini').insert({
        id_threadconversa: threadId,
        user_id: userId,
        message: message, // Tentar campo 'message'
        content: message, // Tentar campo 'content' (caso a tabela use esse campo)
        role,
        total_tokens: typeof tokensUsed === 'number' ? tokensUsed : null,
        created_at: new Date().toISOString(),
      });

      if (threadError) {
        // Se der erro, pode ser que a tabela não tenha campo 'content' ou 'message'
        // Tentar apenas com 'message'
        const { error: retryError } = await this.supabase.from('Threads_Gemini').insert({
          id_threadconversa: threadId,
          user_id: userId,
          message: message,
          role,
          total_tokens: typeof tokensUsed === 'number' ? tokensUsed : null,
          created_at: new Date().toISOString(),
        });

        if (retryError) {
          console.error('[SUPABASE] Erro ao salvar em Threads_Gemini:', retryError);
          // Não bloquear se der erro - apenas logar
          console.warn('[SUPABASE] ⚠️ Continuando sem salvar em Threads_Gemini');
        } else {
          console.log('[SUPABASE] Mensagem salva em Threads_Gemini (campo message)');
        }
      } else {
        console.log('[SUPABASE] Mensagem salva em Threads_Gemini');
      }
    } catch (error: any) {
      console.error('[SUPABASE] Erro ao salvar mensagem interna:', error);
      // Não bloquear se der erro - apenas logar
      console.warn('[SUPABASE] ⚠️ Continuando sem salvar em Threads_Gemini');
    }
  }

  /**
   * Salva múltiplas mensagens em batch (otimização de performance)
   */
  async saveMessagesBatch(
    messages: Array<{
      threadId: string;
      userId: string;
      message: string;
      role: 'user' | 'model'; // Alterado de 'assistant' para 'model'
      type: 'text' | 'audio' | 'file';
      audioBase64?: string | null;
      mimeType?: string | null;
      fileName?: string | null;
      fileSize?: number | null;
      fileType?: string | null;
      tokensUsed?: number;
    }>
  ): Promise<void> {
    try {
      if (messages.length === 0) return;

      console.log(`[SUPABASE] Salvando ${messages.length} mensagens em batch...`);

      const records = messages.map(msg => {
        let finalMessage = msg.message || '';
        let finalMimeType = msg.mimeType || null;
        let fileName = msg.fileName ?? null;
        let fileSize = typeof msg.fileSize === 'number' ? msg.fileSize : null;
        let fileType = msg.fileType ?? null;

        // Se for áudio, normalizar base64 para formato padronizado
        if (msg.type === 'audio' && msg.audioBase64) {
          try {
            const normalized = this.normalizeAudioBase64(msg.audioBase64);
            finalMessage = normalized.cleanBase64;
            finalMimeType = normalized.mimeType;
          } catch (normalizeError: any) {
            console.error(`[SUPABASE] Erro ao normalizar áudio em batch:`, normalizeError);
            // Fallback: limpar prefixo básico
            finalMessage = msg.audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
            finalMimeType = msg.mimeType || 'audio/wav';
          }
        } else if (msg.type === 'file' && msg.audioBase64) {
          try {
            const normalized = this.normalizeFileBase64(msg.audioBase64, msg.mimeType);
            finalMessage = normalized.cleanBase64;
            finalMimeType = normalized.mimeType;
          } catch (normalizeError: any) {
            console.error(`[SUPABASE] Erro ao normalizar arquivo em batch:`, normalizeError);
            finalMessage = msg.audioBase64.replace(/^data:[^;]+;base64,/, '');
            finalMimeType = msg.mimeType || 'application/octet-stream';
          }
        }

        return {
          id_threadconversa: msg.threadId,
          user_id: msg.userId,
          message: finalMessage,
          role: msg.role, // user ou model
          type: msg.type,
          mime_type: finalMimeType, // Sempre salvar mimeType correto
          file_name: fileName,
          file_size: fileSize,
          file_type: fileType,
          total_tokens: typeof msg.tokensUsed === 'number' ? msg.tokensUsed : null,
          created_at: new Date().toISOString(),
        };
      });

      const { error } = await this.supabase.from('anamnesechathistorico').insert(records);

      if (error) {
        console.error('[SUPABASE] Erro ao salvar mensagens em batch:', error);
        throw error;
      }

      console.log(`[SUPABASE] ${messages.length} mensagens salvas em batch`);
    } catch (error: any) {
      console.error('[SUPABASE] Erro ao salvar mensagens em batch:', error);
      throw error;
    }
  }


  /**
   * Verifica se uma pergunta já foi feita no histórico
   * Usa similaridade semântica básica para detectar perguntas similares
   */
  async hasQuestionBeenAsked(threadId: string, userId: string, question: string): Promise<boolean> {
    try {
      const history = await this.getConversationHistory(threadId, userId);
      const questionLower = question.toLowerCase().trim();
      
      // Palavras-chave da pergunta (remover stopwords básicas)
      const stopwords = ['qual', 'quando', 'onde', 'como', 'por', 'que', 'o', 'a', 'os', 'as', 'de', 'da', 'do', 'das', 'em', 'na', 'no', 'nas', 'nos', 'é', 'são', 'foi', 'foram', 'te', 'você', 'sua', 'seu', 'seus', 'suas'];
      const questionWords = questionLower
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopwords.includes(word));
      
      // Verificar se alguma mensagem do assistente contém palavras-chave similares
      return history.some((item) => {
        if (item.role !== 'model' || !item.message) return false;
        
        const messageLower = item.message.toLowerCase().trim();
        
        // Verificação exata (mais rápida)
        if (messageLower.includes(questionLower)) return true;
        
        // Verificação por palavras-chave (pelo menos 2 palavras em comum)
        if (questionWords.length > 0) {
          const matchingWords = questionWords.filter(word => messageLower.includes(word));
          return matchingWords.length >= Math.min(2, questionWords.length);
        }
        
        return false;
      });
    } catch (error: any) {
      console.error('[SUPABASE] ❌ Erro ao verificar pergunta:', error);
      return false;
    }
  }

  /**
   * Gera uma transcrição completa da conversa para dados_conversa_completa
   * CRÍTICO: Usa Threads_Gemini (contexto interno) - sempre apenas texto transcrito
   * Evita enviar base64 de áudio para o Gemini
   */
  async getFullConversationTranscript(threadId: string, userId: string): Promise<string> {
    try {
      // Usar Threads_Gemini para transcrição (apenas texto transcrito)
      const geminiHistory = await this.getGeminiThreadHistory(threadId, userId);
      
      if (geminiHistory.length === 0) {
        // Fallback: tentar usar anamnesechathistorico, mas filtrando base64
        console.log('[SUPABASE] Threads_Gemini vazio, usando anamnesechathistorico com filtro de base64...');
        const history = await this.getConversationHistory(threadId, userId);
        const transcript: string[] = [];
        
        history.forEach((item, index) => {
          const roleLabel = item.role === 'user' ? 'Paciente' : 'Assistente';
          // Filtrar base64 de áudio
          let content = item.message || '[Sem conteúdo]';
          if (item.type === 'audio' || 
              content.startsWith('data:audio') || 
              content.startsWith('UklGR') ||
              (content.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(content) && !content.includes(' '))) {
            content = '[Mensagem de áudio]';
          }
          transcript.push(`${roleLabel}: ${content}`);
        });
        
        return transcript.join('\n');
      }

      // Usar Threads_Gemini (apenas texto transcrito)
      const transcript: string[] = [];
      geminiHistory.forEach((item, index) => {
        const roleLabel = item.role === 'user' ? 'Paciente' : 'Assistente';
        const content = item.message || '[Sem conteúdo]';
        transcript.push(`${roleLabel}: ${content}`);
      });
      
      return transcript.join('\n');
    } catch (error: any) {
      console.error('[SUPABASE] ❌ Erro ao gerar transcrição:', error);
      return '';
    }
  }

  /**
   * Salva exames na tabela tasks_listaexames
   */
  async saveExams(
    userId: string,
    threadId: string,
    exams: Array<{
      titulo: string;
      descricao: string;
      urgencia: string;
      interpretacao?: string;
    }>,
    fontes?: Array<{
      titulo: string;
      url?: string;
      tipo: string;
    }>
  ): Promise<any[]> {
    try {
      console.log(`[SUPABASE] Salvando ${exams.length} exames para usuário ${userId}`);
      
      // Preparar registros para tasks_listaexames
      // Esta tabela serve a tela de guia de exames
      const examRecords = exams.map(exam => ({
        user_id: userId, // ID do usuário (obrigatório)
        id_threadconversa: threadId, // ID da thread de conversa
        titulo: exam.titulo, // Título do exame
        descricao: exam.descricao, // Descrição do exame
        urgencia: exam.urgencia, // Urgência (urgente, alta, média, baixa)
        interpretacao: exam.interpretacao || null, // Interpretação do exame (se houver)
        fontes: fontes && fontes.length > 0 ? fontes : null, // Fontes científicas relacionadas
        status: false, // Status inicial: false (não completo)
        complete: false, // Complete inicial: false
        // urlpdf será preenchido pela Edge Function auto-generate-exame-pdf
        // urlfoto será preenchido se houver foto
        // goal_prescricao_id será preenchido se houver relação com prescrição
      }));
      
      // Salvar em tasks_listaexames (para processamento de PDFs)
      const { data, error } = await this.supabase
        .from('tasks_listaexames')
        .insert(examRecords)
        .select('*');
      
      if (error) {
        console.error('[SUPABASE] ❌ Erro ao salvar exames:', error);
        throw error;
      }
      
      console.log(`[SUPABASE] ✅ ${exams.length} exames salvos em tasks_listaexames`);
      
      // A tabela tasks_listaexames é a única fonte de verdade para a tela de guia de exames
      // Não é mais necessário salvar na tabela exames, pois a tela agora busca de tasks_listaexames
      
      return data || [];
    } catch (error: any) {
      console.error('[SUPABASE] ❌ Erro ao salvar exames:', error);
      throw error;
    }
  }

  /**
   * Salva análise de exame na tabela analises_exames
   * Usado quando um exame é analisado via chat
   */
  async saveExameAnalysis(
    userId: string,
    fileUrl: string,
    fileType: 'pdf' | 'image',
    fileMimeType: string,
    interpretacao: string,
    tokensUsed?: number,
    fontes?: Array<{
      titulo: string;
      url?: string;
      tipo: string;
    }>
  ): Promise<{ id: number } | null> {
    try {
      console.log('[SUPABASE] Salvando análise de exame em analises_exames...');
      console.log(`[SUPABASE] URL: ${fileUrl}`);
      console.log(`[SUPABASE] Tipo: ${fileType}`);
      console.log(`[SUPABASE] Interpretação: ${interpretacao.length} caracteres`);

      // Preparar registro para analises_exames
      const analiseRecord: any = {
        user_id: userId,
        url_arquivo: fileUrl,
        tipo_arquivo: fileType,
        interpretacao: interpretacao,
        status: 'concluida',
        modelo_usado: 'gemini-1.5-pro',
        tokens_usados: typeof tokensUsed === 'number' ? tokensUsed : null,
      };

      // Adicionar fontes se disponíveis
      if (fontes && fontes.length > 0) {
        analiseRecord.fontes = fontes;
      }

      // Salvar em analises_exames
      const { data, error } = await this.supabase
        .from('analises_exames')
        .insert(analiseRecord)
        .select('id')
        .single();

      if (error) {
        console.error('[SUPABASE] ❌ Erro ao salvar análise de exame:', error);
        throw error;
      }

      console.log(`[SUPABASE] ✅ Análise de exame salva em analises_exames com ID: ${data.id}`);
      return data;
    } catch (error: any) {
      console.error('[SUPABASE] ❌ Erro ao salvar análise de exame:', error);
      // Não falhar o processo se não conseguir salvar em analises_exames
      // A mensagem já está sendo salva em anamnesechathistorico
      return null;
    }
  }

  async getTaskExameById(examId: number): Promise<any | null> {
    try {
      const { data, error } = await this.supabase
        .from('tasks_listaexames')
        .select('id, user_id, titulo, urlpdf')
        .eq('id', examId)
        .single();

      if (error) {
        console.error('[SUPABASE] ❌ Erro ao buscar exame:', error);
        throw error;
      }

      return data;
    } catch (error: any) {
      console.error('[SUPABASE] ❌ Erro ao buscar exame:', error);
      return null;
    }
  }

  async generateSignedExamById(
    examId: number,
    userId?: string
  ): Promise<{ success: boolean; pdf_url?: string; error?: string }> {
    try {
      const payload: Record<string, any> = { exame_id: examId };
      if (userId) payload.user_id = userId;

      const { data, error } = await this.supabase.functions.invoke(
        'generate-single-exame-pdf',
        { body: payload }
      );

      if (error) {
        console.error('[SUPABASE] ❌ Erro ao gerar PDF assinado:', error);
        return { success: false, error: error.message || 'Erro desconhecido ao gerar PDF' };
      }

      if (data?.success === false) {
        console.error('[SUPABASE] ❌ PDF assinado falhou:', data?.error);
        return { success: false, error: data?.error || 'Falha ao gerar PDF' };
      }

      return { success: true, pdf_url: data?.pdf_url };
    } catch (error: any) {
      console.error('[SUPABASE] ❌ Erro ao chamar generate-single-exame-pdf:', error);
      return { success: false, error: error.message || 'Erro ao processar geração de PDF' };
    }
  }

  async generateSignedExams(exams: Array<any>): Promise<{ success: number; failed: number; errors: Array<{ examId: number; error: string }> }> {
    const result = { success: 0, failed: 0, errors: [] as Array<{ examId: number; error: string }> };
    
    if (!exams || exams.length === 0) return result;

    for (const exam of exams) {
      try {
        const payload = {
          exame_id: exam.id,
          user_id: exam.user_id,
        };

        const { data, error } = await this.supabase.functions.invoke(
          'generate-single-exame-pdf',
          { body: payload }
        );

        if (error) {
          console.error('[SUPABASE] ❌ Erro ao gerar PDF assinado:', error);
          result.failed++;
          result.errors.push({
            examId: exam.id,
            error: error.message || 'Erro desconhecido ao gerar PDF'
          });
          continue;
        }

        if (data?.success === false) {
          console.error('[SUPABASE] ❌ PDF assinado falhou:', data?.error);
          result.failed++;
          result.errors.push({
            examId: exam.id,
            error: data?.error || 'Falha ao gerar PDF'
          });
          continue;
        }

        console.log('[SUPABASE] ✅ PDF assinado gerado para exame:', exam.id);
        result.success++;
      } catch (error: any) {
        console.error('[SUPABASE] ❌ Erro ao chamar generate-single-exame-pdf:', error);
        result.failed++;
        result.errors.push({
          examId: exam.id,
          error: error.message || 'Erro ao processar geração de PDF'
        });
      }
    }
    
    return result;
  }

  async generateSignedPrescricao(
    userId: string
  ): Promise<{ success: boolean; pdf_url?: string; error?: string }> {
    try {
      // Solicitar geração da prescrição assinada para o usuário
      const { data, error } = await this.supabase.functions.invoke(
        'auto-generate-prescricao-pdf',
        { body: { user_id: userId } }
      );

      if (error) {
        console.error('[SUPABASE] ❌ Erro ao gerar prescrição assinada:', error);
        return { success: false, error: error.message || 'Erro desconhecido ao gerar prescrição' };
      }

      if (data?.success === false) {
        console.error('[SUPABASE] ❌ Prescrição assinada falhou:', data?.error);
        return { success: false, error: data?.error || 'Falha ao gerar prescrição' };
      }

      return { success: true, pdf_url: data?.pdf_url };
    } catch (error: any) {
      console.error('[SUPABASE] ❌ Erro ao chamar auto-generate-prescricao-pdf:', error);
      return { success: false, error: error.message || 'Erro ao processar geração de prescrição' };
    }
  }

  async getMissingExamPdfsForUser(
    userId: string,
    limit: number = 50
  ): Promise<Array<{ id: number; user_id: string; titulo?: string; urlpdf?: string }>> {
    try {
      const { data, error } = await this.supabase
        .from('tasks_listaexames')
        .select('id, user_id, titulo, urlpdf, created_at')
        .eq('user_id', userId)
        .or('urlpdf.is.null,urlpdf.eq.')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[SUPABASE] ❌ Erro ao buscar exames sem PDF:', error);
        throw error;
      }

      return data || [];
    } catch (error: any) {
      console.error('[SUPABASE] ❌ Erro ao buscar exames sem PDF:', error);
      return [];
    }
  }

  async generateMissingExamPdfsForUser(
    userId: string,
    limit: number = 50
  ): Promise<{ success: number; failed: number; errors: Array<{ examId: number; error: string }> }> {
    const exams = await this.getMissingExamPdfsForUser(userId, limit);
    if (!exams || exams.length === 0) {
      return { success: 0, failed: 0, errors: [] };
    }

    return this.generateSignedExams(exams);
  }
}
