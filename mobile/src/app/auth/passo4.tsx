import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, Checkbox, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';

export default function AuthPasso4Screen() {
  const theme = useTheme();
  const router = useRouter();
  const [aceitaTermos, setAceitaTermos] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleNext = () => {
    if (!aceitaTermos) {
      return;
    }
    router.push('/auth/passo5');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>
          Termos de Uso
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Por favor, leia e aceite os termos de uso para continuar
        </Text>

        <View style={styles.checkboxContainer}>
          <Checkbox
            status={aceitaTermos ? 'checked' : 'unchecked'}
            onPress={() => setAceitaTermos(!aceitaTermos)}
          />
          <Text
            variant="bodyMedium"
            style={[styles.checkboxLabel, { color: theme.colors.onBackground }]}
            onPress={() => setAceitaTermos(!aceitaTermos)}
          >
            Eu aceito os{' '}
            <Text
              style={{ color: theme.colors.primary }}
              onPress={() => router.push('/auth/termos-uso')}
            >
              Termos de Uso
            </Text>
            {' '}e a{' '}
            <Text
              style={{ color: theme.colors.primary }}
              onPress={() => router.push('/auth/privacidade')}
            >
              Política de Privacidade
            </Text>
          </Text>
        </View>

        <Button
          mode="contained"
          onPress={handleNext}
          loading={loading}
          disabled={loading || !aceitaTermos}
          style={styles.button}
        >
          Continuar
        </Button>
      </ScrollView>
    </View>
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
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  checkboxLabel: {
    flex: 1,
    marginLeft: 8,
  },
  button: {
    marginTop: 8,
  },
});
