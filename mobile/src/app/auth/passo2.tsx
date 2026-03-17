import { useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';

export default function AuthPasso2Screen() {
  const theme = useTheme();
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNext = () => {
    if (!nome.trim()) {
      return;
    }
    router.push('/auth/passo3');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>
          Qual é o seu nome?
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Precisamos do seu nome para personalizar sua experiência
        </Text>

        <TextInput
          label="Nome completo"
          value={nome}
          onChangeText={setNome}
          autoCapitalize="words"
          mode="outlined"
          style={styles.input}
          disabled={loading}
        />

        <Button
          mode="contained"
          onPress={handleNext}
          loading={loading}
          disabled={loading || !nome.trim()}
          style={styles.button}
        >
          Continuar
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
  input: {
    marginBottom: 24,
  },
  button: {
    marginTop: 8,
  },
});
