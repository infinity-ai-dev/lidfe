import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createTheme, Theme, FontScaleLevel, FONT_SCALE_LEVELS } from '@/utils/theme';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  isDark: boolean;
  fontScaleLevel: FontScaleLevel;
  fontScale: number;
  setFontScaleLevel: (level: FontScaleLevel) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = '@lidfe:theme_mode';
const FONT_SCALE_STORAGE_KEY = '@lidfe:font_scale_level';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [fontScaleLevel, setFontScaleLevelState] = useState<FontScaleLevel>('normal');
  const [isInitialized, setIsInitialized] = useState(false);

  // Carregar preferência salva ao inicializar
  useEffect(() => {
    const loadThemePreference = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system')) {
          setThemeModeState(savedTheme as ThemeMode);
        }
        const savedFontScale = await AsyncStorage.getItem(FONT_SCALE_STORAGE_KEY);
        if (savedFontScale && savedFontScale in FONT_SCALE_LEVELS) {
          setFontScaleLevelState(savedFontScale as FontScaleLevel);
        }
      } catch (error) {
        console.error('[Theme] Erro ao carregar preferência de tema:', error);
      } finally {
        setIsInitialized(true);
      }
    };
    loadThemePreference();
  }, []);

  // Salvar preferência quando mudar
  const setThemeMode = async (mode: ThemeMode) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
      setThemeModeState(mode);
    } catch (error) {
      console.error('[Theme] Erro ao salvar preferência de tema:', error);
    }
  };

  const setFontScaleLevel = async (level: FontScaleLevel) => {
    try {
      await AsyncStorage.setItem(FONT_SCALE_STORAGE_KEY, level);
      setFontScaleLevelState(level);
    } catch (error) {
      console.error('[Theme] Erro ao salvar preferência de fonte:', error);
    }
  };

  // Determinar se deve usar tema escuro
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemColorScheme === 'dark');
  const fontScale = FONT_SCALE_LEVELS[fontScaleLevel] ?? 1;
  const theme = createTheme(isDark ? 'dark' : 'light', fontScale);

  // Não renderizar até carregar a preferência
  if (!isInitialized) {
    return null;
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themeMode,
        setThemeMode,
        isDark,
        fontScaleLevel,
        fontScale,
        setFontScaleLevel,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useThemeContext deve ser usado dentro de ThemeProvider');
  }
  return context;
}
