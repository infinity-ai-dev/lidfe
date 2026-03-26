import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Platform,
  StyleSheet,
  ScrollView,
  RefreshControl,
  View,
  useWindowDimensions,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {
  Text,
  Card,
  Button,
  ActivityIndicator,
  useTheme,
  Chip,
  DataTable,
  Snackbar,
  Banner,
  ProgressBar,
} from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/services/supabase/client';
import { APP_CONFIG } from '@/utils/constants';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { PDFPreviewModal } from '@/components/exames/PDFPreviewModal';
import { MaterialIcons } from '@expo/vector-icons';
import { exameAnalysisService } from '@/services/exame-analysis';
import { useFontScale } from '@/hooks/useFontScale';
import { pickNativeExamUploadAsset, uploadNativeExamAsset } from '@/services/native-exam-upload';
import { useAppStore } from '@/store/appStore';

interface Exame {
  id: number; // ID da task_listaexames
  created_at: string;
  titulo?: string; // Título do exame (substitui tipo)
  descricao?: string;
  urgencia?: string; // Urgência (substitui categoria)
  urlpdf?: string; // URL do PDF assinado (substitui pdfguiaexame)
  user_id?: string;
  id_threadconversa?: string;
  interpretacao?: string;
  status?: boolean;
  complete?: boolean;
  urlfoto?: string;
  guia_geral_url?: string;
  guia_geral_batch_id?: string;
  guia_geral_created_at?: string;
  resultado_id?: number; // ID do resultado relacionado
  foi_analisado?: boolean; // Indica se foi analisado pelo sistema
  is_general_guide?: boolean;
  fontes?: Array<{
    titulo: string;
    url?: string;
    tipo: string;
  }>; // Fontes científicas relacionadas ao exame
  _from_analises_exames?: boolean;
}

interface ResultadoUpload {
  id: number;
  created_at: string;
  titulo?: string | null;
  file_url: string;
  file_name?: string | null;
  task_exame_id?: number | null;
}

interface GeneralGuideDocument {
  id: number;
  title: string;
  url: string;
  createdAt: string;
  sourceExam: Exame;
}

type ExamesTab = 'todos' | 'analisados' | 'pendentes' | 'arquivados';

interface ResultadoSessionSummary {
  threadId: string;
  sessionAt: string;
  totalExames: number;
  completedExames: number;
  percentage: number;
  progress: number;
}

