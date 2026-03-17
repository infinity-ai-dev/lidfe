import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/services/supabase/client';
import { databaseService } from '@/services/supabase/database/tables';
import { anamneseAgentService } from '@/services/anamnese-agent';
import { agentIAService } from '@/services/agent-ia/api';
import { createSSEClient, type SSEClient } from '@/services/agent-ia/sse-client';
import type { ChatMessage } from '@/types';
import { useAuth } from './useAuth';

export function useChat(threadId: string) {
  const { user, session } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(60);
  // Cache do navegador: manter "modo listen" com timestamp de último evento.
  const sseClientRef = useRef<SSEClient | null>(null);
  const lastEventRef = useRef<number>(Date.now());
  const lastServerIdRef = useRef<number>(0);
  const canUseStorage = typeof window !== 'undefined' && !!window.localStorage;
  const listenKey = `lidfe:chat:listen:${threadId}`;
  const lastEventIdKey = `lidfe:chat:last_event_id:${threadId}`;
  const messagesCacheKey = `lidfe:chat:messages:${threadId}`;
  const maxCachedMessages = 80;
  const maxCachedMessageChars = 4000;
  const pollingInFlightRef = useRef(false);

  useEffect(() => {
    // Resetar estado quando a thread muda para evitar vazamento visual.
    setMessages([]);
    setIsLoading(true);
    lastServerIdRef.current = 0;
  }, [threadId]);

  const updateLastEvent = useCallback((timestamp: number) => {
    lastEventRef.current = timestamp;
    if (canUseStorage) {
      try {
        localStorage.setItem(listenKey, String(timestamp));
      } catch (error) {
        console.warn('[CHAT] Erro ao persistir listenKey:', error);
      }
    }
  }, [canUseStorage, listenKey]);

  const saveMessagesToCache = useCallback((items: ChatMessage[]) => {
    if (!canUseStorage) return;
    // Limitar tamanho para evitar cache excessivo no navegador.
    const trimmed = items.slice(-maxCachedMessages).map((item) => {
      if (item.type === 'audio') {
        return { ...item, message: '[audio]', mime_type: item.mime_type ?? null };
      }
      if (item.type === 'file') {
        return {
          ...item,
          message: '[file]',
          mime_type: item.mime_type ?? null,
          file_name: item.file_name ?? null,
          file_size: item.file_size ?? null,
          file_type: item.file_type ?? null,
        };
      }
      if (item.message && item.message.length > maxCachedMessageChars) {
        return { ...item, message: item.message.slice(0, maxCachedMessageChars) };
      }
      return item;
    });
    try {
      localStorage.setItem(messagesCacheKey, JSON.stringify(trimmed));
    } catch (error) {
      console.warn('[CHAT] Erro ao salvar cache de mensagens:', error);
      try {
        localStorage.removeItem(messagesCacheKey);
      } catch {
        // ignore
      }
    }
  }, [canUseStorage, maxCachedMessageChars, maxCachedMessages, messagesCacheKey]);

  const normalizeIncoming = useCallback(
    (incoming: ChatMessage): ChatMessage => {
      // Normalizar valores mínimos
      return {
        ...incoming,
        thread_id: incoming.thread_id || threadId,
        user_id: incoming.user_id || (user?.id ?? ''),
        created_at: incoming.created_at || new Date().toISOString(),
        message: incoming.message ?? '',
        role: incoming.role ?? 'model',
        type: incoming.type ?? 'text',
        mime_type: incoming.mime_type ?? null,
        file_name: incoming.file_name ?? null,
        file_size: incoming.file_size ?? null,
        file_type: incoming.file_type ?? null,
      };
    },
    [threadId, user?.id]
  );

  const isSameLogicalMessage = useCallback(
    (a: ChatMessage, b: ChatMessage) => {
      if (a.role !== b.role) return false;
      if (a.type !== b.type) return false;
      if (a.user_id !== b.user_id) return false;
      if (a.thread_id !== b.thread_id) return false;
      if ((a.message || '').trim() !== (b.message || '').trim()) return false;

      // janela curta para reconciliar eventos duplicados (SSE vs Realtime vs otimista)
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
      return Math.abs(ta - tb) <= 20_000;
    },
    []
  );

  const dedupeMessages = useCallback(
    (items: ChatMessage[]) => {
      const unique: ChatMessage[] = [];

      items.forEach((itemRaw) => {
        const item = normalizeIncoming(itemRaw);

        if (unique.some((m) => m.id === item.id)) {
          return;
        }

        const sameIndex = unique.findIndex((m) => isSameLogicalMessage(m, item));
        if (sameIndex >= 0) {
          const existing = unique[sameIndex];
          const isTempUser = existing.id.startsWith('temp-') && existing.role === 'user';
          if (isTempUser && item.role === 'user') {
            unique[sameIndex] = item;
          }
          return;
        }

        unique.push(item);
      });

      return unique;
    },
    [isSameLogicalMessage, normalizeIncoming]
  );

  const updateLastServerId = useCallback((items: ChatMessage[]) => {
    let maxId = lastServerIdRef.current;
    items.forEach((item) => {
      const numericId = Number(item.id);
      if (Number.isFinite(numericId) && numericId > maxId) {
        maxId = numericId;
      }
    });
    if (maxId !== lastServerIdRef.current) {
      lastServerIdRef.current = maxId;
    }
  }, []);

  const hydrateMessagesFromCache = useCallback(() => {
    if (!canUseStorage) return;
    const cached = localStorage.getItem(messagesCacheKey);
    if (!cached) return;
    try {
      const parsed = JSON.parse(cached) as ChatMessage[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Deduplicar cache para evitar duplicações visuais.
        const deduped = dedupeMessages(parsed);
        setMessages(deduped);
        updateLastServerId(deduped);
      }
    } catch {
      try {
        localStorage.removeItem(messagesCacheKey);
      } catch {
        // ignore
      }
    }
  }, [canUseStorage, dedupeMessages, messagesCacheKey, updateLastServerId]);

  const mergeIncomingMessage = useCallback(
    (incomingRaw: ChatMessage) => {
      const incoming = normalizeIncoming(incomingRaw);
      updateLastServerId([incoming]);

      setMessages((prev) => {
        // 1) Se já existe por ID, não duplica
        if (prev.some((m) => m.id === incoming.id)) return prev;

        // 2) Remover duplicatas lógicas (SSE + Realtime) e reconciliar temp do usuário
        const next = prev.filter((m) => {
          // Reconciliar: se chegou a mensagem real do usuário, remover o temp correspondente
          const isTempUser = m.id.startsWith('temp-') && m.role === 'user';
          if (isTempUser && incoming.role === 'user' && isSameLogicalMessage(m, incoming)) {
            return false;
          }

          // Evitar duplicatas lógicas (ex: mesma resposta do modelo via SSE e Realtime)
          if (isSameLogicalMessage(m, incoming)) {
            return false;
          }

          return true;
        });

        return [...next, incoming];
      });
    },
    [isSameLogicalMessage, normalizeIncoming]
  );

  // Carregar histórico de mensagens
  const loadMessages = useCallback(async (options?: { incremental?: boolean }) => {
    if (!user?.id || !threadId) return;

    const incremental = options?.incremental ?? false;
    const afterId = incremental && lastServerIdRef.current > 0 ? lastServerIdRef.current : undefined;

    try {
      if (!incremental) {
        setIsLoading(true);
      }

      const { data, error } = await databaseService.anamneseChatHistorico.getAll({
        userId: user.id,
        threadId,
        afterId,
      });

      if (error) {
        console.error('[CHAT] Erro ao carregar mensagens:', error);
        return;
      }

      if (data && data.length > 0) {
        const chatMessages: ChatMessage[] = data.map((msg) => ({
          id: msg.id.toString(),
          thread_id: msg.id_threadconversa as string,
          message: msg.message as string,
          role: msg.role as ChatMessage['role'],
          type: msg.type as ChatMessage['type'],
          mime_type: (msg as any).mime_type ?? null,
          file_name: (msg as any).file_name ?? null,
          file_size: (msg as any).file_size ?? null,
          file_type: (msg as any).file_type ?? null,
          user_id: msg.user_id as string,
          created_at: msg.created_at,
        }));

        if (incremental) {
          setMessages((prev) => dedupeMessages([...prev, ...chatMessages]));
          updateLastServerId(chatMessages);
        } else {
          const deduped = dedupeMessages(chatMessages);
          setMessages(deduped);
          saveMessagesToCache(deduped);
          updateLastServerId(deduped);
        }
      } else if (!incremental) {
        // DB retornou vazio — limpar estado e cache local
        setMessages([]);
        saveMessagesToCache([]);
      }
    } catch (error) {
      console.error('[CHAT] Erro ao carregar mensagens:', error);
    } finally {
      if (!incremental) {
        setIsLoading(false);
      }
    }
  }, [dedupeMessages, saveMessagesToCache, threadId, updateLastServerId, user?.id]);

  const setupSSEClient = useCallback(async () => {
    if (!user?.id || !threadId) return null;

    const lastEventId = canUseStorage ? localStorage.getItem(lastEventIdKey) : null;
    let sseToken: string | null = null;
    try {
      sseToken = await agentIAService.getSseToken(threadId);
    } catch {
      sseToken = null;
    }

    const client = createSSEClient(threadId, user.id, lastEventId, sseToken || session?.access_token || null);
    sseClientRef.current = client;

    const handleIncomingEvent = (event: { id?: string; type?: string; data?: any }) => {
      if (event.id && canUseStorage) {
        try {
          localStorage.setItem(lastEventIdKey, event.id);
        } catch (error) {
          console.warn('[CHAT] Erro ao persistir lastEventId:', error);
        }
      }
      if (event.type === 'new_message' && event.data) {
        // Atualizar cache do navegador para manter modo listen ativo.
        updateLastEvent(Date.now());
        const eventId = event.id || event.data?.id;
        const messagePayload = event.data?.message
          || (event.data?.type === 'audio' ? event.data?.audio_base64 : '')
          || '';
        mergeIncomingMessage({
          id: eventId ? `sse-${eventId}` : `sse-${Date.now()}`,
          thread_id: threadId,
          message: messagePayload,
          role: (event.data.role as ChatMessage['role']) || 'model',
          type: (event.data.type as ChatMessage['type']) || 'text',
          mime_type: event.data.mimeType || event.data.mime_type || null,
          file_name: event.data.fileName || event.data.file_name || null,
          file_size: event.data.fileSize || event.data.file_size || null,
          file_type: event.data.fileType || event.data.file_type || null,
          user_id: (event.data.user_id as string) || user.id,
          created_at: event.data.created_at || event.data.timestamp || new Date().toISOString(),
        });
      }
    };

    client
      .connect()
      .then(() => {
        console.log('[CHAT] SSE conectado');
        updateLastEvent(Date.now());

        // Escutar evento customizado e fallback padrão.
        client.on('new_message', handleIncomingEvent);
        client.on('message', handleIncomingEvent);
      })
      .catch((error) => {
        console.error('[CHAT] Erro ao conectar SSE:', error);
      });

    return client;
  }, [mergeIncomingMessage, session?.access_token, threadId, updateLastEvent, user?.id]);

  // Configurar SSE para atualizações em tempo real
  useEffect(() => {
    if (!user?.id || !threadId) return;

    let isActive = true;
    let client: SSEClient | null = null;

    setupSSEClient().then((created) => {
      if (!isActive) {
        created?.close();
        return;
      }
      client = created;
    });

    return () => {
      isActive = false;
      client?.close();
    };
  }, [setupSSEClient, threadId, user?.id]);

  // Carregar mensagens ao montar
  useEffect(() => {
    // Hidratar do cache local primeiro para UX mais rápida.
    hydrateMessagesFromCache();
    loadMessages();
  }, [hydrateMessagesFromCache, loadMessages]);

  // Persistir mensagens em cache sempre que atualizar.
  useEffect(() => {
    if (messages.length === 0) return;
    saveMessagesToCache(messages);
  }, [messages, saveMessagesToCache]);

  // Escutar mudanças no Supabase Realtime como fallback
  useEffect(() => {
    if (!user?.id || !threadId) return;

    const channel = supabase
      .channel(`chat:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'anamnesechathistorico',
          filter: `id_threadconversa=eq.${threadId}`,
        },
        (payload) => {
          const newRecord = payload.new as any;
          // Realtime também atualiza o cache de listen.
          updateLastEvent(Date.now());
          mergeIncomingMessage({
            id: newRecord.id.toString(),
            thread_id: newRecord.id_threadconversa as string,
            message: newRecord.message as string,
            role: newRecord.role as ChatMessage['role'],
            type: newRecord.type as ChatMessage['type'],
            mime_type: newRecord.mime_type || null,
            file_name: newRecord.file_name || null,
            file_size: newRecord.file_size || null,
            file_type: newRecord.file_type || null,
            user_id: newRecord.user_id as string,
            created_at: newRecord.created_at || new Date().toISOString(),
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [mergeIncomingMessage, threadId, updateLastEvent, user?.id]);

  // Watchdog web: manter modo listen ativo e reduzir necessidade de refresh manual.
  useEffect(() => {
    if (!user?.id || !threadId) return;
    if (!canUseStorage) return;

    // Marcar listen ativo no cache do navegador.
    try {
      localStorage.setItem(`${listenKey}:enabled`, 'true');
    } catch (error) {
      console.warn('[CHAT] Erro ao persistir listenKey enabled:', error);
    }
    const cached = localStorage.getItem(listenKey);
    if (cached) {
      const parsed = Number(cached);
      if (Number.isFinite(parsed)) {
        lastEventRef.current = parsed;
      }
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const last = lastEventRef.current || now;

      // Se não há eventos recentes, faz refresh leve e reconecta SSE.
      if (now - last > 15000) {
        updateLastEvent(now);
        void loadMessages({ incremental: true });
        sseClientRef.current?.close();
        void setupSSEClient();
      }
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [canUseStorage, listenKey, loadMessages, setupSSEClient, threadId, updateLastEvent, user?.id]);

  // Fallback rápido: pooling a cada 5s para garantir atualização mesmo com SSE instável.
  useEffect(() => {
    if (!user?.id || !threadId) return;

    const interval = setInterval(async () => {
      // Evitar sobreposição de requisições.
      if (pollingInFlightRef.current) return;
      // No web, pausar pooling se a aba não está visível.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      pollingInFlightRef.current = true;
      try {
        await loadMessages({ incremental: true });
      } finally {
        pollingInFlightRef.current = false;
      }
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [loadMessages, threadId, user?.id]);

  const sendMessage = useCallback(
    async (message: string, messageType: 'text' | 'audio' = 'text') => {
      if (!user?.id || !threadId || !message.trim()) return;

      let userMessageId: string | null = null;

      try {
        setIsSending(true);

        // Adicionar mensagem do usuário localmente (otimista)
        userMessageId = `temp-${Date.now()}`;
        mergeIncomingMessage({
          id: userMessageId,
          thread_id: threadId,
          message,
          role: 'user',
          type: messageType,
          user_id: user.id,
          created_at: new Date().toISOString(),
        });

        // Enviar para o agente (ele salva no banco e dispara SSE/Realtime)
        await anamneseAgentService.sendMessage(threadId, user.id, message, messageType, {
          userName: user.user_metadata?.name || user.email || undefined,
          userEmail: user.email || undefined,
        });

        console.log('[CHAT] Mensagem enviada, aguardando resposta do agente');
      } catch (error: any) {
        console.error('[CHAT] Erro ao enviar mensagem:', error);
        
        // Verificar se é rate limit (429)
        if (error?.status === 429 || error?.message === 'RATE_LIMIT_429') {
          const retryAfter = error?.retryAfter || 60;
          setIsRateLimited(true);
          setRateLimitSeconds(retryAfter);
          
          // Timer para desbloquear após o tempo de espera
          const interval = setInterval(() => {
            setRateLimitSeconds((prev) => {
              if (prev <= 1) {
                clearInterval(interval);
                setIsRateLimited(false);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
        }
        
        // Remover mensagem temporária em caso de erro
        if (userMessageId) {
          setMessages((prev) => prev.filter((m) => m.id !== userMessageId));
        }
      } finally {
        setIsSending(false);
      }
    },
    [mergeIncomingMessage, threadId, user]
  );

  const sendAudioMessage = useCallback(async (audioBase64: string) => {
    await sendMessage(audioBase64, 'audio');
  }, [sendMessage]);

  const sendFileMessage = useCallback(
    async (params: {
      base64: string;
      fileType: 'pdf' | 'image';
      fileMimeType: string;
      fileName?: string;
      fileSize?: number;
      message?: string;
    }) => {
      if (!user?.id || !threadId) return;

      let userMessageId: string | null = null;

      try {
        setIsSending(true);

        // Adicionar mensagem do usuário localmente (otimista)
        userMessageId = `temp-${Date.now()}`;
        mergeIncomingMessage({
          id: userMessageId,
          thread_id: threadId,
          message: params.base64,
          role: 'user',
          type: 'file',
          mime_type: params.fileMimeType,
          file_name: params.fileName || null,
          file_size: typeof params.fileSize === 'number' ? params.fileSize : null,
          file_type: params.fileType,
          user_id: user.id,
          created_at: new Date().toISOString(),
        });

        // Enviar para o agente (ele salva no banco e dispara SSE/Realtime)
        await anamneseAgentService.sendFileMessage(
          threadId,
          user.id,
          params.base64,
          params.fileType,
          params.fileMimeType,
          params.fileName,
          params.fileSize,
          params.message,
          {
            userName: user.user_metadata?.name || user.email || undefined,
            userEmail: user.email || undefined,
          }
        );

        console.log('[CHAT] Arquivo enviado, aguardando resposta do agente');
      } catch (error: any) {
        console.error('[CHAT] Erro ao enviar arquivo:', error);
        
        // Verificar se é rate limit (429)
        if (error?.status === 429 || error?.message === 'RATE_LIMIT_429') {
          const retryAfter = error?.retryAfter || 60;
          setIsRateLimited(true);
          setRateLimitSeconds(retryAfter);
          
          // Timer para desbloquear após o tempo de espera
          const interval = setInterval(() => {
            setRateLimitSeconds((prev) => {
              if (prev <= 1) {
                clearInterval(interval);
                setIsRateLimited(false);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
        }
        
        // Remover mensagem temporária em caso de erro
        if (userMessageId) {
          setMessages((prev) => prev.filter((m) => m.id !== userMessageId));
        }
      } finally {
        setIsSending(false);
      }
    },
    [mergeIncomingMessage, threadId, user]
  );

  return {
    messages,
    isLoading,
    isSending,
    isRateLimited,
    rateLimitSeconds,
    sendMessage,
    sendAudioMessage,
    sendFileMessage,
    refreshMessages: loadMessages,
  };
}
