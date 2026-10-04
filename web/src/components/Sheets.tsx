import { useEffect, useMemo, useState } from 'react';
import type { Departure, Mode, Station, TripStopTime } from '../../../shared/types';
import { api } from '../api/client';
import { useNow, usePolling } from '../hooks';
import { clock, countdown, fallbackNotice } from '../format';
import { useLocale, useT } from '../i18n';
import { showStation, useUi } from '../store/ui';
import { LineBadge, ModeIcon } from './Badges';
import { DepartureRow, StopStar } from './Departures';

export function SheetHost() {
  const sheet = useUi((s) => s.sheet);
  const close = useUi((s) => s.close);
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  if (!sheet) return null;
  return (
    <section className="sheet" role="dialog" aria-modal="false">
      <div className="sheet-grip" aria-hidden="true" />
      <button className="sheet-close" onClick={close} aria-label={t('common.close')}>✕</button>
      {sheet.kind === 'station' && <StationSheet id={sheet.id} />}
      {sheet.kind === 'vehicle' && <VehicleSheet />}
      {sheet.kind === 'route' && <RouteSheet id={sheet.id} directionId={sheet.directionId} fit={sheet.fit} />}
      {sheet.kind === 'lines' && <LinePicker routeIds={sheet.routeIds} />}
    </section>
  );
}

function groupByMode(deps: Departure[]) {
  const m = new Map<Mode, Departure[]>();
  for (const d of deps) {
    if (!m.has(d.mode)) m.set(d.mode, []);
    m.get(d.mode)!.push(d);
  }
  return [...m.entries()];
}

/** Departure board window (minutes); beyond it the server falls back to the next departures. */
const WINDOW_MIN = 90;

/** Above this many bus lines, bus chips are folded behind a toggle. */
const BUS_CHIPS = 8;

function StationSheet({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const now = useNow(10_000);
  const [station, setStation] = useState<Station>();
  const [filter, setFilter] = useState<string>();
  const [showAllLines, setShowAllLines] = useState(false);
  const setHighlight = useUi((s) => s.setHighlight);
  useEffect(() => {
    setFilter(undefined);
    setShowAllLines(false);
    const c = new AbortController();
    api.station(id, c.signal).then(setStation).catch(() => {});
    return () => c.abort();
  }, [id]);
  // Big hubs (a "place" merges metro, bus terminals and piers) can have dozens of bus lines.
  const busCount = station?.lines.filter((l) => l.mode === 'bus').length ?? 0;
  // A line filter is applied server-side so "next available" also works for a single line.
  const { data: deps, error } = usePolling(
    (s) => api.departures(id, { minutes: WINDOW_MIN, limit: 120, routes: filter ? [filter] : undefined, fallback: true }, s),
    20_000,
    [id, filter],
  );
  const shown = deps ?? [];
  const groups = groupByMode(shown);
  const later = fallbackNotice(deps, WINDOW_MIN, t, locale, now);

  return (
    <div className="sheet-body">
      <header className="sheet-head">
        <div className="title-row">
          <h2>{station?.name ?? '…'}</h2>
          {station && <StopStar station={station} />}
        </div>
        <div className="chips">
          {station?.lines.filter((l) => showAllLines || l.mode !== 'bus' || l.routeId === filter || busCount <= BUS_CHIPS).map((l) => (
            <button
              key={l.routeId}
              className={`chip-line ${filter === l.routeId ? 'on' : ''}`}
              onClick={() => {
                const next = filter === l.routeId ? undefined : l.routeId;
                setFilter(next);
                setHighlight(next);
              }}
            >
              <LineBadge line={l.line} color={l.color} textColor={l.textColor} mode={l.mode} size="sm" />
            </button>
          ))}
          {busCount > BUS_CHIPS && (
            <button className="chip-more" onClick={() => setShowAllLines(!showAllLines)}>
              {showAllLines ? t('line.fewer') : t('line.moreBuses', { n: busCount })}
            </button>
          )}
        </div>
      </header>
      {error && !deps ? <p className="empty">{t('status.offline')}</p> : null}
      {deps && shown.length === 0 && <p className="empty">{t('dep.noneAtAll')}</p>}
      {later && <p className="notice small">{later.text}</p>}
      {groups.map(([mode, list]) => (
        <div key={mode} className="dep-group">
          <h3 className="group-title"><ModeIcon mode={mode} size={16} /> {t(`mode.${mode}`)}</h3>
          <ul className="dep-list">
            {list.slice(0, filter ? 30 : 12).map((d) => (
              <DepartureRow key={d.tripId + d.stopId} dep={d} now={now} station={station ?? { id, name: '' }} />
            ))}
          </ul>
        </div>
      ))}
      {!deps && !error && <SkeletonRows />}
    </div>
  );
}

export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <ul className="dep-list" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <li key={i} className="dep skeleton"><span /><span /></li>)}
    </ul>
  );
}

