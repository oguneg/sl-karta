import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type {
  Connection, Departure, Mode, PlanRequest, PlanResult, RouteDetail, RouteDirection, RouteInfo, Station, StationLine, TripDetail,
  TripStopTime, Vehicle,
} from '../../../shared/types.ts';
import { defaultColor, modeFromRouteType, normColor } from '../modes.ts';
import { bearing, buildTrack, pointAt, type Track } from './track.ts';
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

interface ActiveTrip {
  trip_id: string; start: number; end: number; route_id: string; service_id: string;
  direction_id: number; headsign: string; shape_id: string | null; last_stop: string;
}

interface TripStop { seq: number; stop_id: string; arr: number; dep: number }

// Same-named stops this close form one place (Slussen's bus terminals are ~540 m from the metro).
const PLACE_RADIUS_M = 650;
// Stations whose name contains the other's as a whole word, this close, are the same interchange.
const LINKED_RADIUS_M = 400;
// Interchanges SL names differently (normalized names).
const PLACE_ALIASES = [['t centralen', 'stockholm city']];

const LINE_SORT: Record<Mode, number> = { metro: 5, train: 4, tram: 3, ship: 2, bus: 1, other: 0 };

const MODE_ORDER: Mode[] = ['metro', 'train', 'tram', 'bus', 'ship', 'other'];

