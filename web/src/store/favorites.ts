import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { FavoriteRide } from '../../../shared/types';
import { storage } from '../platform/storage';

/** Id of a single-line favourite starred from a departure board. */
export const lineFavKey = (fromId: string, routeId: string, directionId: number) => `${fromId}|${routeId}|${directionId}`;

/** Id of a whole-stop favourite. */
export const stopFavKey = (stationId: string) => `stop:${stationId}`;

/** Id of an A→B ride favourite. */
export const rideFavKey = (fromId: string, toId: string, routeIds: string[]) =>
  `${fromId}>${toId}|${[...routeIds].sort().join(',')}`;

interface FavState {
  items: FavoriteRide[];
  add(f: FavoriteRide): void;
  remove(id: string): void;
  update(id: string, patch: Partial<FavoriteRide>): void;
  move(id: string, delta: number): void;
}

/** Shape stored before favourites became A→B rides (v0). */
interface FavoriteV0 {
  id: string;
  stationId: string;
  stationName: string;
  routeId: string;
  line: string;
  mode: FavoriteRide['lines'][number]['mode'];
  color: string;
  textColor: string;
  directionId: number;
  headsign: string;
  toStationId?: string;
  toStationName?: string;
}

export const useFavorites = create<FavState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (f) => {
        if (get().items.some((x) => x.id === f.id)) return;
        set((s) => ({ items: [...s.items, f] }));
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
    {
      name: 'slk.favorites',
      storage: createJSONStorage(() => storage),
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as { items: unknown[] };
        if (version < 1) {
          state.items = (state.items as FavoriteV0[]).map((o): FavoriteRide => ({
            id: o.id, // keep ids: day-plan legs reference them
            fromId: o.stationId,
            fromName: o.stationName,
            toId: o.toStationId,
            toName: o.toStationName,
            routeIds: [o.routeId],
            directionId: o.toStationId ? undefined : o.directionId,
            lines: [{ routeId: o.routeId, line: o.line, mode: o.mode, color: o.color, textColor: o.textColor }],
            headsign: o.headsign,
          }));
        }
        return state as unknown as FavState;
      },
    },
  ),
);
