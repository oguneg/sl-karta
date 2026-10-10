# SL Karta

Live map of Stockholm public transport (buses, trains, metro, trams, boats): vehicles moving, lines, departures from nearby stops, favourites, day planning. Live at https://sl.ogun.se. Owner: Ogün Gündogdu. `README.md` has the full story (data sources, quotas, deployment); this file is the short version for working in the repo.

## Layout

- `server/`: Node API (TypeScript, run with `tsx`). GTFS timetable in SQLite plus GTFS-RT realtime, quota-aware polling. `server/src/demo/` is the built-in demo network used until Trafiklab keys exist.
- `web/`: Vite + React + MapLibre app, Capacitor-ready. `shared/types.ts`: API types used by both sides. Change a type there first.
- `trailer/`: tooling that records and renders the promo video (`capture.mjs`, `vo.mjs`, `music.mjs`). Not part of the app.
- `deploy/update.sh`, `Dockerfile`, `docker-compose.yml`: production.

## Commands

```bash
npm install
npm run dev          # API on :8787, web on :5173 (Vite proxies /api). No keys needed: demo network with a "Demo mode" banner
npm run typecheck    # server and web. There is no test suite yet: typecheck and build are the checks
npm run build        # builds the web app
```

## Rules

- **Never commit `.env` or `server/.env`.** Trafiklab keys live there (`TRAFIKLAB_STATIC_KEY`, `TRAFIKLAB_REALTIME_KEY`). Never ship a key inside the app: all users share one upstream poll.
- **Respect the quota.** The poll interval is derived from `RT_MONTHLY_BUDGET` and polling stops when no one is looking (`RT_IDLE_SECONDS`). Do not add code that polls faster or per user. Static data is limited to 50 downloads a month on Bronze.
- The server can be given a fake clock for the trailer recordings (`CLOCK_AT`). It is ignored unless the server is started with it, so the live site never honours it.
- Keep `shared/types.ts`, the server and the web app in agreement; typecheck must pass for both workspaces.

## Deploy

**Pushing to `main` deploys https://sl.ogun.se.** GitHub Actions typechecks and builds, then SSHes to the VPS with a key restricted to `deploy/update.sh`, which rebuilds the container and waits for it to be healthy. A docs-only push still redeploys, so push only when asked. The VPS is shared with other apps behind one Caddy proxy; this app joins its `web` network and declares its domain with Docker labels. The SL database lives in the `sl-data` volume and refreshes itself daily.
