import { useEffect, useState } from 'react';
import { usePreference } from './usePreferences';

type Theme = 'light' | 'dark' | 'system';
const validTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark' || value === 'system';
export function useTheme() {
  const [theme, setTheme] = usePreference<Theme>('ttc:theme:v1', 'system', validTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111f29' : '#f7f5ed');
  }, [dark]);
  return { dark, toggle: () => setTheme(dark ? 'light' : 'dark') };
}
