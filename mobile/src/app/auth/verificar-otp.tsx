import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, useTheme } from 'react-native-paper';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { authService } from '@/services/supabase/auth';

const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 10;

export default function VerificarOtpScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const emailParam =
    typeof params.email === 'string'
      ? params.email
      : typeof params.contact === 'string'
      ? params.contact
      : '';

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockTick, setLockTick] = useState(0);

  const lockRemaining = useMemo(() => {
    if (!lockedUntil) return 0;
    return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
  }, [lockedUntil, lockTick]);

  const isLocked = lockRemaining > 0;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (!lockedUntil) return;
    const timer = setInterval(() => {
      setLockTick((value) => value + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  const formatCountdown = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}:${remaining.toString().padStart(2, '0')}`;
  };

  const handleVerify = async () => {
    if (isLocked) {
      setError(`Muitas tentativas. Tente novamente em ${formatCountdown(lockRemaining)}.`);
      return;
    }

    if (!code || code.length !== 6) {
      setError('Digite o código de 6 dígitos');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = { email: emailParam, token: code, type: 'signup' as const };

      const { error: verifyError } = await authService.verifyOtp(payload as any);
      if (verifyError) {
        throw verifyError;
      }

      router.replace('/auth/passo2');
    } catch (err) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= MAX_ATTEMPTS) {
        const lockUntil = Date.now() + LOCK_MINUTES * 60 * 1000;
        setLockedUntil(lockUntil);
        setAttempts(0);
        setError(`Muitas tentativas. Tente novamente em ${formatCountdown(LOCK_MINUTES * 60)}.`);
      } else {
        setAttempts(nextAttempts);
        setError('Código inválido ou expirado. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    if (!emailParam) {
      setError('Email inválido para reenviar o código.');
      return;
    }

    setResending(true);
    setError(null);

    try {
      const resendPayload = { email: emailParam, type: 'signup' as const };

      const { error: resendError } = await authService.resendOtp(resendPayload as any);
      if (resendError) {
        throw resendError;
      }
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível reenviar o código.');
    } finally {
      setResending(false);
    }
  };

  if (!emailParam) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>Verificação</Text>
          <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>Contato não encontrado. Volte para o cadastro.</Text>
          <Button mode="contained" onPress={() => router.back()} style={styles.button}>Voltar</Button>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>Verifique sua identidade</Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>Enviamos um código para o email {emailParam}.</Text>
        <Text variant="bodySmall" style={[styles.subtitleSmall, { color: theme.colors.onSurfaceVariant }]}>O código expira em até 10 minutos.</Text>

        {error && (
          <Text style={[styles.error, { color: theme.colors.error }]}>{error}</Text>
        )}

        <TextInput
          label="Código"
          value={code}
          onChangeText={(text) => setCode(text.replace(/[^0-9]/g, '').slice(0, 6))}
          keyboardType="number-pad"
          inputMode="numeric"
          mode="outlined"
          style={styles.input}
          contentStyle={styles.inputContent}
          disabled={loading || isLocked}
          maxLength={6}
          autoFocus
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          importantForAutofill="yes"
        />

        {isLocked && (
          <Text variant="bodySmall" style={[styles.lockedText, { color: theme.colors.error }]}>Bloqueado temporariamente. Aguarde {formatCountdown(lockRemaining)}.</Text>
        )}

        <Button
          mode="contained"
          onPress={handleVerify}
          loading={loading}
          disabled={loading || code.length !== 6 || isLocked}
          style={styles.button}
        >
          Verificar
        </Button>

        <Button
          mode="text"
          onPress={handleResend}
          disabled={resending || resendCooldown > 0}
        >
          {resendCooldown > 0
            ? `Reenviar em ${formatCountdown(resendCooldown)}`
            : 'Reenviar código'}
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
    marginBottom: 24,
    textAlign: 'center',
  },
  subtitleSmall: {
    marginBottom: 16,
    textAlign: 'center',
  },
  error: {
    marginBottom: 16,
    textAlign: 'center',
  },
  input: {
    marginBottom: 12,
  },
  inputContent: {
    textAlign: 'center',
    letterSpacing: 8,
  },
  button: {
    marginTop: 8,
    marginBottom: 16,
  },
  lockedText: {
    marginBottom: 8,
    textAlign: 'center',
  },
});
