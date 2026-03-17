import { useMemo } from 'react';
import { useThemeContext } from '@/contexts/ThemeContext';

export function useFontScale() {
  const { fontScale } = useThemeContext();

  const scale = useMemo(() => {
    return (size: number) => Math.round(size * fontScale);
  }, [fontScale]);

  return { fontScale, scale };
}
