import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { storage } from '../platform/storage';

export interface PlanLeg {
  key: string;
  favoriteId: string;
  notBefore?: string; // HH:MM
  transferMinutes: number;
}

interface PlanState {
  start: string;
  legs: PlanLeg[];
  setStart(s: string): void;
  addLeg(favoriteId: string): void;
  updateLeg(key: string, patch: Partial<PlanLeg>): void;
  removeLeg(key: string): void;
  moveLeg(key: string, delta: number): void;
}

export const usePlan = create<PlanState>()(
  persist(
    (set) => ({
      start: '08:00',
      legs: [],
      setStart: (start) => set({ start }),
      addLeg: (favoriteId) =>
        set((s) => ({ legs: [...s.legs, { key: Math.random().toString(36).slice(2), favoriteId, transferMinutes: 3 }] })),
      updateLeg: (key, patch) => set((s) => ({ legs: s.legs.map((l) => (l.key === key ? { ...l, ...patch } : l)) })),
      removeLeg: (key) => set((s) => ({ legs: s.legs.filter((l) => l.key !== key) })),
      moveLeg: (key, delta) =>
        set((s) => {
          const i = s.legs.findIndex((l) => l.key === key);
          const j = i + delta;
          if (i < 0 || j < 0 || j >= s.legs.length) return s;
          const legs = [...s.legs];
          [legs[i], legs[j]] = [legs[j], legs[i]];
          return { legs };
        }),
    }),
    { name: 'slk.plan', storage: createJSONStorage(() => storage) },
  ),
);
