import { useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { Text, TextInput, Button, useTheme, Divider, Checkbox, Card } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { authService } from '@/services/supabase/auth';

export default function AuthPasso1Screen() {
  const theme = useTheme();
  const router = useRouter();
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const [lgpdConsentimento, setLgpdConsentimento] = useState(false);

  const handleSubmit = async () => {
    if (!email) {
      setError('Preencha o email');
      return;
    }

    const normalizedEmail = email.trim();
    if (!normalizedEmail.includes('@')) {
      setError('Informe um email válido');
      return;
    }

    if (!password) {
      setError('Preencha todos os campos');
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    // Validar consentimento LGPD apenas para cadastro
    if (isSignUp && !lgpdConsentimento) {
      setError('Você precisa aceitar os termos de uso e política de privacidade para criar uma conta');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (isSignUp) {
        const signUpPayload = { email: normalizedEmail, password, lgpdConsentimento };
        await signUp(signUpPayload);
        router.push({
          pathname: '/auth/verificar-otp',
          params: { email: normalizedEmail },
        });
      } else {
        await signIn(normalizedEmail, password);
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao autenticar');
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
          {isSignUp ? 'Criar Conta' : 'Entrar'}
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          {isSignUp ? 'Crie sua conta para começar' : 'Entre com sua conta existente'}
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

        <TextInput
          label="Senha"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />

        {isSignUp && (
          <TextInput
            label="Confirmar Senha"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            mode="outlined"
            style={styles.input}
            disabled={loading}
          />
        )}

        {isSignUp && (
          <Card style={styles.lgpdCard}>
            <Card.Content>
              <View style={styles.lgpdContainer}>
                <Checkbox
                  status={lgpdConsentimento ? 'checked' : 'unchecked'}
                  onPress={() => setLgpdConsentimento(!lgpdConsentimento)}
                  disabled={loading}
                />
                <View style={styles.lgpdTextContainer}>
                  <Text variant="bodySmall" style={[styles.lgpdText, { color: theme.colors.onSurface }]}>
                    Eu aceito os{' '}
                    <Text
                      style={[styles.link, { color: theme.colors.primary }]}
                      onPress={() => router.push('/auth/termos-uso')}
                    >
                      Termos de Uso
                    </Text>
                    {' '}e a{' '}
                    <Text
                      style={[styles.link, { color: theme.colors.primary }]}
                      onPress={() => router.push('/auth/privacidade')}
                    >
                      Política de Privacidade
                    </Text>
                    . Autorizo o uso dos meus dados conforme a LGPD.
                  </Text>
                </View>
              </View>
            </Card.Content>
          </Card>
        )}

        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={loading}
          disabled={loading}
          style={styles.button}
        >
          {isSignUp ? 'Criar Conta' : 'Entrar'}
        </Button>

        <Button
          mode="text"
          onPress={() => setIsSignUp(!isSignUp)}
          disabled={loading}
          style={styles.switchButton}
        >
          {isSignUp ? 'Já tem conta? Entrar' : 'Não tem conta? Criar conta'}
        </Button>

        <Button
          mode="text"
          onPress={() => router.push('/auth/esqueci-senha')}
          disabled={loading}
        >
          Esqueci minha senha
        </Button>

        <Divider style={styles.divider} />

        <Button
          mode="outlined"
          icon="google"
          onPress={async () => {
            setOauthLoading('google');
            setError(null);
            try {
              // Para OAuth, assumimos consentimento quando o usuário continua com OAuth
              const { user, session, error: oauthError } = await authService.signInWithGoogle(true);
              if (oauthError) throw oauthError;
              if (user && session) {
                router.replace('/(tabs)');
              }
            } catch (err: any) {
              setError(err.message || 'Erro ao fazer login com Google');
            } finally {
              setOauthLoading(null);
            }
          }}
          loading={oauthLoading === 'google'}
          disabled={loading || oauthLoading !== null}
          style={styles.oauthButton}
        >
          Continuar com Google
        </Button>

        {Platform.OS === 'ios' && (
          <Button
            mode="outlined"
            icon="apple"
            onPress={async () => {
              setOauthLoading('apple');
              setError(null);
              try {
                // Para OAuth, assumimos consentimento quando o usuário continua com OAuth
                const { user, session, error: oauthError } = await authService.signInWithApple(true);
                if (oauthError) throw oauthError;
                if (user && session) {
                  router.replace('/(tabs)');
                }
              } catch (err: any) {
                setError(err.message || 'Erro ao fazer login com Apple');
              } finally {
                setOauthLoading(null);
              }
            }}
            loading={oauthLoading === 'apple'}
            disabled={loading || oauthLoading !== null}
            style={styles.oauthButton}
          >
            Continuar com Apple
          </Button>
        )}
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
    marginBottom: 16,
  },
  switchButton: {
    marginBottom: 8,
  },
  divider: {
    marginVertical: 24,
  },
  oauthButton: {
    marginBottom: 12,
  },
  lgpdCard: {
    marginTop: 8,
    marginBottom: 16,
  },
  lgpdContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  lgpdTextContainer: {
    flex: 1,
    marginLeft: 8,
  },
  lgpdText: {
    lineHeight: 20,
  },
  link: {
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
});
