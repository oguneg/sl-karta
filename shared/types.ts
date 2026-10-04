// Types shared between server and web client. Keep this file dependency-free.

export type Mode = 'metro' | 'train' | 'tram' | 'bus' | 'ship' | 'other';

export const ALL_MODES: Mode[] = ['metro', 'train', 'tram', 'bus', 'ship'];

export interface RouteInfo {
  id: string;
  line: string; // short name, e.g. "14", "41", "4"
  name: string; // long name
  mode: Mode;
  color: string; // "#rrggbb"
  textColor: string;
}

export interface Meta {
  source: 'demo' | 'gtfs';
  status: 'loading' | 'ready' | 'error';
  message?: string;
  feedVersion?: string;
  realtime: {
    vehicles: 'gps' | 'schedule';
    tripUpdates: boolean;
    lastFetch?: number; // epoch seconds
    pollSeconds?: number;
  };
  serverTime: number; // epoch seconds
}

export interface Vehicle {
  id: string;
  lat: number;
  lon: number;
  bearing?: number;
  tripId?: string;
  routeId?: string;
  line?: string;
  mode: Mode;
  color: string;
  headsign?: string;
  directionId?: number;
  delay?: number; // seconds, positive = late
  ts: number; // epoch seconds of the position
  source: 'gps' | 'schedule';
}

export interface StationLine {
  routeId: string;
  line: string;
  mode: Mode;
  color: string;
  textColor: string;
}

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  modes: Mode[];
  lines: StationLine[];
  distance?: number; // meters, set for nearby queries
}

export interface Departure {
  tripId: string;
  routeId: string;
  line: string;
  mode: Mode;
  color: string;
  textColor: string;
  headsign: string;
  directionId: number;
  stopId: string;
  platform?: string;
  scheduled: number; // epoch seconds
  expected?: number; // epoch seconds when realtime is known
  delay?: number;
  realtime: boolean;
  canceled?: boolean;
  /** With a destination: arrival there (expected when realtime is known) and its delay. */
  arrival?: number;
  arrivalDelay?: number;
}

/** A line that goes directly from one place to another. */
export interface Connection {
  routeId: string;
  line: string;
  mode: Mode;
  color: string;
  textColor: string;
  directionId: number;
  headsign: string;
  minutes: number; // shortest scheduled travel time
  trips: number; // trips in the timetable (rough frequency)
}

export interface RouteDirection {
  directionId: number;
  headsign: string;
  stops: { id: string; stationId: string; name: string; lat: number; lon: number }[];
  shape: [number, number][]; // [lon, lat]
}

export interface RouteDetail extends RouteInfo {
  directions: RouteDirection[];
}

export interface TripStopTime {
  stopId: string;
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  platform?: string;
  scheduled: number; // epoch seconds (arrival; departure for the first stop)
  expected?: number;
  canceled?: boolean;
  passed: boolean;
}

/** One vehicle's journey: every stop with times, which ones are passed, and its track. */
export interface TripDetail {
  tripId: string;
  routeId: string;
  line: string;
  mode: Mode;
  color: string;
  textColor: string;
  headsign: string;
  directionId: number;
  delay?: number;
  canceled?: boolean;
  nextIndex: number;
  stops: TripStopTime[];
  shape: [number, number][]; // [lon, lat]
}

/**
 * A favourite ride: from one place, optionally to another, optionally only some lines.
 * - from + to: every line going directly between them (or only `routeIds`)
 * - from + one line + direction: that line from that stop (starred from a departure board)
 */
export interface FavoriteRide {
  id: string;
  fromId: string;
  fromName: string;
  toId?: string;
  toName?: string;
  routeIds?: string[];
  directionId?: number;
  /** Badges to show, cached when saved. */
  lines: { routeId: string; line: string; mode: Mode; color: string; textColor: string }[];
  headsign?: string;
}

export interface PlanLegRequest {
  stationId: string;
  routeIds?: string[];
  /** @deprecated use routeIds */
  routeId?: string;
  directionId?: number;
  toStationId?: string;
  notBefore?: string; // "HH:MM" local time
  transferMinutes?: number;
}

export interface PlanRequest {
  date?: string; // YYYY-MM-DD local; default today
  start: string; // "HH:MM"
  legs: PlanLegRequest[];
}

export interface PlanLegResult {
  index: number;
  departure?: Departure;
  arrival?: number; // epoch seconds at toStation (expected if known)
  alternatives: Departure[];
  error?: 'no_departure' | 'no_arrival';
}

export interface PlanResult {
  legs: PlanLegResult[];
}