export default function ExamesScreen() {
  const theme = useTheme();
  const { scale } = useFontScale();
  const router = useRouter();
  const params = useLocalSearchParams<{ threadId?: string | string[]; tab?: string | string[] }>();
  const threadIdFilter = useMemo(() => {
    const raw = Array.isArray(params.threadId) ? params.threadId[0] : params.threadId;
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params.threadId]);
  const requestedTab = useMemo<ExamesTab | null>(() => {
    const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
    if (raw === 'todos' || raw === 'analisados' || raw === 'pendentes' || raw === 'arquivados') {
      return raw;
    }
    return null;
  }, [params.tab]);
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= 1024;
  const currentThreadId = useAppStore(state => state.idthreadConversa);
  const [exames, setExames] = useState<Exame[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<ExamesTab>(requestedTab || 'todos');
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>('');
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [downloadingPdfId, setDownloadingPdfId] = useState<number | null>(null);
  const [examesSemPdf, setExamesSemPdf] = useState<Exame[]>([]);
  const [generatingPdfId, setGeneratingPdfId] = useState<number | null>(null);
  const [uploadingResultExamId, setUploadingResultExamId] = useState<number | null>(null);
  const [bannerVisible, setBannerVisible] = useState(false);
  // Controla exibição do aviso simples de novos dados no histórico
  const [newDataVisible, setNewDataVisible] = useState(false);
  // Guarda o timeout para ocultar o aviso de novos dados
  const newDataTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resultadosUploads, setResultadosUploads] = useState<ResultadoUpload[]>([]);
  const [generalUploading, setGeneralUploading] = useState(false);
  const [generalStatus, setGeneralStatus] = useState('');
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [anamneseUploading, setAnamneseUploading] = useState(false);
  const [anamneseStatus, setAnamneseStatus] = useState('');
  const [anamneseError, setAnamneseError] = useState<string | null>(null);
  const [analisadosFilter, setAnalisadosFilter] = useState<'todos' | 'guia_geral'>('todos');

  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    if (activeTab !== 'analisados') {
      setAnalisadosFilter('todos');
    }
  }, [activeTab]);

  useEffect(() => {
    if (requestedTab) {
      setActiveTab(requestedTab);
      return;
    }

    if (threadIdFilter) {
      setActiveTab('todos');
    }
  }, [threadIdFilter, requestedTab]);

  // Exibe notificação simples e chama atenção para novos dados no histórico
  const showNewDataNotice = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarVisible(true);
    setNewDataVisible(true);

    if (newDataTimeoutRef.current) {
      clearTimeout(newDataTimeoutRef.current);
    }

    newDataTimeoutRef.current = setTimeout(() => {
      setNewDataVisible(false);
      newDataTimeoutRef.current = null;
    }, 6000);
  };

  const loadExames = async (options?: { suppressNewNotice?: boolean }) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const previousCount = exames.length;

      // Buscar exames da tabela tasks_listaexames (guia de exames)
      // Esta tabela contém os exames solicitados pelo agente de IA
      const { data, error } = await supabase
        .from('tasks_listaexames')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Buscar análises concluídas com relacionamento (inclui exames enviados via chat)
      const { data: analisesData } = await supabase
        .from('analises_exames')
        .select(
          'id, url_arquivo, status, interpretacao, tipo_arquivo, tipo_exame, created_at, fontes, task_exame_id'
        )
        .eq('user_id', user.id)
        .eq('status', 'concluida')
        .order('created_at', { ascending: false });

      // Buscar resultados enviados (uploads) para a aba Resultados
      const { data: resultadosData, error: resultadosError } = await supabase
        .from('exames_resultados')
        .select('id, created_at, titulo, file_url, file_name, task_exame_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (resultadosError) {
        console.warn('[Exames] Erro ao carregar resultados enviados:', resultadosError);
        setResultadosUploads([]);
      } else {
        setResultadosUploads(resultadosData || []);
      }

      // Criar um Set com URLs de arquivos que foram analisados pelo sistema
      const urlsAnalisadas = new Set(
        (analisesData || [])
          .map((a: any) => a.url_arquivo)
          .filter((url: any) => url && url.trim().length > 0)
      );

      // Mapear análises para identificar quais URLs já estão em tasks_listaexames
      const urlsEmTasksListaExames = new Set(
        (data || []).map((e: any) => e.urlfoto).filter((url: any) => url && url.trim().length > 0)
      );

      // Marcar exames que foram analisados pelo sistema
      // Um exame foi analisado se:
      // 1. Tem análise concluída vinculada via task_exame_id (relacionamento direto) OU
      // 2. Tem urlfoto (arquivo enviado) E essa URL corresponde a uma análise concluída
      const newExames = (data || []).map((exame: any) => {
        // Buscar análise correspondente via relacionamento (mais eficiente)
        const analisePorRelacionamento = analisesData?.find(
          (a: any) => a.task_exame_id === exame.id
        );

        // Fallback: buscar por urlfoto se não houver relacionamento
        const analisePorUrl = analisesData?.find((a: any) => a.url_arquivo === exame.urlfoto);

        // Priorizar análise por relacionamento, senão usar por URL
        const analiseCorrespondente = analisePorRelacionamento || analisePorUrl;

        const temUrlfoto = exame.urlfoto && exame.urlfoto.trim().length > 0;
        const urlFoiAnalisada = temUrlfoto && urlsAnalisadas.has(exame.urlfoto);
        const temRelacionamento = !!analisePorRelacionamento;

        const interpretacao = analiseCorrespondente?.interpretacao || exame.interpretacao;
        const fontes = analiseCorrespondente?.fontes || exame.fontes;

        // Foi analisado se tem relacionamento direto OU urlfoto foi analisada
        const foi_analisado = temRelacionamento || urlFoiAnalisada;

        // Detectar se é guia geral pelo título ou campo tipo_exame
        const tituloLower = (exame.titulo || '').toLowerCase();
        const isGeneralGuideTask =
          tituloLower.includes('guia geral') ||
          tituloLower.includes('guia_geral') ||
          exame.tipo_exame === 'guia_geral';

        return {
          ...exame,
          foi_analisado,
          interpretacao: interpretacao || exame.interpretacao,
          fontes: fontes || exame.fontes,
          is_general_guide: isGeneralGuideTask,
        };
      });

      // Adicionar exames de analises_exames que não estão em tasks_listaexames
      // (exames enviados via chat que não foram solicitados pelo agente)
      const examesApenasAnalisados = (analisesData || [])
        .filter((analise: any) => {
          // Incluir apenas análises que não estão vinculadas a tasks_listaexames
          return !urlsEmTasksListaExames.has(analise.url_arquivo);
        })
        .map((analise: any) => {
          // Criar objeto Exame a partir da análise
          // Extrair nome do arquivo da URL para usar como título
          const fileUrl = (analise.url_arquivo || '').toString();
          const fileName = fileUrl
            ? fileUrl.split('/').pop() || 'Exame analisado'
            : 'Exame analisado';
          const fileExtension = fileName.split('.').pop() || '';
          const tipoExame =
            analise.tipo_arquivo === 'pdf'
              ? 'PDF'
              : fileExtension.toUpperCase() === 'PDF'
                ? 'PDF'
                : 'Imagem';
          const tipoExameRaw = (analise.tipo_exame || '').toString().toLowerCase();
          const isGeneralGuide =
            tipoExameRaw.includes('guia geral') ||
            tipoExameRaw.includes('guia_geral') ||
            tipoExameRaw === 'guia';
          const displayTitle = isGeneralGuide
            ? 'Guia Geral de Exames'
            : `${tipoExame} - ${fileName}`;

          return {
            id: analise.id, // Usar ID da análise como identificador único
            created_at: analise.created_at,
            titulo: displayTitle,
            descricao: isGeneralGuide
              ? 'Guia Geral enviada para análise automática'
              : 'Exame enviado via chat e analisado pelo sistema',
            urgencia: 'rotina',
            urlpdf: undefined,
            urlfoto: fileUrl || undefined,
            user_id: user.id,
            id_threadconversa: undefined,
            interpretacao: analise.interpretacao,
            status: true,
            complete: true,
            foi_analisado: true,
            is_general_guide: isGeneralGuide,
            fontes: analise.fontes || undefined,
            resultado_id: undefined,
            // Flag para identificar que vem de analises_exames
            _from_analises_exames: true,
            _analise_id: analise.id, // ID da análise para referência
          } as Exame;
        });

      // Combinar exames de tasks_listaexames com exames apenas analisados
      const todosExames = [...newExames, ...examesApenasAnalisados];

      // Ordenar por data de criação (mais recentes primeiro)
      todosExames.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateB - dateA;
      });

      setExames(todosExames);

      // Identificar exames sem PDF que deveriam ter
      // Considerar apenas exames criados há mais de 2 minutos sem urlpdf
      // (dar tempo para a geração automática acontecer)
      const agora = new Date();
      const examesSemPdfList = newExames.filter((exame: any) => {
        const criadoHa = agora.getTime() - new Date(exame.created_at).getTime();
        const maisDe2Minutos = criadoHa > 120000; // 2 minutos
        return !exame.urlpdf && maisDe2Minutos;
      });
      setExamesSemPdf(examesSemPdfList);
      // Mostrar banner apenas se houver exames sem PDF e não estiver gerando
      setBannerVisible(examesSemPdfList.length > 0 && generatingPdfId === null);

      // Notificar se novos exames foram adicionados
      if (!options?.suppressNewNotice && previousCount > 0 && newExames.length > previousCount) {
        const newCount = newExames.length - previousCount;
        // Aviso simples no histórico para chamar atenção do usuário
        showNewDataNotice(
          `${newCount} novo${newCount > 1 ? 's' : ''} exame${newCount > 1 ? 's' : ''} disponível${newCount > 1 ? 'is' : ''}!`
        );
      }
    } catch (error) {
      console.error('[Exames] Erro ao carregar exames:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadExames();

    // Configurar subscription para novos exames
    let channel: any;

    const setupSubscription = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      channel = supabase
        .channel('tasks-exames-changes')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'tasks_listaexames', // Ouvir mudanças na tabela tasks_listaexames
            filter: `user_id=eq.${user.id}`,
          },
          payload => {
            console.log('[Exames] Nova guia de exame detectada:', payload);
            // Aviso simples de novos dados no histórico
            showNewDataNotice('Nova guia de exame disponível!');
            // Evita duplicar aviso, pois já foi disparado no realtime
            loadExames({ suppressNewNotice: true });
          }
        )
        .subscribe();
    };

    setupSubscription();

    return () => {
      // Limpa timeout de notificação para evitar estado pendente
      if (newDataTimeoutRef.current) {
        clearTimeout(newDataTimeoutRef.current);
        newDataTimeoutRef.current = null;
      }

      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadExames();
  };

  const resultadosLookup = useMemo(() => {
    const byTaskExameId = new Set<number>();
    const byResultadoId = new Set<number>();

    resultadosUploads.forEach(resultado => {
      if (typeof resultado.id === 'number') {
        byResultadoId.add(resultado.id);
      }
      if (typeof resultado.task_exame_id === 'number') {
        byTaskExameId.add(resultado.task_exame_id);
      }
    });

    return { byTaskExameId, byResultadoId };
  }, [resultadosUploads]);

  const getDownloadableUrl = (url?: string | null) => {
    const cleanUrl = (url || '').trim();
    if (!cleanUrl) return '';
    if (cleanUrl.includes('/storage/v1/')) return cleanUrl;
    if (APP_CONFIG.SUPABASE_URL && cleanUrl.startsWith(APP_CONFIG.SUPABASE_URL)) return cleanUrl;
    return '';
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    } catch {
      return dateString;
    }
  };

  const formatTime = (dateString: string) => {
    try {
      return format(new Date(dateString), 'HH:mm', { locale: ptBR });
    } catch {
      return '';
    }
  };

  const getThreadDate = (threadId?: string | null) => {
    if (!threadId) return null;
    const parts = threadId.split(':');
    const last = parts[parts.length - 1];
    const timestamp = Number(last);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };

  const filteredExames = exames.filter(exame => {
    if (activeTab === 'analisados') {
      // Exames analisados: apenas os que foram enviados (tem urlfoto)
      // E analisados pelo sistema (tem análise concluída)
      if (exame.foi_analisado !== true) return false;
      if (analisadosFilter === 'guia_geral') {
        return exame.is_general_guide === true;
      }
      return true;
    }
    if (activeTab === 'todos') {
      // Guias: apenas exames solicitados pelo médico
      if (threadIdFilter) {
        return !exame._from_analises_exames && exame.id_threadconversa === threadIdFilter;
      }
      return !exame._from_analises_exames;
    }
    return true;
  });

  const resultadosTabExames = useMemo(() => {
    return exames.filter(exame => {
      if (exame._from_analises_exames || exame.is_general_guide) {
        return false;
      }

      if (threadIdFilter) {
        return exame.id_threadconversa === threadIdFilter;
      }

      return true;
    });
  }, [exames, threadIdFilter]);

  const resultadosSessionSummaries = useMemo<ResultadoSessionSummary[]>(() => {
    const map = new Map<string, ResultadoSessionSummary>();

    resultadosTabExames.forEach(exame => {
      const threadId = exame.id_threadconversa;
      if (!threadId) return;

      const sessionDate = getThreadDate(threadId);
      const sessionAt = sessionDate?.toISOString() || exame.created_at;
      const current = map.get(threadId);
      const isCompleted =
        (typeof exame.resultado_id === 'number' &&
          resultadosLookup.byResultadoId.has(exame.resultado_id)) ||
        resultadosLookup.byTaskExameId.has(exame.id);

      if (!current) {
        map.set(threadId, {
          threadId,
          sessionAt,
          totalExames: 1,
          completedExames: isCompleted ? 1 : 0,
          percentage: 0,
          progress: 0,
        });
        return;
      }

      current.totalExames += 1;
      if (isCompleted) {
        current.completedExames += 1;
      }

      const currentSessionTime = new Date(current.sessionAt).getTime();
      const nextSessionTime = new Date(sessionAt).getTime();
      if (nextSessionTime > currentSessionTime) {
        current.sessionAt = sessionAt;
      }
    });

    return [...map.values()]
      .map(session => {
        const progress =
          session.totalExames > 0 ? session.completedExames / session.totalExames : 0;
        return {
          ...session,
          progress,
          percentage: session.totalExames > 0 ? Math.round(progress * 100) : 0,
        };
      })
      .sort((a, b) => {
        return new Date(b.sessionAt).getTime() - new Date(a.sessionAt).getTime();
      });
  }, [resultadosLookup, resultadosTabExames]);

  // Encontrar a guia geral mais recente para o botão de visualização
  // Prioriza a guia geral consolidada (guia_geral_url). Como fallback, usa apenas
  // documentos explicitamente marcados como guia geral, nunca um PDF individual.
  const latestGeneralGuide = useMemo<GeneralGuideDocument | null>(() => {
    const relevantExames = exames.filter(exame => {
      if (exame._from_analises_exames) {
        return exame.is_general_guide === true;
      }

      if (threadIdFilter) {
        return exame.id_threadconversa === threadIdFilter;
      }

      return true;
    });

    const candidates: GeneralGuideDocument[] = [];

    relevantExames.forEach(exame => {
      const guiaGeralUrl = getDownloadableUrl(exame.guia_geral_url);
      if (guiaGeralUrl) {
        candidates.push({
          id: exame.id,
          title: 'Guia Geral de Exames',
          url: guiaGeralUrl,
          createdAt: exame.guia_geral_created_at || exame.created_at,
          sourceExam: exame,
        });
      }

      if (exame.is_general_guide) {
        const explicitGuideUrl = getDownloadableUrl(exame.urlfoto || exame.urlpdf || '');
        if (explicitGuideUrl) {
          candidates.push({
            id: exame.id,
            title: exame.titulo || 'Guia Geral de Exames',
            url: explicitGuideUrl,
            createdAt: exame.created_at,
            sourceExam: exame,
          });
        }
      }
    });

    const uniqueDocuments = new Map<string, GeneralGuideDocument>();

    candidates.forEach(document => {
      const batchId = document.sourceExam.guia_geral_batch_id || document.url;
      const current = uniqueDocuments.get(batchId);

      if (!current) {
        uniqueDocuments.set(batchId, document);
        return;
      }

      const currentTimestamp = new Date(current.createdAt).getTime();
      const nextTimestamp = new Date(document.createdAt).getTime();
      if (nextTimestamp > currentTimestamp) {
        uniqueDocuments.set(batchId, document);
      }
    });

    return (
      [...uniqueDocuments.values()].sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })[0] || null
    );
  }, [exames, threadIdFilter]);

  const anamneseDateLabel = useMemo(() => {
    const threadDate = getThreadDate(threadIdFilter);
    if (!threadDate) return 'Anamnese atual';
    return format(threadDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  }, [threadIdFilter]);

  const isResultadoEnviado = (exame: Exame) => {
    if (
      typeof exame.resultado_id === 'number' &&
      resultadosLookup.byResultadoId.has(exame.resultado_id)
    ) {
      return true;
    }
    return resultadosLookup.byTaskExameId.has(exame.id);
  };

  const latestResultadoByTaskId = useMemo(() => {
    const entries = [...resultadosUploads].sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const map = new Map<number, ResultadoUpload>();
    entries.forEach(resultado => {
      if (typeof resultado.task_exame_id !== 'number') return;
      if (!map.has(resultado.task_exame_id)) {
        map.set(resultado.task_exame_id, resultado);
      }
    });

    return map;
  }, [resultadosUploads]);

  const resultadosProgress = useMemo(() => {
    const total = resultadosTabExames.length;
    const completed = resultadosTabExames.filter(exame => {
      if (
        typeof exame.resultado_id === 'number' &&
        resultadosLookup.byResultadoId.has(exame.resultado_id)
      ) {
        return true;
      }
      return resultadosLookup.byTaskExameId.has(exame.id);
    }).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const progress = total > 0 ? completed / total : 0;

    return { total, completed, percentage, progress };
  }, [resultadosTabExames, resultadosLookup]);

  const showFloatingResultadosProgress =
    activeTab === 'pendentes' && !!threadIdFilter && resultadosTabExames.length > 0;
  const showResultadosSessionHistory = activeTab === 'pendentes' && !threadIdFilter;

  const renderGuiaStatus = (exame: Exame, options?: { compact?: boolean }) => {
    const concluido = isResultadoEnviado(exame);
    const statusColor = concluido ? '#2E7D32' : '#F9A825';
    const iconName = concluido ? 'check-circle' : 'hourglass-empty';
    const label = concluido
      ? 'Exame realizado\ne inserido na aba Resultados'
      : 'Aguardando a realização\ndo exame e upload na aba Resultados';
    const iconSize = options?.compact ? scale(16) : scale(18);
    const textSize = options?.compact ? scale(9) : scale(10);

    return (
      <View style={styles.guiaStatus}>
        <MaterialIcons name={iconName} size={iconSize} color={statusColor} />
        <Text style={[styles.guiaStatusText, { color: statusColor, fontSize: textSize }]}>
          {label}
        </Text>
      </View>
    );
  };

  const getDownloadUrl = (exame: Exame) => {
    return getDownloadableUrl(exame.urlfoto || exame.urlpdf || '');
  };

  const getFileNameFromUrl = (url: string, fallbackTitle: string) => {
    const cleanUrl = url.split('?')[0];
    const urlName = cleanUrl.split('/').pop() || '';
    if (urlName.includes('.')) return urlName;
    const safeTitle = (fallbackTitle || 'arquivo').replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${safeTitle}_${Date.now()}`;
  };

  const inferMimeType = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    return 'application/octet-stream';
  };

  const openPDFPreview = (url: string, title: string) => {
    setPreviewPdfUrl((url || '').trim());
    setPreviewTitle((title || 'Guia de Exame').trim());
  };

  const closePDFPreview = () => {
    setPreviewPdfUrl(null);
    setPreviewTitle('');
  };

  const handleNativeResultUpload = async (exame: Exame) => {
    try {
      setUploadingResultExamId(exame.id);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      const pickedAsset = await pickNativeExamUploadAsset('any');
      if (!pickedAsset) {
        return;
      }

      const upload = await uploadNativeExamAsset(pickedAsset);

      const { data: insertedResultado, error: insertError } = await supabase
        .from('exames_resultados')
        .insert({
          user_id: user.id,
          task_exame_id: exame.id,
          titulo: exame.titulo || null,
          file_url: upload.fileUrl,
          file_name: upload.fileName,
          mime_type: upload.mimeType,
          file_type: upload.fileType,
          source: 'interpretacao',
          storage_bucket: upload.storageBucket,
          storage_path: upload.storagePath,
        })
        .select('id')
        .single();

      if (insertError) {
        throw insertError;
      }

      let analysisError: string | null = null;
      try {
        await exameAnalysisService.analyzeExame({
          fileUrl: upload.fileUrl,
          fileType: upload.fileType,
          resultadoId: insertedResultado?.id,
          taskExameId: exame.id,
        });
      } catch (error: any) {
        console.error('[Exames] Erro ao analisar resultado no mobile:', error);
        analysisError = error?.message || 'Falha ao processar a análise automática.';
      }

      await loadExames({ suppressNewNotice: true });

      setSnackbarMessage(
        analysisError
          ? 'Resultado enviado, mas a análise automática falhou. Tente novamente em instantes.'
          : 'Resultado enviado com sucesso.'
      );
      setSnackbarVisible(true);
    } catch (error: any) {
      console.error('[Exames] Erro ao enviar resultado no mobile:', error);
      setSnackbarMessage(error?.message || 'Não foi possível enviar o resultado.');
      setSnackbarVisible(true);
    } finally {
      setUploadingResultExamId(null);
    }
  };

  const openResultUpload = (exame: Exame) => {
    if (!isWeb) {
      void handleNativeResultUpload(exame);
      return;
    }

    router.push({
      pathname: '/(tabs)/interpretacao',
      params: { exameId: exame.id.toString() },
    });
  };

  const openInterpretation = (exame: Exame) => {
    router.push({
      pathname: '/exames/interpretacao',
      params: {
        exameId: exame.id.toString(),
        ...(exame._from_analises_exames ? { fromResultados: 'true' } : {}),
      },
    });
  };

  const handleOpenResultadosSession = (threadId: string) => {
    router.push({
      pathname: '/(tabs)/exames',
      params: {
        threadId: encodeURIComponent(threadId),
        tab: 'pendentes',
      },
    });
  };

  const handleClearThreadFilter = () => {
    router.replace({
      pathname: '/(tabs)/exames',
      params: activeTab === 'pendentes' ? { tab: 'pendentes' } : {},
    });
  };

  const pickFileWeb = (accept: string): Promise<File | null> => {
    return new Promise(resolve => {
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
        const base64 = res.includes(',') ? res.split(',')[1] : res;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
      reader.readAsDataURL(file);
    });
  };

  const uploadViaEdgeFunction = async (file: File) => {
    const base64 = await fileToBase64(file);
    const mime =
      file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

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
    return { fileUrl: data.file_url as string, mimeType: mime };
  };

  const handleUploadGeneral = async (mode: 'pdf' | 'image') => {
    try {
      setGeneralUploading(true);
      setGeneralError(null);
      setGeneralStatus('Selecionando arquivo...');

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      let uploadResult:
        | {
            fileUrl: string;
            mimeType: string;
            fileName: string;
            fileType: 'image' | 'pdf';
            storageBucket: string | null;
            storagePath: string | null;
          }
        | undefined;

      if (isWeb) {
        const accept = mode === 'pdf' ? 'application/pdf' : 'image/*';
        const file = await pickFileWeb(accept);
        if (!file) {
          setGeneralStatus('Envio cancelado.');
          return;
        }

        setGeneralStatus('Enviando arquivo...');
        const { fileUrl, mimeType } = await uploadViaEdgeFunction(file);
        uploadResult = {
          fileUrl,
          mimeType,
          fileName: file.name,
          fileType: mimeType === 'application/pdf' ? 'pdf' : 'image',
          storageBucket: null,
          storagePath: null,
        };
      } else {
        const pickedAsset = await pickNativeExamUploadAsset(mode === 'pdf' ? 'pdf' : 'image');
        if (!pickedAsset) {
          setGeneralStatus('Envio cancelado.');
          return;
        }

        setGeneralStatus('Enviando arquivo...');
        uploadResult = await uploadNativeExamAsset(pickedAsset);
      }

      const { fileUrl, mimeType, fileName, fileType, storageBucket, storagePath } = uploadResult;

      setGeneralStatus('Processando análise...');
      const uploadRecordPromise = supabase.from('exames_resultados').insert({
        user_id: user.id,
        titulo: 'Guia Geral de Exames',
        file_url: fileUrl,
        file_name: fileName,
        mime_type: mimeType,
        file_type: fileType,
        source: 'guia_geral',
        storage_bucket: storageBucket,
        storage_path: storagePath,
      });

      const analysisPromise = exameAnalysisService.analyzeExame({ fileUrl, fileType });

      const [analysisOutcome, uploadOutcome] = await Promise.allSettled([
        analysisPromise,
        uploadRecordPromise,
      ]);

      if (uploadOutcome.status === 'fulfilled' && uploadOutcome.value?.error) {
        console.warn('[Exames] Erro ao registrar upload da guia geral:', uploadOutcome.value.error);
      }
      if (uploadOutcome.status === 'rejected') {
        console.warn('[Exames] Falha ao registrar upload da guia geral:', uploadOutcome.reason);
      }

      if (analysisOutcome.status === 'rejected') {
        throw analysisOutcome.reason;
      }

      const analise = analysisOutcome.value;

      if (analise?.id) {
        await supabase
          .from('analises_exames')
          .update({ tipo_exame: 'guia_geral' })
          .eq('id', analise.id);
      }

      setGeneralStatus('Upload concluído. Confira em Exames Analisados.');
      setSnackbarMessage('Guia Geral recebida! A análise aparecerá em "Exames Analisados".');
      setSnackbarVisible(true);
      loadExames({ suppressNewNotice: true });
    } catch (error: any) {
      console.error('[Exames] Erro ao enviar guia geral:', error);
      setGeneralError(error?.message || 'Erro ao enviar a guia geral.');
      setGeneralStatus('');
    } finally {
      setGeneralUploading(false);
    }
  };

  const handleUploadAnamneseGeral = async (mode: 'pdf' | 'image') => {
    if (!threadIdFilter) {
      Alert.alert('Selecione uma anamnese', 'Abra uma sessão no histórico para enviar resultados.');
      return;
    }

    try {
      setAnamneseUploading(true);
      setAnamneseError(null);
      setAnamneseStatus('Selecionando arquivo...');

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      let uploadResult:
        | {
            fileUrl: string;
            mimeType: string;
            fileName: string;
            fileType: 'image' | 'pdf';
            storageBucket: string | null;
            storagePath: string | null;
          }
        | undefined;

      if (isWeb) {
        const accept = mode === 'pdf' ? 'application/pdf' : 'image/*';
        const file = await pickFileWeb(accept);
        if (!file) {
          setAnamneseStatus('Envio cancelado.');
          return;
        }

        setAnamneseStatus('Enviando arquivo...');
        const { fileUrl, mimeType } = await uploadViaEdgeFunction(file);
        uploadResult = {
          fileUrl,
          mimeType,
          fileName: file.name,
          fileType: mimeType === 'application/pdf' ? 'pdf' : 'image',
          storageBucket: null,
          storagePath: null,
        };
      } else {
        const pickedAsset = await pickNativeExamUploadAsset(mode === 'pdf' ? 'pdf' : 'image');
        if (!pickedAsset) {
          setAnamneseStatus('Envio cancelado.');
          return;
        }

        setAnamneseStatus('Enviando arquivo...');
        uploadResult = await uploadNativeExamAsset(pickedAsset);
      }

      const { fileUrl, mimeType, fileName, fileType, storageBucket, storagePath } = uploadResult;

      setAnamneseStatus('Processando análise...');
      const titulo = `Resultados da anamnese (${anamneseDateLabel})`;

      const uploadRecordPromise = supabase.from('exames_resultados').insert({
        user_id: user.id,
        id_threadconversa: threadIdFilter,
        titulo,
        file_url: fileUrl,
        file_name: fileName,
        mime_type: mimeType,
        file_type: fileType,
        source: 'anamnese_geral',
        storage_bucket: storageBucket,
        storage_path: storagePath,
      });

      const analysisPromise = exameAnalysisService.analyzeExame({ fileUrl, fileType });

      const [analysisOutcome, uploadOutcome] = await Promise.allSettled([
        analysisPromise,
        uploadRecordPromise,
      ]);

      if (uploadOutcome.status === 'fulfilled' && uploadOutcome.value?.error) {
        console.warn('[Exames] Erro ao registrar upload da anamnese:', uploadOutcome.value.error);
      }
      if (uploadOutcome.status === 'rejected') {
        console.warn('[Exames] Falha ao registrar upload da anamnese:', uploadOutcome.reason);
      }

      if (analysisOutcome.status === 'rejected') {
        throw analysisOutcome.reason;
      }

      setAnamneseStatus('Upload concluído. Confira em Exames Analisados.');
      setSnackbarMessage(
        'Resultados da anamnese enviados! A análise aparecerá em "Exames Analisados".'
      );
      setSnackbarVisible(true);
      loadExames({ suppressNewNotice: true });
    } catch (error: any) {
      console.error('[Exames] Erro ao enviar resultados da anamnese:', error);
      setAnamneseError(error?.message || 'Erro ao enviar resultados da anamnese.');
      setAnamneseStatus('');
    } finally {
      setAnamneseUploading(false);
    }
  };

  const handleGeneratePDF = async (exame: Exame) => {
    try {
      setGeneratingPdfId(exame.id);
      setBannerVisible(false);

      // Chamar backend do agent-ia para gerar PDF usando service role
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        throw new Error('Sessão inválida. Faça login novamente.');
      }

      const response = await fetch(`${APP_CONFIG.AGENT_IA_URL}/exames/generate-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ exameId: exame.id }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Falha ao gerar PDF');
      }

      // Aguardar um pouco e recarregar exames para verificar se o PDF foi gerado
      setTimeout(() => {
        loadExames();
      }, 2000);

      setSnackbarMessage('PDF gerado com sucesso!');
      setSnackbarVisible(true);
    } catch (error: any) {
      console.error('[Exames] Erro ao gerar PDF:', error);
      setSnackbarMessage('Erro ao gerar PDF. Tente novamente mais tarde.');
      setSnackbarVisible(true);
      setBannerVisible(true); // Mostrar banner novamente se falhar
    } finally {
      setGeneratingPdfId(null);
    }
  };

  const handleDownloadFile = async (url: string, title: string, exameId: number) => {
    try {
      setDownloadingPdfId(exameId);

      if (Platform.OS === 'web') {
        // No web, abrir o PDF em nova aba para download
        if (typeof window !== 'undefined' && window.document) {
          const link = window.document.createElement('a');
          link.href = url;
          link.download = getFileNameFromUrl(url, title || 'arquivo');
          link.target = '_blank';
          window.document.body.appendChild(link);
          link.click();
          window.document.body.removeChild(link);
        } else {
          // Fallback: abrir em nova aba
          await Linking.openURL(url);
        }
        setSnackbarMessage('Download iniciado!');
        setSnackbarVisible(true);
      } else {
        // No mobile, baixar e compartilhar
        const fileName = getFileNameFromUrl(url, title || 'arquivo');
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        const downloadResult = await FileSystem.downloadAsync(url, fileUri);

        if (downloadResult.status === 200) {
          const isAvailable = await Sharing.isAvailableAsync();

          if (isAvailable) {
            await Sharing.shareAsync(downloadResult.uri, {
              mimeType: inferMimeType(fileName),
              dialogTitle: 'Baixar Resultado de Exame',
            });
          } else {
            // Fallback: abrir o PDF
            await Linking.openURL(url);
          }
          setSnackbarMessage('Arquivo baixado com sucesso!');
          setSnackbarVisible(true);
        } else {
          throw new Error('Erro ao baixar o PDF');
        }
      }
    } catch (error: any) {
      console.error('[Exames] Erro ao baixar PDF:', error);
      setSnackbarMessage('Erro ao baixar o arquivo. Tente novamente.');
      setSnackbarVisible(true);
    } finally {
      setDownloadingPdfId(null);
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
      {/* Header alinhado com Flutter (HistoricodeExamesWidget): card 70px */}
      <View style={styles.headerOuter}>
        <View style={[styles.headerCard, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.headerContent}>
            <Text
              style={[styles.headerTitle, { color: theme.colors.onSurface, fontSize: scale(20) }]}
            >
              Histórico de Exames
            </Text>
            {/* Aviso simples de novos dados no histórico */}
            {newDataVisible && (
              <View
                style={[styles.newDataBadge, { backgroundColor: theme.colors.primaryContainer }]}
              >
                <Text
                  style={[
                    styles.newDataText,
                    { color: theme.colors.onPrimaryContainer, fontSize: scale(12) },
                  ]}
                >
                  Novos dados
                </Text>
              </View>
            )}
            <Button
              mode="contained"
              icon="upload"
              onPress={() => router.push('/(tabs)/interpretacao')}
              compact
              style={styles.analyzeButton}
            >
              Analisar Exame
            </Button>
          </View>
        </View>
      </View>

      <View style={styles.tabs}>
        {/* Flutter tem 4 tabs: Guias, Resultados, Prescrições, Exames Analisados.
            Aqui mantemos 3 estados e ajustamos os labels para ficar mais próximo. */}
        <Chip
          selected={activeTab === 'todos'}
          onPress={() => setActiveTab('todos')}
          style={styles.chip}
        >
          Guias
        </Chip>
        <Chip
          selected={activeTab === 'pendentes'}
          onPress={() => setActiveTab('pendentes')}
          style={styles.chip}
        >
          Resultados
        </Chip>
        <Chip
          selected={activeTab === 'analisados'}
          onPress={() => setActiveTab('analisados')}
          style={styles.chip}
        >
          Exames Analisados
        </Chip>
      </View>

      {activeTab === 'analisados' && (
        <View style={styles.analisadosFilters}>
          <Chip
            selected={analisadosFilter === 'todos'}
            onPress={() => setAnalisadosFilter('todos')}
            style={styles.chip}
          >
            Todos
          </Chip>
          <Chip
            selected={analisadosFilter === 'guia_geral'}
            onPress={() => setAnalisadosFilter('guia_geral')}
            style={styles.chip}
          >
            Guia Geral
          </Chip>
        </View>
      )}

      {threadIdFilter && (
        <Card
          style={[
            styles.threadFilterCard,
            {
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.outline,
            },
          ]}
        >
          <Card.Content style={styles.threadFilterContent}>
            <View style={styles.threadFilterInfo}>
              <Text
                style={[
                  styles.threadFilterTitle,
                  { color: theme.colors.onSurface, fontSize: scale(16) },
                ]}
              >
                Anamnese - {anamneseDateLabel}
              </Text>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                Você está vendo apenas os exames desta sessão.
              </Text>
            </View>
            <Button mode="text" onPress={handleClearThreadFilter}>
              Ver histórico geral
            </Button>
          </Card.Content>
        </Card>
      )}

      {threadIdFilter && activeTab !== 'pendentes' && (
        <Card
          style={[
            styles.generalUploadCard,
            {
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.outline,
            },
          ]}
        >
          <Card.Content>
            <View style={styles.generalUploadTop}>
              <View
                style={[
                  styles.generalUploadIconWrap,
                  { backgroundColor: theme.colors.primaryContainer },
                ]}
              >
                <MaterialIcons name="assignment" size={20} color={theme.colors.primary} />
              </View>
              <View style={styles.generalUploadTextCol}>
                <Text
                  style={[
                    styles.generalUploadTitle,
                    { color: theme.colors.onSurface, fontSize: scale(16) },
                  ]}
                >
                  Resultados da anamnese
                </Text>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>
                  Envie um único PDF ou foto referente à anamnese de {anamneseDateLabel}.
                </Text>
              </View>
              <Chip
                compact
                style={[
                  styles.generalUploadChip,
                  { backgroundColor: theme.colors.secondaryContainer },
                ]}
                textStyle={{ color: theme.colors.onSecondaryContainer }}
              >
                Anamnese
              </Chip>
            </View>
            <View style={styles.generalUploadHint}>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Assim que a análise estiver pronta, o resultado aparecerá em &quot;Exames
                Analisados&quot;.
              </Text>
            </View>

            {anamneseStatus ? (
              <View style={styles.generalStatusRow}>
                {anamneseUploading && <ActivityIndicator size="small" />}
                <Text variant="bodySmall" style={{ marginLeft: anamneseUploading ? 8 : 0 }}>
                  {anamneseStatus}
                </Text>
              </View>
            ) : null}

            {anamneseError ? (
              <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 8 }}>
                {anamneseError}
              </Text>
            ) : null}

            <View style={styles.generalUploadActions}>
              <Button
                mode="contained"
                icon="file-pdf-box"
                onPress={() => void handleUploadAnamneseGeral('pdf')}
                disabled={anamneseUploading}
              >
                Enviar PDF
              </Button>
              <Button
                mode="outlined"
                icon="image"
                onPress={() => void handleUploadAnamneseGeral('image')}
                disabled={anamneseUploading}
              >
                Enviar Imagem
              </Button>
            </View>
          </Card.Content>
        </Card>
      )}

      {activeTab !== 'pendentes' && (
        <Card
          style={[
            styles.generalUploadCard,
            {
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.outline,
            },
          ]}
        >
          <Card.Content>
            <View style={styles.generalUploadTop}>
              <View
                style={[
                  styles.generalUploadIconWrap,
                  { backgroundColor: theme.colors.primaryContainer },
                ]}
              >
                <MaterialIcons name="folder-shared" size={20} color={theme.colors.primary} />
              </View>
              <View style={styles.generalUploadTextCol}>
                <Text
                  style={[
                    styles.generalUploadTitle,
                    { color: theme.colors.onSurface, fontSize: scale(16) },
                  ]}
                >
                  Guia Geral de Exames
                </Text>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>
                  {latestGeneralGuide
                    ? 'Abra a guia real com a lista completa de exames solicitados.'
                    : 'Envie um único PDF ou foto com vários exames no mesmo documento.'}
                </Text>
              </View>
            </View>
            {!latestGeneralGuide && (
              <View style={styles.generalUploadHint}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {
                    'Assim que a análise estiver pronta, o resultado aparecerá em "Exames Analisados".'
                  }
                </Text>
              </View>
            )}

            {latestGeneralGuide ? (
              <View style={styles.generalUploadActions}>
                <Button
                  mode="outlined"
                  icon="eye"
                  onPress={() => openPDFPreview(latestGeneralGuide.url, latestGeneralGuide.title)}
                >
                  Visualizar Guia
                </Button>
                <Button
                  mode="contained"
                  icon="download"
                  onPress={() =>
                    handleDownloadFile(
                      latestGeneralGuide.url,
                      latestGeneralGuide.title,
                      latestGeneralGuide.id
                    )
                  }
                  loading={downloadingPdfId === latestGeneralGuide.id}
                  disabled={downloadingPdfId === latestGeneralGuide.id}
                >
                  Baixar Guia
                </Button>
              </View>
            ) : (
              <>
                {generalStatus ? (
                  <View style={styles.generalStatusRow}>
                    {generalUploading && <ActivityIndicator size="small" />}
                    <Text variant="bodySmall" style={{ marginLeft: generalUploading ? 8 : 0 }}>
                      {generalStatus}
                    </Text>
                  </View>
                ) : null}

                {generalError ? (
                  <Text variant="bodySmall" style={{ color: theme.colors.error, marginTop: 8 }}>
                    {generalError}
                  </Text>
                ) : null}

                <View style={styles.generalUploadActions}>
                  <Button
                    mode="contained"
                    icon="file-pdf-box"
                    onPress={() => void handleUploadGeneral('pdf')}
                    disabled={generalUploading}
                  >
                    Enviar PDF
                  </Button>
                  <Button
                    mode="outlined"
                    icon="image"
                    onPress={() => void handleUploadGeneral('image')}
                    disabled={generalUploading}
                  >
                    Enviar Imagem
                  </Button>
                </View>
              </>
            )}
          </Card.Content>
        </Card>
      )}

      {/* Banner de aviso para exames sem PDF */}
      {activeTab !== 'pendentes' && bannerVisible && examesSemPdf.length > 0 && (
        <View style={styles.bannerContainer}>
          <Banner
            visible={bannerVisible}
            actions={[
              {
                label: 'Tentar Gerar Agora',
                onPress: () => {
                  if (examesSemPdf.length > 0) {
                    handleGeneratePDF(examesSemPdf[0]);
                  }
                },
              },
              {
                label: 'Fechar',
                onPress: () => setBannerVisible(false),
              },
            ]}
            icon="alert-circle"
            style={styles.banner}
          >
            {examesSemPdf.length === 1
              ? `Não foi possível gerar a guia do exame "${examesSemPdf[0].titulo}". Os exames foram registrados, mas a guia em PDF não pôde ser gerada. Você pode tentar gerar novamente.`
              : `Não foi possível gerar a guia de ${examesSemPdf.length} exames. Os exames foram registrados, mas as guias em PDF não puderam ser geradas. Você pode tentar gerar novamente.`}
          </Banner>
        </View>
      )}

      <View style={[styles.tableOuter, { backgroundColor: theme.colors.surface }]}>
        {isDesktopWeb && activeTab !== 'pendentes' ? (
          <DataTable>
            <DataTable.Header>
              {activeTab === 'analisados' ? (
                <>
                  <DataTable.Title style={styles.colExame}>Documento</DataTable.Title>
                  <DataTable.Title style={styles.colData}>Data</DataTable.Title>
                  <DataTable.Title style={styles.colAcao}>Download</DataTable.Title>
                </>
              ) : (
                <>
                  <DataTable.Title style={styles.colExame}>Exame</DataTable.Title>
                  <DataTable.Title style={styles.colData}>Data</DataTable.Title>
                  <DataTable.Title style={styles.colAcao}>PDF</DataTable.Title>
                  <DataTable.Title style={styles.colAcao}>Interpretação</DataTable.Title>
                  {activeTab === 'todos' && (
                    <DataTable.Title style={styles.colStatus}>Status</DataTable.Title>
                  )}
                </>
              )}
            </DataTable.Header>

            {filteredExames.map(exame => {
              if (activeTab === 'analisados') {
                const downloadUrl = getDownloadUrl(exame);
                return (
                  <DataTable.Row key={exame.id}>
                    <DataTable.Cell style={styles.colExame}>
                      <TouchableOpacity onPress={() => openInterpretation(exame)}>
                        <Text
                          style={{ color: '#1976d2', textDecorationLine: 'underline' }}
                          numberOfLines={2}
                        >
                          {exame.titulo || 'Exame'}
                        </Text>
                      </TouchableOpacity>
                    </DataTable.Cell>
                    <DataTable.Cell style={styles.colData}>
                      {formatDate(exame.created_at)}
                    </DataTable.Cell>
                    <DataTable.Cell>
                      {downloadUrl ? (
                        <Button
                          mode="text"
                          icon="download"
                          onPress={() =>
                            handleDownloadFile(downloadUrl, exame.titulo || 'Exame', exame.id)
                          }
                          loading={downloadingPdfId === exame.id}
                          disabled={downloadingPdfId === exame.id}
                          compact
                        >
                          Baixar
                        </Button>
                      ) : (
                        <Text style={{ fontSize: scale(12), color: theme.colors.onSurfaceVariant }}>
                          Indisponível
                        </Text>
                      )}
                    </DataTable.Cell>
                  </DataTable.Row>
                );
              }

              // Para outras abas, manter o layout completo
              return (
                <DataTable.Row key={exame.id}>
                  <DataTable.Cell style={styles.colExame}>
                    <View style={styles.tableTitleCell}>
                      <Text style={styles.tableTitleText} numberOfLines={2}>
                        {exame.titulo || 'Exame'}
                      </Text>
                      {exame.is_general_guide && (
                        <Chip compact style={styles.generalGuideChip} icon="file-document">
                          Guia geral
                        </Chip>
                      )}
                    </View>
                  </DataTable.Cell>
                  <DataTable.Cell style={styles.colData}>
                    {formatDate(exame.created_at)}
                  </DataTable.Cell>
                  <DataTable.Cell style={styles.colAcao}>
                    {exame.urlpdf ? (
                      <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                        <Button
                          mode="text"
                          icon="eye"
                          onPress={() => openPDFPreview(exame.urlpdf!, exame.titulo || 'Exame')}
                          compact
                        >
                          Visualizar
                        </Button>
                        <Button
                          mode="text"
                          icon="download"
                          onPress={() =>
                            handleDownloadFile(exame.urlpdf!, exame.titulo || 'Exame', exame.id)
                          }
                          loading={downloadingPdfId === exame.id}
                          disabled={downloadingPdfId === exame.id}
                          compact
                        >
                          Baixar
                        </Button>
                      </View>
                    ) : exame.foi_analisado ? (
                      <Text
                        style={{
                          fontSize: scale(12),
                          color: theme.colors.primary,
                          fontStyle: 'italic',
                        }}
                      >
                        Concluído
                      </Text>
                    ) : (
                      <Button
                        mode="outlined"
                        icon="file-pdf-box"
                        onPress={() => handleGeneratePDF(exame)}
                        loading={generatingPdfId === exame.id}
                        disabled={generatingPdfId === exame.id}
                        compact
                      >
                        {generatingPdfId === exame.id ? 'Gerando...' : 'Gerar PDF'}
                      </Button>
                    )}
                  </DataTable.Cell>
                  <DataTable.Cell style={styles.colAcao}>
                    {exame.foi_analisado ? (
                      <Chip compact icon="check-circle">
                        Concluído
                      </Chip>
                    ) : (
                      <Button
                        mode="text"
                        onPress={() =>
                          router.push({
                            pathname: '/exames/interpretacao',
                            params: { exameId: exame.id.toString() },
                          })
                        }
                      >
                        Ver
                      </Button>
                    )}
                  </DataTable.Cell>
                  {activeTab === 'todos' && (
                    <DataTable.Cell style={styles.colStatus}>
                      {renderGuiaStatus(exame, { compact: true })}
                    </DataTable.Cell>
                  )}
                </DataTable.Row>
              );
            })}
          </DataTable>
        ) : (
          <>
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={[
                styles.scrollViewContent,
                showFloatingResultadosProgress && styles.scrollViewContentWithFloatingProgress,
              ]}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
              {(
                activeTab === 'pendentes'
                  ? showResultadosSessionHistory
                    ? resultadosSessionSummaries.length === 0
                    : resultadosTabExames.length === 0
                  : filteredExames.length === 0
              ) ? (
                <Card style={styles.emptyCard}>
                  <Card.Content>
                    <Text variant="bodyLarge" style={{ textAlign: 'center' }}>
                      {activeTab === 'pendentes'
                        ? showResultadosSessionHistory
                          ? 'Nenhum histórico de exames encontrado'
                          : 'Nenhum exame aguardando resultado'
                        : 'Nenhum exame encontrado'}
                    </Text>
                    {activeTab === 'pendentes' && showResultadosSessionHistory ? (
                      <Text
                        variant="bodySmall"
                        style={{
                          textAlign: 'center',
                          color: theme.colors.onSurfaceVariant,
                          marginTop: 8,
                        }}
                      >
                        Quando novas anamneses gerarem exames, elas aparecerão aqui separadas por
                        sessão.
                      </Text>
                    ) : null}
                  </Card.Content>
                </Card>
              ) : (
                (showResultadosSessionHistory
                  ? resultadosSessionSummaries
                  : activeTab === 'pendentes'
                    ? resultadosTabExames
                    : filteredExames
                ).map(item => {
                  if (showResultadosSessionHistory) {
                    const session = item as ResultadoSessionSummary;
                    const isCurrentSession = session.threadId === currentThreadId;
                    const examesLabel = `${session.totalExames} exame${session.totalExames > 1 ? 's' : ''}`;

                    return (
                      <Card
                        key={`resultado-sessao-${session.threadId}`}
                        style={[
                          styles.card,
                          styles.resultadoSessionCard,
                          isCurrentSession ? styles.resultadoSessionCardCurrent : null,
                        ]}
                      >
                        <Card.Content>
                          <View style={styles.resultadoSessionHeader}>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold', flex: 1 }}>
                              Anamnese - {formatDate(session.sessionAt)}
                            </Text>
                            <Chip
                              compact
                              mode={isCurrentSession ? 'flat' : 'outlined'}
                              style={[
                                styles.resultadoSessionChip,
                                isCurrentSession
                                  ? { backgroundColor: theme.colors.primaryContainer }
                                  : null,
                              ]}
                              textStyle={{
                                color: isCurrentSession
                                  ? theme.colors.onPrimaryContainer
                                  : theme.colors.onSurfaceVariant,
                              }}
                            >
                              {isCurrentSession ? 'Sessão atual' : 'Arquivada'}
                            </Chip>
                          </View>

                          <Text
                            variant="bodySmall"
                            style={{ color: theme.colors.onSurfaceVariant }}
                          >
                            {formatTime(session.sessionAt)} · {examesLabel}
                          </Text>

                          <View style={styles.resultadoSessionProgressHeader}>
                            <Text
                              variant="bodyMedium"
                              style={{ color: theme.colors.onSurfaceVariant }}
                            >
                              {session.completedExames} de {session.totalExames} exames com
                              resultado enviado.
                            </Text>
                            <Chip
                              compact
                              style={{ backgroundColor: theme.colors.primaryContainer }}
                              textStyle={{ color: theme.colors.onPrimaryContainer }}
                            >
                              {session.percentage}% completo
                            </Chip>
                          </View>

                          <ProgressBar
                            progress={session.progress}
                            color={theme.colors.primary}
                            style={styles.resultadoSessionProgressBar}
                          />

                          <View style={styles.resultadoSessionActions}>
                            <Button
                              mode={isCurrentSession ? 'contained' : 'outlined'}
                              onPress={() => handleOpenResultadosSession(session.threadId)}
                            >
                              {isCurrentSession ? 'Abrir sessão atual' : 'Ver resultados'}
                            </Button>
                          </View>
                        </Card.Content>
                      </Card>
                    );
                  }

                  if (activeTab === 'pendentes') {
                    const exame = item as Exame;
                    const resultado = latestResultadoByTaskId.get(exame.id);
                    const resultadoEnviado = isResultadoEnviado(exame);
                    const downloadUrl = resultado ? getDownloadableUrl(resultado.file_url) : '';

                    return (
                      <Card
                        key={`resultado-exame-${exame.id}`}
                        style={[
                          styles.card,
                          styles.resultadoExamCard,
                          resultadoEnviado && styles.resultadoExamCardCompleted,
                        ]}
                      >
                        <TouchableOpacity
                          onPress={() => openResultUpload(exame)}
                          activeOpacity={0.75}
                          disabled={uploadingResultExamId === exame.id}
                        >
                          <Card.Content>
                            <View style={styles.resultadoExamHeader}>
                              <MaterialIcons
                                name={resultadoEnviado ? 'check-circle' : 'radio-button-unchecked'}
                                size={scale(24)}
                                color={resultadoEnviado ? '#2E7D32' : theme.colors.onSurfaceVariant}
                              />
                              <View style={styles.resultadoExamInfo}>
                                <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                                  {exame.titulo || 'Exame'}
                                </Text>
                                {exame.descricao ? (
                                  <Text
                                    variant="bodySmall"
                                    numberOfLines={2}
                                    style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}
                                  >
                                    {exame.descricao}
                                  </Text>
                                ) : null}
                              </View>
                            </View>

                            <View style={styles.resultadoExamMeta}>
                              <Text
                                variant="bodySmall"
                                style={{ color: theme.colors.onSurfaceVariant }}
                              >
                                {resultado
                                  ? `Último envio em ${formatDate(resultado.created_at)}`
                                  : 'Aguardando o upload do resultado deste exame.'}
                              </Text>
                              <Chip
                                compact
                                icon={resultadoEnviado ? 'check-circle' : 'clock-outline'}
                                style={[
                                  styles.resultadoStatusChip,
                                  {
                                    backgroundColor: resultadoEnviado
                                      ? theme.colors.primaryContainer
                                      : theme.colors.secondaryContainer,
                                  },
                                ]}
                                textStyle={{
                                  color: resultadoEnviado
                                    ? theme.colors.onPrimaryContainer
                                    : theme.colors.onSecondaryContainer,
                                }}
                              >
                                {resultadoEnviado ? 'Enviado' : 'Pendente'}
                              </Chip>
                            </View>

                            <View style={styles.resultadoExamActions}>
                              {downloadUrl ? (
                                <Button
                                  mode="outlined"
                                  icon="download"
                                  onPress={() =>
                                    handleDownloadFile(
                                      downloadUrl,
                                      exame.titulo || 'Exame',
                                      resultado?.id || exame.id
                                    )
                                  }
                                  disabled={downloadingPdfId === (resultado?.id || exame.id)}
                                  loading={downloadingPdfId === (resultado?.id || exame.id)}
                                  style={styles.resultadoExamButton}
                                >
                                  Baixar envio
                                </Button>
                              ) : null}
                              <Button
                                mode={resultadoEnviado ? 'text' : 'contained'}
                                icon={resultadoEnviado ? 'refresh' : 'upload'}
                                onPress={() => openResultUpload(exame)}
                                style={styles.resultadoExamButton}
                                disabled={uploadingResultExamId === exame.id}
                                loading={uploadingResultExamId === exame.id}
                              >
                                {uploadingResultExamId === exame.id
                                  ? 'Enviando...'
                                  : resultadoEnviado
                                    ? 'Substituir envio'
                                    : 'Enviar resultado'}
                              </Button>
                            </View>
                          </Card.Content>
                        </TouchableOpacity>
                      </Card>
                    );
                  }

                  const exame = item as Exame;
                  if (activeTab === 'analisados') {
                    const downloadUrl = getDownloadUrl(exame);
                    return (
                      <Card key={exame.id} style={styles.card}>
                        <TouchableOpacity
                          onPress={() => openInterpretation(exame)}
                          activeOpacity={0.7}
                        >
                          <Card.Content>
                            <View style={styles.cardHeader}>
                              <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                                {exame.titulo || 'Exame'}
                              </Text>
                              <Text
                                variant="bodySmall"
                                style={{ color: theme.colors.onSurfaceVariant }}
                              >
                                {formatDate(exame.created_at)}
                              </Text>
                            </View>

                            <Button
                              mode="outlined"
                              icon="download"
                              onPress={() =>
                                downloadUrl &&
                                handleDownloadFile(downloadUrl, exame.titulo || 'Exame', exame.id)
                              }
                              disabled={!downloadUrl || downloadingPdfId === exame.id}
                              loading={downloadingPdfId === exame.id}
                              style={styles.resultadoButton}
                            >
                              Baixar
                            </Button>
                          </Card.Content>
                        </TouchableOpacity>
                      </Card>
                    );
                  }

                  // Para outras abas, manter o layout completo
                  return (
                    <Card key={exame.id} style={styles.card}>
                      <Card.Content>
                        {activeTab === 'todos' ? (
                          <View style={[styles.cardHeader, styles.cardHeaderWithStatus]}>
                            <View style={styles.cardHeaderLeft}>
                              <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                                {exame.titulo || 'Exame'}
                              </Text>
                            </View>
                            <View style={styles.cardHeaderRight}>
                              <Text
                                variant="bodySmall"
                                style={{ color: theme.colors.onSurfaceVariant }}
                              >
                                {formatDate(exame.created_at)}
                              </Text>
                              {renderGuiaStatus(exame)}
                            </View>
                          </View>
                        ) : (
                          <View style={styles.cardHeader}>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                              {exame.titulo || 'Exame'}
                            </Text>
                            <Text
                              variant="bodySmall"
                              style={{ color: theme.colors.onSurfaceVariant }}
                            >
                              {formatDate(exame.created_at)}
                            </Text>
                          </View>
                        )}

                        {exame.is_general_guide && (
                          <Chip
                            style={[styles.generalGuideChip, styles.generalGuideChipCard]}
                            textStyle={styles.generalGuideChipText}
                            icon="file-document"
                            compact
                          >
                            Guia geral
                          </Chip>
                        )}

                        {exame.urgencia && (
                          <Chip style={styles.categoryChip} compact>
                            {exame.urgencia === 'urgente'
                              ? 'PRIORIDADE Urgente'
                              : exame.urgencia === 'alta'
                                ? 'PRIORIDADE Alta'
                                : exame.urgencia === 'média'
                                  ? 'PRIORIDADE Média'
                                  : `PRIORIDADE ${exame.urgencia}`}
                          </Chip>
                        )}

                        {exame.descricao && (
                          <Text variant="bodyMedium" style={styles.description}>
                            {exame.descricao}
                          </Text>
                        )}

                        {exame.interpretacao && activeTab !== 'pendentes' && (
                          <Text
                            variant="bodySmall"
                            style={{ marginTop: 8, color: theme.colors.onSurfaceVariant }}
                          >
                            {exame.interpretacao.substring(0, 150)}...
                          </Text>
                        )}

                        {/* Mostrar status se foi analisado */}
                        {exame.foi_analisado && (
                          <Chip
                            icon="check-circle"
                            style={[
                              styles.statusChip,
                              { backgroundColor: theme.colors.primaryContainer },
                            ]}
                            textStyle={{ color: theme.colors.onPrimaryContainer }}
                          >
                            Concluído
                          </Chip>
                        )}

                        {exame.urlpdf && !exame.foi_analisado ? (
                          <View style={styles.pdfButtonsContainer}>
                            <Button
                              mode="outlined"
                              icon="eye"
                              onPress={() => openPDFPreview(exame.urlpdf!, exame.titulo || 'Exame')}
                              style={styles.pdfButton}
                            >
                              Visualizar Guia
                            </Button>
                            <Button
                              mode="contained"
                              icon="download"
                              onPress={() =>
                                handleDownloadFile(exame.urlpdf!, exame.titulo || 'Exame', exame.id)
                              }
                              loading={downloadingPdfId === exame.id}
                              disabled={downloadingPdfId === exame.id}
                              style={styles.pdfButton}
                            >
                              {downloadingPdfId === exame.id ? 'Baixando...' : 'Baixar Guia'}
                            </Button>
                          </View>
                        ) : !exame.foi_analisado ? (
                          <Button
                            mode="outlined"
                            icon="file-pdf-box"
                            onPress={() => handleGeneratePDF(exame)}
                            loading={generatingPdfId === exame.id}
                            disabled={generatingPdfId === exame.id}
                            style={styles.pdfButton}
                          >
                            {generatingPdfId === exame.id ? 'Gerando PDF...' : 'Gerar Guia em PDF'}
                          </Button>
                        ) : (
                          <Text
                            variant="bodySmall"
                            style={{
                              marginTop: 8,
                              color: theme.colors.primary,
                              fontStyle: 'italic',
                            }}
                          >
                            Exame executado - Guia não disponível para download
                          </Text>
                        )}

                        {exame.interpretacao && (
                          <Button
                            mode="text"
                            onPress={() =>
                              router.push({
                                pathname: '/exames/interpretacao',
                                params: { exameId: exame.id.toString() },
                              })
                            }
                            style={styles.interpretButton}
                          >
                            Ver Interpretação
                          </Button>
                        )}
                      </Card.Content>
                    </Card>
                  );
                })
              )}
            </ScrollView>
            {showFloatingResultadosProgress && (
              <View pointerEvents="box-none" style={styles.floatingResultadosProgressWrap}>
                <Card style={styles.floatingResultadosProgressCard}>
                  <Card.Content>
                    <View style={styles.resultadosProgressHeader}>
                      <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                        Upload dos Exames
                      </Text>
                      <Chip
                        compact
                        style={{ backgroundColor: theme.colors.primaryContainer }}
                        textStyle={{ color: theme.colors.onPrimaryContainer }}
                      >
                        {resultadosProgress.percentage}% completo
                      </Chip>
                    </View>
                    <ProgressBar
                      progress={resultadosProgress.progress}
                      color={theme.colors.primary}
                      style={styles.resultadosProgressBar}
                    />
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {resultadosProgress.completed} de {resultadosProgress.total} exames com
                      resultado enviado.
                    </Text>
                  </Card.Content>
                </Card>
              </View>
            )}
          </>
        )}
      </View>

      <PDFPreviewModal
        visible={!!previewPdfUrl}
        onDismiss={closePDFPreview}
        pdfUrl={previewPdfUrl || ''}
        title={previewTitle}
      />

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={4000}
        action={{
          label: 'Ver',
          onPress: () => {
            setSnackbarVisible(false);
            // Scroll para o topo para mostrar novos exames
            setActiveTab('todos');
          },
        }}
      >
        {snackbarMessage}
      </Snackbar>
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
    minHeight: 70,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
  },
  // Aviso simples de novos dados no histórico
  newDataBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginLeft: 12,
    alignSelf: 'center',
  },
  newDataText: {
    fontSize: 12,
    fontWeight: '600',
  },
  analyzeButton: {
    marginLeft: 16,
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: 8,
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    gap: 8,
  },
  analisadosFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  generalUploadCard: {
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 12,
  },
  threadFilterCard: {
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 12,
  },
  threadFilterContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  threadFilterInfo: {
    flex: 1,
    minWidth: 220,
  },
  threadFilterTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  generalUploadTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  generalUploadIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generalUploadTextCol: {
    flex: 1,
  },
  generalUploadChip: {
    borderRadius: 999,
  },
  generalUploadHint: {
    marginTop: 8,
  },
  generalUploadTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  generalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  generalUploadActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  tableTitleCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  tableTitleText: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  colExame: {
    flex: 3,
  },
  colData: {
    flex: 2,
  },
  colAcao: {
    flex: 2,
  },
  colStatus: {
    flex: 2,
  },
  generalGuideChip: {
    borderRadius: 999,
  },
  generalGuideChipCard: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  generalGuideChipText: {
    fontSize: 11,
  },
  bannerContainer: {
    marginHorizontal: 8,
    marginBottom: 8,
  },
  banner: {
    borderRadius: 12,
  },
  chip: {
    marginRight: 0,
  },
  tableOuter: {
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 12,
    flex: 1,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    paddingBottom: 8,
  },
  scrollViewContentWithFloatingProgress: {
    paddingTop: 156,
  },
  card: {
    marginBottom: 12,
  },
  emptyCard: {
    marginTop: 32,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardHeaderWithStatus: {
    alignItems: 'flex-start',
  },
  cardHeaderLeft: {
    flex: 1,
    paddingRight: 8,
  },
  cardHeaderRight: {
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: 150,
  },
  categoryChip: {
    alignSelf: 'flex-start',
    marginTop: 8,
    marginBottom: 8,
  },
  description: {
    marginTop: 8,
    marginBottom: 8,
  },
  pdfButtonsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  pdfButton: {
    flex: 1,
  },
  interpretButton: {
    marginTop: 4,
  },
  resultadoButton: {
    marginTop: 12,
  },
  resultadoSessionCard: {
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  resultadoSessionCardCurrent: {
    borderColor: '#2F80ED',
  },
  resultadoSessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  resultadoSessionChip: {
    borderRadius: 999,
  },
  resultadoSessionProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  resultadoSessionProgressBar: {
    height: 10,
    borderRadius: 999,
    marginTop: 10,
  },
  resultadoSessionActions: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  resultadoExamCard: {
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  resultadoExamCardCompleted: {
    borderColor: 'rgba(46, 125, 50, 0.35)',
  },
  resultadoExamHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  resultadoExamInfo: {
    flex: 1,
  },
  resultadoExamMeta: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  resultadoStatusChip: {
    borderRadius: 999,
  },
  resultadoExamActions: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  resultadoExamButton: {
    flexGrow: 1,
  },
  floatingResultadosProgressWrap: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 8,
    zIndex: 10,
  },
  floatingResultadosProgressCard: {
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
  },
  resultadosProgressCard: {
    marginTop: 4,
  },
  resultadosProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  resultadosProgressBar: {
    height: 10,
    borderRadius: 999,
    marginBottom: 8,
  },
  statusChip: {
    marginTop: 8,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  guiaStatusCell: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  guiaStatus: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  guiaStatusText: {
    textAlign: 'center',
    fontWeight: '600',
  },
});
