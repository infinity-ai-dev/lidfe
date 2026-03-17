import { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Text, TextInput, Button, useTheme } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { authService } from '@/services/supabase/auth';
import { supabase } from '@/services/supabase/client';

export default function NovaSenhaScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [success, setSuccess] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedParams = useMemo(() => {
    const normalize = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;

    const query = {
      code: normalize(params.code),
      type: normalize(params.type),
      accessToken: normalize(params.access_token),
      refreshToken: normalize(params.refresh_token),
      recoveryToken: normalize(params.rt),
    };

    let hash: Record<string, string> = {};
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const rawHash = window.location.hash?.replace(/^#/, '');
      if (rawHash) {
        hash = Object.fromEntries(new URLSearchParams(rawHash));
      }
    }

    return {
      code: query.code,
      type: query.type || hash.type,
      accessToken: query.accessToken || hash.access_token,
      refreshToken: query.refreshToken || hash.refresh_token,
      recoveryToken: query.recoveryToken || hash.rt,
      error: normalize(params.error) || hash.error,
      errorDescription: normalize(params.error_description) || hash.error_description,
    };
  }, [params]);

  useEffect(() => {
    let cancelled = false;

    const finalize = (ready: boolean, err: string | null) => {
      if (cancelled) return;
      setRecoveryReady(ready);
      setRecoveryError(err);
      setInitializing(false);
    };

    const cleanUrl = () => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    const initRecovery = async () => {
      setInitializing(true);
      setRecoveryError(null);

      try {
        if (parsedParams.error || parsedParams.errorDescription) {
          const message = parsedParams.errorDescription || 'Link inválido ou expirado.';
          finalize(false, message);
          return;
        }

        const validateRecoveryToken = async () => {
          if (!parsedParams.recoveryToken) {
            throw new Error('Link inválido ou expirado. Solicite um novo email de recuperação.');
          }
          const { error: tokenError } = await authService.verifyPasswordRecoveryToken(
            parsedParams.recoveryToken,
            false
          );
          if (tokenError) {
            throw new Error(tokenError.message || 'Link inválido ou expirado.');
          }
        };

        const existingSession = await authService.getCurrentSession();
        if (existingSession) {
          await validateRecoveryToken();
          cleanUrl();
          finalize(true, null);
          return;
        }

        if (parsedParams.code) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(parsedParams.code);
          if (!exchangeError && data?.session) {
            await validateRecoveryToken();
            cleanUrl();
            finalize(true, null);
            return;
          }

          const fallbackSession = await authService.getCurrentSession();
          if (fallbackSession) {
            await validateRecoveryToken();
            cleanUrl();
            finalize(true, null);
            return;
          }

          throw exchangeError || new Error('Link inválido ou expirado.');
        }

        if (parsedParams.accessToken && parsedParams.refreshToken) {
          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: parsedParams.accessToken,
            refresh_token: parsedParams.refreshToken,
          });
          if (!sessionError && data?.session) {
            await validateRecoveryToken();
            cleanUrl();
            finalize(true, null);
            return;
          }

          const fallbackSession = await authService.getCurrentSession();
          if (fallbackSession) {
            await validateRecoveryToken();
            cleanUrl();
            finalize(true, null);
            return;
          }

          throw sessionError || new Error('Link inválido ou expirado.');
        }

        finalize(false, 'Link inválido ou expirado. Solicite um novo email de recuperação.');
      } catch (err: any) {
        const message = err?.message || 'Não foi possível validar o link de recuperação.';
        finalize(false, message);
      }
    };

    void initRecovery();

    return () => {
      cancelled = true;
    };
  }, [parsedParams]);

  const passwordChecks = useMemo(() => {
    return {
      minLength: password.length >= 8,
      hasLetter: /[A-Za-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
    };
  }, [password]);

  const isPasswordStrong =
    passwordChecks.minLength && passwordChecks.hasLetter && passwordChecks.hasNumber;

  const handleUpdate = async () => {
    if (!password || !confirmPassword) {
      setError('Preencha todos os campos');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (!isPasswordStrong) {
      setError('A senha deve ter pelo menos 8 caracteres e incluir letras e números');
      return;
    }

    if (!parsedParams.recoveryToken) {
      setError('Link inválido ou expirado. Solicite um novo email de recuperação.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await updatePassword(password);
      const { error: consumeError } = await authService.verifyPasswordRecoveryToken(
        parsedParams.recoveryToken,
        true
      );
      if (consumeError) {
        console.warn('[AUTH] Falha ao marcar token de recuperação como usado:', consumeError);
      }
      await signOut();
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar senha');
    } finally {
      setLoading(false);
    }
  };

  if (initializing) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text variant="bodyMedium" style={{ marginTop: 12, color: theme.colors.onSurfaceVariant }}>
          Validando link de recuperação...
        </Text>
      </View>
    );
  }

  if (recoveryError) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <Text variant="headlineSmall" style={[styles.title, { color: theme.colors.onBackground }]}>
          Link inválido
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          {recoveryError}
        </Text>
        <Button
          mode="contained"
          onPress={() => router.replace('/auth/esqueci-senha')}
          style={styles.button}
        >
          Solicitar novo link
        </Button>
        <Button mode="text" onPress={() => router.back()}>
          Voltar
        </Button>
      </View>
    );
  }

  if (!recoveryReady) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Para redefinir sua senha, use o link enviado por email.
        </Text>
        <Button
          mode="contained"
          onPress={() => router.replace('/auth/esqueci-senha')}
          style={styles.button}
        >
          Enviar novo link
        </Button>
      </View>
    );
  }

  if (success) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>
          Senha atualizada
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Sua senha foi redefinida com sucesso. Faça login novamente para continuar.
        </Text>
        <Button
          mode="contained"
          onPress={() => router.replace('/auth/passo1')}
          style={styles.button}
        >
          Ir para login
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
          Nova senha
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Digite sua nova senha
        </Text>
        <Text variant="bodySmall" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Use pelo menos 8 caracteres com letras e números.
        </Text>

        {error && (
          <Text style={[styles.error, { color: theme.colors.error }]}>
            {error}
          </Text>
        )}

        <TextInput
          label="Nova senha"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />

        <TextInput
          label="Confirmar nova senha"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />

        <Button
          mode="contained"
          onPress={handleUpdate}
          loading={loading}
          disabled={loading || !password || !confirmPassword || !isPasswordStrong}
          style={styles.button}
        >
          Atualizar senha
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
    marginBottom: 16,
  },
  button: {
    marginTop: 8,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
