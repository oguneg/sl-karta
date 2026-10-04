import Fastify, { type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import type { Meta, PlanRequest, Vehicle } from '../../shared/types.ts';
import { config } from './config.ts';
import { DataManager } from './data.ts';
import { strip, type GtfsStore } from './gtfs/store.ts';
import { DemoRealtime, RealtimePoller } from './realtime/poller.ts';
import { nowSec } from './time.ts';

const data = new DataManager();
const poller = new RealtimePoller(config.demo ? '' : config.realtimeKey);
const rt = config.demo ? new DemoRealtime() : poller;

const app = Fastify({ logger: { level: 'warn' } });
await app.register(cors, { origin: true });

function requireStore(reply: FastifyReply): GtfsStore | undefined {
  if (!data.store) {
    reply.code(503).send({ error: 'loading', message: data.message ?? 'Loading timetable data' });
    return undefined;
  }
  poller.touch();
  return data.store;
}

const num = (v: unknown, fallback?: number) => {
  const n = Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? fallback : n;
};

app.get('/api/meta', async (): Promise<Meta> => ({
  source: config.demo ? 'demo' : 'gtfs',
  status: data.status,
  message: data.message,
  feedVersion: data.store?.version,
  realtime: {
    vehicles: poller.useGps ? 'gps' : 'schedule',
    tripUpdates: config.demo || poller.enabled,
    lastFetch: poller.lastFetch,
    pollSeconds: poller.enabled ? poller.pollSeconds : undefined,
  },
  serverTime: nowSec(),
}));

app.get('/api/routes', async (_req, reply) => {
  const store = requireStore(reply);
  if (!store) return;
  reply.header('Cache-Control', 'public, max-age=3600');
  return store.routeList();
});

app.get<{ Params: { id: string } }>('/api/routes/:id', async (req, reply) => {
  const store = requireStore(reply);
  if (!store) return;
  const r = store.routeDetail(req.params.id);
  if (!r) return reply.code(404).send({ error: 'not_found' });
  reply.header('Cache-Control', 'public, max-age=3600');
  return r;
});

app.get('/api/network', async (_req, reply) => {
  const store = requireStore(reply);
  if (!store) return;
  reply.header('Cache-Control', 'public, max-age=3600');
  return store.network();
});

app.get<{ Params: { id: string } }>('/api/trips/:id', async (req, reply) => {
  const store = requireStore(reply);
  if (!store) return;
  const trip = store.tripDetail(req.params.id, nowSec(), rt);
  return trip ?? reply.code(404).send({ error: 'not_found' });
});

app.get<{ Querystring: { bbox?: string; routes?: string; modes?: string } }>('/api/vehicles', async (req, reply) => {
  const store = requireStore(reply);
  if (!store) return;
  let vehicles: Vehicle[];
  if (poller.useGps) {
    vehicles = [];
    for (const v of poller.vehicles) {
      const trip = v.tripId ? store.tripInfo(v.tripId) : null;
      const routeId = trip?.routeId ?? v.routeId;
      const route = routeId ? store.routes.get(routeId) : undefined;
      if (!route) continue; // vehicle not in service
      const tu = v.tripId ? poller.trip(v.tripId) : undefined;
      const d = tu?.updates.find((u) => u.depDelay !== undefined || u.arrDelay !== undefined);
      vehicles.push({
        id: v.id, lat: v.lat, lon: v.lon, bearing: v.bearing, tripId: v.tripId, routeId,
        line: route.line, mode: route.mode, color: route.color,
        headsign: trip?.headsign || undefined, directionId: trip?.directionId ?? v.directionId,
        delay: d ? d.depDelay ?? d.arrDelay : undefined, ts: v.ts, source: 'gps',
      });
    }
  } else {
    vehicles = store.scheduledVehicles(nowSec(), rt);
  }
  const { bbox, routes, modes } = req.query;
  if (bbox) {
    const [a, b, c, d] = bbox.split(',').map(Number);
    vehicles = vehicles.filter((v) => v.lon >= a && v.lon <= c && v.lat >= b && v.lat <= d);
  }
  if (routes) {
    const set = new Set(routes.split(','));
    vehicles = vehicles.filter((v) => v.routeId && set.has(v.routeId));
  }
  if (modes) {
    const set = new Set(modes.split(','));
    vehicles = vehicles.filter((v) => set.has(v.mode));
  }
  return { time: nowSec(), vehicles };
});

app.get<{ Querystring: { lat: string; lon: string; radius?: string } }>('/api/stations/nearby', async (req, reply) => {
  const store = requireStore(reply);
  if (!store) return;
  const lat = num(req.query.lat), lon = num(req.query.lon);
  if (lat === undefined || lon === undefined) return reply.code(400).send({ error: 'lat_lon_required' });
  return store.nearby(lat, lon, Math.min(num(req.query.radius, 800)!, 3000));
});

app.get<{ Querystring: { bbox: string } }>('/api/stations/box', async (req, reply) => {
  const store = requireStore(reply);
  if (!store) return;
  const [a, b, c, d] = (req.query.bbox ?? '').split(',').map(Number);
  if ([a, b, c, d].some(Number.isNaN)) return reply.code(400).send({ error: 'bbox_required' });
  return store.inBox(a, b, c, d);
});

app.get<{ Querystring: { q: string } }>('/api/stations/search', async (req, reply) => {
  const store = requireStore(reply);
  if (!store) return;
  return store.search(req.query.q ?? '');
});

app.get<{ Params: { id: string } }>('/api/stations/:id', async (req, reply) => {
  const store = requireStore(reply);
  if (!store) return;
  const s = store.station(req.params.id);
  return s ?? reply.code(404).send({ error: 'not_found' });
});

app.get<{ Params: { id: string }; Querystring: { from?: string; minutes?: string; route?: string; direction?: string; limit?: string } }>(
  '/api/stations/:id/departures',
  async (req, reply) => {
    const store = requireStore(reply);
    if (!store) return;
    const q = req.query;
    return store
      .departures(req.params.id, num(q.from, nowSec()), Math.min(num(q.minutes, 60)!, 24 * 60), {
        routeId: q.route || undefined,
        directionId: q.route ? num(q.direction) : undefined,
        limit: Math.min(num(q.limit, 40)!, 200),
        rt,
      })
      .map(strip);
  },
);

app.post<{ Body: PlanRequest }>('/api/plan', async (req, reply) => {
  const store = requireStore(reply);
  if (!store) return;
  const body = req.body;
  if (!body || !/^\d{1,2}:\d{2}$/.test(body.start ?? '') || !Array.isArray(body.legs) || body.legs.length > 20) {
    return reply.code(400).send({ error: 'invalid_plan' });
  }
  return store.plan(body, rt);
});

// Serve the built web app (web/dist) when present, so one container serves site + API.
if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, {
    root: config.webDist,
    wildcard: false,
    cacheControl: false,
    setHeaders: (res, file) => {
      // Hashed build assets never change; HTML must always be revalidated so deploys show up.
      res.header('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ error: 'not_found' });
    return reply.type('text/html').sendFile('index.html');
  });
}

await app.listen({ port: config.port, host: config.host });
console.log(`SL Karta API on http://localhost:${config.port} (${config.demo ? 'DEMO network' : 'Trafiklab GTFS'})`);
if (!config.demo && !config.realtimeKey) console.warn('No TRAFIKLAB_REALTIME_KEY: vehicles are estimated from the timetable.');
void data.start();
