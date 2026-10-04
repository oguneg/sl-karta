import { useMemo } from 'react';
import { interpolate, staticFile, useCurrentFrame } from 'remotion';
import { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';

type Fc = { features: { geometry: { coordinates: [number, number][] }; properties: { color: string; mode: string } }[] };

/** The real SL rail network (from the app's /api/network), loaded once per render. */
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

/** Project lon/lat to SVG paths fitted into width × height (equirectangular, latitude-corrected). */
function project(fc: Fc, width: number, height: number, focus: number) {
  // Frame inner Stockholm: clamp the view to the central area (focus 1) or the whole region (focus 0).
  const all = fc.features.flatMap((f) => f.geometry.coordinates);
  const lons = all.map((c) => c[0]), lats = all.map((c) => c[1]);
  const region = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  const city = [17.82, 59.2, 18.3, 59.45];
  const b = region.map((v, i) => v + (city[i] - v) * focus);
  const k = Math.cos((59.33 * Math.PI) / 180);
  const w = (b[2] - b[0]) * k, h = b[3] - b[1];
  const scale = Math.min(width / w, height / h);
  const ox = (width - w * scale) / 2, oy = (height - h * scale) / 2;
  return fc.features.map((f) => ({
    color: f.properties.color,
    rail: f.properties.mode !== 'tram',
    d: f.geometry.coordinates
      .map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + (x - b[0]) * k * scale).toFixed(1)},${(oy + (b[3] - y) * scale).toFixed(1)}`)
      .join(''),
  }));
}

/**
 * Network lines. `draw` (0..1) reveals each line along its length, staggered; `opacity` dims it for
 * use as a background.
 */
export function NetworkLines({ data, draw = 1, opacity = 1, width = 1920, height = 1080, strokeWidth = 3, focus = 0.75 }: {
  data?: Fc; draw?: number; opacity?: number; width?: number; height?: number; strokeWidth?: number; focus?: number;
}) {
  const paths = useMemo(() => (data ? project(data, width, height, focus) : []), [data, width, height, focus]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', inset: 0, opacity }}>
      {paths.map((p, i) => {
        const start = (i / paths.length) * 0.45;
        const local = Math.max(0, Math.min(1, (draw - start) / 0.55));
        return (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={p.rail ? strokeWidth : strokeWidth * 0.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - local}
          />
        );
      })}
    </svg>
  );
}

/** Slow drift for background layers. */
export function useDrift(speed = 0.02) {
  const frame = useCurrentFrame();
  return interpolate(frame, [0, 900], [0, 900 * speed]);
}
