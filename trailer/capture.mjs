// Captures real screenshots of the live app for the trailer (Chrome via puppeteer-core).
// Usage: node capture.mjs [baseUrl]   (default https://sl.ogun.se)
// CLOCK_AT=2026-10-05T17:40:00+02:00 shifts the browser clock to match a server started with the same
// CLOCK_AT (see server/src/time.ts), e.g. to capture rush hour at night.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'https://sl.ogun.se';
const OUT = path.resolve('public/shots');
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
async function shiftClock(page) {
  if (!CLOCK_OFFSET_MS) return;
  await page.evaluateOnNewDocument((off) => {
    const Real = Date;
    class Shifted extends Real {
      constructor(...a) { if (a.length === 0) super(Real.now() + off); else super(...a); }
      static now() { return Real.now() + off; }
    }
    globalThis.Date = Shifted;
  }, CLOCK_OFFSET_MS);
}

async function phonePage(view, extraStorage = {}) {
  const page = await browser.newPage();
  await shiftClock(page);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
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

const rects = {};
async function shot(page, name, highlight) {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  if (highlight) {
    rects[name] = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }, highlight);
  }
  console.log('  saved', name, rects[name] ? JSON.stringify(rects[name]) : '');
}

const city = { center: [18.0655, 59.3285], zoom: 13.4 };

// 1. Live map
{
  const page = await phonePage(city);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(page, 8000);
  await shot(page, 'map', '.mode-chips');
  // 2. Tap a departure at a stop: the vehicle's journey to "your stop"
  await page.click('.search input');
  await page.waitForSelector('.popular-place');
  const places = await page.$$('.popular-place');
  for (const p of places) if ((await p.evaluate((e) => e.textContent)).includes('Slussen')) { await p.click(); break; }
  await page.waitForSelector('.sheet .dep');
  await sleep(2500);
  await shot(page, 'stop');
  const row = await page.evaluateHandle(() => {
    const rows = [...document.querySelectorAll('.sheet .dep')];
    const metro = rows.filter((r) => /metro/i.test(r.closest('.dep-group')?.querySelector('.group-title')?.textContent ?? ''));
    return metro.find((r) => /\b([4-9]|1[0-2]) min/.test(r.innerText)) ?? metro[2] ?? rows[2];
  });
  await row.click();
  await page.waitForSelector('.trip-stops li.focus', { timeout: 15000 }).catch(() => {});
  await settle(page, 6000);
  await shot(page, 'vehicle', '.trip-next');
  await page.close();
}

// 1b. Wide city view
{
  const page = await phonePage({ center: [18.055, 59.33], zoom: 11.8 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(page, 8000);
  await shot(page, 'mapwide');
  await page.close();
}

// 1c. Landscape map-only city view (app chrome hidden) for full-screen use
{
  const page = await browser.newPage();
  await shiftClock(page);
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1.5 });
  await page.evaluateOnNewDocument((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, {
    'slk.settings': JSON.stringify({ state: { lang: 'en', theme: 'light', modes: ['metro', 'train', 'tram', 'bus', 'ship'] }, version: 0 }),
    'slk.view': JSON.stringify({ center: [18.06, 59.329], zoom: 13.1 }),
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '.panel,.tabbar,.map-top,.banner,.maplibregl-control-container{display:none!important}.app{display:block!important}.stage{position:absolute!important;inset:0!important}' });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await settle(page, 9000);
  await shot(page, 'citywide');
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
  await shot(page, 'lines', '.sheet .chips');
  await page.close();
}

// 4. Favourites, 5. My day, 6. Nearby (location: Medborgarplatsen)
{
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(BASE, ['geolocation']);
  const page = await phonePage(city);
  await page.setGeolocation({ latitude: 59.3142, longitude: 18.0736 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await settle(page, 3000);
  const tab = async (i) => {
    await page.evaluate((n) => document.querySelectorAll('.tabbar button')[n].click(), i);
    await settle(page, 4000);
  };
  await tab(2);
  await shot(page, 'favorites', '.card.fav');
  await tab(3);
  await shot(page, 'plan', '.tl-body');
  await tab(1);
  await shot(page, 'nearby');
  await page.close();
}

// 7. Desktop view for the finale
{
  const page = await browser.newPage();
  await shiftClock(page);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
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
  await shot(page, 'desktop');
  await page.close();
}

fs.writeFileSync(path.resolve('src/rects.json'), JSON.stringify(rects, null, 2));
await browser.close();
console.log('done');
