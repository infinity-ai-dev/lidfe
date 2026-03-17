// Gerenciador de histórico com cache e otimizações
import { SupabaseClientService } from './supabase-client';
import { CacheManager } from './cache-manager';
import { ConversationHistoryItem, GeminiMessage } from './types';

export class HistoryManager {
  private supabaseClient: SupabaseClientService;
  private cacheManager: CacheManager;

  constructor(supabaseClient: SupabaseClientService, cacheManager: CacheManager) {
    this.supabaseClient = supabaseClient;
    this.cacheManager = cacheManager;
  }

  private getMaxGeminiContextMessages(): number {
    const raw = Number(process.env.MAX_GEMINI_CONTEXT_MESSAGES || 24);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 24;
  }

  private getMaxTranscriptMessages(): number {
    const raw = Number(process.env.MAX_TRANSCRIPT_MESSAGES || 12);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 12;
  }

  private isSessionBoundary(message?: string | null): boolean {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return (
      normalized.includes('a coleta da anamnese foi concluída') ||
      normalized.includes('a coleta da anamnese foi concluida') ||
      normalized.includes('sessão encerrada') ||
      normalized.includes('sessao encerrada') ||
      normalized.includes('anamnese concluída') ||
      normalized.includes('anamnese concluida')
    );
  }

