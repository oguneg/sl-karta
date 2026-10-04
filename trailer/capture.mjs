// Records real clips of the app for the trailer (Chrome via puppeteer-core), frame by frame on a
// virtual clock so motion is smooth at 30 fps however slowly headless Chrome renders.
// Usage: node capture.mjs [baseUrl]   (default https://sl.ogun.se)
// CLOCK_AT=2026-10-06T17:40:00+02:00 shifts the browser clock to match a server started with the same
// CLOCK_AT (see server/src/time.ts), e.g. to capture rush hour at night. While recording, simulated time
// runs RATE× faster (default 10) and each API call pins the server clock via the x-sim-time header.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'https://sl.ogun.se';
const OUT = path.resolve('public/clips');
const RATE = Number(process.env.RATE ?? 10);
const FPS = 30;
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p) => (await fetch(BASE + '/api' + p)).json();

// --- Real data for seeding favourites and the day plan -------------------------------------
const place = async (q) => (await api('/search?q=' + encodeURIComponent(q))).stations[0];
const [sollentuna, odenplan, slussen, danderyd, liljeholmen] = await Promise.all(
  ['sollentuna', 'odenplan', 'slussen', 'danderyds sjukhus', 'liljeholmen'].map(place),
);
const conns = await api(`/connections?from=${sollentuna.id}&to=${odenplan.id}`);
const fast = conns.filter((c) => c.minutes <= conns[0].minutes * 1.5 + 5);
const m14 = (await api('/search?q=14')).lines.find((l) => l.mode === 'metro');
const badge = (l) => ({ routeId: l.routeId ?? l.id, line: l.line, mode: l.mode, color: l.color, textColor: l.textColor });
const favorites = [
  { id: 'trailer-ride', fromId: sollentuna.id, fromName: sollentuna.name, toId: odenplan.id, toName: odenplan.name, routeIds: fast.map((c) => c.routeId), lines: fast.map(badge) },
  { id: 'trailer-14', fromId: danderyd.id, fromName: danderyd.name, toId: liljeholmen.id, toName: liljeholmen.name, routeIds: [m14.id], lines: [badge(m14)] },
  { id: `stop:${slussen.id}`, fromId: slussen.id, fromName: slussen.name, lines: [], modes: slussen.modes },
];
const plan = {
  start: '07:40',
  legs: [
    { key: 'a', favoriteId: 'trailer-ride', transferMinutes: 4 },
    { key: 'b', favoriteId: 'trailer-14', transferMinutes: 3 },
  ],
};
fs.writeFileSync(path.resolve('public/network.json'), JSON.stringify(await api('/network')));

// --- Browser ---------------------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});

const CLOCK_OFFSET_MS = process.env.CLOCK_AT ? Date.parse(process.env.CLOCK_AT) - Date.now() : 0;
/** Page clock: real time (shifted) while loading; after __vc.start() every timer, frame and Date read
 * advances only when the recorder steps it. API calls carry the simulated time to the server. */
