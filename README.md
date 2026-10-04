# SL Karta

Live map of Stockholm public transport (buses, pendeltåg, tunnelbana, trams, boats): see vehicles move,
follow lines, check what departs from stops near you, save favourite rides and plan your day along them.

Web first; wrapped for Android/iOS with Capacitor later.

```
sl-karta/
├── shared/types.ts     API types shared by server and web
├── server/             Node API: GTFS timetable (SQLite) + GTFS-RT realtime, quota-aware polling
│   └── src/demo/       Built-in demo network (used until you add a Trafiklab key)
└── web/                Vite + React + MapLibre app (Capacitor-ready)
```

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on :8787, and Vite proxies `/api` to it.

With no API keys the server uses a **demo network**: a slice of the real SL network with approximate station
positions, generated timetables and simulated delays. The UI shows a "Demo mode" banner.

## Real SL data: getting a Trafiklab key (free)

SL publishes its data through [Trafiklab](https://www.trafiklab.se).

1. Create an account at https://developer.trafiklab.se and log in.
2. Create a **project**.
3. In the project, add API keys for:
   - **GTFS Regional Static data**: timetables, stops, lines, shapes
   - **GTFS Regional Realtime**: vehicle positions, delays, cancellations
4. Copy `server/.env.example` to `server/.env` and paste the keys:
   ```
   TRAFIKLAB_STATIC_KEY=...
   TRAFIKLAB_REALTIME_KEY=...
   ```
5. Restart `npm run dev`. The first start downloads the SL feed and imports it into `server/data/sl.sqlite`.
   This takes a few minutes; the app shows "Loading timetable…" meanwhile. After that it refreshes daily.

### Quotas: important for a public app

| Key level | Realtime calls / month | Poll interval this server uses |
|-----------|------------------------|--------------------------------|
| Bronze (default) | 30 000 | ~3 min (so vehicles are *estimated* from timetable + delays) |
| Silver (on request) | 2 000 000 | ~3 s (true live GPS positions) |

The server derives its poll interval from `RT_MONTHLY_BUDGET`, so it never exceeds the quota. It also stops
polling when no app is open. All users share one upstream poll; **never ship the key inside the app.**
For launch, request Silver (or Gold) on your Trafiklab project page.

Static data (Bronze: 50 downloads/month) is fetched at most once per `STATIC_MAX_AGE_HOURS` (24 h).

> SL's keyless *SL Transport API* (`transport.integration.sl.se`) has been returning `429 Quota exceeded`
> for everyone since late September 2026, so this app doesn't depend on it.

## How it works

- **Timetable**: GTFS Regional `sl.zip` is streamed into SQLite (`node:sqlite`, no native build). It supports
  stations (parent stops), departures for any date/time, line shapes and "which lines serve this stop".
- **Realtime**: `VehiclePositions.pb` + `TripUpdates.pb` (protobuf) are decoded and cached in memory.
  Departures get expected times, delays and cancellations. When GPS isn't refreshed often enough (Bronze),
  vehicle positions are interpolated from the timetable, shifted by the reported delay.
- **Client**: polls `/api/vehicles` for the visible map area every 5 s and animates between positions.
  Favourites and the day plan are stored on the device.

### API

| Endpoint | |
|---|---|
| `GET /api/meta` | data source, loading status, realtime mode |
| `GET /api/vehicles?bbox=minLon,minLat,maxLon,maxLat` | vehicles in view |
| `GET /api/stations/nearby?lat&lon&radius` | nearest stations with their lines |
| `GET /api/stations/search?q=` | station search |
| `GET /api/stations/box?bbox=` | stations for map markers |
| `GET /api/stations/:id/departures?minutes&route&direction&from` | departures (realtime-adjusted) |
| `GET /api/routes`, `GET /api/routes/:id` | lines; line detail with stops + shape per direction |
| `POST /api/plan` | chain favourite rides into a day plan |

## Mobile apps (Capacitor)

The web app is already set up for it: relative asset paths, the MapLibre worker bundled explicitly (it
also works on the `capacitor://` scheme), safe-area insets and a configurable API base URL.

```bash
cd web
# set VITE_API_BASE=https://your-api.example.com in web/.env first
npx cap add android      # needs Android Studio
npx cap add ios          # needs macOS + Xcode
npm run cap:android      # build, sync, open in Android Studio
```

Set your own `appId` in `web/capacitor.config.ts` before the first store upload; it cannot change later.

### Ads / in-app purchases

All monetisation goes through `web/src/platform/monetization.ts` (no-op on web today):

- `ads.enabled(placement)` controls reserved `<AdSlot>`s (below the map, and inline in lists).
- `purchases.isPremium()` / `purchasePremium()` / `restore()` and `LIMITS` for free vs premium features.

Plug in e.g. `@capacitor-community/admob` and RevenueCat there once the model is decided.

## Deploying (VPS with Docker)

One container serves both the website and the API. [Caddy](https://caddyserver.com) sits in front and gets
HTTPS certificates automatically. Needs ~2 GB RAM for the timetable import and ~2 GB disk.

**1. DNS.** At your domain registrar, add an **A record** for the (sub)domain, e.g. `sl`, pointing to the
VPS's IPv4 address. Wait until `ping sl.ogun.se` answers from that IP.

**2. Keys.** Create a *second* pair of Trafiklab keys for the server, so your PC and production don't share
quotas (static data allows only 50 downloads/month per key).

**3. On the VPS** (ports 80 and 443 must be open):

```bash
git clone https://github.com/oguneg/sl-karta.git
cd sl-karta
cp .env.example .env                 # set DOMAIN=sl.ogun.se
cp server/.env.example server/.env   # paste the server's Trafiklab keys
docker compose up -d --build
docker compose logs -f app           # first start: downloads + imports SL data (~1-2 min)
```

Then open `https://sl.ogun.se`.

**Update** after pushing new code:

```bash
cd sl-karta && git pull && docker compose up -d --build
```

The SL database lives in the `sl-data` Docker volume and survives rebuilds; it refreshes itself daily.

For the mobile apps, build the web app with `VITE_API_BASE=https://sl.ogun.se`.
