import { create } from 'zustand';
import type { Meta, TripDetail, Vehicle } from '../../../shared/types';

export type Tab = 'map' | 'nearby' | 'favorites' | 'plan' | 'settings';

export type Sheet =
  | { kind: 'station'; id: string }
  | { kind: 'vehicle'; vehicle: Vehicle }
  | { kind: 'route'; id: string; directionId?: number; fit?: boolean }
  /** Several lines share the tapped track: let the user pick one. */
  | { kind: 'lines'; routeIds: string[] }
  | null;

interface UiState {
  tab: Tab;
  sheet: Sheet;
  /** Route drawn on the map and whose vehicles are emphasised. */
  highlightRoute?: string;
  /** Selected vehicle's journey, drawn on the map instead of the generic line. */
  trip?: TripDetail;
  /** Lines serving the open stop, drawn on the map (GeoJSON from /stations/:id/lines). */
  stationLines?: { stationId: string; routeIds: string[]; data: GeoJSON.FeatureCollection };
  flyTo?: { lat: number; lon: number; zoom?: number; seq: number };
  /** Request to frame a bounding box [minLon, minLat, maxLon, maxLat]. */
  fitTo?: { bbox: [number, number, number, number]; seq: number };
  meta?: Meta;
  offline: boolean;
  setTab(t: Tab): void;
  open(sheet: Sheet): void;
  close(): void;
  setHighlight(routeId?: string): void;
  setTrip(trip?: TripDetail): void;
  setStationLines(v?: UiState['stationLines']): void;
  fly(lat: number, lon: number, zoom?: number): void;
  fit(bbox: [number, number, number, number]): void;
  setMeta(m?: Meta, offline?: boolean): void;
}

export const useUi = create<UiState>()((set) => ({
  tab: 'map',
  sheet: null,
  offline: false,
  setTab: (tab) => set({ tab, sheet: null }),
  open: (sheet) => set({ sheet }),
  close: () => set({ sheet: null }),
  setHighlight: (highlightRoute) => set({ highlightRoute }),
  setTrip: (trip) => set({ trip }),
  setStationLines: (stationLines) => set({ stationLines }),
  fit: (bbox) => set((s) => ({ fitTo: { bbox, seq: (s.fitTo?.seq ?? 0) + 1 } })),
  fly: (lat, lon, zoom) => set((s) => ({ flyTo: { lat, lon, zoom, seq: (s.flyTo?.seq ?? 0) + 1 } })),
  setMeta: (meta, offline = false) => set({ meta, offline }),
}));

/** Show a station: switch to the map, centre on it and open its departures. */
export function showStation(id: string, lat?: number, lon?: number) {
  const ui = useUi.getState();
  ui.setTab('map');
  if (lat !== undefined && lon !== undefined) ui.fly(lat, lon, 15);
  ui.open({ kind: 'station', id });
}
