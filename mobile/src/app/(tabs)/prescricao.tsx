import { useState, useEffect, useCallback } from 'react';
import { StyleSheet, ScrollView, View, Alert, Platform, useWindowDimensions } from 'react-native';
import { Text, Card, Button, ActivityIndicator, useTheme, Chip, Divider, ProgressBar } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/services/supabase/client';
import { useAppStore } from '@/store/appStore';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { PDFPreviewModal } from '@/components/exames/PDFPreviewModal';
import { MaterialIcons } from '@expo/vector-icons';
import { useExamProgress } from '@/hooks/useExamProgress';
import { useFontScale } from '@/hooks/useFontScale';
// PDF service - usar API no web, service direto no mobile
let pdfService: any;
if (typeof window === 'undefined' || process.env.EXPO_PUBLIC_PLATFORM === 'native') {
  // Mobile - importar service direto
  pdfService = require('@/services/pdf/pdf-service').pdfService;
} else {
  // Web - usar stub que chama API
  pdfService = {
    generatePrescricaoPDF: async (params: any) => {
      // No web, tentar API do backend e fazer fallback para Edge Function.
      try {
        const response = await fetch('/api/generate-prescricao-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        if (response.ok) {
          const data = await response.json();
          return data.pdfUrl || data.pdf_url || null;
        }
      } catch {
        // Fallback abaixo
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const { data, error } = await supabase.functions.invoke('auto-generate-prescricao-pdf', {
        body: { user_id: user.id },
      });
      if (error || data?.success === false) {
        throw new Error(data?.error || error?.message || 'Erro ao gerar receita');
      }
      return data?.pdf_url || null;
    },
  };
}
import * as Linking from 'expo-linking';

interface Prescricao {
  id: number;
  user_id: string;
  paciente_nome?: string;
  paciente_cpf?: string;
  medicamentos?: string;
  observacoes?: string;
  created_at: string;
  pdfurlprescricao?: string;
  id_threadconversa?: string;
  titulo?: string;
  descricao?: string;
  no_exames?: number;
  no_exames_complete?: number;
  tasks?: any;
  reports_resultados?: any;
  reports?: any;
  chathistorico?: string;
}

interface ExameRelacionado {
  id: number;
  titulo?: string;
  descricao?: string;
  created_at: string;
  urlpdf?: string;
  interpretacao?: string;
}

interface Fonte {
  titulo: string;
  url?: string;
  tipo: string;
}

export default function PrescricaoScreen() {
  const theme = useTheme();
  const { scale } = useFontScale();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= 1024;
  const [prescricoes, setPrescricoes] = useState<Prescricao[]>([]);
  const [loading, setLoading] = useState(true);
  const [examesRelacionados, setExamesRelacionados] = useState<Record<number, ExameRelacionado[]>>({});
  const [fontesRelacionadas, setFontesRelacionadas] = useState<Record<number, Fonte[]>>({});
  const [loadingExames, setLoadingExames] = useState<Record<number, boolean>>({});
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>('');
  const [downloadingPdfId, setDownloadingPdfId] = useState<number | null>(null);
  const { prescricaofinal, image1, image2, titulo } = useAppStore();
  const {
    total: totalExames,
    completed: completedExames,
    percentage: progressPercent,
    progress: progressValue,
    isUnlocked: receitaUnlocked,
  } = useExamProgress();
  const receitaLocked = !receitaUnlocked;

  const loadPrescricoes = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('goals_prescricao')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPrescricoes(data || []);
      
      // Carregar exames e fontes relacionados para cada prescrição
      if (data && data.length > 0) {
        await loadExamesEFontes(data);
      }
    } catch (error) {
      console.error('[Prescricao] Erro ao carregar prescrições:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadExamesEFontes = async (prescricoesData: Prescricao[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const examesMap: Record<number, ExameRelacionado[]> = {};
    const fontesMap: Record<number, Fonte[]> = {};

    for (const prescricao of prescricoesData) {
      if (!prescricao.id_threadconversa) continue;

      setLoadingExames(prev => ({ ...prev, [prescricao.id]: true }));

      try {
        // Buscar exames relacionados através do id_threadconversa
        const { data: examesData } = await supabase
          .from('tasks_listaexames')
          .select('id, titulo, descricao, created_at, urlpdf, interpretacao, fontes')
          .eq('user_id', user.id)
          .eq('id_threadconversa', prescricao.id_threadconversa)
          .order('created_at', { ascending: false });

        examesMap[prescricao.id] = examesData || [];

        // Coletar fontes de duas fontes:
        // 1. Fontes dos exames em tasks_listaexames (quando solicitados via deep research)
        // 2. Fontes das análises em analises_exames (quando exames são analisados)
        const todasFontes: Fonte[] = [];
        
        // 1. Fontes de tasks_listaexames
        (examesData || []).forEach((exame: any) => {
          if (exame.fontes && Array.isArray(exame.fontes)) {
            exame.fontes.forEach((fonte: Fonte) => {
              const existe = todasFontes.find(
                f => f.titulo === fonte.titulo && (!fonte.url || f.url === fonte.url)
              );
              if (!existe) {
                todasFontes.push(fonte);
              }
            });
          }
        });

        // 2. Fontes de analises_exames
        const { data: analisesData } = await supabase
          .from('analises_exames')
          .select('fontes, url_arquivo')
          .eq('user_id', user.id)
          .eq('status', 'concluida')
          .not('fontes', 'is', null);

        (analisesData || []).forEach((analise: any) => {
          if (analise.fontes && Array.isArray(analise.fontes)) {
            analise.fontes.forEach((fonte: Fonte) => {
              const existe = todasFontes.find(
                f => f.titulo === fonte.titulo && (!fonte.url || f.url === fonte.url)
              );
              if (!existe) {
                todasFontes.push(fonte);
              }
            });
          }
        });

        fontesMap[prescricao.id] = todasFontes;
      } catch (error) {
        console.error(`[Prescricao] Erro ao carregar exames/fontes para prescrição ${prescricao.id}:`, error);
      } finally {
        setLoadingExames(prev => ({ ...prev, [prescricao.id]: false }));
      }
    }

    setExamesRelacionados(examesMap);
    setFontesRelacionadas(fontesMap);
  };

  useEffect(() => {
    loadPrescricoes();
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Recarregar prescrições quando a tela entra em foco
      loadPrescricoes();
    }, [])
  );

  const parseMedicamentos = (medString?: string) => {
    if (!medString) return [];
    try {
      return JSON.parse(medString);
    } catch {
      return [];
    }
  };

  const generatePDF = async (prescricao: Prescricao) => {
    if (receitaLocked) {
      Alert.alert(
        'Receita Digital bloqueada',
        'Envie 100% dos resultados dos exames para liberar a receita digital.'
      );
      return;
    }
    try {
      const medicamentos = parseMedicamentos(prescricao.medicamentos);
      
      const pdfUrl = await pdfService.generatePrescricaoPDF({
        titulo: titulo || 'Receita Digital',
        nomepaciente: prescricao.paciente_nome || '',
        data: new Date(prescricao.created_at).toLocaleDateString('pt-BR'),
        descricao: prescricao.observacoes || '',
        medicamentos: medicamentos,
        image1: image1,
        image2: image2,
        id: prescricao.id,
      });

      if (pdfUrl) {
        Alert.alert('Sucesso', 'Receita digital gerada com sucesso!');
        await loadPrescricoes();
      } else {
        Alert.alert('Erro', 'Não foi possível gerar a receita digital');
      }
    } catch (error) {
      console.error('[Prescricao] Erro ao gerar PDF:', error);
      Alert.alert('Erro', 'Erro ao gerar a receita digital');
    }
  };

  const openPDFPreview = (url: string, title: string) => {
    if (receitaLocked) {
      Alert.alert(
        'Receita Digital bloqueada',
        'Envie 100% dos resultados dos exames para liberar a receita digital.'
      );
      return;
    }
    setPreviewPdfUrl(url);
    setPreviewTitle(title);
  };

  const handleDownloadPDF = async (url: string, title: string, prescricaoId: number) => {
    if (receitaLocked) {
      Alert.alert(
        'Receita Digital bloqueada',
        'Envie 100% dos resultados dos exames para liberar a receita digital.'
      );
      return;
    }
    try {
      setDownloadingPdfId(prescricaoId);
      
      if (Platform.OS === 'web') {
        // No web, abrir o PDF em nova aba para download
        if (typeof window !== 'undefined' && window.document) {
          const link = window.document.createElement('a');
          link.href = url;
          link.download = `${title || 'receita'}_${Date.now()}.pdf`;
          link.target = '_blank';
          window.document.body.appendChild(link);
          link.click();
          window.document.body.removeChild(link);
        } else {
          // Fallback: abrir em nova aba
          await Linking.openURL(url);
        }
        Alert.alert('Sucesso', 'Download iniciado!');
      } else {
        // No mobile, baixar e compartilhar
        const fileUri = `${FileSystem.documentDirectory}receita_${Date.now()}.pdf`;
        const downloadResult = await FileSystem.downloadAsync(url, fileUri);

        if (downloadResult.status === 200) {
          const isAvailable = await Sharing.isAvailableAsync();
          
          if (isAvailable) {
            await Sharing.shareAsync(downloadResult.uri, {
              mimeType: 'application/pdf',
              dialogTitle: 'Baixar Receita Digital',
            });
          } else {
            // Fallback: abrir o PDF
            await Linking.openURL(url);
          }
          Alert.alert('Sucesso', 'Receita digital baixada com sucesso!');
        } else {
          throw new Error('Erro ao baixar o PDF');
        }
      }
    } catch (error: any) {
      console.error('[Prescricao] Erro ao baixar PDF:', error);
      Alert.alert('Erro', 'Erro ao baixar o PDF. Tente novamente.');
    } finally {
      setDownloadingPdfId(null);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    } catch {
      return dateString;
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header alinhado com Flutter (PrescricaomedicaWidget): card 70px, padding 8 */}
      <View style={styles.headerOuter}>
        <View style={[styles.headerCard, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.headerTitle, { color: theme.colors.onSurface, fontSize: scale(20) }]}>
            Receita Digital
          </Text>
        </View>
      </View>

      {receitaLocked && (
        <View style={[styles.lockCard, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.lockHeader}>
            <MaterialIcons name="lock" size={20} color={theme.colors.onSurfaceVariant} />
            <Text style={[styles.lockTitle, { color: theme.colors.onSurface, fontSize: scale(14) }]}>
              Receita Digital bloqueada
            </Text>
          </View>
          <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
            Envie 100% dos resultados dos exames para liberar a receita digital.
          </Text>
          <ProgressBar progress={progressValue} color={theme.colors.primary} style={styles.lockProgress} />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {totalExames === 0
              ? 'Nenhuma guia de exame disponível.'
              : `${completedExames} de ${totalExames} resultados enviados (${progressPercent}%)`}
          </Text>
        </View>
      )}

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {prescricoes.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Card.Content>
              <Text variant="bodyLarge" style={{ textAlign: 'center' }}>
                Nenhuma receita encontrada
              </Text>
            </Card.Content>
          </Card>
        ) : (
          prescricoes.map((prescricao) => {
            const medicamentos = parseMedicamentos(prescricao.medicamentos);
            const exames = examesRelacionados[prescricao.id] || [];
            const fontes = fontesRelacionadas[prescricao.id] || [];
            const isLoadingExames = loadingExames[prescricao.id];

            return (
              <Card key={prescricao.id} style={styles.card}>
                <Card.Content>
                  {/* Cabeçalho */}
                  <View style={styles.headerSection}>
                    <View style={styles.headerText}>
                      <Text variant="titleLarge" style={{ fontWeight: 'bold', marginBottom: 4 }}>
                        {prescricao.titulo || prescricao.paciente_nome || 'Receita Digital'}
                      </Text>
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {formatDate(prescricao.created_at)}
                      </Text>
                    </View>
                  </View>

                  <Divider style={styles.divider} />

                  {/* Informações do Paciente */}
                  {prescricao.paciente_nome && (
                    <View style={styles.infoSection}>
                      <Text variant="bodyMedium" style={{ fontWeight: '600', marginBottom: 4 }}>
                        Paciente:
                      </Text>
                      <Text variant="bodyMedium">{prescricao.paciente_nome}</Text>
                      {prescricao.paciente_cpf && (
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                          CPF: {prescricao.paciente_cpf}
                        </Text>
                      )}
                    </View>
                  )}

                  {/* Descrição */}
                  {prescricao.descricao && (
                    <View style={styles.infoSection}>
                      <Text variant="bodyMedium" style={{ fontWeight: '600', marginBottom: 4 }}>
                        Descrição:
                      </Text>
                      <Text variant="bodyMedium">{prescricao.descricao}</Text>
                    </View>
                  )}

                  {/* Medicamentos */}
                  {medicamentos.length > 0 && (
                    <View style={styles.infoSection}>
                      <Text variant="bodyMedium" style={{ fontWeight: '600', marginBottom: 8 }}>
                        Medicamentos:
                      </Text>
                      {medicamentos.map((med: any, index: number) => (
                        <View key={index} style={styles.medicamentoItem}>
                          <Text variant="bodySmall">
                            • {med.nome} - {med.dosagem} ({med.frequencia})
                          </Text>
                          {med.duracao && (
                            <Text variant="bodySmall" style={{ marginLeft: 16, color: theme.colors.onSurfaceVariant }}>
                              Duração: {med.duracao}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Observações */}
                  {prescricao.observacoes && (
                    <View style={styles.infoSection}>
                      <Text variant="bodyMedium" style={{ fontWeight: '600', marginBottom: 4 }}>
                        Observações:
                      </Text>
                      <Text variant="bodyMedium">{prescricao.observacoes}</Text>
                    </View>
                  )}

                  {/* Exames Relacionados */}
                  {isLoadingExames ? (
                    <View style={styles.infoSection}>
                      <ActivityIndicator size="small" />
                    </View>
                  ) : exames.length > 0 && (
                    <View style={styles.infoSection}>
                      <Text variant="bodyMedium" style={{ fontWeight: '600', marginBottom: 8 }}>
                        Exames Relacionados ({exames.length}):
                      </Text>
                      {exames.map((exame) => (
                        <View key={exame.id} style={styles.exameItem}>
                          <Text variant="bodySmall" style={{ fontWeight: '500' }}>
                            • {exame.titulo || 'Exame'}
                          </Text>
                          {exame.descricao && (
                            <Text variant="bodySmall" style={{ marginLeft: 16, color: theme.colors.onSurfaceVariant }}>
                              {exame.descricao}
                            </Text>
                          )}
                          {exame.interpretacao && (
                            <Text variant="bodySmall" style={{ marginLeft: 16, color: theme.colors.primary, marginTop: 4 }}>
                              Interpretação disponível
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Fontes e Referências */}
                  {fontes.length > 0 && (
                    <View style={styles.infoSection}>
                      <Text variant="bodyMedium" style={{ fontWeight: '600', marginBottom: 8 }}>
                        Fontes e Referências Científicas:
                      </Text>
                      <Text variant="bodySmall" style={{ marginBottom: 8, color: theme.colors.onSurfaceVariant }}>
                        Esta receita foi baseada nas seguintes fontes, bases intelectuais e compêndios médicos:
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
                                } else {
                                  Linking.openURL(fonte.url);
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

                  {/* Estatísticas */}
                  {(prescricao.no_exames !== undefined || prescricao.no_exames_complete !== undefined) && (
                    <View style={styles.infoSection}>
                      <View style={styles.statsContainer}>
                        {prescricao.no_exames !== undefined && prescricao.no_exames > 0 && (
                          <Chip style={styles.statChip}>
                            {prescricao.no_exames} Exame{prescricao.no_exames > 1 ? 's' : ''}
                          </Chip>
                        )}
                        {prescricao.no_exames_complete !== undefined && prescricao.no_exames_complete > 0 && (
                          <Chip style={styles.statChip}>
                            {prescricao.no_exames_complete} Completo{prescricao.no_exames_complete > 1 ? 's' : ''}
                          </Chip>
                        )}
                      </View>
                    </View>
                  )}

                  <Divider style={styles.divider} />

                  {/* Ações */}
                  <View style={styles.actions}>
                    {prescricao.pdfurlprescricao ? (
                      <>
                        <Button
                          mode="outlined"
                          icon="eye"
                          onPress={() => openPDFPreview(prescricao.pdfurlprescricao!, prescricao.titulo || 'Receita Digital')}
                          disabled={receitaLocked}
                          style={styles.actionButton}
                        >
                          Visualizar Receita
                        </Button>
                        <Button
                          mode="contained"
                          icon="download"
                          onPress={() => handleDownloadPDF(prescricao.pdfurlprescricao!, prescricao.titulo || 'Receita Digital', prescricao.id)}
                          loading={downloadingPdfId === prescricao.id}
                          disabled={receitaLocked || downloadingPdfId === prescricao.id}
                          style={styles.actionButton}
                        >
                          {downloadingPdfId === prescricao.id ? 'Baixando...' : 'Baixar Receita'}
                        </Button>
                      </>
                    ) : (
                      <Button
                        mode="outlined"
                        icon="file-pdf-box"
                        onPress={() => generatePDF(prescricao)}
                        disabled={receitaLocked}
                        style={styles.actionButton}
                      >
                        Gerar Receita Digital
                      </Button>
                    )}
                  </View>
                </Card.Content>
              </Card>
            );
          })
        )}
      </ScrollView>

      <PDFPreviewModal
        visible={!!previewPdfUrl}
        onDismiss={() => setPreviewPdfUrl(null)}
        pdfUrl={previewPdfUrl || ''}
        title={previewTitle}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerOuter: {
    padding: 8,
  },
  headerCard: {
    height: 70,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  lockCard: {
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 12,
    padding: 12,
  },
  lockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  lockTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  lockProgress: {
    height: 8,
    borderRadius: 999,
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 8,
    paddingTop: 0,
  },
  card: {
    marginBottom: 12,
  },
  emptyCard: {
    marginTop: 32,
  },
  medicamentosContainer: {
    marginTop: 8,
    marginBottom: 8,
  },
  medicamentoItem: {
    marginBottom: 4,
  },
  headerSection: {
    marginBottom: 12,
  },
  headerText: {
    marginBottom: 8,
  },
  divider: {
    marginVertical: 12,
  },
  infoSection: {
    marginBottom: 16,
  },
  exameItem: {
    marginBottom: 8,
    paddingLeft: 8,
  },
  fonteItem: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statChip: {
    marginRight: 8,
  },
  actions: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
  },
});
