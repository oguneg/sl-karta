/**
 * Geometry for placing vehicles on a route's real track (GTFS shape) instead of straight lines
 * between stops. Distances are metres in a local equirectangular projection, which is accurate
 * enough at city scale.
 */

export interface Track {
  /** Shape vertices, [lon, lat]. */
  coords: [number, number][];
  /** Cumulative distance (m) at each vertex. */
  cum: number[];
  /** Distance (m) along the shape of each stop in the trip, same order as the trip's stops. */
  stopDist: number[];
}

const M_PER_DEG_LAT = 111_320;

function projector(lat0: number) {
  const kx = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  return (p: [number, number]) => [p[0] * kx, p[1] * M_PER_DEG_LAT] as const;
}

/**
 * Build a track and snap stops onto it. Stops are matched in order, each one searching forward from
 * the previous match, so loops and lines that pass the same place twice snap to the right pass.
 * Returns undefined when the shape doesn't fit the stops (then callers fall back to straight lines).
 */
export function buildTrack(coords: [number, number][], stops: [number, number][]): Track | undefined {
  if (coords.length < 2 || stops.length < 2) return undefined;
  const proj = projector(coords[0][1]);
  const pts = coords.map(proj);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }

  const stopDist: number[] = [];
  let seg = 0;
  let prevDist = 0;
  let misfits = 0;
  for (const s of stops) {
    const [sx, sy] = proj(s);
    let best = { d2: Infinity, seg, dist: prevDist };
    for (let i = seg; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / len2)) : 0;
      const px = ax + t * dx, py = ay + t * dy;
      const d2 = (sx - px) ** 2 + (sy - py) ** 2;
      const dist = cum[i] + t * Math.sqrt(len2);
      if (d2 < best.d2) best = { d2, seg: i, dist };
      // Found a close match and the shape has clearly moved on: stop searching so a later
      // pass through the same area can't steal this stop.
      else if (best.d2 < 60 ** 2 && dist - best.dist > 1500) break;
    }
    if (best.d2 > 250 ** 2) misfits++;
    const dist = Math.max(prevDist, best.dist);
    stopDist.push(dist);
    seg = best.seg;
    prevDist = dist;
  }
  // Shape belongs to a different pattern; don't trust it.
  if (misfits > Math.max(1, stops.length * 0.2)) return undefined;
  return { coords, cum, stopDist };
}

/** Point and bearing at `dist` metres along the track. */
export function pointAt(track: Track, dist: number): { lon: number; lat: number; bearing: number } {
  const { coords, cum } = track;
  const d = Math.max(0, Math.min(cum[cum.length - 1], dist));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  // Skip zero-length segments so the bearing is meaningful.
  let a = lo, b = hi;
  while (b < coords.length - 1 && cum[b] === cum[a]) b++;
  const segLen = cum[b] - cum[a];
  const f = segLen > 0 ? (d - cum[a]) / segLen : 0;
  const [lon1, lat1] = coords[a], [lon2, lat2] = coords[b];
  return {
    lon: lon1 + (lon2 - lon1) * f,
    lat: lat1 + (lat2 - lat1) * f,
    bearing: bearing(lat1, lon1, lat2, lon2),
  };
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}
