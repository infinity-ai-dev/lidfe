import { MD3LightTheme, MD3DarkTheme, configureFonts } from 'react-native-paper';

export type FontScaleLevel = 'small' | 'normal' | 'large' | 'xlarge';

export const FONT_SCALE_LEVELS: Record<FontScaleLevel, number> = {
  small: 0.9,
  normal: 1,
  large: 1.1,
  xlarge: 1.2,
};

export const FONT_SCALE_OPTIONS: Array<{
  value: FontScaleLevel;
  label: string;
  scale: number;
}> = [
  { value: 'small', label: 'Pequena', scale: FONT_SCALE_LEVELS.small },
  { value: 'normal', label: 'Normal', scale: FONT_SCALE_LEVELS.normal },
  { value: 'large', label: 'Grande', scale: FONT_SCALE_LEVELS.large },
  { value: 'xlarge', label: 'Muito grande', scale: FONT_SCALE_LEVELS.xlarge },
];

const baseFontConfig = {
  displayLarge: {
    fontFamily: 'System',
    fontSize: 57,
    fontWeight: '400' as const,
    letterSpacing: 0,
    lineHeight: 64,
  },
  displayMedium: {
    fontFamily: 'System',
    fontSize: 45,
    fontWeight: '400' as const,
    letterSpacing: 0,
    lineHeight: 52,
  },
  displaySmall: {
    fontFamily: 'System',
    fontSize: 36,
    fontWeight: '400' as const,
    letterSpacing: 0,
    lineHeight: 44,
  },
  headlineLarge: {
    fontFamily: 'System',
    fontSize: 32,
    fontWeight: '400' as const,
    letterSpacing: 0,
    lineHeight: 40,
  },
  headlineMedium: {
    fontFamily: 'System',
    fontSize: 28,
    fontWeight: '400' as const,
    letterSpacing: 0,
    lineHeight: 36,
  },
  headlineSmall: {
    fontFamily: 'System',
    fontSize: 24,
    fontWeight: '400' as const,
    letterSpacing: 0,
    lineHeight: 32,
  },
  titleLarge: {
    fontFamily: 'System',
    fontSize: 22,
    fontWeight: '500' as const,
    letterSpacing: 0,
    lineHeight: 28,
  },
  titleMedium: {
    fontFamily: 'System',
    fontSize: 16,
    fontWeight: '500' as const,
    letterSpacing: 0.15,
    lineHeight: 24,
  },
  titleSmall: {
    fontFamily: 'System',
    fontSize: 14,
    fontWeight: '500' as const,
    letterSpacing: 0.1,
    lineHeight: 20,
  },
  bodyLarge: {
    fontFamily: 'System',
    fontSize: 16,
    fontWeight: '400' as const,
    letterSpacing: 0.5,
    lineHeight: 24,
  },
  bodyMedium: {
    fontFamily: 'System',
    fontSize: 14,
    fontWeight: '400' as const,
    letterSpacing: 0.25,
    lineHeight: 20,
  },
  bodySmall: {
    fontFamily: 'System',
    fontSize: 12,
    fontWeight: '400' as const,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  labelLarge: {
    fontFamily: 'System',
    fontSize: 14,
    fontWeight: '500' as const,
    letterSpacing: 0.1,
    lineHeight: 20,
  },
  labelMedium: {
    fontFamily: 'System',
    fontSize: 12,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
    lineHeight: 16,
  },
  labelSmall: {
    fontFamily: 'System',
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
    lineHeight: 16,
  },
};

const scaleNumber = (value: number, scale: number) => Math.round(value * scale);

const buildFontConfig = (scale: number) => {
  const entries = Object.entries(baseFontConfig).map(([key, value]) => [
    key,
    {
      ...value,
      fontSize: scaleNumber(value.fontSize, scale),
      lineHeight: scaleNumber(value.lineHeight, scale),
    },
  ]);

  return Object.fromEntries(entries) as typeof baseFontConfig;
};

const lightColors = {
  ...MD3LightTheme.colors,
  // Alinhado com FlutterFlowTheme (LightModeTheme)
  primary: '#4B39EF',
  secondary: '#39D2C0',
  tertiary: '#EE8B60',
  error: '#FF5963',
  background: '#F1F4F8',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F4F8',
  onPrimary: '#FFFFFF',
  onSecondary: '#FFFFFF',
  onTertiary: '#FFFFFF',
  onError: '#FFFFFF',
  onBackground: '#14181B',
  onSurface: '#14181B',
  onSurfaceVariant: '#57636C',
  outline: '#E0E3E7',
  outlineVariant: '#E0E3E7',
  shadow: '#000000',
  scrim: '#000000',
  inverseSurface: '#121212',
  inverseOnSurface: '#FFFFFF',
  inversePrimary: '#90CAF9',
  elevation: {
    level0: '#FFFFFF',
    level1: '#FAFAFA',
    level2: '#F5F5F5',
    level3: '#F0F0F0',
    level4: '#EBEBEB',
    level5: '#E6E6E6',
  },
};

const darkColors = {
  ...MD3DarkTheme.colors,
  // Alinhado com FlutterFlowTheme (DarkModeTheme)
  primary: '#4B39EF',
  secondary: '#39D2C0',
  tertiary: '#EE8B60',
  error: '#FF5963',
  background: '#1D2428',
  surface: '#14181B',
  surfaceVariant: '#1D2428',
  onPrimary: '#FFFFFF',
  onSecondary: '#FFFFFF',
  onTertiary: '#FFFFFF',
  onError: '#FFFFFF',
  onBackground: '#FFFFFF',
  onSurface: '#FFFFFF',
  onSurfaceVariant: '#95A1AC',
  outline: '#262D34',
  outlineVariant: '#262D34',
  shadow: '#000000',
  scrim: '#000000',
  inverseSurface: '#E0E0E0',
  inverseOnSurface: '#000000',
  inversePrimary: '#1976D2',
  elevation: {
    level0: '#121212',
    level1: '#1E1E1E',
    level2: '#242424',
    level3: '#2C2C2C',
    level4: '#323232',
    level5: '#383838',
  },
};

export const createTheme = (mode: 'light' | 'dark', fontScale: number) => {
  const fontConfig = buildFontConfig(fontScale);
  if (mode === 'dark') {
    return {
      ...MD3DarkTheme,
      colors: darkColors,
      fonts: configureFonts({ config: fontConfig }),
    };
  }

  return {
    ...MD3LightTheme,
    colors: lightColors,
    fonts: configureFonts({ config: fontConfig }),
  };
};

export type Theme = ReturnType<typeof createTheme>;
