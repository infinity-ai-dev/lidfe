import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="home" />
      <Stack.Screen name="passo1" />
      <Stack.Screen name="passo2" />
      <Stack.Screen name="passo3" />
      <Stack.Screen name="passo4" />
      <Stack.Screen name="passo5" />
      <Stack.Screen name="esqueci-senha" />
      <Stack.Screen name="nova-senha" />
      <Stack.Screen name="termos-uso" />
      <Stack.Screen name="privacidade" />
      <Stack.Screen name="two-factor" />
      <Stack.Screen name="verificar-otp" />
    </Stack>
  );
}
