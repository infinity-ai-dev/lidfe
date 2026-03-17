import React, { useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTheme } from 'react-native-paper';
import { MenuDesktop } from '@/components/layout/MenuDesktop';

type Props = {
  children: React.ReactNode;
};

export function WebDesktopLayout({ children }: Props) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Espelha a lógica do Flutter: MenuDesktop aparece só em desktop.
  const isDesktopWeb = Platform.OS === 'web' && width >= 1024;

  if (!isDesktopWeb) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background, minHeight: height }]}>
      <View style={styles.row}>
        <View style={[styles.menuPad, sidebarCollapsed && styles.menuPadCollapsed]}>
          <MenuDesktop
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          />
        </View>
        <View style={styles.contentPad}>
          <View style={styles.contentContainer}>{children}</View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  menuPad: {
    paddingLeft: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  menuPadCollapsed: {
    paddingLeft: 8,
  },
  contentPad: {
    flex: 1,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 16,
    paddingBottom: 0,
  },
  contentContainer: {
    flex: 1,
    borderRadius: 12,
  },
});

