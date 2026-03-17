import { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useRouter, usePathname } from 'expo-router';
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import { supabase } from '@/services/supabase/client';
import { databaseService } from '@/services/supabase/database/tables';
import { useExamProgress } from '@/hooks/useExamProgress';
import { useFontScale } from '@/hooks/useFontScale';
import { useThemeContext } from '@/contexts/ThemeContext';

type MenuItem = {
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
};

type UsuarioProfile = {
  nome?: string | null;
  fotoPerfil?: string | null;
};

type MenuDesktopProps = {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

const FALLBACK_AVATAR_URL =
  'https://storage.googleapis.com/flutterflow-io-6f20.appspot.com/projects/ailife-1j94co/assets/ovym04gr9hsk/Screenshot_125.jpg';

export function MenuDesktop({ collapsed = false, onToggleCollapse }: MenuDesktopProps) {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { isUnlocked: isReceitaUnlocked } = useExamProgress();
  const isReceitaLocked = !isReceitaUnlocked;
  const { scale } = useFontScale();

  const { isDark, setThemeMode } = useThemeContext();
  const [profile, setProfile] = useState<UsuarioProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  // Controla exibição do ponto de notificação no item de Histórico de Exames
  const [hasNewExams, setHasNewExams] = useState(false);

  const menuItems: MenuItem[] = useMemo(
    () => [
      {
        key: 'painel',
        label: 'Painel de Controle',
        href: '/(tabs)',
        icon: <MaterialIcons name="space-dashboard" size={24} color={theme.colors.background} />,
      },
      {
        key: 'prescricao',
        label: 'Receita Digital',
        href: '/(tabs)/prescricao',
        icon: (
          <View style={styles.iconWithBadge}>
            <FontAwesome5 name="file-signature" size={20} color={theme.colors.background} solid />
            {isReceitaLocked && (
              <MaterialIcons name="lock" size={12} color="#FFD54F" style={styles.lockBadge} />
            )}
          </View>
        ),
      },
      {
        key: 'interpretacao',
        label: 'Interpretação de Exames',
        href: '/(tabs)/interpretacao',
        icon: <FontAwesome5 name="file-medical-alt" size={22} color={theme.colors.background} solid />,
      },
      {
        key: 'historico',
        label: 'Histórico de Exames',
        href: '/(tabs)/exames',
        icon: <MaterialIcons name="medical-services" size={24} color={theme.colors.background} />,
      },
      {
        key: 'perfil',
        label: 'Perfil',
        href: '/(tabs)/perfil',
        icon: <MaterialIcons name="person" size={24} color={theme.colors.background} />,
      },
    ],
    [theme.colors.background, isReceitaLocked]
  );

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await databaseService.usuarios.getByUserId(user.id);
        if (!isMounted) return;
        setProfile({
          nome: (data as any)?.nome ?? (data as any)?.['nome completo'] ?? null,
          fotoPerfil: (data as any)?.fotoPerfil ?? null,
        });
      } catch (e) {
        // Mantém fallback visual
      } finally {
        if (isMounted) setLoadingProfile(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    // Limpa aviso quando usuário está no histórico
    if (pathname === '/(tabs)/exames') {
      setHasNewExams(false);
    }
  }, [pathname]);

  useEffect(() => {
    let channel: any;
    let isMounted = true;

    const setupSubscription = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !isMounted) return;

        channel = supabase
          .channel('tasks-exames-menu-notification')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'tasks_listaexames',
              filter: `user_id=eq.${user.id}`,
            },
            () => {
              // Marca aviso simples no menu quando novos exames chegam
              if (pathname !== '/(tabs)/exames') {
                setHasNewExams(true);
              }
            }
          )
          .subscribe();
      } catch (e) {
        // Silencioso: notificação é auxiliar
      }
    };

    setupSubscription();

    return () => {
      isMounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [pathname]);

  const handleNavigate = (href: string) => {
    if (pathname === href) return;

    if (href === '/(tabs)/prescricao' && isReceitaLocked) {
      Alert.alert(
        'Receita Digital bloqueada',
        'Envie 100% dos resultados dos exames para liberar a receita digital.'
      );
      return;
    }

    // Ao entrar no histórico, limpar indicador de novos exames
    if (href === '/(tabs)/exames') {
      setHasNewExams(false);
    }

    router.push(href);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/auth/home');
  };

  // Renderizar apenas no web desktop (por segurança)
  if (Platform.OS !== 'web') return null;

  return (
    <View
      style={[
        styles.container,
        collapsed && styles.containerCollapsed,
        { borderColor: theme.colors.outline },
      ]}
    >
      {/* Botão de toggle collapse */}
      <View style={[styles.toggleRow, collapsed && styles.toggleRowCollapsed]}>
        {!collapsed && (
          <View style={styles.header}>
            <Text style={[styles.brand, { color: theme.colors.background, fontSize: scale(28) }]}>LIDFE</Text>
            <Text style={[styles.subtitle, { color: theme.colors.background, fontSize: scale(10) }]}>HEALTH TECH</Text>
          </View>
        )}
        <Pressable
          onPress={onToggleCollapse}
          style={({ pressed, hovered }) => [
            styles.toggleButton,
            { opacity: pressed ? 0.7 : hovered ? 0.85 : 1 },
          ]}
        >
          <MaterialIcons
            name={collapsed ? 'chevron-right' : 'chevron-left'}
            size={22}
            color={theme.colors.background}
          />
        </Pressable>
      </View>

      {!collapsed && (
        <View style={styles.profileRow}>
          <View style={[styles.avatarRing, { borderColor: '#249689' }]}>
            <Image
              source={{ uri: (profile?.fotoPerfil || '').trim() || FALLBACK_AVATAR_URL }}
              style={styles.avatar}
              resizeMode="cover"
            />
          </View>
          <View style={styles.profileText}>
            <Text style={[styles.profileName, { color: theme.colors.background, fontSize: scale(16) }]}>
              {loadingProfile ? '-' : profile?.nome || '-'}
            </Text>
          </View>
        </View>
      )}

      {collapsed && (
        <View style={styles.collapsedAvatar}>
          <View style={[styles.avatarRing, { borderColor: '#249689' }]}>
            <Image
              source={{ uri: (profile?.fotoPerfil || '').trim() || FALLBACK_AVATAR_URL }}
              style={styles.avatar}
              resizeMode="cover"
            />
          </View>
        </View>
      )}

      <View style={[styles.divider, { backgroundColor: theme.colors.outline }]} />

      <View style={[styles.menu, collapsed && styles.menuCollapsed]}>
        {menuItems.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => handleNavigate(item.href)}
            style={({ hovered, pressed }) => [
              styles.menuItem,
              collapsed && styles.menuItemCollapsed,
              {
                backgroundColor: '#3996ED',
                opacity:
                  item.key === 'prescricao' && isReceitaLocked
                    ? 0.6
                    : pressed
                      ? 0.85
                      : hovered
                        ? 0.95
                        : 1,
              },
            ]}
          >
            <View style={[styles.menuIcon, collapsed && styles.menuIconCollapsed]}>{item.icon}</View>
            {!collapsed && (
              <View style={styles.menuLabelRow}>
                <Text style={[styles.menuLabel, { color: theme.colors.background, fontSize: scale(14) }]}>
                  {item.label}
                </Text>
                {item.key === 'historico' && hasNewExams && (
                  <View style={[styles.menuDot, { backgroundColor: '#FFD54F' }]} />
                )}
              </View>
            )}
            {collapsed && item.key === 'historico' && hasNewExams && (
              <View style={[styles.menuDotCollapsed, { backgroundColor: '#FFD54F' }]} />
            )}
          </Pressable>
        ))}
      </View>

      <View style={[styles.divider, { backgroundColor: theme.colors.outline }]} />

      <View style={[styles.footer, collapsed && styles.footerCollapsed]}>
        <Pressable
          onPress={() => setThemeMode(isDark ? 'light' : 'dark')}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <MaterialIcons
            name={isDark ? 'light-mode' : 'dark-mode'}
            size={24}
            color={theme.colors.background}
          />
        </Pressable>
        <Pressable onPress={handleLogout} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
          <MaterialIcons name="logout" size={24} color={theme.colors.background} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 270,
    height: '100%',
    backgroundColor: '#3996ED',
    borderRadius: 12,
    borderWidth: 1,
    paddingTop: 16,
    paddingBottom: 16,
  },
  containerCollapsed: {
    width: 72,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  toggleRowCollapsed: {
    justifyContent: 'center',
  },
  toggleButton: {
    padding: 4,
    borderRadius: 8,
  },
  header: {
    flex: 1,
    paddingHorizontal: 4,
  },
  brand: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 10,
    letterSpacing: 0,
  },
  profileRow: {
    marginTop: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  collapsedAvatar: {
    marginTop: 12,
    alignItems: 'center',
  },
  avatarRing: {
    width: 50,
    height: 50,
    borderRadius: 100,
    borderWidth: 2,
    padding: 2,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 100,
  },
  profileText: {
    marginLeft: 12,
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  divider: {
    height: 2,
    marginTop: 12,
    marginBottom: 12,
  },
  menu: {
    paddingHorizontal: 12,
    gap: 12,
  },
  menuCollapsed: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  menuItem: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemCollapsed: {
    width: 48,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  menuIcon: {
    width: 36,
    alignItems: 'center',
  },
  menuIconCollapsed: {
    width: 'auto',
  },
  iconWithBadge: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    position: 'absolute',
    right: -10,
    top: -6,
  },
  menuLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  menuLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginLeft: 8,
  },
  menuDotCollapsed: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  footer: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
  },
  footerCollapsed: {
    paddingHorizontal: 0,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
});
