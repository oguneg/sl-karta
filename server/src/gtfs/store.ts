import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type {
  Departure, Mode, PlanRequest, PlanResult, RouteDetail, RouteDirection, RouteInfo, Station, StationLine, Vehicle,
} from '../../../shared/types.ts';
import { defaultColor, modeFromRouteType, normColor } from '../modes.ts';
import { addDays, localTimeToEpoch, midnight, nowSec, serviceDate, weekday } from '../time.ts';

/** Realtime info the store can apply to scheduled data. */
export interface TripRealtime {
  canceled?: boolean;
  updates: { seq?: number; stopId?: string; arrDelay?: number; depDelay?: number; arrTime?: number; depTime?: number; skipped?: boolean }[];
}
export interface RealtimeLookup {
  trip(tripId: string): TripRealtime | undefined;
}

interface StationRec extends Station {
  childIds: string[];
  search: string;
}

interface StopRec {
  name: string;
  lat: number;
  lon: number;
  platform?: string;
  stationId: string;
}

export type DepInternal = Departure & { seq: number };

const MODE_ORDER: Mode[] = ['metro', 'train', 'tram', 'bus', 'ship', 'other'];

const normalize = (s: string) =>
  s.toLocaleLowerCase('sv-SE').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

export class GtfsStore {
  readonly db: DatabaseSync;
  readonly version: string;
  readonly routes = new Map<string, RouteInfo>();
  readonly stations = new Map<string, StationRec>();
  readonly stops = new Map<string, StopRec>();
  private calendar: { id: string; days: string; start: string; end: string }[] = [];
  private svcCache = new Map<string, Set<string>>();
  private tripCache = new Map<string, { routeId: string; directionId: number; headsign: string } | null>();
  private routeDetailCache = new Map<string, RouteDetail>();
  private q: Record<string, StatementSync> = {};

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { readOnly: true });
    this.version = (this.db.prepare("SELECT value FROM meta WHERE key='version'").get() as { value: string } | undefined)?.value ?? '?';
    this.loadRoutes();
    this.loadStops();
    this.calendar = this.db.prepare('SELECT service_id AS id, days, start, end FROM calendar').all() as typeof this.calendar;
    this.q = {
      trip: this.db.prepare('SELECT route_id, direction_id, headsign FROM trips WHERE trip_id = ?'),
      activeTrips: this.db.prepare(
        `SELECT tb.trip_id, t.route_id, t.service_id, t.direction_id, t.headsign, tb.last_stop
         FROM trip_bounds tb JOIN trips t ON t.trip_id = tb.trip_id WHERE tb.start <= ? AND tb.end >= ?`),
      lastAt: this.db.prepare('SELECT seq, stop_id, arr, dep FROM stop_times WHERE trip_id = ? AND arr <= ? ORDER BY seq DESC LIMIT 1'),
      nextAfter: this.db.prepare('SELECT seq, stop_id, arr, dep FROM stop_times WHERE trip_id = ? AND seq > ? ORDER BY seq LIMIT 1'),
      cdates: this.db.prepare('SELECT service_id, type FROM calendar_dates WHERE date = ?'),
      tripStops: this.db.prepare('SELECT seq, stop_id, arr, dep FROM stop_times WHERE trip_id = ? ORDER BY seq'),
      shape: this.db.prepare('SELECT lat, lon FROM shapes WHERE shape_id = ? ORDER BY seq'),
      repTrip: this.db.prepare(
        `SELECT t.trip_id, t.shape_id, t.headsign, tb.last_stop FROM trips t JOIN trip_bounds tb ON tb.trip_id = t.trip_id
         WHERE t.route_id = ? AND t.direction_id = ? ORDER BY tb.last_seq DESC LIMIT 1`),
      directions: this.db.prepare('SELECT DISTINCT direction_id FROM trips WHERE route_id = ? ORDER BY direction_id'),
    };
  }

  close() {
    this.db.close();
  }

  private loadRoutes() {
    const rows = this.db.prepare('SELECT * FROM routes').all() as {
      route_id: string; short: string; long: string; type: number; color: string | null; text_color: string | null;
    }[];
    for (const r of rows) {
      const mode = modeFromRouteType(r.type);
      const line = r.short || r.long;
      this.routes.set(r.route_id, {
        id: r.route_id,
        line,
        name: r.long,
        mode,
        color: normColor(r.color ?? undefined) ?? defaultColor(mode, line),
        textColor: normColor(r.text_color ?? undefined) ?? '#ffffff',
      });
    }
  }

  private loadStops() {
    const rows = this.db.prepare('SELECT * FROM stops').all() as {
      stop_id: string; name: string; lat: number; lon: number; parent: string | null; location_type: number; platform: string | null;
    }[];
    const byId = new Map(rows.map((r) => [r.stop_id, r]));
    for (const r of rows) {
      if (r.location_type === 1 || (r.location_type === 0 && !(r.parent && byId.has(r.parent)))) {
        this.stations.set(r.stop_id, {
          id: r.stop_id, name: r.name, lat: r.lat, lon: r.lon, modes: [], lines: [], childIds: [], search: normalize(r.name),
        });
      }
    }
    for (const r of rows) {
      if (r.location_type !== 0) continue;
      const stationId = r.parent && this.stations.has(r.parent) ? r.parent : r.stop_id;
      this.stations.get(stationId)!.childIds.push(r.stop_id);
      this.stops.set(r.stop_id, { name: r.name, lat: r.lat, lon: r.lon, platform: r.platform ?? undefined, stationId });
    }
    // Lines serving each station.
    const sr = this.db.prepare('SELECT DISTINCT stop_id, route_id FROM stop_routes').all() as { stop_id: string; route_id: string }[];
    const lineSets = new Map<string, Set<string>>();
    for (const { stop_id, route_id } of sr) {
      const st = this.stops.get(stop_id);
      if (!st) continue;
      let s = lineSets.get(st.stationId);
      if (!s) lineSets.set(st.stationId, (s = new Set()));
      s.add(route_id);
    }
    for (const [id, st] of this.stations) {
      const set = lineSets.get(id);
      if (!set) {
        this.stations.delete(id); // station without service
        continue;
      }
      const lines: StationLine[] = [];
      for (const rid of set) {
        const r = this.routes.get(rid);
        if (r) lines.push({ routeId: r.id, line: r.line, mode: r.mode, color: r.color, textColor: r.textColor });
      }
      lines.sort(compareLines);
      st.lines = lines;
      st.modes = [...new Set(lines.map((l) => l.mode))].sort((a, b) => MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b));
    }
  }

  /** Service IDs running on a given YYYYMMDD date. */
  activeServices(date: string) {
    let set = this.svcCache.get(date);
    if (set) return set;
    set = new Set();
    const wd = weekday(date);
    for (const c of this.calendar) if (c.start <= date && c.end >= date && c.days[wd] === '1') set.add(c.id);
    for (const r of this.q.cdates.all(date) as { service_id: string; type: number }[]) {
      if (r.type === 1) set.add(r.service_id);
      else set.delete(r.service_id);
    }
    if (this.svcCache.size > 16) this.svcCache.clear();
    this.svcCache.set(date, set);
    return set;
  }

  tripInfo(tripId: string) {
    if (this.tripCache.has(tripId)) return this.tripCache.get(tripId)!;
    const r = this.q.trip.get(tripId) as { route_id: string; direction_id: number; headsign: string } | undefined;
    const v = r ? { routeId: r.route_id, directionId: r.direction_id, headsign: r.headsign } : null;
    if (this.tripCache.size > 50_000) this.tripCache.clear();
    this.tripCache.set(tripId, v);
    return v;
  }

  routeList() {
    return [...this.routes.values()].sort((a, b) => compareLines(
      { mode: a.mode, line: a.line } as StationLine, { mode: b.mode, line: b.line } as StationLine));
  }

  station(id: string): Station | undefined {
    const s = this.stations.get(id) ?? this.stations.get(this.stops.get(id)?.stationId ?? '');
    return s && publicStation(s);
  }

  nearby(lat: number, lon: number, radius = 800, limit = 25): Station[] {
    const dLat = radius / 111_000, dLon = radius / (111_000 * Math.cos((lat * Math.PI) / 180));
    const out: Station[] = [];
    for (const s of this.stations.values()) {
      if (Math.abs(s.lat - lat) > dLat || Math.abs(s.lon - lon) > dLon) continue;
      const d = haversine(lat, lon, s.lat, s.lon);
      if (d <= radius) out.push({ ...publicStation(s), distance: Math.round(d) });
    }
    return out.sort((a, b) => a.distance! - b.distance!).slice(0, limit);
  }

  /** Stations inside a bounding box (for drawing stop markers on the map). */
  inBox(minLon: number, minLat: number, maxLon: number, maxLat: number, limit = 1500): Station[] {
    const out: Station[] = [];
    for (const s of this.stations.values()) {
      if (s.lon >= minLon && s.lon <= maxLon && s.lat >= minLat && s.lat <= maxLat) {
        out.push(publicStation(s));
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  search(query: string, limit = 20): Station[] {
    const q = normalize(query);
    if (!q) return [];
    const scored: [number, StationRec][] = [];
    for (const s of this.stations.values()) {
      const i = s.search.indexOf(q);
      if (i < 0) continue;
      // Prefer prefix matches, then stations with rail/metro, then more lines.
      const score = (i === 0 ? 0 : i > 0 && s.search[i - 1] === ' ' ? 1 : 2) * 1000
        - (s.modes.includes('metro') || s.modes.includes('train') ? 100 : 0) - s.lines.length;
      scored.push([score, s]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, 'sv')).slice(0, limit).map(([, s]) => publicStation(s));
  }

  private realtimeFor(rt: RealtimeLookup | undefined, tripId: string, seq: number, stopId: string, scheduledAbs: number, kind: 'dep' | 'arr') {
    // Realtime only describes trips running now or soon; never project it onto other days.
    if (!rt || Math.abs(scheduledAbs - nowSec()) > 3 * 3600) return undefined;
    const tu = rt.trip(tripId);
    if (!tu) return undefined;
    if (tu.canceled) return { canceled: true as const };
    let best: TripRealtime['updates'][number] | undefined;
    let exact = false;
    for (const u of tu.updates) {
      const match = u.seq !== undefined ? u.seq === seq : u.stopId === stopId;
      if (match) { best = u; exact = true; break; }
      if (u.seq !== undefined && u.seq < seq && (!best || (best.seq ?? -1) < u.seq)) best = u;
    }
    if (!best) return undefined;
    if (exact && best.skipped) return { canceled: true as const };
    let expected: number | undefined;
    if (exact) {
      const abs = kind === 'dep' ? best.depTime ?? best.arrTime : best.arrTime ?? best.depTime;
      const delay = kind === 'dep' ? best.depDelay ?? best.arrDelay : best.arrDelay ?? best.depDelay;
      expected = abs ?? (delay !== undefined ? scheduledAbs + delay : undefined);
    } else {
      // Propagate the latest known delay upstream of this stop.
      const delay = best.depDelay ?? best.arrDelay;
      expected = delay !== undefined ? scheduledAbs + Math.max(0, delay) : undefined;
    }
    if (expected === undefined) return undefined;
    return { expected, delay: expected - scheduledAbs };
  }

  departures(
    stationId: string,
    from = nowSec(),
    minutes = 60,
    opts: { routeId?: string; directionId?: number; limit?: number; rt?: RealtimeLookup } = {},
  ): DepInternal[] {
    const st = this.stations.get(stationId) ?? this.stations.get(this.stops.get(stationId)?.stationId ?? '');
    if (!st || st.childIds.length === 0) return [];
    const ph = st.childIds.map(() => '?').join(',');
    const extra = opts.routeId ? ' AND t.route_id = ?' + (opts.directionId !== undefined ? ' AND t.direction_id = ?' : '') : '';
    const stmt = this.db.prepare(
      `SELECT st.trip_id, st.seq, st.stop_id, st.dep, t.route_id, t.service_id, t.headsign, t.direction_id, tb.last_stop
       FROM stop_times st
       JOIN trips t ON t.trip_id = st.trip_id
       JOIN trip_bounds tb ON tb.trip_id = st.trip_id
       WHERE st.stop_id IN (${ph}) AND st.dep BETWEEN ? AND ? AND st.seq < tb.last_seq${extra}`,
    );
    const lookback = 30 * 60;
    const out: DepInternal[] = [];
    const today = serviceDate(from);
    for (const day of [addDays(today, -1), today]) {
      const base = midnight(day);
      const lo = from - base - lookback, hi = from + minutes * 60 - base;
      if (hi < 0) continue;
      const services = this.activeServices(day);
      const params: (string | number)[] = [...st.childIds, lo, hi];
      if (opts.routeId) {
        params.push(opts.routeId);
        if (opts.directionId !== undefined) params.push(opts.directionId);
      }
      const rows = stmt.all(...params) as {
        trip_id: string; seq: number; stop_id: string; dep: number; route_id: string; service_id: string;
        headsign: string; direction_id: number; last_stop: string;
      }[];
      for (const r of rows) {
        if (!services.has(r.service_id)) continue;
        const route = this.routes.get(r.route_id);
        if (!route) continue;
        const scheduled = base + r.dep;
        const rt = this.realtimeFor(opts.rt, r.trip_id, r.seq, r.stop_id, scheduled, 'dep');
        const when = rt && 'expected' in rt ? rt.expected! : scheduled;
        if (when < from - 30 || scheduled > from + minutes * 60) continue;
        out.push({
          tripId: r.trip_id,
          seq: r.seq,
          routeId: r.route_id,
          line: route.line,
          mode: route.mode,
          color: route.color,
          textColor: route.textColor,
          headsign: r.headsign || this.stops.get(r.last_stop)?.name || '',
          directionId: r.direction_id,
          stopId: r.stop_id,
          platform: this.stops.get(r.stop_id)?.platform,
          scheduled,
          expected: rt && 'expected' in rt ? rt.expected : undefined,
          delay: rt && 'delay' in rt ? rt.delay : undefined,
          realtime: !!rt,
          canceled: rt && 'canceled' in rt ? true : undefined,
        });
      }
    }
    out.sort((a, b) => (a.expected ?? a.scheduled) - (b.expected ?? b.scheduled));
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /** Arrival time of `tripId` at any stop of `stationId` after stop sequence `afterSeq`. */
  arrival(tripId: string, afterSeq: number, stationId: string, serviceBase: number, rt?: RealtimeLookup) {
    const st = this.stations.get(stationId);
    if (!st) return undefined;
    const children = new Set(st.childIds);
    for (const r of this.q.tripStops.all(tripId) as { seq: number; stop_id: string; arr: number }[]) {
      if (r.seq <= afterSeq || !children.has(r.stop_id)) continue;
      const scheduled = serviceBase + r.arr;
      const x = this.realtimeFor(rt, tripId, r.seq, r.stop_id, scheduled, 'arr');
      return x && 'expected' in x ? x.expected : scheduled;
    }
    return undefined;
  }

  /** Vehicle positions interpolated from the timetable (+ realtime delay when known). */
  scheduledVehicles(now = nowSec(), rt?: RealtimeLookup): Vehicle[] {
    const out: Vehicle[] = [];
    const today = serviceDate(now);
    for (const day of [addDays(today, -1), today]) {
      const base = midnight(day);
      const services = this.activeServices(day);
      const secs = now - base;
      // Look back a few minutes so late-running trips stay visible.
      const rows = this.q.activeTrips.all(secs + 60, secs - 15 * 60) as {
        trip_id: string; route_id: string; service_id: string; direction_id: number; headsign: string; last_stop: string;
      }[];
      for (const r of rows) {
        if (!services.has(r.service_id)) continue;
        const route = this.routes.get(r.route_id);
        if (!route) continue;
        const tu = rt?.trip(r.trip_id);
        if (tu?.canceled) continue;
        const delay = tu?.updates.find((u) => u.depDelay !== undefined || u.arrDelay !== undefined);
        const d = delay ? delay.depDelay ?? delay.arrDelay ?? 0 : 0;
        const t = secs - d;
        const a = this.q.lastAt.get(r.trip_id, t) as { seq: number; stop_id: string; arr: number; dep: number } | undefined;
        if (!a) continue;
        const sa = this.stops.get(a.stop_id);
        if (!sa) continue;
        let lat = sa.lat, lon = sa.lon, brg: number | undefined;
        const b = this.q.nextAfter.get(r.trip_id, a.seq) as { seq: number; stop_id: string; arr: number } | undefined;
        if (!b && t > a.dep) continue; // trip finished
        if (b) {
          const sb = this.stops.get(b.stop_id);
          if (sb) {
            brg = bearing(sa.lat, sa.lon, sb.lat, sb.lon);
            if (t > a.dep && b.arr > a.dep) {
              const f = Math.min(1, (t - a.dep) / (b.arr - a.dep));
              lat = sa.lat + (sb.lat - sa.lat) * f;
              lon = sa.lon + (sb.lon - sa.lon) * f;
            }
          }
        }
        out.push({
          id: r.trip_id,
          lat, lon, bearing: brg,
          tripId: r.trip_id,
          routeId: r.route_id,
          line: route.line,
          mode: route.mode,
          color: route.color,
          headsign: r.headsign || this.stops.get(r.last_stop)?.name,
          directionId: r.direction_id,
          delay: delay ? d : undefined,
          ts: now,
          source: 'schedule',
        });
      }
    }
    return out;
  }

  routeDetail(routeId: string): RouteDetail | undefined {
    const cached = this.routeDetailCache.get(routeId);
    if (cached) return cached;
    const route = this.routes.get(routeId);
    if (!route) return undefined;
    const directions: RouteDirection[] = [];
    for (const { direction_id } of this.q.directions.all(routeId) as { direction_id: number }[]) {
      const rep = this.q.repTrip.get(routeId, direction_id) as { trip_id: string; shape_id: string | null; headsign: string; last_stop: string } | undefined;
      if (!rep) continue;
      const stops = (this.q.tripStops.all(rep.trip_id) as { stop_id: string }[])
        .map((r) => {
          const s = this.stops.get(r.stop_id);
          return s && { id: r.stop_id, stationId: s.stationId, name: s.name, lat: s.lat, lon: s.lon };
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
      let shape: [number, number][] = rep.shape_id
        ? (this.q.shape.all(rep.shape_id) as { lat: number; lon: number }[]).map((p) => [p.lon, p.lat])
        : [];
      if (shape.length < 2) shape = stops.map((s) => [s.lon, s.lat]);
      directions.push({ directionId: direction_id, headsign: rep.headsign || this.stops.get(rep.last_stop)?.name || '', stops, shape });
    }
    const detail = { ...route, directions };
    if (this.routeDetailCache.size > 300) this.routeDetailCache.clear();
    this.routeDetailCache.set(routeId, detail);
    return detail;
  }

  /** Chain favourite rides into a day plan. */
  plan(req: PlanRequest, rt?: RealtimeLookup): PlanResult {
    let t = localTimeToEpoch(req.start, req.date);
    const legs: PlanResult['legs'] = [];
    req.legs.forEach((leg, index) => {
      if (leg.notBefore) t = Math.max(t, localTimeToEpoch(leg.notBefore, req.date));
      const deps = this.departures(leg.stationId, t, 6 * 60, {
        routeId: leg.routeId, directionId: leg.directionId, limit: 4, rt,
      }).filter((d) => !d.canceled);
      const departure = deps[0];
      if (!departure) {
        legs.push({ index, alternatives: [], error: 'no_departure' });
        return;
      }
      let arrival: number | undefined;
      if (leg.toStationId) {
        const serviceBase = departure.scheduled - (this.q.tripStops.all(departure.tripId) as { seq: number; dep: number }[])
          .find((r) => r.seq === departure.seq)!.dep;
        arrival = this.arrival(departure.tripId, departure.seq, leg.toStationId, serviceBase, rt);
      }
      legs.push({
        index,
        departure: strip(departure),
        arrival,
        alternatives: deps.slice(1).map(strip),
        error: leg.toStationId && arrival === undefined ? 'no_arrival' : undefined,
      });
      const next = arrival ?? (departure.expected ?? departure.scheduled);
      t = next + (leg.transferMinutes ?? 3) * 60;
    });
    return { legs };
  }
}

export function strip(d: DepInternal): Departure {
  const { seq: _seq, ...rest } = d;
  return rest;
}

function publicStation(s: StationRec): Station {
  return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, modes: s.modes, lines: s.lines };
}

function compareLines(a: Pick<StationLine, 'mode' | 'line'>, b: Pick<StationLine, 'mode' | 'line'>) {
  const m = MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode);
  if (m) return m;
  const na = parseInt(a.line, 10), nb = parseInt(b.line, 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.line.localeCompare(b.line, 'sv');
}
