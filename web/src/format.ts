import type { Departure } from '../../shared/types';
import type { TFn } from './i18n';

const TZ = 'Europe/Stockholm';

export const nowSec = () => Math.floor(Date.now() / 1000);

export function clock(epochSec: number, locale: string) {
  return new Date(epochSec * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export const departureTime = (d: Departure) => d.expected ?? d.scheduled;

/** "Nu", "4 min" within the next 20 minutes, otherwise the clock time. */
export function countdown(epochSec: number, t: TFn, locale: string, now = nowSec()) {
  const mins = Math.floor((epochSec - now) / 60);
  if (mins <= 0) return t('dep.now');
  if (mins < 20) return `${mins} ${t('dep.min')}`;
  return clock(epochSec, locale);
}

export function delayLabel(d: Departure, t: TFn) {
  if (d.canceled) return t('dep.canceled');
  if (d.delay === undefined) return undefined;
  const m = Math.round(d.delay / 60);
  if (m >= 1) return t('dep.late', { n: m });
  if (m <= -1) return t('dep.early', { n: -m });
  return undefined;
}

/** Today's date in Stockholm as YYYY-MM-DD. */
export function todayIso() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

export function nowHHMM() {
  return new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function distance(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}