function VehicleSheet() {
  const t = useT();
  const locale = useLocale();
  const now = useNow(10_000);
  const sheet = useUi((s) => s.sheet);
  const { open, setHighlight, setTrip } = useUi.getState();
  const [showPassed, setShowPassed] = useState(false);
  const v = sheet?.kind === 'vehicle' ? sheet.vehicle : undefined;
  const tripId = v?.tripId;
  const { data: trip, error } = usePolling(tripId ? (s) => api.trip(tripId, s) : null, 20_000, [tripId]);

  // Selecting a vehicle shows its line and journey on the map; clear both when the sheet closes.
  useEffect(() => {
    setHighlight(v?.routeId);
    setShowPassed(false);
    return () => {
      setTrip(undefined);
      setHighlight(undefined);
    };
  }, [tripId, v?.routeId, setHighlight, setTrip]);
  useEffect(() => setTrip(trip), [trip, setTrip]);

  if (!v) return null;
  const delay = trip?.delay ?? v.delay;
  const delayMin = delay !== undefined ? Math.round(delay / 60) : undefined;
  const passed = trip ? trip.stops.slice(0, trip.nextIndex) : [];
  const upcoming = trip ? trip.stops.slice(trip.nextIndex) : [];
  const next = upcoming[0];
  const when = (s: TripStopTime) => s.expected ?? s.scheduled;

  const stopRow = (s: TripStopTime, i: number, isNext = false) => {
    const late = s.expected !== undefined && Math.abs(s.expected - s.scheduled) >= 60;
    const mins = Math.floor((when(s) - now) / 60); // same rounding as countdown()
    return (
      <li key={s.stopId + i} className={`${s.passed ? 'passed' : ''} ${isNext ? 'next' : ''} ${s.canceled ? 'canceled' : ''}`}>
        <button onClick={() => showStation(s.stationId, s.lat, s.lon)}>
          <span className="trip-stop-name">
            {s.name}
            {s.platform && <span className="muted small"> · {t('dep.platform', { p: s.platform })}</span>}
          </span>
          <span className="trip-stop-time">
            <strong className={s.expected !== undefined ? 'rt' : ''}>{clock(when(s), locale)}</strong>
            {late && <s className="muted small">{clock(s.scheduled, locale)}</s>}
            {!s.passed && mins >= 0 && mins < 60 && !late && <span className="muted small">{mins === 0 ? t('dep.now') : `${mins} ${t('dep.min')}`}</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="sheet-body">
      <header className="sheet-head row">
        <LineBadge line={v.line ?? '?'} color={v.color} textColor={trip?.textColor} mode={v.mode} size="lg" />
        <div>
          <h2>{t('vehicle.towards', { h: trip?.headsign ?? v.headsign ?? '' })}</h2>
          <p className="muted small">
            {t(`mode.${v.mode}`)} · {v.source === 'gps' ? t('vehicle.gps') : t('vehicle.estimated')}
            {delayMin !== undefined && (delayMin === 0
              ? <> · <span className="rt">{t('trip.onTime')}</span></>
              : delayMin > 0
                ? <> · <span className="late">{t('dep.late', { n: delayMin })}</span></>
                : <> · <span className="rt">{t('dep.early', { n: -delayMin })}</span></>)}
          </p>
        </div>
      </header>

      {!tripId || (error && !trip) ? <p className="empty">{t('trip.unavailable')}</p> : null}
      {tripId && !trip && !error && <SkeletonRows n={4} />}

      {next && (
        <button className="trip-next" onClick={() => showStation(next.stationId, next.lat, next.lon)} style={{ ['--line' as string]: v.color }}>
          <span className="muted small">{t('trip.next')}</span>
          <strong className="trip-next-name">{next.name}</strong>
          <span className="trip-next-time">
            <strong className={next.expected !== undefined ? 'rt' : ''}>{countdown(when(next), t, locale, now)}</strong>
            <span className="muted small">{clock(when(next), locale)}</span>
          </span>
        </button>
      )}

      {trip && (
        <ol className="trip-stops" style={{ ['--line' as string]: trip.color }}>
          {passed.length > 0 && (
            <li className="trip-toggle">
              <button onClick={() => setShowPassed(!showPassed)}>
                {showPassed ? t('trip.hideEarlier') : t('trip.earlier', { n: passed.length })}
              </button>
            </li>
          )}
          {showPassed && passed.map((s, i) => stopRow(s, i))}
          {upcoming.map((s, i) => stopRow(s, passed.length + i, i === 0))}
        </ol>
      )}

      {v.routeId && (
        <div className="actions">
          <button className="btn" onClick={() => open({ kind: 'route', id: v.routeId!, directionId: v.directionId })}>
            {t('trip.wholeLine')}
          </button>
        </div>
      )}
    </div>
  );
}

function RouteSheet({ id, directionId, fit }: { id: string; directionId?: number; fit?: boolean }) {
  const t = useT();
  const setHighlight = useUi((s) => s.setHighlight);
  const { data: route } = usePolling((s) => api.route(id, s), 3600_000, [id]);
  // Opened from search: frame the whole line.
  useEffect(() => {
    if (!fit || !route) return;
    const pts = route.directions.flatMap((d) => d.shape);
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    useUi.getState().fit([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }, [fit, route]);
  const [dir, setDir] = useState(directionId ?? 0);
  useEffect(() => {
    setHighlight(id);
  }, [id, setHighlight]);
  useEffect(() => setDir(directionId ?? 0), [id, directionId]);
  const direction = route?.directions.find((d) => d.directionId === dir) ?? route?.directions[0];
  return (
    <div className="sheet-body">
      {route && (
        <header className="sheet-head row">
          <LineBadge line={route.line} color={route.color} textColor={route.textColor} mode={route.mode} size="lg" />
          <div>
            <h2>{direction ? t('vehicle.towards', { h: direction.headsign }) : route.name}</h2>
            <p className="muted small">{t(`mode.${route.mode}`)}{route.name && route.name !== route.line ? ` · ${route.name}` : ''}</p>
          </div>
        </header>
      )}
      {route && route.directions.length > 1 && (
        <div className="segmented" role="tablist">
          {route.directions.map((d) => (
            <button key={d.directionId} role="tab" aria-selected={d.directionId === direction?.directionId} onClick={() => setDir(d.directionId)}>
              {d.headsign}
            </button>
          ))}
        </div>
      )}
      {direction && (
        <ol className="stop-line" style={{ ['--line' as string]: route!.color }}>
          {direction.stops.map((s, i) => (
            <li key={s.id + i}>
              <button onClick={() => showStation(s.stationId, s.lat, s.lon)}>{s.name}</button>
            </li>
          ))}
        </ol>
      )}
      {!route && <SkeletonRows />}
    </div>
  );
}

function LinePicker({ routeIds }: { routeIds: string[] }) {
  const t = useT();
  const open = useUi((s) => s.open);
  const { data: routes } = usePolling((s) => api.routes(s), 3600_000, []);
  // Server returns routes sorted (metro, train, tram, bus; then by number): keep that order.
  const list = (routes ?? []).filter((r) => routeIds.includes(r.id));
  return (
    <div className="sheet-body">
      <header className="sheet-head"><h2>{t('line.pick')}</h2></header>
      {!routes && <SkeletonRows n={routeIds.length} />}
      <ul className="line-pick">
        {list.map((r) => (
          <li key={r.id}>
            <button onClick={() => open({ kind: 'route', id: r.id })}>
              <LineBadge line={r.line} color={r.color} textColor={r.textColor} mode={r.mode} />
              <span>{r.name || t(`mode.${r.mode}`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
