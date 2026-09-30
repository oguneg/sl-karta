import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Mode } from '../../../shared/types';
import { storage } from '../platform/storage';

export type Theme = 'system' | 'light' | 'dark';

interface SettingsState {
  lang: 'sv' | 'en';
  theme: Theme;
  modes: Mode[]; // vehicle modes visible on the map
  setLang(l: 'sv' | 'en'): void;
  setTheme(t: Theme): void;
  toggleMode(m: Mode): void;
}

const browserLang = (): 'sv' | 'en' =>
  typeof navigator !== 'undefined' && navigator.language && !navigator.language.startsWith('sv') ? 'en' : 'sv';

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      lang: browserLang(),
      theme: 'system',
      modes: ['metro', 'train', 'tram', 'bus', 'ship'],
      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      toggleMode: (m) => set((s) => ({ modes: s.modes.includes(m) ? s.modes.filter((x) => x !== m) : [...s.modes, m] })),
    }),
    { name: 'slk.settings', storage: createJSONStorage(() => storage) },
  ),
);
