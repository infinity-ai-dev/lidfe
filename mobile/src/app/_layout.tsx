import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { ThemeProvider, useThemeContext } from '@/contexts/ThemeContext';
import { authService } from '@/services/supabase/auth';
import { supabase } from '@/services/supabase/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

function RootLayoutContent() {
  const { theme, isDark } = useThemeContext();

  useEffect(() => {
    // Ativar refresh automático de tokens em web e mobile.
    supabase.auth.startAutoRefresh();

    // Controlar refresh quando o app muda de estado (mobile) e visibilidade (web).
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    let handleVisibilityChange: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          supabase.auth.startAutoRefresh();
        } else {
          supabase.auth.stopAutoRefresh();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      handleVisibilityChange();
    }

    // Verificar estado de autenticação ao iniciar
    authService.getCurrentSession().then((session) => {
      if (session) {
        console.log('User session found:', session.user.email);
      }
    });

    // Escutar mudanças de autenticação
    const { data: { subscription } } = authService.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event, session?.user?.email);
      }
    );

    return () => {
      subscription.unsubscribe();
      // Parar refresh automático ao desmontar para evitar vazamento.
      supabase.auth.stopAutoRefresh();
      appStateSubscription.remove();
      if (handleVisibilityChange && Platform.OS === 'web') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <PaperProvider theme={theme}>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.background },
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="auth" />
            </Stack>
          </PaperProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutContent />
    </ThemeProvider>
  );
}
