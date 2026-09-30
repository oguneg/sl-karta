import { TZ } from './config.ts';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export const nowSec = () => Math.floor(Date.now() / 1000);

function parts(epochSec: number) {
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(new Date(epochSec * 1000))) {
    if (x.type !== 'literal') p[x.type] = Number(x.value);
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset in seconds between Stockholm local time and UTC at a given instant. */
function offsetAt(epochSec: number) {
  const p = parts(epochSec);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
  return asUtc - epochSec;
}

/** GTFS service date (YYYYMMDD) in Stockholm for an instant. */
export function serviceDate(epochSec: number) {
  const p = parts(epochSec);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

/** Epoch seconds of local midnight for a YYYYMMDD date. */
export function midnight(date: string) {
  const y = +date.slice(0, 4), m = +date.slice(4, 6), d = +date.slice(6, 8);
  const utcMid = Date.UTC(y, m - 1, d) / 1000;
  return utcMid - offsetAt(utcMid + 12 * 3600);
}

export function addDays(date: string, n: number) {
  const y = +date.slice(0, 4), m = +date.slice(4, 6), d = +date.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10).replaceAll('-', '');
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(date: string) {
  const y = +date.slice(0, 4), m = +date.slice(4, 6), d = +date.slice(6, 8);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Parse "HH:MM" (+ optional YYYY-MM-DD) into epoch seconds, Stockholm time. */
export function localTimeToEpoch(hhmm: string, isoDate?: string) {
  const date = isoDate ? isoDate.replaceAll('-', '') : serviceDate(nowSec());
  const [h, m] = hhmm.split(':').map(Number);
  return midnight(date) + h * 3600 + m * 60;
}

export function parseGtfsTime(s: string | undefined) {
  if (!s) return -1;
  const [h, m, sec] = s.trim().split(':').map(Number);
  return h * 3600 + m * 60 + (sec || 0);
}