  private sliceToCurrentSession(history: ConversationHistoryItem[]): ConversationHistoryItem[] {
    if (history.length === 0) return history;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const item = history[i];
      if (this.isSessionBoundary(item.message)) {
        if (i >= history.length - 1) {
          return [];
        }
        return history.slice(i + 1);
      }
    }
    return history;
  }

  private limitHistory(history: ConversationHistoryItem[], maxItems: number): ConversationHistoryItem[] {
    if (maxItems <= 0 || history.length <= maxItems) {
      return history;
    }
    return history.slice(-maxItems);
  }

  private isMediaBase64(message?: string | null): boolean {
    if (!message) return false;
    if (message.startsWith('data:audio/') || message.startsWith('data:application/pdf') || message.startsWith('data:image/')) {
      return true;
    }
    if (message.startsWith('JVBERi0')) return true; // PDF
    if (message.startsWith('iVBORw0KGgo')) return true; // PNG
    if (message.startsWith('/9j/')) return true; // JPEG
    if (message.startsWith('R0lGOD')) return true; // GIF
    const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(message);
    if (looksBase64 && message.length > 2000 && !message.includes(' ')) {
      return true;
    }
    return false;
  }

  private filterTextOnly(history: ConversationHistoryItem[]): ConversationHistoryItem[] {
    return history.filter((item) => {
      if (item.type && item.type !== 'text') return false;
      return !this.isMediaBase64(item.message);
    });
  }

  private buildTranscript(history: ConversationHistoryItem[], maxItems: number): string {
    const recent = this.limitHistory(history, maxItems);
    return recent
      .map((item) => {
        const roleLabel = item.role === 'user' ? 'Paciente' : 'Assistente';
        const content = item.message || '[Sem conteúdo]';
        return `${roleLabel}: ${content}`;
      })
      .join('\n');
  }

  /**
   * Busca histórico com cache
   */
  async getConversationHistory(
    threadId: string,
    userId: string,
    useCache: boolean = true
  ): Promise<ConversationHistoryItem[]> {
    const cacheKey = CacheManager.getHistoryKey(threadId, userId);

    // Tentar cache primeiro
    if (useCache) {
      const cached = await this.cacheManager.get<ConversationHistoryItem[]>(cacheKey);
      if (cached) {
        console.log('[HISTORY-MANAGER] ✅ Histórico encontrado no cache');
        return cached;
      }
    }

    // Buscar do banco
    console.log('[HISTORY-MANAGER] Buscando histórico do banco...');
    const history = await this.supabaseClient.getConversationHistory(threadId, userId);

    // Armazenar no cache (TTL de 5 minutos)
    if (useCache && history.length > 0) {
      await this.cacheManager.set(cacheKey, history, 300);
    }

    return history;
  }


  /**
   * Busca transcrição completa com cache
   */
  async getFullTranscript(
    threadId: string,
    userId: string,
    useCache: boolean = true
  ): Promise<string> {
    const cacheKey = CacheManager.getTranscriptKey(threadId, userId);

    // Tentar cache primeiro
    if (useCache) {
      const cached = await this.cacheManager.get<string>(cacheKey);
      if (cached) {
        console.log('[HISTORY-MANAGER] ✅ Transcrição encontrada no cache');
        return cached;
      }
    }

    // Buscar do banco
    console.log('[HISTORY-MANAGER] Gerando transcrição do banco...');
    const transcript = await this.supabaseClient.getFullConversationTranscript(threadId, userId);

    // Armazenar no cache (TTL de 5 minutos)
    if (useCache && transcript.length > 0) {
      await this.cacheManager.set(cacheKey, transcript, 300);
    }

    return transcript;
  }

  /**
   * Invalida cache após salvar nova mensagem
   */
  async invalidateCache(threadId: string, userId: string): Promise<void> {
    const historyKey = CacheManager.getHistoryKey(threadId, userId);
    const transcriptKey = CacheManager.getTranscriptKey(threadId, userId);
    const geminiThreadKey = `gemini_thread:${threadId}:${userId}`;

    await Promise.all([
      this.cacheManager.delete(historyKey),
      this.cacheManager.delete(transcriptKey),
      this.cacheManager.delete(geminiThreadKey),
    ]);

    console.log('[HISTORY-MANAGER] ✅ Cache invalidado');
  }

  /**
   * Busca histórico e transcrição em paralelo (otimização)
   */
  async getHistoryAndTranscript(
    threadId: string,
    userId: string
  ): Promise<{
    history: ConversationHistoryItem[];
    transcript: string;
  }> {
    // Buscar tudo em paralelo
    const [history, transcript] = await Promise.all([
      this.getConversationHistory(threadId, userId),
      this.getFullTranscript(threadId, userId),
    ]);

    return {
      history,
      transcript,
    };
  }

  /**
   * Busca histórico interno (Threads_Gemini) com cache
   * Usado para contexto interno do agente - apenas texto
   */
  async getGeminiThreadHistory(
    threadId: string,
    userId: string,
    useCache: boolean = true
  ): Promise<ConversationHistoryItem[]> {
    const cacheKey = `gemini_thread:${threadId}:${userId}`;

    // Tentar cache primeiro
    if (useCache) {
      const cached = await this.cacheManager.get<ConversationHistoryItem[]>(cacheKey);
      if (cached) {
        console.log('[HISTORY-MANAGER] ✅ Histórico interno encontrado no cache');
        return cached;
      }
    }

    // Buscar do banco
    console.log('[HISTORY-MANAGER] Buscando histórico interno (Threads_Gemini) do banco...');
    const history = await this.supabaseClient.getGeminiThreadHistory(threadId, userId);

    // Armazenar no cache (TTL de 5 minutos)
    if (useCache && history.length > 0) {
      await this.cacheManager.set(cacheKey, history, 300);
    }

    return history;
  }

  /**
   * Busca ambos históricos em paralelo (otimização)
   */
  async getBothHistories(
    threadId: string,
    userId: string
  ): Promise<{
    anamneseHistory: ConversationHistoryItem[];
    geminiThreadHistory: ConversationHistoryItem[];
    transcript: string;
  }> {
    // Buscar históricos em paralelo (evitar transcrição completa para reduzir tokens)
    const [anamneseHistoryRaw, geminiThreadHistoryRaw] = await Promise.all([
      this.getConversationHistory(threadId, userId),
      this.getGeminiThreadHistory(threadId, userId),
    ]);

    const anamneseHistory = this.sliceToCurrentSession(anamneseHistoryRaw);
    const geminiThreadHistory = this.limitHistory(
      this.sliceToCurrentSession(geminiThreadHistoryRaw),
      this.getMaxGeminiContextMessages()
    );

    const transcriptSource =
      geminiThreadHistory.length > 0
        ? geminiThreadHistory
        : this.filterTextOnly(anamneseHistory);
    const transcript = this.buildTranscript(transcriptSource, this.getMaxTranscriptMessages());

    return {
      anamneseHistory,
      geminiThreadHistory,
      transcript,
    };
  }
}
