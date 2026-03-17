import { useState, useEffect } from 'react';
import { StyleSheet, ScrollView, View, Alert, Image, Platform } from 'react-native';
import { Text, Card, Button, ActivityIndicator, useTheme, Divider, Switch, List, SegmentedButtons, Snackbar } from 'react-native-paper';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/services/supabase/client';
import { BioDigitalViewer } from '@/services/biodigital';
import { useAppStore } from '@/store/appStore';
import { useThemeContext } from '@/contexts/ThemeContext';
import { useFontScale } from '@/hooks/useFontScale';
import { FONT_SCALE_OPTIONS, FontScaleLevel } from '@/utils/theme';
import { storageService } from '@/services/supabase/storage';

interface UserProfile {
  user_id: string;
  nome?: string;
  email?: string;
  genero?: 'masculino' | 'feminino';
  fotoPerfil?: string;
  avatar_url?: string;
  created_at: string;
}

export default function PerfilScreen() {
  const theme = useTheme();
  const { themeMode, setThemeMode, isDark, fontScaleLevel, setFontScaleLevel } = useThemeContext();
  const { scale } = useFontScale();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { urlimageavatar, setUrlimageavatar } = useAppStore();
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarVisible, setSnackbarVisible] = useState(false);

  const isWeb = Platform.OS === 'web';

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

  useEffect(() => {
    loadProfile();
  }, []);

  const pickFileWeb = (): Promise<File | null> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
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
        // Remover o input do DOM após uso
        try { document.body.removeChild(input); } catch {}
        resolve(file);
      };

      input.onchange = () => settle(input.files?.[0] ?? null);

      // Detect cancellation: window regains focus after picker closes without selection
      const onWindowFocus = () => {
        window.removeEventListener('focus', onWindowFocus);
        setTimeout(() => settle(null), 500);
      };
      window.addEventListener('focus', onWindowFocus);

      input.click();
    });
  };

  const handleUploadAvatar = async () => {
    try {
      // IMPORTANTE: No iOS Safari, o file picker DEVE ser aberto sincronamente
      // a partir do gesto do usuário. Qualquer await antes do input.click()
      // quebra a cadeia de gesto e o picker não abre.
      let blob: Blob;
      let mimeType: string;
      let safeName: string;

      if (isWeb) {
        const file = await pickFileWeb();
        if (!file) {
          return;
        }
        blob = file;
        mimeType = file.type || 'image/jpeg';
        safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'avatar.jpg';
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permissão necessária', 'Precisamos de acesso à sua galeria de fotos para alterar o avatar.');
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });

        if (result.canceled) {
          return;
        }

        const asset = result.assets[0];
        const ext = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
        mimeType = asset.mimeType || `image/${ext}`;
        safeName = `avatar.${ext}`;
        const fetchResp = await fetch(asset.uri);
        blob = await fetchResp.blob();
      }

      // Após o picker, agora podemos fazer chamadas async
      setUploading(true);
      setUploadStatus('Enviando foto...');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const storagePath = `${user.id}/${Date.now()}_${safeName}`;

      const { error: uploadError } = await storageService.uploadFile(
        'avatars',
        storagePath,
        blob,
        { contentType: mimeType, upsert: true }
      );

      if (uploadError) throw uploadError;

      const publicUrl = await storageService.getPublicUrl('avatars', storagePath);

      setUploadStatus('Atualizando perfil...');
      const { error: updateError } = await supabase
        .from('usuarios')
        .update({ fotoPerfil: publicUrl })
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      setProfile((prev) => (prev ? { ...prev, fotoPerfil: publicUrl } : prev));
      setUrlimageavatar(publicUrl);
      setUploadStatus('');
      setSnackbarMessage('Foto atualizada com sucesso!');
      setSnackbarVisible(true);
    } catch (error: any) {
      console.error('[Perfil] Erro ao enviar foto:', error);
      setUploadStatus('');
      Alert.alert('Erro', error?.message || 'Não foi possível enviar a foto.');
    } finally {
      setUploading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      router.replace('/auth/home');
    } catch (error) {
      console.error('[Perfil] Erro ao fazer logout:', error);
      Alert.alert('Erro', 'Não foi possível fazer logout');
    }
  };

  const gender = profile?.genero || 'masculino';

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header alinhado com Flutter (PerflWidget): card 70px, raio 12 */}
      <View style={styles.headerOuter}>
        <View style={[styles.headerCard, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.headerTitle, { color: theme.colors.onSurface, fontSize: scale(18) }]}>
            Configurações do Perfil
          </Text>
        </View>
      </View>

      <View style={[styles.bodyCard, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.profileTop}>
          <Image
            source={{
              uri:
                profile?.fotoPerfil ||
                profile?.avatar_url ||
                urlimageavatar ||
                'https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/ailife-1j94co/assets/ovym04gr9hsk/Screenshot_125.jpg',
            }}
            style={styles.profileAvatar}
          />
          <Text style={[styles.profileName, { color: theme.colors.onSurface, fontSize: scale(18) }]}>
            {profile?.nome || 'Usuário'}
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            Membro desde {profile?.created_at ? new Date(profile.created_at).getFullYear() : '-'}
          </Text>
          <Button
            mode="outlined"
            icon="camera"
            onPress={() => void handleUploadAvatar()}
            disabled={uploading}
            style={styles.avatarButton}
          >
            Alterar foto
          </Button>
          {uploadStatus ? (
            <View style={styles.uploadStatusRow}>
              {uploading && <ActivityIndicator size="small" />}
              <Text variant="bodySmall" style={{ marginLeft: uploading ? 8 : 0 }}>
                {uploadStatus}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.profileActions}>
          <Button
            mode="outlined"
            icon="pencil"
            onPress={() => router.push('/perfil/editar')}
            style={styles.actionBtn}
          >
            Editar Perfil
          </Button>
          <Button
            mode="outlined"
            icon="shield-key"
            onPress={() => router.push('/auth/two-factor')}
            style={styles.actionBtn}
          >
            Autenticação de Dois Fatores
          </Button>
          <Button
            mode="outlined"
            icon="logout"
            onPress={handleSignOut}
            style={styles.actionBtn}
          >
            Sair
          </Button>
        </View>
      </View>

      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium" style={{ fontWeight: 'bold', marginBottom: 16 }}>
            Visualizador 3D Anatômico
          </Text>
          <View style={styles.biodigitalContainer}>
            <BioDigitalViewer gender={gender} />
          </View>
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium" style={{ fontWeight: 'bold', marginBottom: 8 }}>
            Aparência
          </Text>
          <Divider style={styles.divider} />
          <List.Item
            title="Tema Escuro"
            description={
              themeMode === 'system'
                ? 'Seguindo o sistema'
                : themeMode === 'dark'
                ? 'Sempre escuro'
                : 'Sempre claro'
            }
            left={(props) => <List.Icon {...props} icon={isDark ? 'weather-night' : 'weather-sunny'} />}
            right={() => (
              <Switch
                value={isDark}
                onValueChange={(value) => {
                  setThemeMode(value ? 'dark' : 'light');
                }}
              />
            )}
          />
          <List.Item
            title="Seguir sistema"
            description="Usar a preferência do dispositivo"
            left={(props) => <List.Icon {...props} icon="cellphone-cog" />}
            right={() => (
              <Switch
                value={themeMode === 'system'}
                onValueChange={(value) => {
                  setThemeMode(value ? 'system' : (isDark ? 'dark' : 'light'));
                }}
              />
            )}
          />
          <View style={styles.fontScaleSection}>
            <Text variant="bodyMedium" style={[styles.fontScaleTitle, { color: theme.colors.onSurface }]}>
              Tamanho da fonte
            </Text>
            <SegmentedButtons
              value={fontScaleLevel}
              onValueChange={(value) => setFontScaleLevel(value as FontScaleLevel)}
              buttons={FONT_SCALE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              style={styles.fontScaleButtons}
            />
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Ajuste o tamanho do texto em todo o app.
            </Text>
          </View>
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium" style={{ fontWeight: 'bold', marginBottom: 8 }}>
            Informações da Conta
          </Text>
          <Divider style={styles.divider} />
          <View style={styles.infoRow}>
            <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
              Gênero:
            </Text>
            <Text variant="bodyMedium">
              {gender === 'masculino' ? 'Masculino' : 'Feminino'}
            </Text>
          </View>
          {profile?.created_at && (
            <View style={styles.infoRow}>
              <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                Membro desde:
              </Text>
              <Text variant="bodyMedium">
                {new Date(profile.created_at).toLocaleDateString('pt-BR')}
              </Text>
            </View>
          )}
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Content>
          <Button
            mode="outlined"
            icon="pencil"
            onPress={() => router.push('/perfil/editar')}
            style={styles.button}
          >
            Editar Perfil
          </Button>
          <Button
            mode="outlined"
            icon="shield-key"
            onPress={() => router.push('/auth/two-factor')}
            style={styles.button}
          >
            Autenticação de Dois Fatores
          </Button>
          <Button
            mode="contained"
            icon="logout"
            onPress={handleSignOut}
            style={[styles.button, styles.signOutButton]}
            buttonColor={theme.colors.error}
          >
            Sair
          </Button>
        </Card.Content>
      </Card>
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
    padding: 8,
  },
  headerOuter: {
    padding: 8,
  },
  headerCard: {
    height: 70,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  bodyCard: {
    marginHorizontal: 8,
    marginBottom: 16,
    borderRadius: 12,
  },
  profileTop: {
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  profileAvatar: {
    width: 100,
    height: 100,
    borderRadius: 999,
  },
  profileName: {
    fontWeight: '700',
  },
  profileActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  avatarButton: {
    marginTop: 8,
    borderRadius: 999,
  },
  uploadStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    borderRadius: 12,
  },
  card: {
    marginBottom: 16,
  },
  profileContent: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  avatar: {
    marginBottom: 8,
  },
  biodigitalContainer: {
    width: '100%',
    height: 300,
    marginTop: 8,
  },
  divider: {
    marginVertical: 12,
  },
  fontScaleSection: {
    marginTop: 16,
    gap: 8,
  },
  fontScaleTitle: {
    fontWeight: '600',
  },
  fontScaleButtons: {
    alignSelf: 'stretch',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 8,
  },
  button: {
    marginBottom: 8,
  },
  signOutButton: {
    marginTop: 8,
  },
});
