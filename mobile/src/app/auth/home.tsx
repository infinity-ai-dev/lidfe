import { useCallback, useEffect, useRef } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from 'react-native-paper';
import { useAuth } from '@/hooks/useAuth';

export default function AuthHomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();
  const hasNavigatedRef = useRef(false);
  const safeReplace = useCallback((path: string) => {
    try {
      // No web iOS, router.replace pode lançar DOMException; usar navigation direta.
      if (typeof window !== 'undefined' && window.location) {
        window.location.assign(path);
        return;
      }
      router.replace(path);
    } catch (error) {
      console.error('[AUTH] Erro ao navegar:', error);
      if (typeof window !== 'undefined' && window.location) {
        window.location.href = path;
      }
    }
  }, [router]);

  useEffect(() => {
    if (hasNavigatedRef.current) return;

    if (isAuthenticated && !loading) {
      hasNavigatedRef.current = true;
      // Redirecionar com fallback para iOS web.
      safeReplace('/(tabs)');
      return;
    }

    if (!isAuthenticated && !loading) {
      hasNavigatedRef.current = true;
      safeReplace('/auth/passo1');
    }
  }, [loading, isAuthenticated, safeReplace]);


  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Image
        source={require('../../../assets/images/logo_LIDFE_new-Photoroom.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator
        size="large"
        color={theme.colors.primary}
        style={styles.loader}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 350,
    height: 200,
  },
  loader: {
    marginTop: 20,
  },
});
