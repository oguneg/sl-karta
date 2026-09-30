import { useEffect, useMemo, useState } from 'react';
import type { Departure, Mode, Station } from '../../../shared/types';
import { api } from '../api/client';
import { useNow, usePolling } from '../hooks';
import { useT } from '../i18n';
import { showStation, useUi } from '../store/ui';
import { LineBadge, ModeIcon } from './Badges';
import { DepartureRow } from './Departures';

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
      {sheet.kind === 'route' && <RouteSheet id={sheet.id} directionId={sheet.directionId} />}
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

function StationSheet({ id }: { id: string }) {
  const t = useT();
  const now = useNow(10_000);
  const [station, setStation] = useState<Station>();
  const [filter, setFilter] = useState<string>();
  const setHighlight = useUi((s) => s.setHighlight);
  useEffect(() => {
    setFilter(undefined);
    const c = new AbortController();
    api.station(id, c.signal).then(setStation).catch(() => {});
    return () => c.abort();
  }, [id]);
  const { data: deps, error } = usePolling((s) => api.departures(id, { minutes: 90, limit: 60 }, s), 20_000, [id]);
  const shown = useMemo(() => (deps ?? []).filter((d) => !filter || d.routeId === filter), [deps, filter]);
  const groups = groupByMode(shown);

  return (
    <div className="sheet-body">
      <header className="sheet-head">
        <h2>{station?.name ?? '…'}</h2>
        <div className="chips">
          {station?.lines.map((l) => (
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
        </div>
      </header>
      {error && !deps ? <p className="empty">{t('status.offline')}</p> : null}
      {deps && shown.length === 0 && <p className="empty">{t('dep.none')}</p>}
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
  const sheet = useUi((s) => s.sheet);
  const { open, setHighlight } = useUi.getState();
  const highlight = useUi((s) => s.highlightRoute);
  if (sheet?.kind !== 'vehicle') return null;
  const v = sheet.vehicle;
  const delayMin = v.delay !== undefined ? Math.round(v.delay / 60) : undefined;
  return (
    <div className="sheet-body">
      <header className="sheet-head row">
        <LineBadge line={v.line ?? '?'} color={v.color} mode={v.mode} size="lg" />
        <div>
          <h2>{v.headsign ? t('vehicle.towards', { h: v.headsign }) : t(`mode.${v.mode}`)}</h2>
          <p className="muted small">
            {t(`mode.${v.mode}`)} · {v.source === 'gps' ? t('vehicle.gps') : t('vehicle.estimated')}
            {delayMin !== undefined && delayMin !== 0 && <> · <span className="late">{t('dep.late', { n: delayMin })}</span></>}
          </p>
        </div>
      </header>
      {v.routeId && (
        <div className="actions">
          <button className="btn" onClick={() => setHighlight(highlight === v.routeId ? undefined : v.routeId)}>
            {highlight === v.routeId ? t('line.hide') : t('line.show')}
          </button>
          <button className="btn primary" onClick={() => open({ kind: 'route', id: v.routeId!, directionId: v.directionId })}>
            {t('line.stops')}
          </button>
        </div>
      )}
    </div>
  );
}

function RouteSheet({ id, directionId }: { id: string; directionId?: number }) {
  const t = useT();
  const setHighlight = useUi((s) => s.setHighlight);
  const { data: route } = usePolling((s) => api.route(id, s), 3600_000, [id]);
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
