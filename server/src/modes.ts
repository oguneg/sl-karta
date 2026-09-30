import type { Mode } from '../../shared/types.ts';

/** Map GTFS route_type (basic + extended HVT codes) to a display mode. */
export function modeFromRouteType(t: number): Mode {
  if (t === 1 || (t >= 400 && t < 500)) return 'metro';
  if (t === 2 || (t >= 100 && t < 200)) return 'train';
  if (t === 0 || t === 5 || (t >= 900 && t < 1000)) return 'tram';
  if (t === 3 || t === 11 || (t >= 700 && t < 900) || (t >= 200 && t < 300)) return 'bus';
  if (t === 4 || (t >= 1000 && t < 1300)) return 'ship';
  return 'other';
}

const SL_BLUE = '#0089ca';
const SL_RED = '#d71d24';
const SL_GREEN = '#179a3e';

/** Fallback colours following SL's line colour scheme when the feed has none. */
export function defaultColor(mode: Mode, line: string): string {
  const n = parseInt(line, 10);
  switch (mode) {
    case 'metro':
      if (n === 10 || n === 11) return SL_BLUE;
      if (n === 13 || n === 14) return SL_RED;
      return SL_GREEN;
    case 'train':
      if (n >= 25 && n <= 26) return '#00a1a9'; // Saltsjöbanan
      if (n >= 27 && n <= 29) return '#8d5ca6'; // Roslagsbanan
      if (n >= 40 && n <= 48) return '#ec619f'; // Pendeltåg
      return '#ec619f';
    case 'tram':
      if (n === 7) return '#878a83'; // Spårväg City
      if (n === 12) return '#778da7'; // Nockebybanan
      if (n === 21) return '#b76020'; // Lidingöbanan
      if (n === 30 || n === 31) return '#e08a32'; // Tvärbanan
      return '#e08a32';
    case 'bus':
      return n >= 1 && n <= 6 ? SL_BLUE : SL_RED;
    case 'ship':
      return '#00a0b0';
    default:
      return '#6b7280';
  }
}

export function normColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const v = c.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toLowerCase()}` : undefined;
}
