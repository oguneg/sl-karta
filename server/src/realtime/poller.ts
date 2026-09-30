import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { config } from '../config.ts';
import type { RealtimeLookup, TripRealtime } from '../gtfs/store.ts';
import { nowSec } from '../time.ts';

const { transit_realtime } = GtfsRealtimeBindings;

export interface RawVehicle {
  id: string;
  lat: number;
  lon: number;
  bearing?: number;
  tripId?: string;
  routeId?: string;
  directionId?: number;
  ts: number;
}

const toNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return v;
  const n = Number((v as { toString(): string }).toString());
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Polls Trafiklab GTFS-RT (VehiclePositions + TripUpdates) for SL.
 * The interval is derived from the monthly quota, and polling pauses when no client is active.
 */
export class RealtimePoller implements RealtimeLookup {
  vehicles: RawVehicle[] = [];
  private trips = new Map<string, TripRealtime>();
  lastFetch?: number;
  lastError?: string;
  readonly pollSeconds: number;
  private lastClient = 0;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private key: string) {
    const feeds = 2;
    const perMonth = config.rtMonthlyBudget / feeds;
    this.pollSeconds = Math.max(config.rtMinPollSeconds, Math.ceil((31 * 86400) / perMonth));
  }

  get enabled() {
    return !!this.key;
  }

  /** GPS positions are only worth showing if they are refreshed often. */
  get useGps() {
    return this.enabled && this.pollSeconds <= 20 && this.vehicles.length > 0;
  }

  trip(tripId: string) {
    return this.trips.get(tripId);
  }

  /** Call on each client request; (re)starts polling if it was idle. */
  touch() {
    this.lastClient = nowSec();
    if (this.enabled && !this.running) {
      this.running = true;
      void this.loop();
    }
  }

  private async loop() {
    while (nowSec() - this.lastClient < config.rtIdleSeconds) {
      const started = Date.now();
      await Promise.all([this.fetchVehicles(), this.fetchTripUpdates()]);
      this.lastFetch = nowSec();
      const wait = this.pollSeconds * 1000 - (Date.now() - started);
      await new Promise((r) => (this.timer = setTimeout(r, Math.max(1000, wait))));
    }
    this.running = false;
  }

  stop() {
    clearTimeout(this.timer);
    this.lastClient = 0;
  }

  private async fetchFeed(name: string) {
    const url = `https://opendata.samtrafiken.se/gtfs-rt/${config.operator}/${name}.pb?key=${encodeURIComponent(this.key)}`;
    const res = await fetch(url, { headers: { 'Accept-Encoding': 'gzip' } });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return transit_realtime.FeedMessage.decode(buf);
  }

  private async fetchVehicles() {
    try {
      const feed = await this.fetchFeed('VehiclePositions');
      const out: RawVehicle[] = [];
      for (const e of feed.entity) {
        const v = e.vehicle;
        if (!v?.position) continue;
        out.push({
          id: v.vehicle?.id || e.id,
          lat: v.position.latitude,
          lon: v.position.longitude,
          bearing: v.position.bearing ?? undefined,
          tripId: v.trip?.tripId || undefined,
          routeId: v.trip?.routeId || undefined,
          directionId: v.trip?.directionId ?? undefined,
          ts: toNum(v.timestamp) ?? toNum(feed.header.timestamp) ?? nowSec(),
        });
      }
      this.vehicles = out;
      this.lastError = undefined;
    } catch (err) {
      this.lastError = String(err);
      console.warn('[rt] vehicles', this.lastError);
    }
  }

  private async fetchTripUpdates() {
    try {
      const feed = await this.fetchFeed('TripUpdates');
      const map = new Map<string, TripRealtime>();
      const CANCELED = transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED;
      const SKIPPED = transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED;
      for (const e of feed.entity) {
        const tu = e.tripUpdate;
        const tripId = tu?.trip?.tripId;
        if (!tu || !tripId) continue;
        map.set(tripId, {
          canceled: tu.trip.scheduleRelationship === CANCELED || undefined,
          updates: (tu.stopTimeUpdate ?? []).map((u) => ({
            seq: u.stopSequence ?? undefined,
            stopId: u.stopId || undefined,
            arrDelay: u.arrival?.delay ?? undefined,
            depDelay: u.departure?.delay ?? undefined,
            arrTime: toNum(u.arrival?.time) || undefined,
            depTime: toNum(u.departure?.time) || undefined,
            skipped: u.scheduleRelationship === SKIPPED || undefined,
          })),
        });
      }
      this.trips = map;
    } catch (err) {
      this.lastError = String(err);
      console.warn('[rt] trip updates', this.lastError);
    }
  }
}

/** Deterministic pseudo-delays for the demo network, so the realtime UI can be exercised. */
export class DemoRealtime implements RealtimeLookup {
  trip(tripId: string): TripRealtime | undefined {
    let h = 0;
    for (let i = 0; i < tripId.length; i++) h = (h * 31 + tripId.charCodeAt(i)) | 0;
    h = Math.abs(h);
    if (h % 47 === 0) return { canceled: true, updates: [] };
    const delay = h % 4 === 0 ? 60 + (h % 5) * 60 : 0;
    return { updates: [{ seq: 1, depDelay: delay, arrDelay: delay }] };
  }
}
