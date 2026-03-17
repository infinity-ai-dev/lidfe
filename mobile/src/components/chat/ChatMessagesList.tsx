import React, { useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, Platform } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { ChatMessageItem } from './ChatMessageItem';
import type { ChatMessage } from '@/types';
import type { AudioPlayerControls } from './AudioMessagePlayer';
import * as SecureStore from 'expo-secure-store';

interface ChatMessagesListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  onRefresh?: () => Promise<void>;
  emptyStateMessage?: string;
  userAvatarUrl?: string | null;
  threadId?: string;
  footerComponent?: React.ReactNode;
}

export function ChatMessagesList({
  messages,
  isLoading = false,
  onRefresh,
  emptyStateMessage = 'Nenhuma mensagem ainda. Comece uma conversa!',
  userAvatarUrl,
  threadId,
  footerComponent,
}: ChatMessagesListProps) {
  const theme = useTheme();
  const flatListRef = useRef<FlatList>(null);
  const audioPlayersRef = useRef<Map<string, AudioPlayerControls>>(new Map());
  const playedAudioIdsRef = useRef<Set<string>>(new Set());
  const autoSequenceRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const playedStorageKey = threadId ? `lidfe:chat:audio_played:${threadId}` : null;
  const MAX_PLAYED_IDS = 300;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    playedAudioIdsRef.current = new Set();
    autoSequenceRef.current = false;
  }, [playedStorageKey]);

  const loadPlayedAudioIds = useCallback(async () => {
    if (!playedStorageKey) return;
    try {
      let raw: string | null = null;
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        raw = window.localStorage.getItem(playedStorageKey);
      } else {
        raw = await SecureStore.getItemAsync(playedStorageKey);
      }
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((item) => typeof item === 'string');
        playedAudioIdsRef.current = new Set(filtered);
      }
    } catch (error) {
      console.warn('[CHAT] Erro ao carregar estado de áudio:', error);
    }
  }, [playedStorageKey]);

  const persistPlayedAudioIds = useCallback(async () => {
    if (!playedStorageKey) return;
    const values = Array.from(playedAudioIdsRef.current);
    const trimmed = values.slice(-MAX_PLAYED_IDS);
    if (trimmed.length !== values.length) {
      playedAudioIdsRef.current = new Set(trimmed);
    }
    try {
      const payload = JSON.stringify(trimmed);
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(playedStorageKey, payload);
      } else {
        await SecureStore.setItemAsync(playedStorageKey, payload);
      }
    } catch (error) {
      console.warn('[CHAT] Erro ao persistir estado de áudio:', error);
    }
  }, [MAX_PLAYED_IDS, playedStorageKey]);

  useEffect(() => {
    void loadPlayedAudioIds();
  }, [loadPlayedAudioIds]);

  const registerAudioPlayer = useCallback(
    (id: string, controls: AudioPlayerControls) => {
      audioPlayersRef.current.set(id, controls);
      return () => {
        audioPlayersRef.current.delete(id);
      };
    },
    []
  );

  const stopAllExcept = useCallback((id: string) => {
    audioPlayersRef.current.forEach((controls, key) => {
      if (key !== id) {
        controls.stopAndReset?.();
      }
    });
  }, []);

  const stopAllPlayers = useCallback(() => {
    audioPlayersRef.current.forEach((controls) => {
      controls.stopAndReset?.();
    });
  }, []);

  const findNextAudioId = useCallback((currentId: string) => {
    const list = messagesRef.current;
    const currentIndex = list.findIndex((msg) => msg.id === currentId);
    if (currentIndex < 0) return null;

    for (let i = currentIndex + 1; i < list.length; i += 1) {
      const msg = list[i];
      if (msg.type === 'audio' && !playedAudioIdsRef.current.has(msg.id)) {
        return msg.id;
      }
    }
    return null;
  }, []);

  const handlePlayRequest = useCallback(
    async (id: string) => {
      stopAllExcept(id);
      autoSequenceRef.current = true;
      const player = audioPlayersRef.current.get(id);
      if (player) {
        await player.play?.();
      }
    },
    [stopAllExcept]
  );

  const handlePauseRequest = useCallback(async (id: string) => {
    autoSequenceRef.current = false;
    const player = audioPlayersRef.current.get(id);
    if (player) {
      await player.pause?.();
    }
  }, []);

  const handlePlaybackEnd = useCallback(
    async (id: string) => {
      if (playedAudioIdsRef.current.has(id)) {
        playedAudioIdsRef.current.delete(id);
      }
      playedAudioIdsRef.current.add(id);
      void persistPlayedAudioIds();
      if (!autoSequenceRef.current) return;

      const nextId = findNextAudioId(id);
      if (!nextId) return;

      stopAllExcept(nextId);
      const nextPlayer = audioPlayersRef.current.get(nextId);
      if (nextPlayer) {
        await nextPlayer.play?.();
      }
    },
    [findNextAudioId, stopAllExcept]
  );

  useEffect(() => {
    return () => {
      autoSequenceRef.current = false;
      stopAllPlayers();
    };
  }, [stopAllPlayers]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  if (isLoading && messages.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text
          variant="bodyMedium"
          style={[styles.loadingText, { color: theme.colors.onSurfaceVariant }]}
        >
          Carregando mensagens...
        </Text>
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <Text
          variant="displaySmall"
          style={[styles.emptyIcon, { color: theme.colors.onSurfaceVariant }]}
        >
          💬
        </Text>
        <Text
          variant="bodyLarge"
          style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}
        >
          {emptyStateMessage}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={flatListRef}
      data={messages}
      keyExtractor={(item, index) => item.id || `message-${index}`}
      renderItem={({ item }) => (
        <ChatMessageItem
          message={item}
          userAvatarUrl={userAvatarUrl}
          registerAudioPlayer={registerAudioPlayer}
          onAudioPlay={handlePlayRequest}
          onAudioPause={handlePauseRequest}
          onAudioEnd={handlePlaybackEnd}
        />
      )}
      contentContainerStyle={styles.listContent}
      onRefresh={onRefresh}
      refreshing={false}
      ListFooterComponent={
        footerComponent ? <View style={styles.footerContainer}>{footerComponent}</View> : null
      }
      onContentSizeChange={() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }}
    />
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    textAlign: 'center',
  },
  listContent: {
    paddingVertical: 16,
  },
  footerContainer: {
    paddingTop: 12,
  },
});
