import { useState } from 'react';
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { twoFactorAuthService } from '@/services/two-factor-auth';
import { supabase } from '@/services/supabase/client';

export default function TwoFactorAuthScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    if (!code || code.length !== 6) {
      setError('Digite o código de 6 dígitos');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Para 2FA TOTP, usar o serviço two-factor-auth
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      const isValid = await twoFactorAuthService.verifyCode(user.id, code);
      if (!isValid) {
        throw new Error('Código inválido');
      }

      // Código válido, redirecionar
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.message || 'Código inválido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>
          Autenticação de Dois Fatores
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Digite o código de 6 dígitos do seu aplicativo autenticador
        </Text>

        {error && (
          <Text style={[styles.error, { color: theme.colors.error }]}>
            {error}
          </Text>
        )}

        <TextInput
          label="Código"
          value={code}
          onChangeText={(text) => setCode(text.replace(/[^0-9]/g, '').slice(0, 6))}
          keyboardType="number-pad"
          mode="outlined"
          style={styles.input}
          disabled={loading}
          maxLength={6}
          autoFocus
        />

        <Button
          mode="contained"
          onPress={handleVerify}
          loading={loading}
          disabled={loading || code.length !== 6}
          style={styles.button}
        >
          Verificar
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
