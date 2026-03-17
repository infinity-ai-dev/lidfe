import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, IconButton, Text, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useFontScale } from '@/hooks/useFontScale';
import { useAppStore } from '@/store/appStore';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const MAX_HISTORY_ROWS = 500;

type SessionSummary = {
  threadId: string;
  lastMessage: string;
  lastAt: string;
  messageCount: number;
};

export default function AnamneseHistoricoScreen() {
  const theme = useTheme();
  const { scale } = useFontScale();
  const router = useRouter();
  const { user } = useAuth();
  const currentThreadId = useAppStore((state) => state.idthreadConversa);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingThreadId, setDownloadingThreadId] = useState<string | null>(null);

  const buildSessions = useCallback((rows: Array<any>) => {
    const map = new Map<string, SessionSummary>();

    rows.forEach((row) => {
      const threadId = row.id_threadconversa as string;
      if (!threadId) return;

      const current = map.get(threadId);
      if (!current) {
        const messageText = row.type === 'audio'
          ? 'Mensagem de áudio'
          : 'Sessão de anamnese concluída.';
        map.set(threadId, {
          threadId,
          lastMessage: messageText,
          lastAt: row.created_at || new Date().toISOString(),
          messageCount: 1,
        });
        return;
      }

      current.messageCount += 1;
    });

    return Array.from(map.values()).sort((a, b) => {
      return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
    });
  }, []);

  const loadSessions = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('anamnesechathistorico')
        .select('id_threadconversa, created_at, type')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(MAX_HISTORY_ROWS);

      if (error) throw error;

      const rows = (data || []) as Array<any>;
      setSessions(buildSessions(rows));
    } catch (error) {
      console.warn('[HISTORICO] Erro ao carregar sessões:', error);
    } finally {
      setLoading(false);
    }
  }, [buildSessions, user?.id]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  }, [loadSessions]);

  const formatDate = useCallback((value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  }, []);

  const formatTime = useCallback((value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return format(date, 'HH:mm', { locale: ptBR });
  }, []);

  const emptyState = useMemo(() => !loading && sessions.length === 0, [loading, sessions.length]);

  const handleOpenSession = (threadId: string) => {
    router.push({
      pathname: '/(tabs)/anamnese-historico/[threadId]',
      params: { threadId },
    });
  };

  const handleOpenExames = (threadId: string) => {
    router.push({
      pathname: '/(tabs)/exames',
      params: { threadId: encodeURIComponent(threadId) },
    });
  };

  const buildTranscript = (rows: Array<any>) => {
    return rows
      .map((row) => {
        const createdAt = row.created_at ? new Date(row.created_at) : null;
        const timestamp = createdAt && !Number.isNaN(createdAt.getTime())
          ? format(createdAt, "dd/MM/yyyy HH:mm", { locale: ptBR })
          : '--/--/---- --:--';
        const roleLabel = row.role === 'user' ? 'Paciente' : 'Assistente';
        const type = row.type || 'text';

        if (type === 'audio') {
          const fileLabel = row.file_name ? ` - ${row.file_name}` : '';
          return `[${timestamp}] ${roleLabel}: [Mensagem de áudio${fileLabel}]`;
        }

        if (type === 'file') {
          const fileLabel = row.file_name ? ` - ${row.file_name}` : '';
          const urlLabel = row.message ? ` (${row.message})` : '';
          return `[${timestamp}] ${roleLabel}: [Arquivo${fileLabel}]${urlLabel}`;
        }

        return `[${timestamp}] ${roleLabel}: ${row.message || ''}`;
      })
      .join('\n');
  };

  const handleDownloadSession = async (session: SessionSummary) => {
    if (!user?.id) return;
    try {
      setDownloadingThreadId(session.threadId);
      const { data, error } = await supabase
        .from('anamnesechathistorico')
        .select('created_at, role, message, type, file_name')
        .eq('user_id', user.id)
        .eq('id_threadconversa', session.threadId)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      const rows = (data || []) as Array<any>;
      const transcript = buildTranscript(rows);
      const safeDate = format(new Date(session.lastAt), 'yyyy-MM-dd', { locale: ptBR });
      const fileName = `anamnese-${safeDate}.txt`;

      if (Platform.OS === 'web') {
        if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
          Alert.alert('Download indisponível', 'Este navegador não suporta download automático.');
          return;
        }
        const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, transcript, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'text/plain',
            dialogTitle: 'Baixar anamnese',
          });
        } else {
          Alert.alert('Arquivo gerado', `Arquivo salvo em: ${fileUri}`);
        }
      }
    } catch (error) {
      console.warn('[HISTORICO] Erro ao baixar anamnese:', error);
      Alert.alert('Erro ao baixar', 'Não foi possível gerar o arquivo da anamnese.');
    } finally {
      setDownloadingThreadId(null);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.primary}
        />
      }
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.onBackground, fontSize: scale(22) }]}>
          Histórico de Anamneses
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant, fontSize: scale(14) }]}
        >
          Consulte sessões anteriores já concluídas.
        </Text>
      </View>

      {emptyState ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyIcon, { fontSize: scale(48) }]}>📝</Text>
          <Text style={[styles.emptyTitle, { color: theme.colors.onBackground, fontSize: scale(18) }]}>
            Nenhuma anamnese encontrada
          </Text>
          <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant, fontSize: scale(14) }]}>
            Quando você finalizar uma anamnese, ela aparecerá aqui para consulta.
          </Text>
          <Button mode="contained" onPress={() => router.push('/(tabs)')}>
            Iniciar Nova Anamnese
          </Button>
        </View>
      ) : (
        <View style={styles.list}>
          {sessions.map((session) => {
            const isCurrent = session.threadId === currentThreadId;
            return (
              <Card
                key={session.threadId}
                style={[styles.card, isCurrent ? styles.cardCurrent : null]}
              >
                <Card.Content>
                  <View style={styles.cardHeaderRow}>
                    <Text
                      style={[styles.cardTitle, { color: theme.colors.onSurface, fontSize: scale(16) }]}
                    >
                      Anamnese - {formatDate(session.lastAt)}
                    </Text>
                    <Chip
                      compact
                      mode={isCurrent ? 'flat' : 'outlined'}
                      style={[
                        styles.cardChip,
                        isCurrent ? { backgroundColor: theme.colors.primaryContainer } : null,
                      ]}
                      textStyle={{
                        color: isCurrent
                          ? theme.colors.onPrimaryContainer
                          : theme.colors.onSurfaceVariant,
                      }}
                    >
                      {isCurrent ? 'Sessão atual' : 'Arquivada'}
                    </Chip>
                  </View>
                  <Text style={[styles.cardMeta, { color: theme.colors.onSurfaceVariant, fontSize: scale(12) }]}
                  >
                    {formatTime(session.lastAt)} · {session.messageCount} mensagens
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[styles.cardSnippet, { color: theme.colors.onSurfaceVariant, fontSize: scale(13) }]}
                  >
                    {session.lastMessage || 'Sessão concluída.'}
                  </Text>
                  <View style={styles.cardActions}>
                    <View style={styles.cardIconRow}>
                      <IconButton
                        icon="chat-outline"
                        onPress={() => handleOpenSession(session.threadId)}
                        accessibilityLabel="Abrir conversa"
                      />
                      <IconButton
                        icon="download"
                        onPress={() => handleDownloadSession(session)}
                        accessibilityLabel="Baixar anamnese"
                        disabled={downloadingThreadId === session.threadId}
                      />
                      <IconButton
                        icon="format-list-bulleted"
                        onPress={() => handleOpenExames(session.threadId)}
                        accessibilityLabel="Ver lista de exames"
                      />
                    </View>
                    {isCurrent ? (
                      <Button mode="contained" onPress={() => router.push('/(tabs)')}>
                        Sessão atual
                      </Button>
                    ) : null}
                  </View>
                </Card.Content>
              </Card>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    borderRadius: 16,
  },
  cardCurrent: {
    borderWidth: 1,
    borderColor: '#2F80ED',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  cardChip: {
    alignSelf: 'flex-start',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 12,
    marginBottom: 8,
  },
  cardSnippet: {
    fontSize: 13,
    marginBottom: 12,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  cardIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -8,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
});
