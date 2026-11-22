import { useLayoutEffect } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useLocal } from './useLocal';

export type Theme = 'system' | 'light' | 'dark';
export const themeOptions = [
  { value: 'system', label: 'System', description: 'Follow your device', icon: Monitor },
  { value: 'light', label: 'Light', description: 'Soft, bright surfaces', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Pastel pink accents', icon: Moon },
] as const;

export function useTheme() {
  const [theme, setTheme] = useLocal<Theme>('mm-theme-v1', 'system');
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
  }, [theme]);
  return { theme, setTheme };
}
