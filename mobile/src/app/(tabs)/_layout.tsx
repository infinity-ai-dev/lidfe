import { Tabs, Slot, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions, Platform, View, StyleSheet, Alert } from 'react-native';
import { useTheme } from 'react-native-paper';
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import { WebDesktopLayout } from '@/components/layout/WebDesktopLayout';
import { supabase } from '@/services/supabase/client';
import { useExamProgress } from '@/hooks/useExamProgress';

export default function TabsLayout() {
  const theme = useTheme();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= 1024;
  // Controla o ponto de notificação no item de Histórico (mobile)
  const [hasNewExams, setHasNewExams] = useState(false);
  const { isUnlocked: isReceitaUnlocked } = useExamProgress({ watch: !isDesktopWeb });
  const isReceitaLocked = !isReceitaUnlocked;

  // Hooks devem ser chamados ANTES de qualquer return condicional (regra dos hooks)
  useEffect(() => {
    // Limpa aviso quando usuário abre o histórico
    if (pathname === '/(tabs)/exames') {
      setHasNewExams(false);
    }
  }, [pathname]);

  useEffect(() => {
    // No desktop, não precisa de subscription para notificação mobile
    if (isDesktopWeb) return;

    let channel: any;
    let isMounted = true;

    const setupSubscription = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !isMounted) return;

        channel = supabase
          .channel('tasks-exames-tab-notification')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'tasks_listaexames',
              filter: `user_id=eq.${user.id}`,
            },
            () => {
              // Marca ponto no menu quando novos exames chegam
              if (pathname !== '/(tabs)/exames') {
                setHasNewExams(true);
              }
            }
          )
          .subscribe();
      } catch {
        // Notificação é auxiliar
      }
    };

    setupSubscription();

    return () => {
      isMounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [pathname, isDesktopWeb]);

  // Web desktop: usar layout com sidebar (igual Flutter). Mobile/responsivo: usar bottom tabs.
  if (isDesktopWeb) {
    return (
      <WebDesktopLayout>
        <Slot />
      </WebDesktopLayout>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Igual ao Flutter (NavBarPage + MenuDesktop): fundo azul e labels escondidos
        tabBarShowLabel: false,
        tabBarActiveTintColor: '#F1F4F8', // primaryBackground (FlutterFlowTheme light)
        tabBarInactiveTintColor: '#14181B', // primaryText (FlutterFlowTheme light)
        tabBarStyle: {
          backgroundColor: '#3996ED',
          borderTopColor: theme.colors.outline,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Painel',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="exames"
        options={{
          title: 'Histórico',
          tabBarIcon: ({ color, size }) => (
            <View style={styles.tabIconWrapper}>
              <MaterialIcons name="medical-services" size={size} color={color} />
              {/* Ponto simples de notificação */}
              {hasNewExams && <View style={styles.tabDot} />}
            </View>
          ),
        }}
        listeners={{
          tabPress: () => {
            // Limpa o ponto ao acessar o histórico
            setHasNewExams(false);
          },
        }}
      />
      <Tabs.Screen
        name="prescricao"
        options={{
          title: 'Receita',
          tabBarIcon: ({ color, size }) => (
            <View style={styles.tabIconWrapper}>
              <FontAwesome5 name="file-signature" size={size - 2} color={color} solid />
              {isReceitaLocked && <MaterialIcons name="lock" size={12} color="#FFD54F" style={styles.lockBadge} />}
            </View>
          ),
        }}
        listeners={{
          tabPress: (event) => {
            if (!isReceitaLocked) return;
            event.preventDefault();
            Alert.alert(
              'Receita Digital bloqueada',
              'Envie 100% dos resultados dos exames para liberar a receita digital.'
            );
          },
        }}
      />
      <Tabs.Screen
        name="interpretacao"
        options={{
          title: 'Interpretação',
          tabBarIcon: ({ color, size }) => (
            <FontAwesome5 name="file-medical-alt" size={size - 2} color={color} solid />
          ),
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="person" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="anamnese-historico/index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="anamnese-historico/[threadId]"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Wrapper do ícone da tab para suportar o ponto de notificação
  tabIconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    position: 'absolute',
    right: -6,
    top: -4,
  },
  // Ponto simples de notificação para novos exames
  tabDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#FFD54F',
  },
});
