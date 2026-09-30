import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { FavoriteRide } from '../../../shared/types';
import { storage } from '../platform/storage';

export const favKey = (f: Pick<FavoriteRide, 'stationId' | 'routeId' | 'directionId'>) =>
  `${f.stationId}|${f.routeId}|${f.directionId}`;

interface FavState {
  items: FavoriteRide[];
  add(f: Omit<FavoriteRide, 'id'>): void;
  remove(id: string): void;
  update(id: string, patch: Partial<FavoriteRide>): void;
  move(id: string, delta: number): void;
}

export const useFavorites = create<FavState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (f) => {
        const id = favKey(f);
        if (get().items.some((x) => x.id === id)) return;
        set((s) => ({ items: [...s.items, { ...f, id }] }));
      },
      remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
      update: (id, patch) => set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      move: (id, delta) =>
        set((s) => {
          const i = s.items.findIndex((x) => x.id === id);
          const j = i + delta;
          if (i < 0 || j < 0 || j >= s.items.length) return s;
          const items = [...s.items];
          [items[i], items[j]] = [items[j], items[i]];
          return { items };
        }),
    }),
    { name: 'slk.favorites', storage: createJSONStorage(() => storage) },
  ),
);
