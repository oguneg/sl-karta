import { useEffect, useState } from 'react';
import { useSettings } from './store/settings';

const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

/** 'light' | 'dark' after applying the user's setting (or the OS preference). */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useSettings((s) => s.theme);
  const [sysDark, setSysDark] = useState(() => mq().matches);
  useEffect(() => {
    const m = mq();
    const on = () => setSysDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return theme === 'system' ? (sysDark ? 'dark' : 'light') : theme;
}

/** Keeps <html data-theme> in sync so CSS tokens follow the setting. */
export function useApplyTheme() {
  const resolved = useResolvedTheme();
  const lang = useSettings((s) => s.lang);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.lang = lang;
  }, [resolved, lang]);
}