async function virtualClock(page) {
  await page.evaluateOnNewDocument((off, rate) => {
    const RealDate = Date, rNow = RealDate.now.bind(RealDate), rPerf = performance.now.bind(performance);
    const rST = setTimeout, rCT = clearTimeout, rSI = setInterval, rCI = clearInterval;
    const rRAF = requestAnimationFrame.bind(window), rCAF = cancelAnimationFrame.bind(window), rFetch = fetch.bind(window);
    const vc = { manual: false, t: 0, perf0: 0, sim0: 0, timers: new Map(), raf: new Map(), id: 1e9, inflight: 0 };
    window.__vc = vc;
    const now = () => (vc.manual ? vc.sim0 + (vc.t - vc.perf0) * rate : rNow() + off);
    class D extends RealDate {
      constructor(...a) { if (a.length === 0) super(now()); else super(...a); }
      static now() { return now(); }
    }
    globalThis.Date = D;
    performance.now = () => (vc.manual ? vc.t : rPerf());
    const later = (fn, d, every, args) => {
      // The app polls vehicles every 5 s; poll more often while time-lapsing so motion follows the track.
      if (d === 5000) d = 2000;
      const id = ++vc.id;
      vc.timers.set(id, { at: vc.t + Math.max(0, d | 0), every: every ? Math.max(1, d | 0) : 0, fn, args });
      return id;
    };
    window.setTimeout = (fn, d = 0, ...a) => (vc.manual ? later(fn, d, false, a) : rST(fn, d, ...a));
    window.setInterval = (fn, d = 0, ...a) => (vc.manual ? later(fn, d, true, a) : rSI(fn, d, ...a));
    window.clearTimeout = (id) => (id > 1e9 ? vc.timers.delete(id) : rCT(id));
    window.clearInterval = (id) => (id > 1e9 ? vc.timers.delete(id) : rCI(id));
    window.requestAnimationFrame = (cb) => { if (!vc.manual) return rRAF(cb); const id = ++vc.id; vc.raf.set(id, cb); return id; };
    window.cancelAnimationFrame = (id) => (id > 1e9 ? vc.raf.delete(id) : rCAF(id));
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.includes('/api/')) return rFetch(input, init);
      const headers = new Headers(init.headers || {});
      headers.set('x-sim-time', String(Math.floor(now() / 1000)));
      vc.inflight++;
      return rFetch(input, { ...init, headers }).then(async (r) => { const b = await r.clone().arrayBuffer(); void b; return r; }).finally(() => vc.inflight--);
    };
    vc.start = () => { vc.perf0 = rPerf(); vc.t = vc.perf0; vc.sim0 = rNow() + off; vc.manual = true; };
    vc.step = (dt) => {
      vc.t += dt;
      for (;;) {
        let next;
        for (const e of vc.timers) if (e[1].at <= vc.t && (!next || e[1].at < next[1].at)) next = e;
        if (!next) break;
        const [id, tm] = next;
        if (tm.every) tm.at += tm.every; else vc.timers.delete(id);
        try { typeof tm.fn === 'function' && tm.fn(...tm.args); } catch (e) { console.error(e); }
      }
    };
    vc.frame = () => {
      const cbs = [...vc.raf.values()];
      vc.raf.clear();
      for (const cb of cbs) try { cb(vc.t); } catch (e) { console.error(e); }
    };
  }, CLOCK_OFFSET_MS, RATE);
}

const rects = {};
/** Records `seconds` of the page into public/clips/<name>.mp4; measures a highlight rect first. */
async function record(page, name, seconds, highlight) {
  if (highlight) {
    rects[name] = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }, highlight);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slk-' + name + '-'));
  await page.evaluate(() => window.__vc.start());
  const n = Math.ceil(seconds * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate((dt) => { window.__vc.step(dt); window.__vc.frame(); }, 1000 / FPS);
    // Poll from here: the page's own timers are frozen between steps.
    for (let w = 0; w < 3000 && (await page.evaluate(() => window.__vc.inflight)) > 0; w++) await sleep(10);
    await sleep(25); // let map workers hand back parsed vehicle data
    await page.evaluate(() => window.__vc.frame());
    await page.screenshot({ path: path.join(dir, String(i).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 92 });
  }
  const file = path.join(OUT, name + '.mp4');
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['remotion', 'ffmpeg', '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.jpg'),
    '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', file], { stdio: 'inherit', shell: process.platform === 'win32' });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`  ${name}: ${n} frames in ${Math.round((Date.now() - t0) / 1000)}s`, rects[name] ? JSON.stringify(rects[name]) : '');
}

// Clip lengths follow the trailer timeline (same rule as src/timeline.ts) plus the overlap into the next scene.
const script = JSON.parse(fs.readFileSync('src/script.json', 'utf8'));
const vo = fs.existsSync('src/vo.json') ? JSON.parse(fs.readFileSync('src/vo.json', 'utf8')) : {};
const DELAY = { intro: 24, map: 10, outro: 18 };
const len = (id) => {
  const sg = script.find((x) => x.id === id);
  const frames = Math.max(sg.min, vo[id] ? (DELAY[id] ?? 6) + Math.ceil(vo[id].seconds * FPS) + 14 : 0);
  return (frames + 12 + 6) / FPS;
};

