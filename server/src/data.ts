import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.ts';
import { demoSource } from './demo/demoFeed.ts';
import { importGtfs, zipSource } from './gtfs/importer.ts';
import { GtfsStore } from './gtfs/store.ts';

/** Owns the current GtfsStore and keeps it fresh. */
export class DataManager {
  store?: GtfsStore;
  status: 'loading' | 'ready' | 'error' = 'loading';
  message?: string;

  async start() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    try {
      if (config.demo) await this.loadDemo();
      else {
        await this.loadStatic();
        setInterval(() => void this.loadStatic().catch((e) => console.error('[gtfs] refresh failed', e)), 6 * 3600_000).unref();
      }
    } catch (err) {
      this.status = 'error';
      this.message = String(err);
      console.error('[gtfs] load failed', err);
    }
  }

  private swap(dbPath: string) {
    const next = new GtfsStore(dbPath);
    const old = this.store;
    this.store = next;
    this.status = 'ready';
    this.message = undefined;
    old?.close();
    console.log(`[gtfs] ready: ${next.stations.size} stations, ${next.routes.size} routes (version ${next.version})`);
  }

  private async loadDemo() {
    const dbPath = path.join(config.dataDir, 'demo.sqlite');
    console.log('[gtfs] building demo network…');
    await importGtfs(demoSource(), dbPath, 'demo');
    this.swap(dbPath);
  }

  private async loadStatic() {
    const zipPath = path.join(config.dataDir, `${config.operator}.zip`);
    const dbPath = path.join(config.dataDir, `${config.operator}.sqlite`);
    const maxAge = config.staticMaxAgeHours * 3600_000;
    const age = (p: string) => (fs.existsSync(p) ? Date.now() - fs.statSync(p).mtimeMs : Infinity);

    if (age(dbPath) < maxAge) {
      if (!this.store) this.swap(dbPath);
      return;
    }
    if (age(zipPath) >= maxAge) {
      this.message = 'Downloading timetable…';
      console.log('[gtfs] downloading static feed…');
      const url = `https://opendata.samtrafiken.se/gtfs/${config.operator}/${config.operator}.zip?key=${encodeURIComponent(config.staticKey)}`;
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`Static GTFS download failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      const tmp = `${zipPath}.part`;
      await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
      fs.renameSync(tmp, zipPath);
    }
    this.message = 'Importing timetable…';
    console.log('[gtfs] importing static feed (takes a few minutes the first time)…');
    const t0 = Date.now();
    await importGtfs(zipSource(zipPath), dbPath, new Date(fs.statSync(zipPath).mtimeMs).toISOString().slice(0, 10), (m) => console.log('[gtfs]', m));
    console.log(`[gtfs] import done in ${Math.round((Date.now() - t0) / 1000)}s`);
    this.swap(dbPath);
  }
}
