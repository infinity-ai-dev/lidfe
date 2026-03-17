import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, RadioButton, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useFontScale } from '@/hooks/useFontScale';

export default function AuthPasso3Screen() {
  const theme = useTheme();
  const { scale } = useFontScale();
  const router = useRouter();
  const [genero, setGenero] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleNext = () => {
    if (!genero) {
      return;
    }
    router.push('/auth/passo4');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text variant="headlineMedium" style={[styles.title, { color: theme.colors.onBackground }]}>
          Qual é o seu gênero?
        </Text>
        <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Esta informação ajuda a personalizar sua experiência
        </Text>

        <RadioButton.Group onValueChange={setGenero} value={genero}>
          <View style={styles.radioContainer}>
            <RadioButton.Item
              label="Masculino"
              value="masculino"
              labelStyle={[styles.radioLabel, { fontSize: scale(16) }]}
            />
            <RadioButton.Item
              label="Feminino"
              value="feminino"
              labelStyle={[styles.radioLabel, { fontSize: scale(16) }]}
            />
            <RadioButton.Item
              label="Prefiro não informar"
              value="outro"
              labelStyle={[styles.radioLabel, { fontSize: scale(16) }]}
            />
          </View>
        </RadioButton.Group>

        <Button
          mode="contained"
          onPress={handleNext}
          loading={loading}
          disabled={loading || !genero}
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
  radioContainer: {
    marginBottom: 24,
  },
  radioLabel: {
    fontSize: 16,
  },
  button: {
    marginTop: 8,
  },
});
