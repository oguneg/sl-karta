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

/** A favourite ride: board `line` at `stationId` going in `directionId`. */
export interface FavoriteRide {
  id: string;
  stationId: string;
  stationName: string;
  routeId: string;
  line: string;
  mode: Mode;
  color: string;
  textColor: string;
  directionId: number;
  headsign: string;
  toStationId?: string;
  toStationName?: string;
}

export interface PlanLegRequest {
  stationId: string;
  routeId: string;
  directionId: number;
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
