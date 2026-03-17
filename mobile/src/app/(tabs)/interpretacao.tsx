import { useState, useEffect } from 'react';
import { Platform, StyleSheet, View, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Text, useTheme, Button, SegmentedButtons, ActivityIndicator, Card, Chip } from 'react-native-paper';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/services/supabase/client';
import { exameAnalysisService } from '@/services/exame-analysis';
import { useFontScale } from '@/hooks/useFontScale';
import { useAppStore } from '@/store/appStore';

interface ExameSugerido {
  id: number;
  titulo?: string;
  descricao?: string;
  urgencia?: string;
  created_at: string;
  urlfoto?: string;
}

export default function InterpretacaoScreen() {
  const theme = useTheme();
  const { scale } = useFontScale();
  const router = useRouter();
  const { exameId } = useLocalSearchParams<{ exameId?: string }>();
  const [mode, setMode] = useState<'foto' | 'pdf'>('foto');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('Aguardando envio.');
  const [resultText, setResultText] = useState<string>('');
  const [lastFileUrl, setLastFileUrl] = useState<string | null>(null);
  const [fontes, setFontes] = useState<{ titulo: string; url?: string; tipo: string }[]>([]);
  const [examesSugeridos, setExamesSugeridos] = useState<ExameSugerido[]>([]);
  const [exameSelecionado, setExameSelecionado] = useState<number | null>(null);
  const [anamneseUploading, setAnamneseUploading] = useState(false);
  const [anamneseStatus, setAnamneseStatus] = useState('');
  const [anamneseError, setAnamneseError] = useState<string | null>(null);

  const isWeb = Platform.OS === 'web';
  const threadId = useAppStore((state) => state.idthreadConversa);

  // Carregar exames sugeridos pelo agente
  useEffect(() => {
    loadExamesSugeridos();
  }, []);

  // Pré-selecionar exame quando a tela é aberta a partir do card de exames
  useEffect(() => {
    if (exameId) {
      const parsedId = parseInt(exameId, 10);
      if (!Number.isNaN(parsedId)) {
        setExameSelecionado(parsedId);
      }
    }
  }, [exameId]);

  // Carregar interpretação já existente quando o exame é selecionado
  useEffect(() => {
    if (exameSelecionado) {
      loadInterpretacaoSelecionada(exameSelecionado);
    }
  }, [exameSelecionado]);

  const loadExamesSugeridos = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Buscar exames sugeridos que ainda não foram analisados
      const { data, error } = await supabase
        .from('tasks_listaexames')
        .select('id, titulo, descricao, urgencia, created_at, urlfoto')
        .eq('user_id', user.id)
        .is('urlfoto', null) // Apenas exames sem arquivo enviado
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      // Também buscar exames com urlfoto mas sem análise concluída
      const { data: examesComArquivo } = await supabase
        .from('tasks_listaexames')
        .select('id, titulo, descricao, urgencia, created_at, urlfoto')
        .eq('user_id', user.id)
        .not('urlfoto', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);

      // Verificar quais exames com arquivo não têm análise concluída
      let examesPendentes: ExameSugerido[] = [];
      if (examesComArquivo && examesComArquivo.length > 0) {
        const { data: analisesConcluidas } = await supabase
          .from('analises_exames')
          .select('url_arquivo')
          .eq('user_id', user.id)
          .eq('status', 'concluida');

        const urlsAnalisadas = new Set(
          (analisesConcluidas || []).map((a) => a.url_arquivo)
        );

        // Filtrar exames que têm arquivo mas não têm análise concluída
        examesPendentes = examesComArquivo.filter(
          (e) => e.urlfoto && !urlsAnalisadas.has(e.urlfoto)
        ) as ExameSugerido[];
      }

      // Combinar exames sem arquivo com exames pendentes de análise
      setExamesSugeridos([...(data || []), ...examesPendentes]);
    } catch (error) {
      console.error('[Interpretacao] Erro ao carregar exames sugeridos:', error);
    }
  };

  const loadInterpretacaoSelecionada = async (taskExameId: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('tasks_listaexames')
        .select('interpretacao, fontes, urlfoto')
        .eq('user_id', user.id)
        .eq('id', taskExameId)
        .single();

      if (error) {
        console.error('[Interpretacao] Erro ao carregar interpretação:', error);
        return;
      }

      // Atualizar estado para exibir interpretação já gerada
      if (data?.interpretacao) {
        setResultText(data.interpretacao);
      }
      if (data?.fontes && Array.isArray(data.fontes)) {
        setFontes(data.fontes);
      }
      if (data?.urlfoto) {
        setLastFileUrl(data.urlfoto);
      }
    } catch (error) {
      console.error('[Interpretacao] Erro ao buscar interpretação existente:', error);
    }
  };

  const getThreadDate = (value?: string | null) => {
    if (!value) return null;
    const parts = value.split(':');
    const last = parts[parts.length - 1];
    const timestamp = Number(last);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };

  const anamneseDateLabel = (() => {
    const threadDate = getThreadDate(threadId);
    if (!threadDate) return 'anamnese atual';
    try {
      return threadDate.toLocaleDateString('pt-BR');
    } catch {
      return 'anamnese atual';
    }
  })();

  const pickFileWeb = (accept: string): Promise<File | null> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';

      let resolved = false;
      const cleanup = () => {
        if (input.parentNode) input.parentNode.removeChild(input);
      };

      input.onchange = () => {
        resolved = true;
        const file = input.files?.[0] ?? null;
        cleanup();
        resolve(file);
      };

      // Detectar cancelamento: quando a janela recupera o foco sem ter selecionado arquivo
      const handleFocus = () => {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(null);
          }
        }, 500);
      };
      window.addEventListener('focus', handleFocus, { once: true });

      document.body.appendChild(input);
      input.click();
    });
  };

  const fileToBase64 = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result || '');
        // res: data:<mime>;base64,<base64>
        const base64 = res.includes(',') ? res.split(',')[1] : res;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
      reader.readAsDataURL(file);
    });
  };

  const uploadViaEdgeFunction = async (file: File) => {
    const base64 = await fileToBase64(file);
    const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

    // Edge function que faz upload nos buckets corretos e devolve URL pública
    const { data, error } = await supabase.functions.invoke('upload-exame', {
      body: {
        file_base64: base64,
        filename: file.name,
        mime_type: mime,
        file_size: file.size,
      },
    });
    if (error) throw new Error(error.message);
    if (!data?.file_url) throw new Error('Upload falhou: URL não retornada');
    return {
      fileUrl: data.file_url as string,
      mimeType: mime,
      storageBucket: (data as any)?.bucket ?? null,
      storagePath: (data as any)?.storage_path ?? null,
    };
  };

  const handleUploadAnamneseGeral = async (mode: 'pdf' | 'image') => {
    if (!isWeb) {
      Alert.alert('Envio disponível apenas na versão web', 'Abra a versão web para enviar exames.');
      return;
    }
    if (!threadId) {
      Alert.alert('Sessão não encontrada', 'Inicie ou selecione uma anamnese para enviar resultados.');
      return;
    }

    try {
      setAnamneseUploading(true);
      setAnamneseError(null);
      setAnamneseStatus('Selecionando arquivo...');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      const accept = mode === 'pdf' ? 'application/pdf' : 'image/*';
      const file = await pickFileWeb(accept);
      if (!file) {
        setAnamneseStatus('Envio cancelado.');
        return;
      }

      setAnamneseStatus('Enviando arquivo...');
      const { fileUrl, mimeType } = await uploadViaEdgeFunction(file);

      setAnamneseStatus('Processando interpretação...');
      const fileType = mimeType === 'application/pdf' ? 'pdf' : 'image';
      const titulo = `Resultados da anamnese (${anamneseDateLabel})`;

      const uploadRecordPromise = supabase
        .from('exames_resultados')
        .insert({
          user_id: user.id,
          id_threadconversa: threadId,
          titulo,
          file_url: fileUrl,
          file_name: file.name,
          mime_type: mimeType,
          file_type: fileType,
          source: 'anamnese_geral',
        });

      const analysisPromise = exameAnalysisService.analyzeExame({ fileUrl, fileType });

      const [analysisOutcome, uploadOutcome] = await Promise.allSettled([
        analysisPromise,
        uploadRecordPromise,
      ]);

      if (uploadOutcome.status === 'fulfilled' && uploadOutcome.value?.error) {
        console.warn('[Interpretacao] Erro ao registrar upload da anamnese:', uploadOutcome.value.error);
      }
      if (uploadOutcome.status === 'rejected') {
        console.warn('[Interpretacao] Falha ao registrar upload da anamnese:', uploadOutcome.reason);
      }

      if (analysisOutcome.status === 'rejected') {
        throw analysisOutcome.reason;
      }

      setAnamneseStatus('Upload concluído. Confira em Exames Analisados.');
    } catch (e: unknown) {
      const error = e as { message?: string };
      setAnamneseError(error?.message || 'Falha ao processar');
      setAnamneseStatus('');
    } finally {
      setAnamneseUploading(false);
    }
  };

  const handleSend = async () => {
    if (!isWeb) {
      Alert.alert('Envio disponível apenas na versão web', 'Abra a versão web para enviar exames.');
      return;
    }

    const requireSelection = examesSugeridos.length > 0;
    if (requireSelection && !exameSelecionado) {
      // Garantir associação ao exame selecionado para interpretação automática
      Alert.alert('Selecione um exame', 'Escolha um exame sugerido para enviar o resultado.');
      return;
    }

    try {
      setLoading(true);
      setResultText('');
      setLastFileUrl(null);
      setStatus('Selecionando arquivo...');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      const accept = mode === 'pdf' ? 'application/pdf' : 'image/*';
      const file = await pickFileWeb(accept);
      if (!file) {
        setStatus('Aguardando envio.');
        return;
      }

      setStatus('Enviando arquivo...');
      const { fileUrl, mimeType, storageBucket, storagePath } = await uploadViaEdgeFunction(file);
      setLastFileUrl(fileUrl);

      setStatus('Processando interpretação...');
      const fileType = mimeType === 'application/pdf' ? 'pdf' : 'image';

      const exameSelecionadoData = examesSugeridos.find((exame) => exame.id === exameSelecionado);
      const tituloResultado = exameSelecionadoData?.titulo || null;

      const uploadRecordPromise = supabase
        .from('exames_resultados')
        .insert({
          user_id: user.id,
          task_exame_id: exameSelecionado || null,
          titulo: tituloResultado,
          file_url: fileUrl,
          file_name: file.name,
          mime_type: mimeType,
          file_type: fileType,
          source: 'interpretacao',
          storage_bucket: storageBucket,
          storage_path: storagePath,
        });

      // Passar task_exame_id para garantir interpretação e vínculo com o exame
      const analysisPromise = exameAnalysisService.analyzeExame({
        fileUrl,
        fileType,
        taskExameId: exameSelecionado || undefined,
      });

      const [analysisOutcome, uploadOutcome] = await Promise.allSettled([
        analysisPromise,
        uploadRecordPromise,
      ]);

      if (uploadOutcome.status === 'fulfilled' && uploadOutcome.value?.error) {
        console.warn('[Interpretacao] Erro ao registrar upload do exame:', uploadOutcome.value.error);
      }
      if (uploadOutcome.status === 'rejected') {
        console.warn('[Interpretacao] Falha ao registrar upload do exame:', uploadOutcome.reason);
      }

      if (analysisOutcome.status === 'rejected') {
        throw analysisOutcome.reason;
      }

      const analise = analysisOutcome.value;

      // Recarregar exames sugeridos para atualizar a lista após análise
      if (exameSelecionado) {
        setTimeout(() => {
          loadExamesSugeridos();
        }, 2000);
      }

      // A Edge Function retorna 'interpretacao', não 'analise' ou 'conclusao'
      // Mostrar a interpretação retornada
      setResultText(analise?.interpretacao || analise?.analise || 'Interpretação concluída.');
      
      // Carregar fontes se disponíveis
      if (analise?.fontes && Array.isArray(analise.fontes) && analise.fontes.length > 0) {
        setFontes(analise.fontes);
      } else {
        // Se não houver fontes na resposta, buscar do banco após salvar
        if (analise?.id) {
          // Buscar fontes do banco após um pequeno delay para garantir que foram salvas
          setTimeout(async () => {
            try {
              const { data: analiseCompleta } = await supabase
                .from('analises_exames')
                .select('fontes')
                .eq('id', analise.id)
                .single();
              
              if (analiseCompleta?.fontes && Array.isArray(analiseCompleta.fontes)) {
                setFontes(analiseCompleta.fontes);
              }
            } catch (error) {
              console.error('[Interpretacao] Erro ao buscar fontes:', error);
            }
          }, 1000);
        }
      }
      
      setStatus('Concluído.');
    } catch (e: unknown) {
      const error = e as { message?: string };
      setStatus(`Erro: ${error?.message || 'Falha ao processar'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header “Analisar Exame” (Flutter: height 100, secondaryBackground, radius 12, padding 16/8) */}
      <View style={[styles.headerCard, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.headerContent}>
          <View style={styles.headerText}>
            <Text style={[styles.headerTitle, { color: theme.colors.onSurface, fontSize: scale(20) }]}>
              Analisar Exame
            </Text>
            <Text style={[styles.headerSubtitle, { color: theme.colors.onSurfaceVariant }]}>
              Envie uma FOTO ou PDF do seu exame para obter as informações de forma clara e objetiva!
            </Text>
          </View>
          <Button
            mode="outlined"
            icon="history"
            onPress={() => router.push('/(tabs)/exames')}
            compact
            style={styles.historyButton}
          >
            Histórico
          </Button>
        </View>
      </View>

      {/* Tabs "Enviar Foto" / "Enviar PDF" (Flutter TabBar) */}
      <View style={styles.tabsRow}>
        <SegmentedButtons
          value={mode}
          onValueChange={(v) => setMode(v as any)}
          buttons={[
            { value: 'foto', label: 'Enviar Foto' },
            { value: 'pdf', label: 'Enviar PDF' },
          ]}
        />
      </View>

      {/* Container principal (Flutter: secondaryBackground + radius 12) */}
      <ScrollView style={styles.scrollView}>
        {/* Exames Sugeridos pelo Agente */}
        {examesSugeridos.length > 0 && !resultText && (
          <View style={[styles.suggestedExamsCard, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.suggestedTitle, { color: theme.colors.onSurface, fontSize: scale(16) }]}>
              Exames Sugeridos pelo Agente
            </Text>
            <Text style={[styles.suggestedSubtitle, { color: theme.colors.onSurfaceVariant, fontSize: scale(12) }]}>
              Selecione um exame para enviar o resultado:
            </Text>
            <View style={styles.suggestedExamsList}>
              {examesSugeridos.map((exame) => (
                <Card
                  key={exame.id}
                  style={[
                    styles.suggestedExamCard,
                    exameSelecionado === exame.id && styles.suggestedExamCardSelected,
                  ]}
                >
                  <Card.Content>
                    <TouchableOpacity
                      onPress={() => setExameSelecionado(exameSelecionado === exame.id ? null : exame.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.suggestedExamHeader}>
                        <Text variant="titleSmall" style={{ fontWeight: 'bold', flex: 1 }}>
                          {exame.titulo || 'Exame'}
                        </Text>
                        {exame.urgencia && (
                          <Chip compact style={styles.urgencyChip}>
                            {exame.urgencia === 'urgente'
                              ? 'PRIORIDADE Urgente'
                              : exame.urgencia === 'alta'
                                ? 'PRIORIDADE Alta'
                                : exame.urgencia === 'média'
                                  ? 'PRIORIDADE Média'
                                  : `PRIORIDADE ${exame.urgencia}`}
                          </Chip>
                        )}
                      </View>
                      {exame.descricao && (
                        <Text variant="bodySmall" style={{ marginTop: 4, opacity: 0.8 }}>
                          {exame.descricao}
                        </Text>
                      )}
                    </TouchableOpacity>
                    
                    {/* Botão de enviar dentro do card selecionado */}
                    {exameSelecionado === exame.id && (
                      <View style={styles.sendButtonContainer}>
                        <Button
                          mode="contained"
                          onPress={handleSend}
                          disabled={loading}
                          style={styles.sendButtonInCard}
                          icon={mode === 'pdf' ? 'file-pdf-box' : 'image'}
                        >
                          {loading ? 'Enviando...' : mode === 'pdf' ? 'Enviar PDF' : 'Enviar Imagem'}
                        </Button>
                        {!isWeb && (
                          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
                            Envio disponível apenas na versão web.
                          </Text>
                        )}
                        {loading && (
                          <View style={styles.statusRow}>
                            <ActivityIndicator size="small" />
                            <Text variant="bodySmall" style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}>
                              {status}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </Card.Content>
                </Card>
              ))}
            </View>
          </View>
        )}

        {/* Body card só aparece se não houver exames sugeridos, ou se houver resultado */}
        {(examesSugeridos.length === 0 || resultText) && (
          <View style={[styles.bodyCard, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.bodyInner}>
              {examesSugeridos.length === 0 && !resultText && (
                <>
                  <Button
                    mode="contained"
                    onPress={handleSend}
                    disabled={loading}
                    style={styles.sendButton}
                    icon={mode === 'pdf' ? 'file-pdf-box' : 'image'}
                  >
                    {mode === 'pdf' ? 'Enviar PDF' : 'Enviar Imagem'}
                  </Button>
                  {!isWeb && (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
                      Envio disponível apenas na versão web.
                    </Text>
                  )}

                  {loading ? (
                    <View style={styles.statusRow}>
                      <ActivityIndicator />
                      <Text style={{ marginLeft: 8 }}>{status}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.statusText, { color: theme.colors.onSurfaceVariant }]}>{status}</Text>
                  )}
                </>
              )}

            {lastFileUrl ? (
              <Text style={[styles.small, { color: theme.colors.onSurfaceVariant, fontSize: scale(12) }]}>
                Arquivo enviado: {lastFileUrl}
              </Text>
            ) : null}

            {resultText ? (
              <Card style={styles.resultCard}>
                <Card.Content>
                  <Text style={[styles.resultTitle, { color: theme.colors.onSurface, fontSize: scale(16) }]}>
                    Interpretação
                  </Text>
                  <Text style={{ color: theme.colors.onSurface, marginTop: 8 }}>{resultText}</Text>
                  
                  {/* Fontes e Referências */}
                  {fontes.length > 0 && (
                    <View style={styles.fontesSection}>
                      <Text style={[styles.fontesTitle, { color: theme.colors.onSurface, fontSize: scale(14) }]}>
                        Fontes e Referências Científicas:
                      </Text>
                      <Text variant="bodySmall" style={{ marginBottom: 8, color: theme.colors.onSurfaceVariant }}>
                        Esta interpretação foi baseada nas seguintes fontes, bases intelectuais e compêndios médicos:
                      </Text>
                      {fontes.map((fonte, index) => (
                        <View key={index} style={styles.fonteItem}>
                          <Text variant="bodySmall" style={{ fontWeight: '500', marginBottom: 2 }}>
                            {fonte.titulo}
                          </Text>
                          {fonte.tipo && (
                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>
                              Tipo: {fonte.tipo === 'artigo' ? 'Artigo Científico' : fonte.tipo === 'diretriz' ? 'Diretriz Clínica' : fonte.tipo === 'compendio' ? 'Compêndio Médico' : fonte.tipo}
                            </Text>
                          )}
                          {fonte.url && (
                            <Text 
                              variant="bodySmall" 
                              style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
                              onPress={() => {
                                if (typeof window !== 'undefined') {
                                  window.open(fonte.url, '_blank');
                                }
                              }}
                            >
                              {fonte.url}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                  
                  {/* Botão para ver no histórico */}
                  <Button
                    mode="outlined"
                    icon="history"
                    onPress={() => router.push('/(tabs)/exames')}
                    style={styles.viewHistoryButton}
                  >
                    Ver no Histórico de Exames
                  </Button>
                </Card.Content>
              </Card>
            ) : (
              <Text style={[styles.small, { color: theme.colors.onSurfaceVariant, fontSize: scale(12) }]}>
                Aguardando o envio do {mode === 'pdf' ? 'PDF' : 'arquivo'}.
              </Text>
            )}
            </View>
          </View>
        )}

        {threadId && (
          <View style={[styles.bodyCard, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.bodyInner}>
              <Text style={[styles.headerTitle, { color: theme.colors.onSurface, fontSize: scale(16) }]}>
                Resultados da anamnese
              </Text>
              <Text style={[styles.headerSubtitle, { color: theme.colors.onSurfaceVariant }]}>
                Envie um único PDF ou foto referente à anamnese de {anamneseDateLabel}.
              </Text>

              {anamneseStatus ? (
                <View style={styles.statusRow}>
                  {anamneseUploading && <ActivityIndicator size="small" />}
                  <Text style={{ marginLeft: anamneseUploading ? 8 : 0 }}>{anamneseStatus}</Text>
                </View>
              ) : null}

              {anamneseError ? (
                <Text style={[styles.statusText, { color: theme.colors.error }]}>{anamneseError}</Text>
              ) : null}

              <View style={styles.generalUploadActions}>
                <Button
                  mode="contained"
                  icon="file-pdf-box"
                  onPress={() => void handleUploadAnamneseGeral('pdf')}
                  disabled={anamneseUploading}
                  style={styles.sendButton}
                >
                  Enviar PDF
                </Button>
                <Button
                  mode="outlined"
                  icon="image"
                  onPress={() => void handleUploadAnamneseGeral('image')}
                  disabled={anamneseUploading}
                  style={styles.sendButton}
                >
                  Enviar Imagem
                </Button>
              </View>
              {!isWeb && (
                <Text style={[styles.statusText, { color: theme.colors.onSurfaceVariant }]}>
                  Envio disponível apenas na versão web.
                </Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerCard: {
    margin: 8,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 100,
    justifyContent: 'center',
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    marginTop: 8,
    opacity: 0.8,
  },
  historyButton: {
    marginLeft: 16,
  },
  tabsRow: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  scrollView: {
    flex: 1,
  },
  bodyCard: {
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 12,
  },
  bodyInner: {
    padding: 16,
    gap: 12,
  },
  sendButton: {
    alignSelf: 'flex-start',
  },
  generalUploadActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    opacity: 0.9,
  },
  small: {
    fontSize: 12,
    opacity: 0.8,
  },
  resultCard: {
    marginTop: 8,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  fontesSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  fontesTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  fonteItem: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  viewHistoryButton: {
    marginTop: 16,
  },
  suggestedExamsCard: {
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 12,
    padding: 16,
  },
  suggestedTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  suggestedSubtitle: {
    fontSize: 12,
    opacity: 0.8,
    marginBottom: 12,
  },
  suggestedExamsList: {
    gap: 8,
  },
  suggestedExamCard: {
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  suggestedExamCardSelected: {
    borderColor: '#6366f1',
    borderWidth: 2,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  suggestedExamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  urgencyChip: {
    alignSelf: 'flex-start',
  },
  sendButtonContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  sendButtonInCard: {
    width: '100%',
  },
});
