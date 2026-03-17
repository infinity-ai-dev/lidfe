import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Image, Platform, StyleSheet, TouchableOpacity, View, Alert } from 'react-native';
import { Banner, Button, Card, IconButton, ProgressBar, Text, TextInput, useTheme } from 'react-native-paper';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { useChat } from '@/hooks/useChat';
import { useFontScale } from '@/hooks/useFontScale';
import { ChatMessagesList } from '@/components/chat/ChatMessagesList';
import { AudioRecorderButton } from '@/components/chat/AudioRecorderButton';
import { FileUploadButton, FileUploadResult } from '@/components/chat/FileUploadButton';
import { databaseService } from '@/services/supabase/database/tables';
import { supabase } from '@/services/supabase/client';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { MaterialIcons } from '@expo/vector-icons';

type ExamSummary = {
  id: number;
  titulo?: string;
  urlpdf?: string | null;
  created_at: string;
  id_threadconversa?: string | null;
};

type SessionMeta = {
  completedAt?: string;
  expiresAt?: string;
};

const SESSION_EXPIRY_MS = 30 * 60 * 1000;

export default function PainelDeControleScreen() {
  const theme = useTheme();
  const { scale } = useFontScale();
  const { user } = useAuth();
  const router = useRouter();
  const threadIdFromStore = useAppStore((state) => state.idthreadConversa);
  const setIdthreadConversa = useAppStore((state) => state.setIdthreadConversa);
  const storedAvatarUrl = useAppStore((state) => state.urlimageavatar);
  const threadId = threadIdFromStore;

  useEffect(() => {
    if (user?.id && !threadIdFromStore) {
      setIdthreadConversa(`anamnese:${user.id}`);
    }
  }, [user?.id, threadIdFromStore, setIdthreadConversa]);
  
  // Chamar o hook useChat com threadId
  const {
    messages,
    isLoading,
    isSending,
    isRateLimited,
    rateLimitSeconds,
    sendMessage,
    sendAudioMessage,
    sendFileMessage,
    refreshMessages,
  } = useChat(threadId || `anamnese:${user?.id || ''}`);
  
  const [inputText, setInputText] = useState('');
  const hasText = inputText.trim().length > 0;
  const [nome, setNome] = useState<string>('-');
  const [fotoPerfil, setFotoPerfil] = useState<string | null>(null);
  const [examSummary, setExamSummary] = useState<ExamSummary[]>([]);
  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadProfile = async () => {
      if (!user?.id) return;
      const { data, error } = await databaseService.usuarios.getByUserId(user.id);
      if (!mounted) return;
      if (!error && data) {
        setNome(((data as any)?.nome ?? (data as any)?.['nome completo'] ?? '-') as string);
        const profileAvatar =
          ((data as any)?.fotoPerfil as string | null | undefined) ||
          ((data as any)?.avatar_url as string | null | undefined) ||
          null;
        setFotoPerfil(profileAvatar);
      }
    };
    loadProfile();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const chatAvatarUrl =
    (fotoPerfil || '').trim() ||
    (storedAvatarUrl || '').trim() ||
    null;

  const sessionMetaKey = threadId ? `lidfe:chat:session_meta:${threadId}` : null;

  useEffect(() => {
    setExamSummary([]);
    setSessionMeta(null);
    setSessionExpired(false);
  }, [threadId]);

  const loadSessionMeta = useCallback(async () => {
    if (!sessionMetaKey) {
      setSessionMeta(null);
      return;
    }
    try {
      let raw: string | null = null;
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        raw = window.localStorage.getItem(sessionMetaKey);
      } else {
        raw = await SecureStore.getItemAsync(sessionMetaKey);
      }
      if (!raw) {
        setSessionMeta(null);
        return;
      }
      const parsed = JSON.parse(raw) as SessionMeta;
      setSessionMeta(parsed || null);
    } catch (error) {
      console.warn('[CHAT] Erro ao carregar meta de sessão:', error);
      setSessionMeta(null);
    }
  }, [sessionMetaKey]);

  const saveSessionMeta = useCallback(
    async (meta: SessionMeta | null) => {
      if (!sessionMetaKey) return;
      try {
        if (!meta) {
          if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.removeItem(sessionMetaKey);
          } else {
            await SecureStore.deleteItemAsync(sessionMetaKey);
          }
          return;
        }
        const payload = JSON.stringify(meta);
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(sessionMetaKey, payload);
        } else {
          await SecureStore.setItemAsync(sessionMetaKey, payload);
        }
      } catch (error) {
        console.warn('[CHAT] Erro ao salvar meta de sessão:', error);
      }
    },
    [sessionMetaKey]
  );

  useEffect(() => {
    void loadSessionMeta();
  }, [loadSessionMeta]);

  useEffect(() => {
    if (!sessionMeta?.expiresAt) {
      setSessionExpired(false);
      return;
    }
    const expiresAt = new Date(sessionMeta.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) {
      setSessionExpired(false);
      return;
    }

    const update = () => {
      setSessionExpired(Date.now() >= expiresAt);
    };
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [sessionMeta?.expiresAt]);

  const fetchExamSummary = useCallback(async () => {
    if (!user?.id || !threadId) return;
    try {
      setSummaryLoading(true);
      const { data, error } = await supabase
        .from('tasks_listaexames')
        .select('id, titulo, urlpdf, created_at, id_threadconversa')
        .eq('user_id', user.id)
        .eq('id_threadconversa', threadId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setExamSummary((data || []) as ExamSummary[]);
    } catch (error) {
      console.warn('[CHAT] Erro ao buscar resumo de exames:', error);
    } finally {
      setSummaryLoading(false);
    }
  }, [threadId, user?.id]);

  useEffect(() => {
    void fetchExamSummary();
  }, [fetchExamSummary]);

  useEffect(() => {
    if (!user?.id || !threadId) return;

    let channel: any;
    let isMounted = true;

    const setupSubscription = async () => {
      try {
        channel = supabase
          .channel(`tasks-exames-chat-${threadId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'tasks_listaexames',
              filter: `user_id=eq.${user.id}`,
            },
            (payload) => {
              if (!isMounted) return;
              const record = (payload.new || payload.old) as any;
              if (record?.id_threadconversa !== threadId) return;
              void fetchExamSummary();
            }
          )
          .subscribe();
      } catch (error) {
        console.warn('[CHAT] Falha ao assinar guias de exames:', error);
      }
    };

    setupSubscription();

    return () => {
      isMounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [fetchExamSummary, threadId, user?.id]);

  const guidesReady = useMemo(() => {
    return examSummary.some((exam) => (exam.urlpdf || '').trim().length > 0);
  }, [examSummary]);

  useEffect(() => {
    if (sessionMeta?.completedAt) return;
    if (examSummary.length === 0) return;
    const now = new Date();
    const nextMeta: SessionMeta = {
      completedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_EXPIRY_MS).toISOString(),
    };
    setSessionMeta(nextMeta);
    void saveSessionMeta(nextMeta);
  }, [examSummary.length, saveSessionMeta, sessionMeta?.completedAt]);

  const handleStartNewSession = useCallback(async () => {
    if (!user?.id) return;
    const newThreadId = `anamnese:${user.id}:${Date.now()}`;
    setInputText('');
    setExamSummary([]);
    setSessionMeta(null);
    setSessionExpired(false);
    await saveSessionMeta(null);
    setIdthreadConversa(newThreadId);
    try {
      await databaseService.usuarios.update(user.id, { id_threadconversa: newThreadId });
    } catch (error) {
      console.warn('[CHAT] Erro ao atualizar nova thread:', error);
    }
  }, [saveSessionMeta, setIdthreadConversa, user?.id]);

  const handleOpenHistory = useCallback(() => {
    router.push('/(tabs)/anamnese-historico');
  }, [router]);

  const isSessionClosed = Boolean(sessionMeta?.completedAt);
  // Calcular estado das guias primeiro (usado abaixo)
  const hasExamSummary = examSummary.length > 0;
  const readyCount = examSummary.filter((exam) => (exam.urlpdf || '').trim().length > 0).length;
  // Sessão só é bloqueada se expirou E todas as guias já foram geradas (ou não há guias)
  const allGuidesReady = hasExamSummary ? readyCount === examSummary.length : true;
  const isSessionLocked = sessionExpired && allGuidesReady;
  const progressValue = hasExamSummary ? Math.min(1, readyCount / examSummary.length) : 0;

  const handleSend = async () => {
    if (isSessionLocked) {
      Alert.alert(
        'Sessão encerrada',
        'Esta sessão foi encerrada. Para novos sintomas, inicie uma nova anamnese.'
      );
      return;
    }
    if (!inputText.trim() || isSending || isRateLimited) return;

    const text = inputText.trim();
    setInputText('');
    await sendMessage(text, 'text');
  };

  const handleKeyPress = (event: any) => {
    if (!hasText) return;
    const key = event?.nativeEvent?.key;
    const shiftKey = event?.nativeEvent?.shiftKey;
    if (key === 'Enter' && !shiftKey) {
      event?.preventDefault?.();
      void handleSend();
    }
  };

  const handleAudioRecorded = async (audioBase64: string) => {
    if (isSessionLocked) return;
    await sendAudioMessage(audioBase64);
  };

  const handleAudioDeleted = () => {
    // Áudio deletado, não fazer nada
  };

  const handleRecordingStateChanged = (isRecording: boolean) => {
    // Pode adicionar feedback visual aqui se necessário
  };

  const handleFileSelected = async (file: FileUploadResult) => {
    if (!user?.id || !threadId || isSending || isRateLimited || isSessionLocked) return;

    try {
      if (!file.base64) {
        alert('Não foi possível ler o arquivo. Tente novamente.');
        return;
      }

      await sendFileMessage({
        base64: file.base64,
        fileType: file.type,
        fileMimeType: file.mimeType,
        fileName: file.name,
        fileSize: file.size,
        message: `Enviei um ${file.type === 'pdf' ? 'PDF' : 'exame de imagem'} para análise.`,
      });
    } catch (error: any) {
      console.error('[CHAT] Erro ao processar arquivo:', error);
      alert('Erro ao processar arquivo. Tente novamente.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header do Painel (alinhado com Flutter PaineldeControle) */}
      <View style={styles.headerOuter}>
        <View style={styles.headerInner}>
          {fotoPerfil && fotoPerfil.trim() !== '' ? (
            <Image
              source={{ uri: fotoPerfil }}
              style={styles.headerAvatar}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder, { backgroundColor: theme.colors.primaryContainer }]}>
              <MaterialIcons name="account-circle" size={50} color={theme.colors.onPrimaryContainer} />
            </View>
          )}

          <View style={styles.headerTextCol}>
            <View style={styles.headerTitleRow}>
              <Image
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                source={require('../../../assets/images/logo_LIDFE_new-Photoroom.png')}
                style={styles.headerLogo}
                resizeMode="cover"
              />
              <Text style={[styles.headerTitle, { color: theme.colors.onBackground, fontSize: scale(18) }]}>
                Olá, {nome}
              </Text>
            </View>
            <Text style={[styles.headerSubtitle, { color: theme.colors.onSurfaceVariant, fontSize: scale(14) }]}>
              Seja Bem vindo ao seu Personal Health Hub!
            </Text>
          </View>
        </View>
      </View>

      {isSessionLocked ? (
        <View style={styles.emptySessionContainer}>
          <Text style={[styles.emptySessionIcon, { color: theme.colors.primary, fontSize: scale(42) }]}>
            🩺
          </Text>
          <Text style={[styles.emptySessionTitle, { color: theme.colors.onBackground, fontSize: scale(20) }]}>
            Sessão encerrada
          </Text>
          <Text style={[styles.emptySessionText, { color: theme.colors.onSurfaceVariant }]}>
            Esta anamnese foi concluída e arquivada. Para novos sintomas, inicie uma nova anamnese.
          </Text>
          <Button
            mode="contained"
            onPress={handleStartNewSession}
            style={styles.emptySessionButton}
          >
            Iniciar Nova Anamnese
          </Button>
          <Button
            mode="outlined"
            onPress={() => router.push('/(tabs)/exames')}
          >
            Ver Guias de Exames
          </Button>
          <Button
            mode="text"
            onPress={handleOpenHistory}
          >
            Ver Histórico de Anamneses
          </Button>
        </View>
      ) : isSessionClosed && !allGuidesReady ? (
        <View style={styles.emptySessionContainer}>
          <Text style={[styles.emptySessionIcon, { color: theme.colors.primary, fontSize: scale(42) }]}>
            ⏳
          </Text>
          <Text style={[styles.emptySessionTitle, { color: theme.colors.onBackground, fontSize: scale(20) }]}>
            Aguardando seus exames
          </Text>
          <Text style={[styles.emptySessionText, { color: theme.colors.onSurfaceVariant }]}>
            Sua anamnese foi concluída e as guias de exames estão sendo geradas. Você pode acompanhar o progresso abaixo.
          </Text>
          <ProgressBar
            progress={progressValue}
            color={theme.colors.primary}
            style={{ height: 6, borderRadius: 999, marginBottom: 16, width: '100%' }}
          />
          <Text style={[{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }]}>
            {readyCount} de {examSummary.length} guia{examSummary.length > 1 ? 's' : ''} pronta{readyCount > 1 ? 's' : ''}
          </Text>
          <Button
            mode="contained"
            icon="download"
            onPress={() => router.push('/(tabs)/exames')}
            style={styles.emptySessionButton}
          >
            Ver Guias de Exames
          </Button>
          <Button
            mode="outlined"
            onPress={handleStartNewSession}
          >
            Iniciar Nova Anamnese
          </Button>
          <Button
            mode="text"
            onPress={handleOpenHistory}
          >
            Ver Histórico de Anamneses
          </Button>
        </View>
      ) : (
        <ChatMessagesList
          messages={messages}
          isLoading={isLoading}
          onRefresh={refreshMessages}
          userAvatarUrl={chatAvatarUrl}
          threadId={threadId || `anamnese:${user?.id || ''}`}
          footerComponent={
            isSessionClosed ? (
              <Card style={styles.summaryCard}>
                <Card.Content>
                  <View style={styles.summaryHeader}>
                    <MaterialIcons name="check-circle" size={22} color="#2E7D32" />
                    <Text style={[styles.summaryTitle, { color: theme.colors.onSurface, fontSize: scale(16) }]}>
                      Anamnese concluída com sucesso!
                    </Text>
                  </View>

                  <View style={styles.summarySteps}>
                    <View style={styles.summaryStepRow}>
                      <MaterialIcons
                        name="check-circle"
                        size={18}
                        color="#2E7D32"
                      />
                      <Text style={[styles.summaryStepText, { color: theme.colors.onSurfaceVariant, fontSize: scale(13) }]}>
                        Anamnese concluída
                      </Text>
                    </View>
                    <View style={styles.summaryStepRow}>
                      <MaterialIcons
                        name={hasExamSummary ? 'check-circle' : 'progress-clock'}
                        size={18}
                        color={hasExamSummary ? '#2E7D32' : theme.colors.primary}
                      />
                      <Text style={[styles.summaryStepText, { color: theme.colors.onSurfaceVariant, fontSize: scale(13) }]}>
                        Revisão médica em curso
                      </Text>
                    </View>
                    <View style={styles.summaryStepRow}>
                      <MaterialIcons
                        name={guidesReady ? 'check-circle' : 'progress-clock'}
                        size={18}
                        color={guidesReady ? '#2E7D32' : theme.colors.primary}
                      />
                      <Text style={[styles.summaryStepText, { color: theme.colors.onSurfaceVariant, fontSize: scale(13) }]}>
                        Gerando guias
                      </Text>
                    </View>
                  </View>

                  <ProgressBar
                    progress={progressValue}
                    color={theme.colors.primary}
                    style={styles.summaryProgress}
                  />

                  {summaryLoading ? (
                    <Text style={[styles.summaryHint, { color: theme.colors.onSurfaceVariant, fontSize: scale(12) }]}>
                      Carregando guias...
                    </Text>
                  ) : null}

                  <View style={styles.summaryActions}>
                    <Button
                      mode="contained"
                      onPress={handleStartNewSession}
                    >
                      Iniciar Nova Anamnese
                    </Button>
                    <Button
                      mode="contained"
                      icon="download"
                      onPress={() => router.push('/(tabs)/exames')}
                    >
                      Ver Guias de Exames
                    </Button>
                    <Button
                      mode="outlined"
                      onPress={handleOpenHistory}
                    >
                      Histórico de Anamneses
                    </Button>
                  </View>

                  {hasExamSummary ? (
                    <View style={styles.summaryList}>
                      <Text style={[styles.summaryListTitle, { color: theme.colors.onSurface, fontSize: scale(14) }]}>
                        Guia de exames gerada
                      </Text>
                      {examSummary.slice(0, 5).map((exam) => (
                        <Text
                          key={`exam-${exam.id}`}
                          style={[styles.summaryListItem, { color: theme.colors.onSurfaceVariant, fontSize: scale(13) }]}
                        >
                          • {exam.titulo || 'Exame solicitado'}
                        </Text>
                      ))}
                      {examSummary.length > 5 && (
                        <Text style={[styles.summaryListItem, { color: theme.colors.onSurfaceVariant, fontSize: scale(13) }]}>
                          • +{examSummary.length - 5} exames adicionais
                        </Text>
                      )}
                    </View>
                  ) : null}
                </Card.Content>
              </Card>
            ) : null
          }
        />
      )}

      {/* Aviso fixo sobre tempo de processamento do agente */}
      {!isSessionLocked && (
        <Banner
          visible
          actions={[]}
          icon="information-outline"
          style={{ backgroundColor: theme.colors.surfaceVariant }}
        >
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            O processamento das mensagens pode levar até 5 minutos. Por favor, aguarde.
          </Text>
        </Banner>
      )}

      {isSessionClosed && isSessionLocked && (
        <Banner
          visible
          actions={[]}
          icon="alert-circle-outline"
          style={{ backgroundColor: theme.colors.errorContainer }}
        >
          <Text style={{ color: theme.colors.onErrorContainer }}>
            Esta sessão foi encerrada. Para novos sintomas, inicie uma nova anamnese.
          </Text>
        </Banner>
      )}

      {isSessionClosed && !isSessionLocked && !allGuidesReady && (
        <Banner
          visible
          actions={[]}
          icon="progress-clock"
          style={{ backgroundColor: theme.colors.primaryContainer }}
        >
          <Text style={{ color: theme.colors.onPrimaryContainer }}>
            Suas guias de exames estão sendo geradas. Aguarde alguns instantes.
          </Text>
        </Banner>
      )}

      {/* Banner de aviso de rate limit */}
      {isRateLimited && (
        <Banner
          visible={isRateLimited}
          actions={[]}
          icon="clock-alert-outline"
          style={{ backgroundColor: theme.colors.errorContainer }}
        >
          <Text style={{ color: theme.colors.onErrorContainer }}>
            Limite de requisições excedido. Aguarde {rateLimitSeconds} segundo{rateLimitSeconds !== 1 ? 's' : ''} antes de tentar novamente.
          </Text>
        </Banner>
      )}

      <View style={styles.inputDock}>
        <View
          style={[
            styles.inputContainer,
            { 
              backgroundColor: theme.colors.surface,
              opacity: (isRateLimited || isSessionLocked) ? 0.5 : 1,
            },
          ]}
        >
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder={
              isSessionLocked
                ? 'Sessão encerrada. Inicie uma nova anamnese.'
                : isRateLimited
                ? 'Aguarde o tempo de espera...'
                : 'Digite sua mensagem...'
            }
            mode="outlined"
            outlineStyle={styles.inputOutline}
            multiline
            maxLength={1000}
            style={styles.input}
            disabled={isSending || isRateLimited || isSessionLocked}
            editable={!isRateLimited && !isSessionLocked}
            onSubmitEditing={handleSend}
            onKeyPress={handleKeyPress}
          />
          {/* Botões de ação: anexar arquivo, microfone quando vazio, envio quando há texto. */}
          <View style={styles.actionButtonsContainer}>
            <View style={{ opacity: (isRateLimited || isSessionLocked) ? 0.5 : 1 }}>
              <FileUploadButton
                onFileSelected={handleFileSelected}
                disabled={isSending || isRateLimited || isSessionLocked}
              />
            </View>
            {hasText ? (
              <TouchableOpacity
                onPress={handleSend}
                disabled={isSending || isRateLimited || isSessionLocked}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.textActionButton,
                    { 
                      backgroundColor: theme.colors.primary, 
                      opacity: (isSending || isRateLimited || isSessionLocked) ? 0.6 : 1 
                    },
                  ]}
                >
                  <IconButton
                    icon="send"
                    iconColor={theme.colors.onPrimary}
                    size={24}
                    disabled={isSending || isRateLimited || isSessionLocked}
                    containerColor="transparent"
                    style={{ backgroundColor: 'transparent' }}
                  />
                </View>
              </TouchableOpacity>
            ) : (
              <View style={{ opacity: (isRateLimited || isSessionLocked) ? 0.5 : 1 }}>
                <AudioRecorderButton
                  onAudioRecorded={handleAudioRecorded}
                  onAudioDeleted={handleAudioDeleted}
                  disabled={isRateLimited || isSessionLocked}
                  onRecordingStateChanged={handleRecordingStateChanged}
                />
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerOuter: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  headerInner: {
    height: 100,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerAvatar: {
    width: 70,
    height: 70,
    borderRadius: 999,
  },
  headerAvatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerTextCol: {
    flex: 1,
    marginLeft: 12,
    paddingTop: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogo: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    marginTop: 8,
    fontSize: 14,
  },
  emptySessionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptySessionIcon: {
    fontSize: 42,
    marginBottom: 12,
  },
  emptySessionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySessionText: {
    textAlign: 'center',
    marginBottom: 20,
  },
  emptySessionButton: {
    marginBottom: 12,
  },
  summaryCard: {
    marginHorizontal: 16,
    borderRadius: 16,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  summarySteps: {
    gap: 8,
    marginBottom: 12,
  },
  summaryStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryStepText: {
    fontSize: 13,
  },
  summaryProgress: {
    height: 6,
    borderRadius: 999,
    marginBottom: 8,
  },
  summaryHint: {
    fontSize: 12,
    marginBottom: 8,
  },
  summaryList: {
    marginTop: 8,
    marginBottom: 12,
  },
  summaryListTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  summaryListItem: {
    fontSize: 13,
    marginBottom: 2,
  },
  summaryActions: {
    gap: 8,
    marginTop: 12,
  },
  inputDock: {
    // Em Flutter, o input fica no rodapé da coluna.
    paddingBottom: Platform.OS === 'ios' ? 12 : 0,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
    borderRadius: 24,
  },
  input: {
    flex: 1,
    marginRight: 8,
    maxHeight: 100,
  },
  inputOutline: {
    borderRadius: 24,
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  audioButtonContainer: {
    marginLeft: 8,
  },
  textActionButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
