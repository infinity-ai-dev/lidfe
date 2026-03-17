import { supabase } from './client';
import type { User, Session, AuthError } from '@supabase/supabase-js';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

export interface AuthResponse {
  user: User | null;
  session: Session | null;
  error: AuthError | null;
}

type SignInParams = { email: string; password: string };

type SignUpParams =
  | { email: string; password: string; lgpdConsentimento?: boolean }
  | { phone: string; password: string; channel?: 'sms' | 'whatsapp'; lgpdConsentimento?: boolean };

type VerifyOtpParams =
  | { email: string; token: string; type: 'signup' | 'email' | 'magiclink' | 'recovery' | 'invite' | 'email_change' }
  | { phone: string; token: string; type: 'sms' | 'phone_change' };

export const authService = {
  async signUp(params: SignUpParams): Promise<AuthResponse> {
    const lgpdConsentimento = params.lgpdConsentimento ?? false;

    const signUpPayload =
      'email' in params
        ? { email: params.email, password: params.password }
        : { phone: params.phone, password: params.password, options: { channel: params.channel ?? 'sms' } };

    const { data, error } = await supabase.auth.signUp(signUpPayload);

    // Se o cadastro foi bem-sucedido, salvar consentimento LGPD
    if (data.user && !error) {
      try {
        // Obter IP do usuário (se disponível)
        let userIp: string | null = null;
        if (typeof window !== 'undefined' && window.location) {
          // Para web, podemos usar fetch para obter IP
          try {
            const ipResponse = await fetch('https://api.ipify.org?format=json');
            const ipData = await ipResponse.json();
            userIp = ipData.ip;
          } catch {
            // Se falhar, deixar null
          }
        }

        // Salvar ou atualizar consentimento LGPD na tabela usuarios
        await supabase.from('usuarios').upsert({
          user_id: data.user.id,
          email: data.user.email ?? null,
          nome: (data.user.user_metadata as any)?.name ?? null,
          lgpd_consentimento: lgpdConsentimento,
          lgpd_consentimento_data: lgpdConsentimento ? new Date().toISOString() : null,
          lgpd_consentimento_ip: userIp,
        }, {
          onConflict: 'user_id',
        });
      } catch (e) {
        console.error('[AUTH] Erro ao salvar consentimento LGPD:', e);
        // Não falhar o cadastro se houver erro ao salvar consentimento
      }
    }

    return {
      user: data.user,
      session: data.session,
      error,
    };
  },

  async signIn(params: SignInParams): Promise<AuthResponse> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: params.email,
      password: params.password,
    });
    return {
      user: data.user,
      session: data.session,
      error,
    };
  },

  async signOut(): Promise<{ error: AuthError | null }> {
    const { error } = await supabase.auth.signOut();
    return { error };
  },

  async resetPassword(email: string): Promise<{ error: AuthError | null }> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getRecoveryRedirectUrl(),
    });
    return { error };
  },

  async requestPasswordRecovery(email: string): Promise<{ token: string | null; error: Error | null }> {
    const { data, error } = await supabase.functions.invoke('request-password-recovery', {
      body: { email },
    });
    if (error) {
      return { token: null, error };
    }
    const token = (data as any)?.token as string | undefined;
    if (!token) {
      return { token: null, error: new Error('Token de recuperação não retornado') };
    }
    return { token, error: null };
  },

  async resetPasswordWithToken(email: string, recoveryToken: string): Promise<{ error: AuthError | null }> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: appendRedirectToken(getRecoveryRedirectUrl(), recoveryToken),
    });
    return { error };
  },

  async updatePassword(newPassword: string): Promise<{ error: AuthError | null }> {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    return { error };
  },

  async verifyPasswordRecoveryToken(token: string, consume: boolean): Promise<{ error: Error | null }> {
    const { error } = await supabase.functions.invoke('verify-password-recovery-token', {
      body: { token, consume },
    });
    return { error };
  },

  async verifyOtp(params: VerifyOtpParams): Promise<AuthResponse> {
    const { data, error } = await supabase.auth.verifyOtp(params as any);
    return {
      user: data.user,
      session: data.session,
      error: error as AuthError | null,
    };
  },

  async resendOtp(params: { email?: string; phone?: string; type: 'signup' | 'email_change' | 'sms' | 'phone_change' }) {
    const { data, error } = await supabase.auth.resend(params as any);
    return { data, error: error as AuthError | null };
  },

  async signInWithGoogle(lgpdConsentimento: boolean = false): Promise<AuthResponse> {
    if (Platform.OS === 'web') {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://lidfe.mayacrm.shop/',
        },
      });
      return {
        user: null,
        session: null,
        error: error as AuthError | null,
      };
    }

    // Para mobile, usar OAuth flow
    const redirectUri = AuthSession.makeRedirectUri({
      scheme: 'lidfe',
      path: 'auth/callback',
    });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUri,
      },
    });

    if (data.url) {
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectUri
      );

      if (result.type === 'success' && result.url) {
        const url = new URL(result.url);
        const accessToken = url.searchParams.get('access_token');
        const refreshToken = url.searchParams.get('refresh_token');

        if (accessToken && refreshToken) {
          const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          // Se for primeiro login (cadastro via OAuth), salvar consentimento LGPD
          if (sessionData.user && !sessionError && lgpdConsentimento) {
            try {
              // Obter IP do usuário (se disponível)
              let userIp: string | null = null;
              if (typeof window !== 'undefined' && window.location) {
                try {
                  const ipResponse = await fetch('https://api.ipify.org?format=json');
                  const ipData = await ipResponse.json();
                  userIp = ipData.ip;
                } catch {
                  // Se falhar, deixar null
                }
              }

              // Salvar ou atualizar consentimento LGPD
              await supabase.from('usuarios').upsert({
                user_id: sessionData.user.id,
                email: sessionData.user.email ?? null,
                nome: (sessionData.user.user_metadata as any)?.name ?? 
                      (sessionData.user.user_metadata as any)?.full_name ?? null,
                lgpd_consentimento: true,
                lgpd_consentimento_data: new Date().toISOString(),
                lgpd_consentimento_ip: userIp,
              }, {
                onConflict: 'user_id',
              });
            } catch (e) {
              console.error('[AUTH] Erro ao salvar consentimento LGPD (OAuth Google):', e);
            }
          }

          return {
            user: sessionData.user,
            session: sessionData.session,
            error: sessionError as AuthError | null,
          };
        }
      }
    }

    return {
      user: null,
      session: null,
      error: error as AuthError | null,
    };
  },

  async signInWithApple(lgpdConsentimento: boolean = false): Promise<AuthResponse> {
    if (Platform.OS === 'web') {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: 'https://lidfe.mayacrm.shop/',
        },
      });
      return {
        user: null,
        session: null,
        error: error as AuthError | null,
      };
    }

    const redirectUri = AuthSession.makeRedirectUri({
      scheme: 'lidfe',
      path: 'auth/callback',
    });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: redirectUri,
      },
    });

    if (data.url) {
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectUri
      );

      if (result.type === 'success' && result.url) {
        const url = new URL(result.url);
        const accessToken = url.searchParams.get('access_token');
        const refreshToken = url.searchParams.get('refresh_token');

        if (accessToken && refreshToken) {
          const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          // Se for primeiro login (cadastro via OAuth), salvar consentimento LGPD
          if (sessionData.user && !sessionError && lgpdConsentimento) {
            try {
              // Obter IP do usuário (se disponível)
              let userIp: string | null = null;
              if (typeof window !== 'undefined' && window.location) {
                try {
                  const ipResponse = await fetch('https://api.ipify.org?format=json');
                  const ipData = await ipResponse.json();
                  userIp = ipData.ip;
                } catch {
                  // Se falhar, deixar null
                }
              }

              // Salvar ou atualizar consentimento LGPD
              await supabase.from('usuarios').upsert({
                user_id: sessionData.user.id,
                email: sessionData.user.email ?? null,
                nome: (sessionData.user.user_metadata as any)?.name ?? 
                      (sessionData.user.user_metadata as any)?.full_name ?? null,
                lgpd_consentimento: true,
                lgpd_consentimento_data: new Date().toISOString(),
                lgpd_consentimento_ip: userIp,
              }, {
                onConflict: 'user_id',
              });
            } catch (e) {
              console.error('[AUTH] Erro ao salvar consentimento LGPD (OAuth Apple):', e);
            }
          }

          return {
            user: sessionData.user,
            session: sessionData.session,
            error: sessionError as AuthError | null,
          };
        }
      }
    }

    return {
      user: null,
      session: null,
      error: error as AuthError | null,
    };
  },

  async getCurrentUser(): Promise<User | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  async getCurrentSession(): Promise<Session | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  },

  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  },
};

export default authService;

function getRecoveryRedirectUrl(): string {
  return Platform.OS === 'web'
    ? 'https://lidfe.mayacrm.shop/auth/nova-senha'
    : AuthSession.makeRedirectUri({
        scheme: 'lidfe',
        path: 'auth/nova-senha',
      });
}

function appendRedirectToken(baseUrl: string, token: string): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}rt=${encodeURIComponent(token)}`;
}
