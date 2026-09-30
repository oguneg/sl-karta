import { GeolocateControl, Map as MlMap, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type { Mode, Station, Vehicle } from '../../../shared/types';
import { api } from '../api/client';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { useResolvedTheme } from '../theme';

// Explicit worker URL: works with Vite dev, production builds and Capacitor (capacitor:// scheme).
setWorkerUrl(workerUrl);

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const FONT = ['Noto Sans Bold'];
const VIEW_KEY = 'slk.view';
const POLL_MS = 5000;
const ANIM_MS = 1500;
const STATION_MIN_ZOOM = 13;

type BBox = [number, number, number, number];

const emptyFc = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

function savedView(): { center: [number, number]; zoom: number } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '');
    if (Array.isArray(v.center) && typeof v.zoom === 'number') return v;
  } catch {
    // no saved view
  }
  return { center: [18.0686, 59.3293], zoom: 12.5 };
}

function paddedBounds(map: MlMap, pad = 0.25): BBox {
  const b = map.getBounds();
  const dx = (b.getEast() - b.getWest()) * pad, dy = (b.getNorth() - b.getSouth()) * pad;
  return [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy];
}

/** Draw a vehicle marker: a disc with a pointer showing heading (or a plain disc). */
function vehicleImage(color: string, pointer: boolean) {
  const ratio = 2, size = 40;
  const c = document.createElement('canvas');
  c.width = c.height = size * ratio;
  const ctx = c.getContext('2d')!;
  ctx.scale(ratio, ratio);
  const cx = size / 2, cy = size / 2, r = 11;
  ctx.beginPath();
  if (pointer) {
    // Circle with a tip pointing up (north); rotated by the map to the bearing.
    const a = Math.asin(6 / r);
    ctx.moveTo(cx, cy - r - 7);
    ctx.arc(cx, cy, r, -Math.PI / 2 + a, -Math.PI / 2 - a + Math.PI * 2);
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  return { width: c.width, height: c.height, data: new Uint8Array(ctx.getImageData(0, 0, c.width, c.height).data.buffer) };
}

function addLayers(map: MlMap, dark: boolean) {
  if (map.getSource('vehicles')) return;
  map.addSource('route', { type: 'geojson', data: emptyFc() });
  map.addSource('stations', { type: 'geojson', data: emptyFc() });
  map.addSource('vehicles', { type: 'geojson', data: emptyFc() });

  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route', filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 10] },
  });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route', filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 6] },
  });
  map.addLayer({
    id: 'route-stops', type: 'circle', source: 'route', filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 5],
      'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'stations', type: 'circle', source: 'stations', minzoom: STATION_MIN_ZOOM,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3, 17, 7],
      'circle-color': dark ? '#111827' : '#ffffff',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 17, 2.5],
    },
  });
  map.addLayer({
    id: 'station-labels', type: 'symbol', source: 'stations', minzoom: 14.5,
    layout: {
      'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 12, 'text-offset': [0, 1.1],
      'text-anchor': 'top', 'text-optional': true,
    },
    paint: { 'text-color': dark ? '#e5e7eb' : '#1f2937', 'text-halo-color': dark ? '#111827' : '#fff', 'text-halo-width': 1.5 },
  });
  map.addLayer({
    id: 'vehicles', type: 'symbol', source: 'vehicles',
    layout: {
      'icon-image': ['concat', ['case', ['has', 'bearing'], 'vp-', 'vc-'], ['get', 'color']],
      'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 13, 0.85, 16, 1],
      'text-field': ['get', 'line'],
      'text-font': FONT,
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 8, 13, 10.5, 16, 12],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'symbol-sort-key': ['get', 'sort'],
    },
    paint: {
      'text-color': '#fff',
      'icon-opacity': ['case', ['get', 'dim'], 0.25, 1],
      'text-opacity': ['case', ['get', 'dim'], 0.25, 1],
    },
  });
}

const MODE_SORT: Record<Mode, number> = { bus: 1, ship: 2, tram: 3, train: 4, metro: 5, other: 0 };

