import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';

export default function TermosUsoScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>
          Termos de Uso
        </Text>
        <Text variant="bodyMedium" style={[styles.content, { color: theme.colors.onSurface }]}>
          {`Ao usar o aplicativo LIDFE, você concorda com os seguintes termos:

1. Uso do Aplicativo
O LIDFE é uma ferramenta de apoio médico que utiliza inteligência artificial para auxiliar na anamnese e análise de exames. Este aplicativo não substitui a consulta médica presencial.

2. Responsabilidades
Você é responsável por fornecer informações precisas e atualizadas. O LIDFE não se responsabiliza por decisões médicas tomadas com base nas informações fornecidas.

3. Privacidade
Seus dados são tratados com confidencialidade conforme nossa Política de Privacidade.

4. Limitações
O LIDFE é uma ferramenta de apoio e não deve ser usado como único meio de diagnóstico ou tratamento.

5. Modificações
Reservamos o direito de modificar estes termos a qualquer momento.`}
        </Text>
        <Button
          mode="contained"
          onPress={() => router.back()}
          style={styles.button}
        >
          Aceitar
        </Button>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
  },
  title: {
    marginBottom: 16,
    textAlign: 'center',
  },
  content: {
    marginBottom: 24,
    lineHeight: 24,
  },
  button: {
    marginTop: 16,
  },
});