async function phonePage(view, extraStorage = {}) {
  const page = await browser.newPage();
  await virtualClock(page);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const storage = {
    'slk.settings': JSON.stringify({ state: { lang: 'en', theme: 'light', modes: ['metro', 'train', 'tram', 'bus', 'ship'] }, version: 0 }),
    'slk.favorites': JSON.stringify({ state: { items: favorites }, version: 1 }),
    'slk.plan': JSON.stringify({ state: plan, version: 0 }),
    'slk.view': JSON.stringify(view),
    ...extraStorage,
  };
  await page.evaluateOnNewDocument((s) => {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, storage);
  return page;
}

async function settle(page, ms = 6000) {
  await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
  await sleep(ms);
}

const city = { center: [18.0655, 59.3285], zoom: 13.4 };

// 1. Live map
{
  const page = await phonePage(city);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(page, 8000);
  await record(page, 'map', len('map'), '.mode-chips');
  await page.close();
}

// 2. Tap a departure at a stop, follow the vehicle
{
  const page = await phonePage(city);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(page, 4000);
  // 2. Tap a departure at a stop: the vehicle's journey to "your stop"
  await page.click('.search input');
  await page.waitForSelector('.popular-place');
  const places = await page.$$('.popular-place');
  for (const p of places) if ((await p.evaluate((e) => e.textContent)).includes('Slussen')) { await p.click(); break; }
  await page.waitForSelector('.sheet .dep');
  await sleep(2500);
  const row = await page.evaluateHandle(() => {
    const rows = [...document.querySelectorAll('.sheet .dep')];
    const metro = rows.filter((r) => /metro/i.test(r.closest('.dep-group')?.querySelector('.group-title')?.textContent ?? ''));
    return metro.find((r) => /\b([4-9]|1[0-2]) min/.test(r.innerText)) ?? metro[2] ?? rows[2];
  });
  await row.click();
  await page.waitForSelector('.trip-stops li.focus', { timeout: 15000 }).catch(() => {});
  await settle(page, 6000);
  await record(page, 'vehicle', len('vehicle'), '.trip-next');
  await page.close();
}

// 1c. Landscape map-only city view (app chrome hidden) for full-screen use
{
  const page = await browser.newPage();
  await virtualClock(page);
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, {
    'slk.settings': JSON.stringify({ state: { lang: 'en', theme: 'light', modes: ['metro', 'train', 'tram', 'bus', 'ship'] }, version: 0 }),
    'slk.view': JSON.stringify({ center: [18.06, 59.329], zoom: 13.1 }),
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '.panel,.tabbar,.map-top,.banner,.maplibregl-control-container{display:none!important}.app{display:block!important}.stage{position:absolute!important;inset:0!important}' });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await settle(page, 9000);
  await record(page, 'citywide', 2.6);
  await page.close();
}

// 3. A stop's lines drawn across the city
{
  const page = await phonePage({ center: [18.05, 59.338], zoom: 11.6 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(page, 4000);
  await page.click('.search input');
  await page.waitForSelector('.popular-place');
  for (const p of await page.$$('.popular-place')) if ((await p.evaluate((e) => e.textContent)).includes('Odenplan')) { await p.click(); break; }
  await page.waitForSelector('.sheet .dep');
  // Peek the sheet so the lines on the map get the screen (DOM click: the sheet may still be sliding in).
  await sleep(1500);
  await page.evaluate(() => document.querySelector('.sheet-grip').click());
  await settle(page, 5000);
  await record(page, 'lines', len('lines'), '.sheet .chips');
  await page.close();
}

// 4. Favourites, 5. My day, 6. Nearby (location: Medborgarplatsen)
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ['geolocation']);
for (const [id, tabIndex, highlight] of [['favorites', 2, '.card.fav'], ['plan', 3, '.tl-body'], ['nearby', 1]]) {
  const page = await phonePage(city);
  await page.setGeolocation({ latitude: 59.3142, longitude: 18.0736 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(page, 3000);
  await page.evaluate((n) => document.querySelectorAll('.tabbar button')[n].click(), tabIndex);
  await settle(page, 4000);
  await record(page, id, len(id), highlight);
  await page.close();
}

// 7. Desktop view for the finale
{
  const page = await browser.newPage();
  await virtualClock(page);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.25 });
  await page.evaluateOnNewDocument((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, {
    'slk.settings': JSON.stringify({ state: { lang: 'en', theme: 'light', modes: ['metro', 'train', 'tram', 'bus', 'ship'] }, version: 0 }),
    'slk.view': JSON.stringify({ center: [18.06, 59.33], zoom: 12.6 }),
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(page, 5000);
  await page.click('.search input');
  await page.waitForSelector('.popular-place');
  for (const p of await page.$$('.popular-place')) if ((await p.evaluate((e) => e.textContent)).includes('Odenplan')) { await p.click(); break; }
  await page.waitForSelector('.sheet .dep');
  await settle(page, 6000);
  await record(page, 'desktop', len('desktop'));
  await page.close();
}

const prevRects = fs.existsSync('src/rects.json') ? JSON.parse(fs.readFileSync('src/rects.json', 'utf8')) : {};
fs.writeFileSync(path.resolve('src/rects.json'), JSON.stringify({ ...prevRects, ...rects }, null, 2));
await browser.close();
console.log('done');
