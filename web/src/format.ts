import type { Departure } from '../../shared/types';
import type { TFn } from './i18n';

const TZ = 'Europe/Stockholm';

export const nowSec = () => Math.floor(Date.now() / 1000);

export function clock(epochSec: number, locale: string) {
  return new Date(epochSec * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export const departureTime = (d: Departure) => d.expected ?? d.scheduled;

const localDate = (epochSec: number) => new Date(epochSec * 1000).toLocaleDateString('sv-SE', { timeZone: TZ });

/** "" for today, "tomorrow", or the short weekday. */
export function dayLabel(epochSec: number, t: TFn, locale: string, now = nowSec()) {
  const day = localDate(epochSec);
  if (day === localDate(now)) return '';
  if (day === localDate(now + 86400)) return t('time.tomorrow');
  return new Date(epochSec * 1000).toLocaleDateString(locale, { weekday: 'short', timeZone: TZ });
}

/** Clock time, prefixed with "tomorrow" or the weekday when it isn't today. */
export function clockDay(epochSec: number, t: TFn, locale: string, now = nowSec()) {
  const day = dayLabel(epochSec, t, locale, now);
  return day ? `${day} ${clock(epochSec, locale)}` : clock(epochSec, locale);
}

/**
 * Notice for fallback departures (nothing soon): names the day once when they all fall on the
 * same later day, so rows can show plain times. Returns undefined when not a fallback.
 */
export function fallbackNotice(deps: { scheduled: number }[] | undefined, windowMin: number, t: TFn, locale: string, now = nowSec()) {
  if (!isFallback(deps, windowMin, now)) return undefined;
  const days = new Set(deps!.map((d) => dayLabel(d.scheduled, t, locale, now)));
  const only = days.size === 1 ? [...days][0] : '';
  return { text: only ? t('dep.noneSoonDay', { d: only }) : t('dep.noneSoon'), sameDay: !!only };
}

/** "Nu", "4 min" within the next 20 minutes, otherwise the clock time (with the day when not today). */
export function countdown(epochSec: number, t: TFn, locale: string, now = nowSec()) {
  const mins = Math.floor((epochSec - now) / 60);
  if (mins <= 0) return t('dep.now');
  if (mins < 20) return `${mins} ${t('dep.min')}`;
  return clockDay(epochSec, t, locale, now);
}

/** True when the first departure is beyond the requested window, i.e. the server fell back to later ones. */
export const isFallback = (deps: { scheduled: number }[] | undefined, windowMin: number, now = nowSec()) =>
  !!deps?.length && deps[0].scheduled > now + windowMin * 60;

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
