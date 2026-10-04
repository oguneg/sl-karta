import type {
  Connection, Departure, Meta, PlanRequest, PlanResult, RouteDetail, RouteInfo, Station, TripDetail, Vehicle,
} from '../../../shared/types';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { signal });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  return res.json() as Promise<T>;
}

type BBox = [number, number, number, number];
const bboxParam = (b: BBox) => b.map((n) => n.toFixed(4)).join(',');

export const api = {
  meta: (s?: AbortSignal) => get<Meta>('/meta', s),
  routes: (s?: AbortSignal) => get<RouteInfo[]>('/routes', s),
  route: (id: string, s?: AbortSignal) => get<RouteDetail>(`/routes/${encodeURIComponent(id)}`, s),
  connections: (from: string, to: string, s?: AbortSignal) =>
    get<Connection[]>(`/connections?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, s),
  network: (s?: AbortSignal) => get<GeoJSON.FeatureCollection>('/network', s),
  trip: (id: string, s?: AbortSignal) => get<TripDetail>(`/trips/${encodeURIComponent(id)}`, s),
  vehicles: (bbox?: BBox, s?: AbortSignal) =>
    get<{ time: number; vehicles: Vehicle[] }>(`/vehicles${bbox ? `?bbox=${bboxParam(bbox)}` : ''}`, s),
  nearby: (lat: number, lon: number, radius = 800, s?: AbortSignal) =>
    get<Station[]>(`/stations/nearby?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&radius=${radius}`, s),
  stationsInBox: (bbox: BBox, s?: AbortSignal) => get<Station[]>(`/stations/box?bbox=${bboxParam(bbox)}`, s),
  search: (q: string, s?: AbortSignal) =>
    get<{ lines: RouteInfo[]; stations: Station[] }>(`/search?q=${encodeURIComponent(q)}`, s),
  popular: (s?: AbortSignal) => get<Station[]>('/stations/popular', s),
  station: (id: string, s?: AbortSignal) => get<Station>(`/stations/${encodeURIComponent(id)}`, s),
  departures: (
    id: string,
    opts: {
      minutes?: number; routes?: string[]; direction?: number; to?: string; limit?: number; from?: number;
      /** If nothing departs within `minutes`, get the next departures (up to 3 days ahead) instead. */
      fallback?: boolean;
    } = {},
    s?: AbortSignal,
  ) => {
    const p = new URLSearchParams();
    if (opts.minutes) p.set('minutes', String(opts.minutes));
    if (opts.routes?.length) p.set('routes', opts.routes.join(','));
    if (opts.to) p.set('to', opts.to);
    if (opts.fallback) p.set('fallback', '1');
    if (opts.direction !== undefined) p.set('direction', String(opts.direction));
    if (opts.limit) p.set('limit', String(opts.limit));
    if (opts.from) p.set('from', String(opts.from));
    return get<Departure[]>(`/stations/${encodeURIComponent(id)}/departures?${p}`, s);
  },
  plan: async (req: PlanRequest, signal?: AbortSignal) => {
    const res = await fetch(`${BASE}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json() as Promise<PlanResult>;
  },
};
