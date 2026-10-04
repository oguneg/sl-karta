import { useEffect, useMemo, useRef, useState } from 'react';
import type { Departure, Mode, Station, TripStopTime } from '../../../shared/types';
import { api } from '../api/client';
import { useNow, usePolling } from '../hooks';
import { clock, countdown, fallbackNotice } from '../format';
import { useLocale, useT } from '../i18n';
import { showStation, useUi } from '../store/ui';
import { LineBadge, ModeIcon } from './Badges';
import { DepartureRow, StopStar } from './Departures';
import { Icon } from './Icon';
import { useBottomSheet } from './useBottomSheet';

/** Identifies what the sheet shows (not its live data), so the vehicle sheet's refreshes don't reset it. */
function sheetKey(sheet: NonNullable<ReturnType<typeof useUi.getState>['sheet']>) {
  switch (sheet.kind) {
    case 'station': return `station:${sheet.id}`;
    case 'vehicle': return `vehicle:${sheet.tripId}`;
    case 'route': return `route:${sheet.id}`;
    case 'lines': return `lines:${sheet.routeIds.join(',')}`;
  }
}

export function SheetHost() {
  const sheet = useUi((s) => s.sheet);
  if (!sheet) return null;
  return <Sheet sheet={sheet} />;
}

function Sheet({ sheet }: { sheet: NonNullable<ReturnType<typeof useUi.getState>['sheet']> }) {
  const close = useUi((s) => s.close);
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const { snap, setSnap, style, dragging } = useBottomSheet(ref, sheetKey(sheet));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <section ref={ref} className={`sheet snap-${snap} ${dragging ? 'dragging' : ''}`} style={style} role="dialog" aria-modal="false">
      <button
        className="sheet-grip"
        aria-label={snap === 'peek' ? t('sheet.expand') : t('sheet.collapse')}
        onClick={() => setSnap(snap === 'peek' ? 'half' : 'peek')}
      />
      <button className="sheet-close" onClick={close} aria-label={t('common.close')}><Icon name="close" size={18} /></button>
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
  // Draw the stop's lines on the map while its sheet is open.
  const setStationLines = useUi((s) => s.setStationLines);
  useEffect(() => {
    const c = new AbortController();
    api.stationLines(id, c.signal)
      .then((data) => {
        const routeIds = [...new Set(data.features.map((f) => f.properties?.routeId as string))];
        setStationLines({ stationId: id, routeIds, data });
      })
      .catch(() => {});
    return () => {
      c.abort();
      if (useUi.getState().stationLines?.stationId === id) setStationLines(undefined);
    };
  }, [id, setStationLines]);
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

/**
 * One vehicle's journey. Opened from the map (a vehicle) or from a stop's departure list (a trip
 * plus the stop it was opened from, `focusStopId`): then the map flies to the vehicle and the list
 * runs from where it is now to that stop, which is emphasised; later stops fold away.
 */
function VehicleSheet() {
  const t = useT();
  const locale = useLocale();
  const now = useNow(10_000);
  const sheet = useUi((s) => s.sheet);
  const { open, setHighlight, setTrip } = useUi.getState();
  const vs = sheet?.kind === 'vehicle' ? sheet : undefined;
  const v = vs?.vehicle;
  const tripId = vs?.tripId;
  const focusStopId = vs?.focusStopId;
  const { data: trip, error } = usePolling(tripId ? (s) => api.trip(tripId, s) : null, 20_000, [tripId]);
  const routeId = trip?.routeId ?? v?.routeId;
  const [showPassed, setShowPassed] = useState(false);
  const [showLater, setShowLater] = useState(false);

  // Show the line and this journey on the map; clear both when the sheet closes.
  useEffect(() => {
    setHighlight(routeId);
    return () => {
      setTrip(undefined);
      setHighlight(undefined);
    };
  }, [tripId, routeId, setHighlight, setTrip]);
  useEffect(() => setTrip(trip), [trip, setTrip]);
  useEffect(() => {
    setShowPassed(false);
    setShowLater(false);
  }, [tripId]);

  // Opened from a stop: bring the vehicle into view once.
  const flownFor = useRef<string>(undefined);
  useEffect(() => {
    if (!focusStopId || !trip?.position || flownFor.current === tripId) return;
    flownFor.current = tripId;
    useUi.getState().fly(trip.position.lat, trip.position.lon, 14);
  }, [focusStopId, trip, tripId]);

  if (!vs) return null;
  const line = trip?.line ?? v?.line ?? '?';
  const color = trip?.color ?? v?.color ?? '#6b7280';
  const mode = trip?.mode ?? v?.mode ?? 'bus';
  const delay = trip?.delay ?? v?.delay;
  const delayMin = delay !== undefined ? Math.round(delay / 60) : undefined;
  const when = (s: TripStopTime) => s.expected ?? s.scheduled;

  const stops = trip?.stops ?? [];
  const nextIndex = trip?.nextIndex ?? 0;
  // The stop we came from: its occurrence at or after the vehicle's position, else any.
  let focus = -1;
  if (focusStopId) {
    focus = stops.findIndex((s, k) => k >= nextIndex && s.stopId === focusStopId);
    if (focus < 0) focus = stops.findIndex((s) => s.stopId === focusStopId);
  }
  const focusAhead = focus >= nextIndex;
  const passed = stops.slice(0, nextIndex);
  const ahead = stops.slice(nextIndex, focusAhead ? focus + 1 : undefined);
  const later = focusAhead ? stops.slice(focus + 1) : [];
  const next = stops[nextIndex];
  const target = focusAhead ? stops[focus] : undefined;
  const stopsAway = focus - nextIndex + 1;

  const stopRow = (s: TripStopTime, k: number) => {
    const late = s.expected !== undefined && Math.abs(s.expected - s.scheduled) >= 60;
    const mins = Math.floor((when(s) - now) / 60); // same rounding as countdown()
    const cls = [s.passed && 'passed', k === nextIndex && 'next', k === focus && 'focus', s.canceled && 'canceled'].filter(Boolean).join(' ');
    return (
      <li key={s.stopId + k} className={cls}>
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
  const toggle = (label: string, onClick: () => void) => (
    <li className="trip-toggle"><button onClick={onClick}>{label}</button></li>
  );

  // The card at the top: your stop when opened from one, otherwise the next stop.
  const card = target ?? next;
  return (
    <div className="sheet-body">
      <header className="sheet-head row">
        <LineBadge line={line} color={color} textColor={trip?.textColor} mode={mode} size="lg" />
        <div>
          <h2>{t('vehicle.towards', { h: trip?.headsign ?? v?.headsign ?? '' })}</h2>
          <p className="muted small">
            {t(`mode.${mode}`)} · {v?.source === 'gps' ? t('vehicle.gps') : t('vehicle.estimated')}
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
      {focusStopId && trip && focus >= 0 && !focusAhead && (
        <p className="notice small">{t('trip.left', { name: stops[focus].name })}</p>
      )}

      {card && (
        <button className="trip-next" onClick={() => showStation(card.stationId, card.lat, card.lon)} style={{ ['--line' as string]: color }}>
          <span className="trip-next-label">
            <span className="line-dot" aria-hidden="true" />
            {target ? t('trip.yourStop') : t('trip.next')}
            {target && <span>· {stopsAway <= 1 ? t('trip.isNext') : t('trip.stopsAway', { n: stopsAway })}</span>}
          </span>
          <strong className="trip-next-name">{card.name}</strong>
          <span className="trip-next-time">
            <strong className={card.expected !== undefined ? 'rt' : ''}>{countdown(when(card), t, locale, now)}</strong>
            <span className="muted small">{clock(when(card), locale)}</span>
          </span>
        </button>
      )}

      {trip && (
        <ol className="trip-stops" style={{ ['--line' as string]: trip.color }}>
          {passed.length > 0 && toggle(showPassed ? t('trip.hideEarlier') : t('trip.earlier', { n: passed.length }), () => setShowPassed(!showPassed))}
          {(showPassed || (focus >= 0 && !focusAhead)) && passed.map((s, i) => stopRow(s, i))}
          {ahead.map((s, i) => stopRow(s, nextIndex + i))}
          {later.length > 0 && (
            <>
              {showLater && later.map((s, i) => stopRow(s, focus + 1 + i))}
              {toggle(showLater ? t('trip.hideLater') : t('trip.later', { n: later.length }), () => setShowLater(!showLater))}
            </>
          )}
        </ol>
      )}

      {routeId && (
        <div className="actions">
          <button className="btn" onClick={() => open({ kind: 'route', id: routeId, directionId: trip?.directionId ?? v?.directionId })}>
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
