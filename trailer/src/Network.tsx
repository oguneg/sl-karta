import { useEffect, useMemo, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

type Fc = { features: { geometry: { coordinates: [number, number][] }; properties: { color: string; mode: string } }[] };

/** The real SL rail network (the app's /api/network), loaded once per render. */
export function useNetwork() {
  const [data, setData] = useState<Fc>();
  const [handle] = useState(() => delayRender('network'));
  useEffect(() => {
    fetch(staticFile('network.json'))
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        continueRender(handle);
      });
  }, [handle]);
  return data;
}

export const W = 1920, H = 1080;
const CENTER: [number, number] = [18.0596, 59.3313]; // T-Centralen: the network grows from here
const VIEW = [17.62, 59.12, 18.5, 59.56]; // lon/lat box framed by the 1920 × 1080 canvas
const K = Math.cos((59.33 * Math.PI) / 180);
const SCALE = Math.min(W / ((VIEW[2] - VIEW[0]) * K), H / (VIEW[3] - VIEW[1]));
const OX = (W - (VIEW[2] - VIEW[0]) * K * SCALE) / 2, OY = (H - (VIEW[3] - VIEW[1]) * SCALE) / 2;
const px = ([x, y]: [number, number]) => [OX + (x - VIEW[0]) * K * SCALE, OY + (VIEW[3] - y) * SCALE] as const;
export const CENTER_PX = px(CENTER);

type Branch = { d: string; color: string; width: number; seed: number; reach: number };

/**
 * Each line split at its point nearest the centre into two branches that run outward, so growth and
 * impulses travel from the heart of the city to the edges like a nervous system.
 */
function branches(fc: Fc): Branch[] {
  const out: Branch[] = [];
  fc.features.forEach((f, fi) => {
    const c = f.geometry.coordinates;
    let k = 0, best = Infinity;
    c.forEach(([x, y], i) => {
      const d = ((x - CENTER[0]) * K) ** 2 + (y - CENTER[1]) ** 2;
      if (d < best) [best, k] = [d, i];
    });
    const near = Math.sqrt(best); // how far from the centre this line starts (deg)
    for (const half of [c.slice(0, k + 1).reverse(), c.slice(k)]) {
      if (half.length < 2) continue;
      out.push({
        d: half.map((p, i) => { const [X, Y] = px(p); return `${i ? 'L' : 'M'}${X.toFixed(1)},${Y.toFixed(1)}`; }).join(''),
        color: f.properties.color,
        width: f.properties.mode === 'tram' ? 3.4 : 4.6,
        seed: ((fi * 7919 + out.length * 104729) % 1000) / 1000,
        reach: Math.min(1, near / 0.08), // lines that start further out begin growing a little later
      });
    }
  });
  return out;
}

/**
 * The network. `grow` 0..1 draws branches outward from the centre; `pulse` turns on travelling
 * impulses (frame drives them); `dim` fades the lines for use behind content.
 */
export function NervousNetwork({ data, frame, grow = 1, pulse = true, dim = 1, glow = 1 }: {
  data?: Fc; frame: number; grow?: number; pulse?: boolean; dim?: number; glow?: number;
}) {
  const list = useMemo(() => (data ? branches(data) : []), [data]);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      <defs>
        <filter id="impulse-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g opacity={dim}>
        {list.map((b, i) => {
          const local = Math.max(0, Math.min(1, (grow - b.reach * 0.25) / 0.75));
          return (
            <path key={i} d={b.d} fill="none" stroke={b.color} strokeWidth={b.width} strokeLinecap="round" strokeLinejoin="round"
              pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - local} />
          );
        })}
      </g>
      {pulse && (
        <g filter="url(#impulse-glow)" opacity={glow}>
          {list.map((b, i) => {
            const local = Math.max(0, Math.min(1, (grow - b.reach * 0.25) / 0.75));
            // Two impulses per branch, travelling outward at slightly different speeds.
            return [0, 0.5].map((shift) => {
              const speed = 0.006 + b.seed * 0.004;
              const pos = ((frame * speed + b.seed + shift) % 1.15) - 0.08;
              if (pos > local || pos < -0.05) return null;
              return (
                <path key={`${i}-${shift}`} d={b.d} fill="none" stroke={b.color} strokeWidth={b.width * 2.2} strokeLinecap="round"
                  pathLength={1} strokeDasharray="0.025 2" strokeDashoffset={-pos} />
              );
            });
          })}
        </g>
      )}
    </svg>
  );
}
