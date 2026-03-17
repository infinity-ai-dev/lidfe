import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Button, IconButton, Text, useTheme } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useChat } from '@/hooks/useChat';
import { ChatMessagesList } from '@/components/chat/ChatMessagesList';
import { useAppStore } from '@/store/appStore';
import { useFontScale } from '@/hooks/useFontScale';

export default function AnamneseHistoricoDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { scale } = useFontScale();
  const params = useLocalSearchParams<{ threadId?: string | string[] }>();
  const storedAvatarUrl = useAppStore((state) => state.urlimageavatar);

  const threadId = useMemo(() => {
    const raw = Array.isArray(params.threadId) ? params.threadId[0] : params.threadId;
    if (!raw) return '';
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params.threadId]);

  const { messages, isLoading, refreshMessages } = useChat(threadId);

  if (!threadId) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <Text style={{ color: theme.colors.onBackground }}>Sessão não encontrada.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.header}>
        <IconButton icon="arrow-left" onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: theme.colors.onBackground, fontSize: scale(18) }]}
        >
          Anamnese Arquivada
        </Text>
      </View>

      <ChatMessagesList
        messages={messages}
        isLoading={isLoading}
        onRefresh={refreshMessages}
        userAvatarUrl={storedAvatarUrl}
        threadId={threadId}
      />

      <Banner
        visible
        actions={[]}
        icon="archive-outline"
        style={{ backgroundColor: theme.colors.surfaceVariant }}
      >
        <Text style={{ color: theme.colors.onSurfaceVariant }}>
          Esta sessão foi encerrada e está em modo somente leitura.
        </Text>
      </Banner>

      <View style={styles.footer}>
        <Button mode="contained" onPress={() => router.push('/(tabs)')}>
          Iniciar Nova Anamnese
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  footer: {
    padding: 16,
  },
});