const normalize = (s: string) =>
  s.toLocaleLowerCase('sv-SE').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
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
  private tripStopsCache = new Map<string, TripStop[]>();
  private trackCache = new Map<string, Track | null>();
  private activeCache = new Map<string, ActiveTrip[]>();
  private networkCache?: GeoJSON.FeatureCollection;
  private stationLinesCache = new Map<string, GeoJSON.FeatureCollection>();
  private placeCache = new Map<string, StationRec[]>();
  private vehicleCache?: { at: number; rt?: RealtimeLookup; list: Vehicle[] };
  private q: Record<string, StatementSync> = {};

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { readOnly: true });
    this.version = (this.db.prepare("SELECT value FROM meta WHERE key='version'").get() as { value: string } | undefined)?.value ?? '?';
    this.loadRoutes();
    this.loadStops();
    this.calendar = this.db.prepare('SELECT service_id AS id, days, start, end FROM calendar').all() as typeof this.calendar;
    this.q = {
      trip: this.db.prepare('SELECT route_id, direction_id, headsign FROM trips WHERE trip_id = ?'),
      tripFull: this.db.prepare('SELECT route_id, service_id, headsign, direction_id, shape_id FROM trips WHERE trip_id = ?'),
      activeTrips: this.db.prepare(
        `SELECT tb.trip_id, tb.start, tb.end, t.route_id, t.service_id, t.direction_id, t.headsign, t.shape_id, tb.last_stop
         FROM trip_bounds tb JOIN trips t ON t.trip_id = tb.trip_id WHERE tb.start <= ? AND tb.end >= ?`),
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

  private rec(id: string) {
    return this.stations.get(id) ?? this.stations.get(this.stops.get(id)?.stationId ?? '');
  }

  /**
   * A place: the station plus same-named stations within PLACE_RADIUS_M (e.g. Slussen's metro station,
   * bus terminals and boat pier). People think in places, so search, nearby and departure boards
   * work per place; map markers stay per physical station.
   */
  private place(s: StationRec): StationRec[] {
    let p = this.placeCache.get(s.id);
    if (!p) {
      const words = ` ${s.search} `;
      const alias = PLACE_ALIASES.find((pair) => pair.includes(s.search));
      p = [];
      for (const o of this.stations.values()) {
        if (o === s) {
          p.push(o);
          continue;
        }
        if (Math.abs(o.lat - s.lat) > 0.007 || Math.abs(o.lon - s.lon) > 0.013) continue; // ~700 m
        const d = haversine(s.lat, s.lon, o.lat, o.lon);
        const other = ` ${o.search} `;
        if (
          (o.search === s.search && d <= PLACE_RADIUS_M) ||
          // "Odenplan" + "Stockholm Odenplan", "Kista" + "Kista centrum": one name contains the other.
          ((words.includes(other) || other.includes(words)) && d <= LINKED_RADIUS_M) ||
          (alias?.includes(o.search) && d <= PLACE_RADIUS_M)
        ) p.push(o);
      }
      this.placeCache.set(s.id, p);
    }
    return p;
  }

  /** Public view of a place, keeping the given station's id, name and position. */
  private placeStation(s: StationRec): Station {
    const group = this.place(s);
    if (group.length === 1) return publicStation(s);
    const lines = new Map<string, StationLine>();
    for (const g of group) for (const l of g.lines) lines.set(l.routeId, l);
    const merged = [...lines.values()].sort(compareLines);
    return {
      ...publicStation(s),
      lines: merged,
      modes: [...new Set(merged.map((l) => l.mode))].sort((a, b) => MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b)),
    };
  }

  /** Platform/stop ids of a whole place. */
  private placeStops(s: StationRec) {
    return this.place(s).flatMap((g) => g.childIds);
  }

  station(id: string): Station | undefined {
    const s = this.rec(id);
    return s && this.placeStation(s);
  }

  nearby(lat: number, lon: number, radius = 800, limit = 25): Station[] {
    const dLat = radius / 111_000, dLon = radius / (111_000 * Math.cos((lat * Math.PI) / 180));
    const out: Station[] = [];
    for (const s of this.stations.values()) {
      if (Math.abs(s.lat - lat) > dLat || Math.abs(s.lon - lon) > dLon) continue;
      const d = haversine(lat, lon, s.lat, s.lon);
      if (d <= radius) out.push({ ...publicStation(s), distance: Math.round(d) });
    }
    out.sort((a, b) => a.distance! - b.distance!);
    return this.dedupePlaces(out).slice(0, limit);
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
    scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, 'sv'));
    return this.dedupePlaces(scored.map(([, s]) => publicStation(s))).slice(0, limit);
  }

  /** Keep the first station of each place (input is already ranked) and give it the place's lines. */
  private dedupePlaces(list: Station[]): Station[] {
    const seen = new Set<string>();
    const out: Station[] = [];
    for (const st of list) {
      if (seen.has(st.id)) continue;
      const rec = this.stations.get(st.id)!;
      for (const g of this.place(rec)) seen.add(g.id);
      out.push({ ...this.placeStation(rec), distance: st.distance });
    }
    return out;
  }

  /** Lines matching a search: by number ("14", "176x") or name ("tvärbanan", "röda"). */
  searchLines(query: string, limit = 8): RouteInfo[] {
    const q = normalize(query);
    if (!q) return [];
    const scored: [number, RouteInfo][] = [];
    for (const r of this.routes.values()) {
      const line = normalize(r.line), name = normalize(r.name);
      let score: number;
      if (line === q) score = 0;
      else if (line.startsWith(q)) score = 1;
      else if (q.length >= 3 && name.includes(q)) score = 2;
      else continue;
      scored.push([score * 10 + MODE_ORDER.indexOf(r.mode), r]);
    }
    return scored
      .sort((a, b) => a[0] - b[0] || compareLines(a[1], b[1]))
      .slice(0, limit)
      .map(([, r]) => (r.name ? r : { ...r, name: this.endpoints(r.id) ?? '' }));
  }

  /** "A – B" from a line's two directions, for lines without a name (most buses). */
  private endpoints(routeId: string) {
    const heads = [...new Set((this.routeDetail(routeId)?.directions ?? []).map((d) => d.headsign).filter(Boolean))];
    return heads.length ? heads.join(' – ') : undefined;
  }

  /** Quick-access hubs, resolved to the best-matching station for each name. */
  popular(names: string[]): Station[] {
    return names
      .map((n) => this.search(n, 1)[0])
      .filter((s): s is Station => !!s);
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

  /**
   * Departures from a place. Optionally only some lines (`routeIds`, `directionId`) and/or only
   * trips that later stop at `toStationId`; then each departure carries its arrival time there.
   */
  departures(
    stationId: string,
    from = nowSec(),
    minutes = 60,
    opts: {
      routeIds?: string[];
      directionId?: number;
      toStationId?: string;
      limit?: number;
      rt?: RealtimeLookup;
    } = {},
  ): DepInternal[] {
    const st = this.rec(stationId);
    if (!st) return [];
    const stopIds = this.placeStops(st);
    if (stopIds.length === 0) return [];
    const to = opts.toStationId ? this.rec(opts.toStationId) : undefined;
    if (opts.toStationId && !to) return [];
    const toIds = to ? this.placeStops(to).filter((id) => !stopIds.includes(id)) : [];
    if (to && toIds.length === 0) return [];
    const routeIds = opts.routeIds?.filter(Boolean) ?? [];

    const ph = (n: number) => Array(n).fill('?').join(',');
    let sql = `SELECT st.trip_id, st.seq, st.stop_id, st.dep, t.route_id, t.service_id, t.headsign, t.direction_id, tb.last_stop`;
    // With a destination: the first later stop of the same trip at the destination
    // (SQLite returns b's columns from the row that gives MIN(b.seq)).
    if (to) sql += `, MIN(b.seq) AS to_seq, b.arr AS to_arr, b.stop_id AS to_stop`;
    sql += `
       FROM stop_times st
       JOIN trips t ON t.trip_id = st.trip_id
       JOIN trip_bounds tb ON tb.trip_id = st.trip_id`;
    if (to) sql += `
       JOIN stop_times b ON b.trip_id = st.trip_id AND b.seq > st.seq AND b.stop_id IN (${ph(toIds.length)})`;
    sql += `
       WHERE st.stop_id IN (${ph(stopIds.length)}) AND st.dep BETWEEN ? AND ? AND st.seq < tb.last_seq`;
    if (routeIds.length) sql += ` AND t.route_id IN (${ph(routeIds.length)})`;
    if (opts.directionId !== undefined) sql += ` AND t.direction_id = ?`;
    if (to) sql += ` GROUP BY st.trip_id, st.seq`;
    const stmt = this.db.prepare(sql);

    const lookback = 30 * 60;
    const out: DepInternal[] = [];
    const today = serviceDate(from);
    // Yesterday (trips past midnight) through as many days as the window covers.
    const lastDay = serviceDate(from + minutes * 60);
    const days = [addDays(today, -1), today];
    while (days[days.length - 1] < lastDay) days.push(addDays(days[days.length - 1], 1));
    for (const day of days) {
      const base = midnight(day);
      const lo = from - base - lookback, hi = from + minutes * 60 - base;
      if (hi < 0) continue;
      const services = this.activeServices(day);
      const params: (string | number)[] = [...toIds, ...stopIds, lo, hi, ...routeIds];
      if (opts.directionId !== undefined) params.push(opts.directionId);
      const rows = stmt.all(...params) as {
        trip_id: string; seq: number; stop_id: string; dep: number; route_id: string; service_id: string;
        headsign: string; direction_id: number; last_stop: string;
        to_seq?: number; to_arr?: number; to_stop?: string;
      }[];
      for (const r of rows) {
        if (!services.has(r.service_id)) continue;
        const route = this.routes.get(r.route_id);
        if (!route) continue;
        const scheduled = base + r.dep;
        const rt = this.realtimeFor(opts.rt, r.trip_id, r.seq, r.stop_id, scheduled, 'dep');
        const when = rt && 'expected' in rt ? rt.expected! : scheduled;
        if (when < from - 30 || scheduled > from + minutes * 60) continue;
        let arrival: number | undefined, arrivalDelay: number | undefined;
        if (to && r.to_arr !== undefined && r.to_seq !== undefined) {
          const sched = base + r.to_arr;
          const a = this.realtimeFor(opts.rt, r.trip_id, r.to_seq, r.to_stop!, sched, 'arr');
          arrival = a && 'expected' in a ? a.expected : sched;
          arrivalDelay = a && 'delay' in a ? a.delay : undefined;
        }
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
          arrival,
          arrivalDelay,
        });
      }
    }
    out.sort((a, b) => (a.expected ?? a.scheduled) - (b.expected ?? b.scheduled));
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /**
   * Lines going directly from one place to another (both directions are checked; only the one that
   * reaches the destination is returned), with the shortest scheduled travel time.
   */
  connections(fromId: string, toId: string): Connection[] {
    const a = this.rec(fromId), b = this.rec(toId);
    if (!a || !b) return [];
    const fromIds = this.placeStops(a);
    const toIds = this.placeStops(b).filter((id) => !fromIds.includes(id));
    if (!fromIds.length || !toIds.length) return [];
    const ph = (n: number) => Array(n).fill('?').join(',');
    const rows = this.db.prepare(
      `SELECT t.route_id, t.direction_id, MIN(y.arr - x.dep) AS minutes, COUNT(DISTINCT t.trip_id) AS trips,
              MAX(t.headsign) AS headsign, MAX(tb.last_stop) AS last_stop
       FROM stop_times x
       JOIN stop_times y ON y.trip_id = x.trip_id AND y.seq > x.seq AND y.stop_id IN (${ph(toIds.length)})
       JOIN trips t ON t.trip_id = x.trip_id
       JOIN trip_bounds tb ON tb.trip_id = x.trip_id
       WHERE x.stop_id IN (${ph(fromIds.length)})
       GROUP BY t.route_id, t.direction_id`,
    ).all(...toIds, ...fromIds) as {
      route_id: string; direction_id: number; minutes: number; trips: number; headsign: string; last_stop: string;
    }[];
    const out: Connection[] = [];
    for (const r of rows) {
      const route = this.routes.get(r.route_id);
      if (!route) continue;
      out.push({
        routeId: route.id, line: route.line, mode: route.mode, color: route.color, textColor: route.textColor,
        directionId: r.direction_id, headsign: r.headsign || this.stops.get(r.last_stop)?.name || '', minutes: Math.round(r.minutes / 60), trips: r.trips,
      });
    }
    // Fast and frequent lines first.
    return out.sort((x, y) => x.minutes - y.minutes || y.trips - x.trips || compareLines(x, y));
  }


  private tripStops(tripId: string): TripStop[] {
    let v = this.tripStopsCache.get(tripId);
    if (!v) {
      v = this.q.tripStops.all(tripId) as unknown as TripStop[];
      if (this.tripStopsCache.size > 20_000) this.tripStopsCache.clear();
      this.tripStopsCache.set(tripId, v);
    }
    return v;
  }

  /** Trips running around `secs` on service day `day`; the DB query is shared for a 5-minute window. */
  private activeTrips(day: string, secs: number): ActiveTrip[] {
    const bucket = Math.floor(secs / 300);
    const key = `${day}:${bucket}`;
    let rows = this.activeCache.get(key);
    if (!rows) {
      const from = bucket * 300;
      rows = this.q.activeTrips.all(from + 300 + 60, from - 20 * 60) as unknown as ActiveTrip[];
      if (this.activeCache.size > 8) this.activeCache.clear();
      this.activeCache.set(key, rows);
    }
    return rows;
  }

  /** Track for a trip's shape with its stops snapped on; shared by all trips with the same pattern. */
  private track(shapeId: string | null, stops: TripStop[]): Track | undefined {
    if (!shapeId) return undefined;
    const key = `${shapeId}|${stops.map((s) => s.stop_id).join(',')}`;
    let t = this.trackCache.get(key);
    if (t === undefined) {
      const coords = (this.q.shape.all(shapeId) as { lat: number; lon: number }[]).map((p) => [p.lon, p.lat] as [number, number]);
      const pts = stops.map((s) => this.stops.get(s.stop_id)).map((s) => (s ? [s.lon, s.lat] as [number, number] : undefined));
      t = pts.every(Boolean) ? buildTrack(coords, pts as [number, number][]) ?? null : null;
      if (this.trackCache.size > 5_000) this.trackCache.clear();
      this.trackCache.set(key, t);
    }
    return t ?? undefined;
  }

  /**
   * Delay (s) expected when arriving at stop index `idx`: the latest realtime update at or before
   * that stop; before the first update, that first update's delay.
   */
  private delayAt(stops: TripStop[], tu: TripRealtime, base: number, idx: number): number | undefined {
    let best: { i: number; d: number } | undefined;
    let first: { i: number; d: number } | undefined;
    for (const u of tu.updates) {
      const i = u.seq !== undefined ? stops.findIndex((s) => s.seq === u.seq) : stops.findIndex((s) => s.stop_id === u.stopId);
      if (i < 0) continue;
      const d = u.arrDelay ?? u.depDelay
        ?? (u.arrTime ? u.arrTime - (base + stops[i].arr) : u.depTime ? u.depTime - (base + stops[i].dep) : undefined);
      if (d === undefined) continue;
      if (i <= idx && (!best || i > best.i)) best = { i, d };
      if (!first || i < first.i) first = { i, d };
    }
    return (best ?? first)?.d;
  }

  /**
   * Where a trip is at `secs` (seconds since the service day's midnight): index of the last stop
   * reached (-1 before the first) and the delay used, which is the prediction for the next stop.
   */
  private progress(stops: TripStop[], tu: TripRealtime | undefined, base: number, secs: number) {
    const locate = (t: number) => {
      let i = -1;
      for (let k = 0; k < stops.length && stops[k].arr <= t; k++) i = k;
      return i;
    };
    let delay = tu ? this.delayAt(stops, tu, base, 0) : undefined;
    let i = locate(secs - (delay ?? 0));
    if (tu && i + 1 < stops.length) {
      const d2 = this.delayAt(stops, tu, base, i + 1);
      if (d2 !== undefined && d2 !== delay) {
        delay = d2;
        i = locate(secs - delay);
      }
    }
    return { i, delay };
  }

  /** One trip's stops with scheduled/expected times and progress, plus its track for the map. */
  tripDetail(tripId: string, now = nowSec(), rt?: RealtimeLookup): TripDetail | undefined {
    const info = this.q.tripFull.get(tripId) as
      | { route_id: string; service_id: string; headsign: string; direction_id: number; shape_id: string | null }
      | undefined;
    const route = info && this.routes.get(info.route_id);
    const stops = this.tripStops(tripId);
    if (!info || !route || stops.length < 2) return undefined;

    // The service day this trip instance runs on: the active one whose run is closest to now.
    const today = serviceDate(now);
    let base: number | undefined;
    let bestGap = Infinity;
    for (const day of [addDays(today, -1), today, addDays(today, 1)]) {
      if (!this.activeServices(day).has(info.service_id)) continue;
      const b = midnight(day);
      const start = b + stops[0].dep, end = b + stops[stops.length - 1].arr;
      const gap = now < start ? start - now : now > end ? now - end : 0;
      if (gap < bestGap) [bestGap, base] = [gap, b];
    }
    if (base === undefined) return undefined;

    const tu = rt?.trip(tripId);
    const { i, delay } = this.progress(stops, tu, base, now - base);
    const out: TripStopTime[] = stops.map((s, k) => {
      const st = this.stops.get(s.stop_id);
      const scheduled = base! + (k === 0 ? s.dep : s.arr);
      const x = this.realtimeFor(rt, tripId, s.seq, s.stop_id, scheduled, k === 0 ? 'dep' : 'arr');
      return {
        stopId: s.stop_id,
        stationId: st?.stationId ?? s.stop_id,
        name: st?.name ?? '',
        lat: st?.lat ?? 0,
        lon: st?.lon ?? 0,
        platform: st?.platform,
        scheduled,
        expected: x && 'expected' in x ? x.expected : undefined,
        canceled: x && 'canceled' in x ? true : undefined,
        passed: k <= i && !(k === i && now - base! - (delay ?? 0) < s.dep),
      };
    });
    const track = this.track(info.shape_id, stops);
    return {
      tripId,
      routeId: route.id,
      line: route.line,
      mode: route.mode,
      color: route.color,
      textColor: route.textColor,
      headsign: info.headsign || out[out.length - 1].name,
      directionId: info.direction_id,
      delay,
      canceled: tu?.canceled || undefined,
      nextIndex: Math.max(0, out.findIndex((x) => !x.passed)),
      stops: out,
      shape: track ? track.coords : out.map((s) => [s.lon, s.lat] as [number, number]),
      // Where the vehicle is now (at its first stop if it hasn't left yet).
      position: this.positionOn(stops, track ?? undefined, i, now - base - (delay ?? 0)),
    };
  }

  /**
   * Position at schedule time `t` (seconds since service midnight, delay already removed), given the
   * index `i` of the last stop reached: on the track shape when available, else a straight line.
   */
  private positionOn(stops: TripStop[], track: Track | undefined, i: number, t: number) {
    const last = stops.length - 1;
    const ia = Math.max(0, Math.min(i, last)), ib = Math.min(ia + 1, last);
    const a = stops[ia], b = stops[ib];
    const f = t <= a.dep || b.arr <= a.dep ? 0 : Math.min(1, (t - a.dep) / (b.arr - a.dep));
    if (track) {
      const p = pointAt(track, track.stopDist[ia] + f * (track.stopDist[ib] - track.stopDist[ia]));
      return { lat: p.lat, lon: p.lon, bearing: p.bearing };
    }
    const sa = this.stops.get(a.stop_id), sb = this.stops.get(b.stop_id);
    if (!sa || !sb) return undefined;
    return {
      lat: sa.lat + (sb.lat - sa.lat) * f,
      lon: sa.lon + (sb.lon - sa.lon) * f,
      bearing: ia === ib ? undefined : bearing(sa.lat, sa.lon, sb.lat, sb.lon),
    };
  }

  /** Vehicle positions from the timetable, shifted by realtime delays, placed on the real track shape. */
  scheduledVehicles(now = nowSec(), rt?: RealtimeLookup): Vehicle[] {
    // Positions only change meaningfully per second; share the result between concurrent clients.
    if (this.vehicleCache && this.vehicleCache.at === now && this.vehicleCache.rt === rt) return this.vehicleCache.list;
    const out: Vehicle[] = [];
    const today = serviceDate(now);
    for (const day of [addDays(today, -1), today]) {
      const base = midnight(day);
      const services = this.activeServices(day);
      const secs = now - base;
      // Look back so late-running trips stay visible.
      const rows = this.activeTrips(day, secs).filter((r) => r.start <= secs + 60 && r.end >= secs - 20 * 60);
      for (const r of rows) {
        if (!services.has(r.service_id)) continue;
        const route = this.routes.get(r.route_id);
        if (!route) continue;
        const tu = rt?.trip(r.trip_id);
        if (tu?.canceled) continue;
        const stops = this.tripStops(r.trip_id);
        if (stops.length < 2) continue;

        let { i, delay } = this.progress(stops, tu, base, secs);
        const t = secs - (delay ?? 0);
        if (i < 0) {
          if (stops[0].dep - t > 60) continue; // not started yet
          i = 0;
        }
        const last = stops.length - 1;
        if (i === last && t > stops[last].arr + 30) continue; // finished

        const pos = this.positionOn(stops, this.track(r.shape_id, stops), i, t);
        if (!pos) continue;
        out.push({
          id: r.trip_id,
          lat: pos.lat, lon: pos.lon, bearing: pos.bearing,
          tripId: r.trip_id,
          routeId: r.route_id,
          line: route.line,
          mode: route.mode,
          color: route.color,
          headsign: r.headsign || this.stops.get(r.last_stop)?.name,
          directionId: r.direction_id,
          delay,
          ts: now,
          source: 'schedule',
        });
      }
    }
    this.vehicleCache = { at: now, rt, list: out };
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

  /**
   * Faint background network: one simplified track per rail line and direction, as GeoJSON.
   * Computed once per timetable import.
   */
  /**
   * Every line serving a place, as simplified map lines (one per direction unless both run on the
   * same track), for drawing a stop's lines on the map. Cached per place.
   */
  stationLines(stationId: string): GeoJSON.FeatureCollection | undefined {
    const st = this.rec(stationId);
    if (!st) return undefined;
    const place = this.placeStation(st);
    const cached = this.stationLinesCache.get(st.id);
    if (cached) return cached;
    const features: GeoJSON.Feature[] = [];
    for (const l of place.lines) {
      const detail = this.routeDetail(l.routeId);
      const seen: number[] = [];
      for (const d of detail?.directions ?? []) {
        if (d.shape.length < 2) continue;
        // ~10 m: plenty for an overview of many lines, and keeps big hubs light to download.
        const line = simplify(d.shape, 0.0001);
        if (seen.some((n) => Math.abs(n - line.length) <= Math.max(2, line.length * 0.05))) continue;
        seen.push(line.length);
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: line.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) },
          // sort: rail above buses when many lines overlap (also marks station-mode lines for styling).
          properties: { routeId: l.routeId, line: l.line, mode: l.mode, color: l.color, sort: LINE_SORT[l.mode] },
        });
      }
    }
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
    if (this.stationLinesCache.size > 200) this.stationLinesCache.clear();
    this.stationLinesCache.set(st.id, fc);
    return fc;
  }

  network(): GeoJSON.FeatureCollection {
    if (this.networkCache) return this.networkCache;
    const features: GeoJSON.Feature[] = [];
    for (const r of this.routes.values()) {
      if (r.mode !== 'metro' && r.mode !== 'train' && r.mode !== 'tram') continue;
      const detail = this.routeDetail(r.id);
      const seen: number[] = [];
      for (const d of detail?.directions ?? []) {
        if (d.shape.length < 2) continue;
        const line = simplify(d.shape, 0.00003);
        // The opposite direction usually runs on (almost) the same track; skip near-duplicates.
        if (seen.some((n) => Math.abs(n - line.length) <= Math.max(2, line.length * 0.05))) continue;
        seen.push(line.length);
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: line.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) },
          properties: { routeId: r.id, line: r.line, mode: r.mode, color: r.color },
        });
      }
    }
    this.networkCache = { type: 'FeatureCollection', features };
    return this.networkCache;
  }

  /** Chain favourite rides into a day plan. */
  plan(req: PlanRequest, rt?: RealtimeLookup): PlanResult {
    let t = localTimeToEpoch(req.start, req.date);
    const legs: PlanResult['legs'] = [];
    req.legs.forEach((leg, index) => {
      if (leg.notBefore) t = Math.max(t, localTimeToEpoch(leg.notBefore, req.date));
      const routeIds = leg.routeIds ?? (leg.routeId ? [leg.routeId] : undefined);
      const deps = this.departures(leg.stationId, t, 6 * 60, {
        routeIds, directionId: leg.toStationId ? undefined : leg.directionId, toStationId: leg.toStationId, limit: 4, rt,
      }).filter((d) => !d.canceled);
      const departure = deps[0];
      if (!departure) {
        legs.push({ index, alternatives: [], error: 'no_departure' });
        return;
      }
      const arrival = departure.arrival;
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

/** Ramer-Douglas-Peucker line simplification (tolerance in degrees). */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d > maxD) [maxD, idx] = [d, i];
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
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
