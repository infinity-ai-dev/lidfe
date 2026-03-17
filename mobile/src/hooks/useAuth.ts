import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { User, Session } from '@supabase/supabase-js';
import { authService } from '@/services/supabase/auth';
import { useAppStore } from '@/store/appStore';
import { databaseService } from '@/services/supabase/database/tables';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const setIdthreadConversa = useAppStore((s) => s.setIdthreadConversa);
  const loginPath = '/auth/passo1';
  const authFlowBlockRedirect = useMemo(
    () =>
      new Set([
        '/auth/passo2',
        '/auth/passo3',
        '/auth/passo4',
        '/auth/passo5',
        '/auth/nova-senha',
        '/auth/verificar-otp',
      ]),
    []
  );
  const enforceExpiry = process.env.EXPO_PUBLIC_AUTH_ENFORCE_EXPIRY !== 'false';
  const expiryGraceSeconds = 7 * 24 * 60 * 60;

  const isSessionExpired = useCallback((currentSession: Session | null) => {
    if (!enforceExpiry) return false;
    if (!currentSession?.expires_at) return false;
    // Se o token expirou, forçar logout e redirecionar para login.
    const nowInSeconds = Math.floor(Date.now() / 1000);
    return currentSession.expires_at + expiryGraceSeconds <= nowInSeconds;
  }, [enforceExpiry, expiryGraceSeconds]);

  const clearClientState = useCallback(async () => {
    try {
      // Limpar store persistido e resetar estado em memória.
      useAppStore.getState().reset();
      if (useAppStore.persist?.clearStorage) {
        await useAppStore.persist.clearStorage();
      }

      // No web, limpar storage local que guarda auth e cache.
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.clear();
      }
    } catch (error) {
      console.error('[AUTH] Erro ao limpar storage local:', error);
    }
  }, []);

  const safeNavigate = useCallback((path: string) => {
    try {
      // Tentar navegação SPA primeiro para evitar reloads.
      router.replace(path);
    } catch (error) {
      console.error('[AUTH] Erro ao navegar:', error);
      if (typeof window !== 'undefined' && window.location) {
        // Fallback: navegação direta se replace falhar (iOS web).
        window.location.replace(path);
      }
    }
  }, [router]);

  const navigateIfNeeded = useCallback((path: string) => {
    // Evitar navegar se já estiver na rota desejada.
    if (pathname === path) return;
    safeNavigate(path);
  }, [pathname, safeNavigate]);

  const ensureThreadId = useCallback(
    async (u: User | null) => {
      if (!u?.id) return;

      const fallbackThreadId = `anamnese:${u.id}`;

      // Persistir também no perfil do usuário para manter consistência cross-device
      try {
        const { data, error } = await databaseService.usuarios.getByUserId(u.id);

        if (error || !data) {
          // Garantir campos mínimos quando o usuário vem de OAuth (evita falha de validação).
          const fallbackName =
            (u.user_metadata as any)?.name ??
            (u.user_metadata as any)?.full_name ??
            (u.email ? u.email.split('@')[0] : 'Usuário');
          await databaseService.usuarios.insert({
            user_id: u.id,
            email: u.email ?? null,
            nome: fallbackName,
            id_threadconversa: fallbackThreadId,
          } as any);
          setIdthreadConversa(fallbackThreadId);
          return;
        }

        const storedThreadId = (data as any)?.id_threadconversa as string | null | undefined;
        if (storedThreadId && storedThreadId.trim().length > 0) {
          setIdthreadConversa(storedThreadId);
          return;
        }

        await databaseService.usuarios.update(u.id, { id_threadconversa: fallbackThreadId });
        setIdthreadConversa(fallbackThreadId);
      } catch (e) {
        console.error('[AUTH] Erro ao garantir id_threadconversa em usuarios:', e);
        setIdthreadConversa(fallbackThreadId);
      }
    },
    [setIdthreadConversa]
  );

  useEffect(() => {
    // Verificar sessão inicial
    authService
      .getCurrentSession()
      .then(async (session) => {
        if (isSessionExpired(session)) {
          // Limpar sessão expirada e forçar nova autenticação.
          await authService.signOut();
          await clearClientState();
          setSession(null);
          setUser(null);
          setLoading(false);
          // Redirecionar para login apenas quando necessário.
          if (!pathname?.startsWith('/auth')) {
            navigateIfNeeded(loginPath);
          }
          return;
        }

        setSession(session);
        setUser(session?.user ?? null);
        void ensureThreadId(session?.user ?? null);
        setLoading(false);
      })
      .catch(async (error) => {
        // Se houver erro ao buscar a sessão, limpar storage e voltar ao login.
        console.error('[AUTH] Erro ao buscar sessão:', error);
        await authService.signOut();
        await clearClientState();
        setSession(null);
        setUser(null);
        setLoading(false);
        // Redirecionar para login apenas quando necessário.
        if (!pathname?.startsWith('/auth')) {
          navigateIfNeeded(loginPath);
        }
      });

    // Escutar mudanças de autenticação
    const {
      data: { subscription },
    } = authService.onAuthStateChange(async (event, session) => {
      if (!session || isSessionExpired(session)) {
        // Sessão inválida ou expirada: limpar e voltar ao login.
        if (event !== 'SIGNED_OUT') {
          await authService.signOut();
        }
        await clearClientState();
        setSession(null);
        setUser(null);
        setLoading(false);
        // Redirecionar para login apenas quando necessário.
        if (!pathname?.startsWith('/auth')) {
          navigateIfNeeded(loginPath);
        }
        return;
      }

      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      if (event === 'PASSWORD_RECOVERY') {
        await ensureThreadId(session?.user ?? null);
        navigateIfNeeded('/auth/nova-senha');
        return;
      }

      if (event === 'SIGNED_IN') {
        await ensureThreadId(session?.user ?? null);
        // Redirecionar para a área logada apenas quando necessário.
        if (!authFlowBlockRedirect.has(pathname)) {
          navigateIfNeeded('/(tabs)');
        }
      } else if (event === 'SIGNED_OUT') {
        // Redirecionar para login apenas quando necessário.
        if (!pathname?.startsWith('/auth')) {
          navigateIfNeeded(loginPath);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router, ensureThreadId, isSessionExpired, clearClientState, safeNavigate, navigateIfNeeded, loginPath, pathname]);

  const signIn = async (email: string, password: string) => {
    const normalizedEmail = email.trim();
    const { user, session, error } = await authService.signIn({ email: normalizedEmail, password });
    if (error) throw error;
    return { user, session };
  };

  const signUp = async (params: { email?: string; phone?: string; password: string; lgpdConsentimento?: boolean; channel?: 'sms' | 'whatsapp' }) => {
    const { user, session, error } = await authService.signUp(params as any);
    if (error) throw error;
    return { user, session };
  };

  const signOut = async () => {
    const { error } = await authService.signOut();
    if (error) throw error;
  };

  const requestPasswordRecovery = async (email: string) => {
    const { token, error } = await authService.requestPasswordRecovery(email);
    if (error) throw error;
    return { token };
  };

  const resetPassword = async (email: string, recoveryToken?: string) => {
    const { error } = recoveryToken
      ? await authService.resetPasswordWithToken(email, recoveryToken)
      : await authService.resetPassword(email);
    if (error) throw error;
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await authService.updatePassword(newPassword);
    if (error) throw error;
  };

  return {
    user,
    session,
    loading,
    signIn,
    signUp,
    signOut,
    requestPasswordRecovery,
    resetPassword,
    updatePassword,
    isAuthenticated: !!user,
  };
}
