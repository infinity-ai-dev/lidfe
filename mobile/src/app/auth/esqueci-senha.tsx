import { useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';

export default function EsqueciSenhaScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { resetPassword, requestPasswordRecovery } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReset = async () => {
    if (!email) {
      setError('Preencha o email');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { token } = await requestPasswordRecovery(email);
      await resetPassword(email, token);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar email de recuperação');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>
          Email enviado!
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Verifique sua caixa de entrada e siga as instruções para redefinir sua senha.
        </Text>
        <Button
          mode="contained"
          onPress={() => router.back()}
          style={styles.button}
        >
          Voltar
        </Button>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>
          Esqueci minha senha
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Digite seu email e enviaremos um link para redefinir sua senha
        </Text>

        {error && (
          <Text style={[styles.error, { color: theme.colors.error }]}>
            {error}
          </Text>
        )}

        <TextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />

        <Button
          mode="contained"
          onPress={handleReset}
          loading={loading}
          disabled={loading || !email}
          style={styles.button}
        >
          Enviar link de recuperação
        </Button>

        <Button
          mode="text"
          onPress={() => router.back()}
          disabled={loading}
        >
          Voltar
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    marginBottom: 32,
    textAlign: 'center',
  },
  error: {
    marginBottom: 16,
    textAlign: 'center',
  },
  input: {
    marginBottom: 24,
  },
  button: {
    marginTop: 8,
    marginBottom: 16,
  },
});
