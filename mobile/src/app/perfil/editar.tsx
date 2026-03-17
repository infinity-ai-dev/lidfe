import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, Image, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Snackbar, Text, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { supabase } from '@/services/supabase/client';
import { storageService } from '@/services/supabase/storage';
import { useAppStore } from '@/store/appStore';
import { useFontScale } from '@/hooks/useFontScale';

interface UserProfile {
  user_id: string;
  nome?: string;
  email?: string;
  fotoPerfil?: string | null;
  avatar_url?: string | null;
}

const AVATAR_BUCKET = 'avatars';

export default function EditarPerfilScreen() {
  const theme = useTheme();
  const { scale } = useFontScale();
  const router = useRouter();
  const { setUrlimageavatar } = useAppStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarVisible, setSnackbarVisible] = useState(false);

  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('usuarios')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (error) throw error;
        setProfile(data);
      } catch (error) {
        console.error('[Perfil] Erro ao carregar perfil:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, []);

  const pickFileWeb = (accept: string): Promise<File | null> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      // iOS Safari requer que o input esteja no DOM para abrir o picker
      input.style.position = 'fixed';
      input.style.top = '-9999px';
      input.style.left = '-9999px';
      input.style.opacity = '0';
      document.body.appendChild(input);

      let settled = false;
      const settle = (file: File | null) => {
        if (settled) return;
        settled = true;
        try { document.body.removeChild(input); } catch {}
        resolve(file);
      };

      input.onchange = () => settle(input.files?.[0] ?? null);

      const onWindowFocus = () => {
        window.removeEventListener('focus', onWindowFocus);
        setTimeout(() => settle(null), 500);
      };
      window.addEventListener('focus', onWindowFocus);

      input.click();
    });
  };

  const pickImageNative = async (): Promise<{ blob: Blob; name: string; type: string } | null> => {
    const { status: permStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permStatus !== 'granted') {
      Alert.alert('Permissão necessária', 'Permita acesso à galeria para enviar sua foto de perfil.');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return null;

    const asset = result.assets[0];
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const ext = asset.uri.split('.').pop() ?? 'jpg';
    const type = asset.mimeType ?? `image/${ext}`;

    return { blob, name: `avatar.${ext}`, type };
  };

  const handleUploadAvatar = async () => {
    try {
      // IMPORTANTE: No iOS Safari, o file picker DEVE ser aberto sincronamente
      // a partir do gesto do usuário. Qualquer await antes quebra a cadeia.
      let fileBlob: Blob;
      let fileName: string;
      let contentType: string;

      if (isWeb) {
        const file = await pickFileWeb('image/*');
        if (!file) { return; }
        fileBlob = file;
        fileName = file.name ? file.name.replace(/[^a-zA-Z0-9._-]/g, '_') : 'avatar.jpg';
        contentType = file.type || 'image/jpeg';
      } else {
        const picked = await pickImageNative();
        if (!picked) { return; }
        fileBlob = picked.blob;
        fileName = picked.name;
        contentType = picked.type;
      }

      // Após o picker, agora podemos fazer chamadas async
      setUploading(true);
      setStatus('Enviando foto...');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const storagePath = `${user.id}/${Date.now()}_${fileName}`;

      const { error: uploadError } = await storageService.uploadFile(
        AVATAR_BUCKET,
        storagePath,
        fileBlob,
        { contentType, upsert: true }
      );

      if (uploadError) throw uploadError;

      const publicUrl = await storageService.getPublicUrl(AVATAR_BUCKET, storagePath);

      setStatus('Atualizando perfil...');
      const { error: updateError } = await supabase
        .from('usuarios')
        .update({ fotoPerfil: publicUrl })
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      setProfile((prev) => (prev ? { ...prev, fotoPerfil: publicUrl } : prev));
      setUrlimageavatar(publicUrl);
      setSnackbarMessage('Foto atualizada com sucesso!');
      setSnackbarVisible(true);
      setStatus('Concluído.');
    } catch (error: any) {
      console.error('[Perfil] Erro ao enviar foto:', error);
      setStatus('');
      Alert.alert('Erro', error?.message || 'Não foi possível enviar a foto.');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const avatarUrl =
    profile?.fotoPerfil ||
    profile?.avatar_url ||
    'https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/ailife-1j94co/assets/ovym04gr9hsk/Screenshot_125.jpg';

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.headerOuter}>
        <View style={[styles.headerCard, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.headerTitle, { color: theme.colors.onSurface, fontSize: scale(18) }]}>
            Editar Perfil
          </Text>
        </View>
      </View>

      <Card style={styles.card}>
        <Card.Content>
          <View style={styles.avatarRow}>
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            <View style={styles.avatarText}>
              <Text variant="titleMedium" style={{ fontWeight: '700' }}>
                Foto do Perfil
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Use uma imagem quadrada para melhor resultado.
              </Text>
            </View>
          </View>

          {status ? (
            <View style={styles.statusRow}>
              {uploading && <ActivityIndicator size="small" />}
              <Text variant="bodySmall" style={{ marginLeft: uploading ? 8 : 0 }}>
                {status}
              </Text>
            </View>
          ) : null}

          <Button
            mode="contained"
            icon="image"
            onPress={() => void handleUploadAvatar()}
            disabled={uploading}
            style={styles.uploadButton}
          >
            Enviar Foto
          </Button>

        </Card.Content>
      </Card>

      <Button mode="outlined" onPress={() => router.back()} style={styles.backButton}>
        Voltar
      </Button>

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={4000}
      >
        {snackbarMessage}
      </Snackbar>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerOuter: {
    padding: 8,
  },
  headerCard: {
    minHeight: 70,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  card: {
    marginHorizontal: 8,
    marginBottom: 12,
    borderRadius: 12,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarImage: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  avatarText: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  uploadButton: {
    marginTop: 16,
  },
  backButton: {
    marginHorizontal: 8,
    marginBottom: 24,
  },
});
