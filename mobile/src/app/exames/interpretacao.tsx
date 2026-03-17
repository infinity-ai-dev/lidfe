import { useState, useEffect } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { Text, Card, ActivityIndicator, useTheme } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/services/supabase/client';
import { exameAnalysisService } from '@/services/exame-analysis';

interface Exame {
  exame_id: number;
  descricao?: string;
  categoria?: string;
  tipo?: string;
  medico?: string;
  created_at: string;
}

interface Fonte {
  titulo: string;
  url?: string;
  tipo: string;
}

export default function InterpretacaoExameScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { exameId, fromResultados } = useLocalSearchParams<{ exameId: string; fromResultados?: string }>();
  const [exame, setExame] = useState<any>(null);
  const [interpretacao, setInterpretacao] = useState<string>('');
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    loadExame();
  }, [exameId]);

  const loadExame = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const id = parseInt(exameId || '0');
      
      // Se vier da aba "Resultados", buscar diretamente de analises_exames
      if (fromResultados === 'true') {
        const { data, error } = await supabase
          .from('analises_exames')
          .select('*')
          .eq('id', id)
          .eq('user_id', user.id)
          .single();

        if (error) {
          console.error('[Interpretacao] Erro ao buscar análise:', error);
          if (error.code === 'PGRST116') {
            setInterpretacao('Interpretação não encontrada.');
          }
          return;
        }

        // Extrair nome do arquivo da URL para usar como título
        const fileName = data.url_arquivo?.split('/').pop() || 'Exame analisado';
        const tipoExame = data.tipo_arquivo === 'pdf' ? 'PDF' : 
                         fileName.split('.').pop()?.toUpperCase() === 'PDF' ? 'PDF' : 
                         'Imagem';

        setExame({
          tipo: tipoExame,
          categoria: data.tipo_arquivo,
          created_at: data.created_at,
        });

        if (data.interpretacao) {
          setInterpretacao(data.interpretacao);
        }

        if (data.fontes && Array.isArray(data.fontes)) {
          setFontes(data.fontes as Fonte[]);
        }

        setLoading(false);
        return;
      }

      // Caso contrário, tentar buscar em tasks_listaexames primeiro
      const { data: exameData, error: exameError } = await supabase
        .from('tasks_listaexames')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

      if (exameError) {
        // Se não encontrar em tasks_listaexames, tentar em analises_exames
        const { data: analiseData, error: analiseError } = await supabase
          .from('analises_exames')
          .select('*')
          .eq('id', id)
          .eq('user_id', user.id)
          .single();

        if (analiseError) {
          console.error('[Interpretacao] Erro ao buscar exame/análise:', analiseError);
          setInterpretacao('Exame não encontrado.');
          setLoading(false);
          return;
        }

        // Processar análise
        const fileName = analiseData.url_arquivo?.split('/').pop() || 'Exame analisado';
        const tipoExame = analiseData.tipo_arquivo === 'pdf' ? 'PDF' : 
                         fileName.split('.').pop()?.toUpperCase() === 'PDF' ? 'PDF' : 
                         'Imagem';

        setExame({
          tipo: tipoExame,
          categoria: analiseData.tipo_arquivo,
          created_at: analiseData.created_at,
        });

        if (analiseData.interpretacao) {
          setInterpretacao(analiseData.interpretacao);
        }

        if (analiseData.fontes && Array.isArray(analiseData.fontes)) {
          setFontes(analiseData.fontes as Fonte[]);
        }

        setLoading(false);
        return;
      }

      // Processar exame de tasks_listaexames
      setExame({
        tipo: exameData.titulo || 'Exame',
        categoria: exameData.urgencia,
        created_at: exameData.created_at,
      });

      // Buscar análise correspondente via relacionamento (mais eficiente)
      // Usar task_exame_id ao invés de urlfoto
      const { data: analiseData } = await supabase
        .from('analises_exames')
        .select('*')
        .eq('task_exame_id', exameData.id)
        .eq('user_id', user.id)
        .eq('status', 'concluida')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Se não encontrar por relacionamento, tentar por urlfoto (fallback)
      if (!analiseData && exameData.urlfoto) {
        const { data: analisePorUrl } = await supabase
          .from('analises_exames')
          .select('*')
          .eq('url_arquivo', exameData.urlfoto)
          .eq('user_id', user.id)
          .eq('status', 'concluida')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (analisePorUrl?.interpretacao) {
          setInterpretacao(analisePorUrl.interpretacao);
          if (analisePorUrl.fontes && Array.isArray(analisePorUrl.fontes)) {
            setFontes(analisePorUrl.fontes as Fonte[]);
          }
        }
      } else if (analiseData?.interpretacao) {
        setInterpretacao(analiseData.interpretacao);
        if (analiseData.fontes && Array.isArray(analiseData.fontes)) {
          setFontes(analiseData.fontes as Fonte[]);
        }
      } else if (exameData.interpretacao) {
        // Fallback: usar interpretação diretamente do exame
        setInterpretacao(exameData.interpretacao);
        if (exameData.fontes && Array.isArray(exameData.fontes)) {
          setFontes(exameData.fontes as Fonte[]);
        }
      }
    } catch (error) {
      console.error('[Interpretacao] Erro ao carregar exame:', error);
    } finally {
      setLoading(false);
    }
  };

  const analyzeExame = async (exameData: Exame) => {
    setAnalyzing(true);
    try {
      // Buscar análise existente primeiro
      const analise = await exameAnalysisService.getAnaliseByExameId(exameData.exame_id);
      
      if (analise && (analise.analise || (analise as any).interpretacao)) {
        const interpretacaoTexto = (analise as any).interpretacao || analise.analise || '';
        setInterpretacao(interpretacaoTexto);
        // Carregar fontes se disponíveis
        if (analise.fontes && Array.isArray(analise.fontes)) {
          setFontes(analise.fontes as Fonte[]);
        }
        await supabase
          .from('exames')
          .update({ descricao: interpretacaoTexto })
          .eq('exame_id', exameData.exame_id);
      } else {
        // Se não houver análise, mostrar mensagem
        setInterpretacao('Análise não disponível. Faça upload do resultado do exame para análise automática.');
      }
    } catch (error) {
      console.error('[Interpretacao] Erro ao analisar exame:', error);
      setInterpretacao('Erro ao carregar interpretação do exame.');
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!exame && !loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Text variant="bodyLarge">Exame não encontrado</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleLarge" style={{ fontWeight: 'bold', marginBottom: 8 }}>
            {exame.tipo || 'Exame'}
          </Text>
          {exame.categoria && (
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              Categoria: {exame.categoria}
            </Text>
          )}
          {exame.medico && (
            <Text variant="bodySmall" style={{ marginBottom: 8 }}>
              Médico: {exame.medico}
            </Text>
          )}
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium" style={{ fontWeight: 'bold', marginBottom: 16 }}>
            Interpretação
          </Text>
          
          {analyzing ? (
            <ActivityIndicator />
          ) : interpretacao ? (
            <Text variant="bodyMedium" style={styles.interpretacao}>
              {interpretacao}
            </Text>
          ) : (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Nenhuma interpretação disponível
            </Text>
          )}
        </Card.Content>
      </Card>

      {fontes.length > 0 && (
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="titleMedium" style={{ fontWeight: 'bold', marginBottom: 16 }}>
              Fontes e Referências
            </Text>
            <Text variant="bodySmall" style={{ marginBottom: 12, color: theme.colors.onSurfaceVariant }}>
              Esta interpretação foi baseada nas seguintes fontes, bases intelectuais e compêndios médicos:
            </Text>
            {fontes.map((fonte, index) => (
              <View key={index} style={styles.fonteItem}>
                <Text variant="bodySmall" style={{ fontWeight: '600', marginBottom: 4 }}>
                  {fonte.titulo}
                </Text>
                {fonte.tipo && (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}>
                    Tipo: {fonte.tipo === 'artigo' ? 'Artigo Científico' : fonte.tipo === 'diretriz' ? 'Diretriz Clínica' : fonte.tipo === 'compendio' ? 'Compêndio Médico' : fonte.tipo}
                  </Text>
                )}
                {fonte.url && (
                  <Text 
                    variant="bodySmall" 
                    style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
                    onPress={() => {
                      // Abrir URL no navegador
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
          </Card.Content>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  card: {
    marginBottom: 16,
  },
  interpretacao: {
    lineHeight: 24,
  },
  fonteItem: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
});
