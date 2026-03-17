import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';

export default function AuthPasso5Screen() {
  const theme = useTheme();
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      // Aguardar um pouco antes de redirecionar
      const timer = setTimeout(() => {
        router.replace('/(tabs)');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, router]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>
        Bem-vindo ao LIDFE!
      </Text>
      <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
        Configurando sua conta...
      </Text>
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
    padding: 20,
  },
  title: {
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    marginBottom: 32,
    textAlign: 'center',
  },
  loader: {
    marginTop: 20,
  },
});
