import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// server/.env, whatever the working directory. Real env vars (e.g. from Docker) take precedence.
dotenv.config({ path: path.resolve(here, '..', '.env'), quiet: true });

const staticKey = process.env.TRAFIKLAB_STATIC_KEY?.trim() ?? '';
const realtimeKey = process.env.TRAFIKLAB_REALTIME_KEY?.trim() ?? '';

export const config = {
  port: Number(process.env.API_PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  operator: 'sl',
  staticKey,
  realtimeKey,
  demo: process.env.DEMO === 'true' || !staticKey,
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(here, '..', 'data'),
  webDist: process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : path.resolve(here, '..', '..', 'web', 'dist'),
  staticMaxAgeHours: Number(process.env.STATIC_MAX_AGE_HOURS ?? 24),
  rtMonthlyBudget: Number(process.env.RT_MONTHLY_BUDGET ?? 30000),
  rtMinPollSeconds: Number(process.env.RT_MIN_POLL_SECONDS ?? 3),
  rtIdleSeconds: Number(process.env.RT_IDLE_SECONDS ?? 120),
};

export const TZ = 'Europe/Stockholm';