export function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap>(undefined);
  const vehiclesRef = useRef(new Map<string, Vehicle>());
  const animRef = useRef(new Map<string, { from: [number, number]; to: [number, number]; cur: [number, number] }>());
  const animStart = useRef(0);
  const rafRef = useRef(0);
  const theme = useResolvedTheme();
  const modes = useSettings((s) => s.modes);
  const highlight = useUi((s) => s.highlightRoute);
  const flyTo = useUi((s) => s.flyTo);
  const renderRef = useRef<() => void>(() => {});
  const loadRouteRef = useRef<(id?: string) => Promise<void>>(undefined);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const stateRef = useRef({ modes, highlight });
  stateRef.current = { modes, highlight };

  // Create the map once.
  useEffect(() => {
    const view = savedView();
    const map = new MlMap({
      container: el.current!,
      style: STYLES[theme],
      center: view.center,
      zoom: view.zoom,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'bottom-right');

    map.on('styleimagemissing', (e: { id: string }) => {
      const m = /^(vp|vc)-(#[0-9a-f]{6})$/i.exec(e.id);
      if (m && !map.hasImage(e.id)) map.addImage(e.id, vehicleImage(m[2], m[1] === 'vp'), { pixelRatio: 2 });
    });
    map.on('style.load', () => {
      addLayers(map, themeRef.current === 'dark');
      renderRef.current();
      void loadStations();
      void loadRoute(stateRef.current.highlight);
    });

    // --- Vehicles --------------------------------------------------------------------
    const render = () => {
      const src = map.getSource('vehicles') as GeoJSONSource | undefined;
      if (!src) return;
      const { modes, highlight } = stateRef.current;
      const features: GeoJSON.Feature[] = [];
      for (const [id, v] of vehiclesRef.current) {
        if (!modes.includes(v.mode)) continue;
        const pos = animRef.current.get(id)?.cur ?? [v.lon, v.lat];
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pos },
          properties: {
            id, line: v.line ?? '', color: v.color, mode: v.mode,
            ...(v.bearing !== undefined ? { bearing: v.bearing } : {}),
            dim: !!highlight && v.routeId !== highlight,
            sort: (highlight && v.routeId === highlight ? 10 : 0) + MODE_SORT[v.mode],
          },
        });
      }
      src.setData({ type: 'FeatureCollection', features });
    };
    renderRef.current = render;

    const animate = () => {
      const f = Math.min(1, (performance.now() - animStart.current) / ANIM_MS);
      const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      for (const a of animRef.current.values()) {
        a.cur = [a.from[0] + (a.to[0] - a.from[0]) * e, a.from[1] + (a.to[1] - a.from[1]) * e];
      }
      render();
      if (f < 1) rafRef.current = requestAnimationFrame(animate);
    };

    let vehTimer: ReturnType<typeof setTimeout>;
    let vehCtrl: AbortController | undefined;
    const loadVehicles = async () => {
      clearTimeout(vehTimer);
      vehCtrl?.abort();
      vehCtrl = new AbortController();
      try {
        const { vehicles } = await api.vehicles(paddedBounds(map), vehCtrl.signal);
        const next = new Map(vehicles.map((v) => [v.id, v]));
        const anim = new Map<string, { from: [number, number]; to: [number, number]; cur: [number, number] }>();
        const zoomedOut = map.getZoom() < 10;
        for (const v of vehicles) {
          const prev = animRef.current.get(v.id)?.cur ?? (vehiclesRef.current.get(v.id) && [vehiclesRef.current.get(v.id)!.lon, vehiclesRef.current.get(v.id)!.lat]);
          const to: [number, number] = [v.lon, v.lat];
          const from: [number, number] = prev && !zoomedOut ? prev : to;
          anim.set(v.id, { from, to, cur: from });
        }
        vehiclesRef.current = next;
        animRef.current = anim;
        // Keep the open vehicle sheet in sync.
        const sheet = useUi.getState().sheet;
        if (sheet?.kind === 'vehicle' && next.has(sheet.vehicle.id)) useUi.getState().open({ kind: 'vehicle', vehicle: next.get(sheet.vehicle.id)! });
        cancelAnimationFrame(rafRef.current);
        animStart.current = performance.now();
        rafRef.current = requestAnimationFrame(animate);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
      if (document.visibilityState === 'visible') vehTimer = setTimeout(loadVehicles, POLL_MS);
    };

    // --- Stations ----------------------------------------------------------------------
    let stCtrl: AbortController | undefined;
    const loadStations = async () => {
      const src = map.getSource('stations') as GeoJSONSource | undefined;
      if (!src) return;
      if (map.getZoom() < STATION_MIN_ZOOM) return;
      stCtrl?.abort();
      stCtrl = new AbortController();
      try {
        const stations: Station[] = await api.stationsInBox(paddedBounds(map, 0.1), stCtrl.signal);
        src.setData({
          type: 'FeatureCollection',
          features: stations.map((s) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: { id: s.id, name: s.name, color: s.lines[0]?.color ?? '#6b7280' },
          })),
        });
      } catch {
        // ignore; retried on next move
      }
    };

    // --- Highlighted route ---------------------------------------------------------------
    let routeCtrl: AbortController | undefined;
    const loadRoute = async (routeId?: string) => {
      const src = map.getSource('route') as GeoJSONSource | undefined;
      if (!src) return;
      routeCtrl?.abort();
      if (!routeId) {
        src.setData(emptyFc());
        return;
      }
      routeCtrl = new AbortController();
      try {
        const r = await api.route(routeId, routeCtrl.signal);
        const features: GeoJSON.Feature[] = [];
        const seen = new Set<string>();
        for (const d of r.directions) {
          features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: d.shape }, properties: { color: r.color } });
          for (const s of d.stops) {
            if (seen.has(s.stationId)) continue;
            seen.add(s.stationId);
            features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { color: r.color, id: s.stationId } });
          }
        }
        src.setData({ type: 'FeatureCollection', features });
      } catch {
        // ignore
      }
    };
    loadRouteRef.current = loadRoute;

    let moveTimer: ReturnType<typeof setTimeout>;
    map.on('moveend', () => {
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify({ center: map.getCenter().toArray(), zoom: map.getZoom() }));
      } catch {
        // ignore
      }
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        void loadStations();
        void loadVehicles();
      }, 250);
    });

    const onVehicleClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      const v = id && vehiclesRef.current.get(id);
      if (v) useUi.getState().open({ kind: 'vehicle', vehicle: v });
    };
    const onStationClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) useUi.getState().open({ kind: 'station', id });
    };
    map.on('click', 'vehicles', onVehicleClick);
    map.on('click', 'stations', onStationClick);
    map.on('click', 'route-stops', onStationClick);
    for (const layer of ['vehicles', 'stations', 'route-stops']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }

    const onVis = () => {
      if (document.visibilityState === 'visible') void loadVehicles();
      else clearTimeout(vehTimer);
    };
    document.addEventListener('visibilitychange', onVis);
    map.once('load', () => void loadVehicles());

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(vehTimer);
      clearTimeout(moveTimer);
      cancelAnimationFrame(rafRef.current);
      vehCtrl?.abort();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Theme switch: swap base style; layers are re-added on style.load.
  const firstTheme = useRef(theme);
  useEffect(() => {
    if (theme === firstTheme.current) return;
    firstTheme.current = theme;
    mapRef.current?.setStyle(STYLES[theme]);
  }, [theme]);

  useEffect(() => {
    renderRef.current();
  }, [modes, highlight]);

  useEffect(() => {
    void loadRouteRef.current?.(highlight);
  }, [highlight]);

  useEffect(() => {
    if (flyTo) mapRef.current?.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: flyTo.zoom ?? Math.max(14, mapRef.current.getZoom()) });
  }, [flyTo]);

  return <div ref={el} className="map" />;
}
