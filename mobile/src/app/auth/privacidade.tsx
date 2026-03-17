import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';

export default function PrivacidadeScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>
          Política de Privacidade
        </Text>
        <Text variant="bodyMedium" style={[styles.content, { color: theme.colors.onSurface }]}>
          {`Política de Privacidade do LIDFE

1. Coleta de Dados
Coletamos informações que você fornece diretamente, incluindo dados de saúde, exames e histórico médico.

2. Uso dos Dados
Seus dados são usados para:
- Fornecer serviços de anamnese e análise
- Melhorar nossos algoritmos de IA
- Personalizar sua experiência

3. Compartilhamento
Não compartilhamos seus dados pessoais com terceiros, exceto quando necessário para fornecer nossos serviços ou quando exigido por lei.

4. Segurança
Utilizamos medidas de segurança avançadas para proteger seus dados, incluindo criptografia e armazenamento seguro.

5. Seus Direitos
Você tem o direito de acessar, corrigir ou excluir seus dados pessoais a qualquer momento.

6. Alterações
Podemos atualizar esta política periodicamente. Notificaremos sobre mudanças significativas.`}
        </Text>
        <Button
          mode="contained"
          onPress={() => router.back()}
          style={styles.button}
        >
          Entendi
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
