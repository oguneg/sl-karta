import { useEffect, useMemo, useRef, useState } from 'react';
import type { Connection, FavoriteRide, Station } from '../../../shared/types';
import { api } from '../api/client';
import { AdSlot } from '../components/AdSlot';
import { LineBadge, ModeIcon } from '../components/Badges';
import { clock, countdown, delayLabel, departureTime, fallbackNotice } from '../format';
import { useNow, usePolling } from '../hooks';
import { useLocale, useT } from '../i18n';
import { rideFavKey, useFavorites } from '../store/favorites';
import { showStation, useUi } from '../store/ui';

/** Favourite cards look this far ahead before falling back to the next departures. */
const FAV_WINDOW_MIN = 120;

/** Lines this much slower than the fastest direct line start unticked (e.g. buses vs. pendeltåg). */
const isFast = (c: Connection, fastest: number) => c.minutes <= fastest * 1.5 + 5;

export function FavoritesScreen() {
  const t = useT();
  const items = useFavorites((s) => s.items);
  const [adding, setAdding] = useState(false);
  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('tab.favorites')}</h1>
        {!adding && <button className="btn primary" onClick={() => setAdding(true)}>+ {t('fav.new')}</button>}
      </div>
      {adding && <RideEditor onDone={() => setAdding(false)} />}
      {items.length === 0 && !adding && <p className="empty">{t('fav.empty')}</p>}
      <div className="cards">
        {items.map((f, i) => (
          <FavCard key={f.id} fav={f} first={i === 0} last={i === items.length - 1} />
        ))}
      </div>
      {items.length > 0 && <AdSlot placement="list-inline" />}
    </div>
  );
}

/** Search field that picks one stop (place). */
function StopPicker({ label, value, onPick, autoFocus }: {
  label: string; value?: Pick<Station, 'id' | 'name'>; onPick: (s?: Station) => void; autoFocus?: boolean;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Station[]>();
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus when asked (e.g. jump to "To" once "From" is picked).
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (q.trim().length < 2) return setResults(undefined);
    const c = new AbortController();
    const id = setTimeout(() => api.search(q, c.signal).then((r) => setResults(r.stations.slice(0, 6))).catch(() => {}), 150);
    return () => {
      clearTimeout(id);
      c.abort();
    };
  }, [q]);
  if (value) {
    return (
      <div className="field">
        <span>{label}</span>
        <div className="picked">
          <strong>{value.name}</strong>
          <button className="icon-btn" aria-label={t('common.remove')} onClick={() => onPick(undefined)}>✕</button>
        </div>
      </div>
    );
  }
  return (
    <div className="field stop-picker">
      <span>{label}</span>
      <input
        ref={inputRef} type="search" value={q} placeholder={t('fav.pickStop')}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results?.[0]) {
            onPick(results[0]);
            setQ('');
          }
        }}
      />
      {results && (
        <ul className="picker-results">
          {results.length === 0 && <li className="muted">{t('search.none')}</li>}
          {results.map((s) => (
            <li key={s.id}>
              <button onClick={() => { onPick(s); setQ(''); }}>
                <span>{s.name}</span>
                <span className="lines">
                  {s.lines.slice(0, 5).map((l) => (
                    <LineBadge key={l.routeId} line={l.line} color={l.color} textColor={l.textColor} mode={l.mode} size="sm" />
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pick lines among the direct connections between two places. */
function LineToggles({ conns, selected, onChange }: {
  conns: Connection[]; selected: string[]; onChange: (ids: string[]) => void;
}) {
  return (
    <div className="line-toggles">
      {conns.map((c) => {
        const on = selected.includes(c.routeId);
        return (
          <button
            key={c.routeId + c.directionId}
            className={`line-toggle ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((x) => x !== c.routeId) : [...selected, c.routeId])}
          >
            <LineBadge line={c.line} color={c.color} textColor={c.textColor} mode={c.mode} size="sm" />
            <span>{c.minutes} min</span>
          </button>
        );
      })}
    </div>
  );
}

function useConnections(fromId?: string, toId?: string) {
  const { data, error } = usePolling(
    fromId && toId ? (s) => api.connections(fromId, toId, s) : null,
    3600_000,
    [fromId, toId],
  );
  return { conns: data, error };
}

function RideEditor({ onDone }: { onDone: () => void }) {
  const t = useT();
  const add = useFavorites((s) => s.add);
  const [from, setFrom] = useState<Station>();
  const [to, setTo] = useState<Station>();
  const { conns } = useConnections(from?.id, to?.id);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (!conns?.length) return setSelected([]);
    const fastest = conns[0].minutes;
    setSelected(conns.filter((c) => isFast(c, fastest)).map((c) => c.routeId));
  }, [conns]);

  const save = () => {
    if (!from || !to || !conns) return;
    const all = selected.length === conns.length;
    const picked = conns.filter((c) => selected.includes(c.routeId));
    add({
      id: rideFavKey(from.id, to.id, all ? [] : selected),
      fromId: from.id,
      fromName: from.name,
      toId: to.id,
      toName: to.name,
      // No restriction when every direct line is wanted, so new lines are picked up automatically.
      routeIds: all ? undefined : selected,
      lines: picked.map((c) => ({ routeId: c.routeId, line: c.line, mode: c.mode, color: c.color, textColor: c.textColor })),
    });
    onDone();
  };

  return (
    <article className="card ride-editor">
      <h2>{t('fav.new')}</h2>
      <StopPicker label={t('fav.from')} value={from} onPick={setFrom} autoFocus={!from} />
      <StopPicker label={t('fav.toLabel')} value={to} onPick={setTo} autoFocus={!!from && !to} />
      {from && to && conns && conns.length === 0 && <p className="bad small">{t('fav.noDirect')}</p>}
      {from && to && conns && conns.length > 0 && (
        <div className="field">
          <span>{t('fav.lines')}</span>
          <LineToggles conns={conns} selected={selected} onChange={setSelected} />
        </div>
      )}
      <div className="actions">
        <button className="btn" onClick={onDone}>{t('fav.cancel')}</button>
        <button className="btn primary" disabled={!from || !to || !selected.length} onClick={save}>{t('fav.save')}</button>
      </div>
    </article>
  );
}

function FavCard({ fav, first, last }: { fav: FavoriteRide; first: boolean; last: boolean }) {
  const t = useT();
  const locale = useLocale();
  const now = useNow(10_000);
  const { remove, move } = useFavorites.getState();
  const [editing, setEditing] = useState(false);
  // A stop favourite: no destination and no lines, so everything departing from the stop.
  const isStop = !fav.toId && !fav.routeIds?.length;
  const { data: deps } = usePolling(
    (s) => api.departures(fav.fromId, {
      minutes: FAV_WINDOW_MIN,
      routes: fav.routeIds,
      direction: fav.toId ? undefined : fav.directionId,
      to: fav.toId,
      limit: isStop ? 6 : 5,
      fallback: true,
    }, s),
    30_000,
    [fav.id, fav.toId, fav.routeIds?.join(',')],
  );
  // Badges: the lines actually seen in departures, falling back to the cached ones.
  const lines = useMemo(() => {
    const seen = new Map(fav.lines.map((l) => [l.routeId, l]));
    for (const d of deps ?? []) if (!seen.has(d.routeId)) seen.set(d.routeId, { routeId: d.routeId, line: d.line, mode: d.mode, color: d.color, textColor: d.textColor });
    return [...seen.values()];
  }, [fav.lines, deps]);
  const modes = fav.modes ?? [...new Set((deps ?? []).map((d) => d.mode))];
  const later = fallbackNotice(deps, FAV_WINDOW_MIN, t, locale, now);

  return (
    <article className="card fav">
      <div className="fav-head">
        <div className="fav-badges">
          {isStop
            ? <span className="stop-icon">{modes.slice(0, 3).map((m) => <ModeIcon key={m} mode={m} size={20} />)}</span>
            : lines.slice(0, 4).map((l) => (
              <LineBadge key={l.routeId} line={l.line} color={l.color} textColor={l.textColor} mode={l.mode} size={lines.length > 1 ? 'md' : 'lg'} />
            ))}
        </div>
        <button className="fav-title" onClick={() => showStation(fav.fromId)}>
          <strong>{fav.fromName}{fav.toName ? ` → ${fav.toName}` : ''}</strong>
          {isStop && <span className="muted small">{t('fav.stop')}</span>}
          {!fav.toName && fav.headsign && <span className="muted">{t('fav.to')} {fav.headsign}</span>}
          {fav.toName && !fav.routeIds && <span className="muted small">{t('fav.allLines')}</span>}
        </button>
        <button className="icon-btn" aria-expanded={editing} aria-label={t('fav.edit')} onClick={() => setEditing(!editing)}>⋯</button>
      </div>
      {later && <p className="notice small">{later.text}</p>}
      <ol className="ride-deps">
        {deps?.map((d) => {
          const dl = delayLabel(d, t);
          const when = departureTime(d);
          const soon = when - now < 20 * 60; // countdown shows minutes, so add the clock time here
          return (
            <li key={d.tripId + d.stopId} className={d.canceled ? 'canceled' : ''}>
              <LineBadge line={d.line} color={d.color} textColor={d.textColor} mode={d.mode} size="sm" />
              <strong className={`ride-when ${d.realtime ? 'rt' : ''}`}>
                {later?.sameDay ? clock(when, locale) : countdown(when, t, locale, now)}
              </strong>
              <span className="ride-detail muted small">
                {soon && clock(when, locale)}
                {d.arrival
                  ? <>{soon ? ' ' : ''}→ {clock(d.arrival, locale)} · {Math.round((d.arrival - when) / 60)} min</>
                  : <>{soon ? ' · ' : ''}{d.headsign}</>}
              </span>
              {dl && <span className={d.canceled ? 'bad small' : 'late small'}>{dl}</span>}
            </li>
          );
        })}
        {deps && deps.length === 0 && <li className="muted">{t('dep.noneAtAll')}</li>}
      </ol>
      {editing && <FavEditor fav={fav} first={first} last={last} onMove={(d) => move(fav.id, d)} onRemove={() => remove(fav.id)} />}
    </article>
  );
}

function FavEditor({ fav, first, last, onMove, onRemove }: {
  fav: FavoriteRide; first: boolean; last: boolean; onMove: (d: number) => void; onRemove: () => void;
}) {
  const t = useT();
  const update = useFavorites((s) => s.update);
  const { conns } = useConnections(fav.fromId, fav.toId);
  const selected = fav.routeIds ?? conns?.map((c) => c.routeId) ?? [];
  const setDestination = (s?: Station) =>
    update(fav.id, s ? { toId: s.id, toName: s.name, directionId: undefined } : { toId: undefined, toName: undefined });
  const setLines = (ids: string[]) => {
    if (!conns || ids.length === 0) return;
    const all = ids.length === conns.length;
    update(fav.id, {
      routeIds: all ? undefined : ids,
      lines: conns.filter((c) => ids.includes(c.routeId)).map((c) => ({ routeId: c.routeId, line: c.line, mode: c.mode, color: c.color, textColor: c.textColor })),
    });
  };
  return (
    <div className="fav-edit">
      <StopPicker label={t('fav.toLabel')} value={fav.toId ? { id: fav.toId, name: fav.toName ?? '' } : undefined} onPick={setDestination} />
      {fav.toId && conns && conns.length === 0 && <p className="bad small">{t('fav.noDirect')}</p>}
      {fav.toId && conns && conns.length > 0 && (
        <div className="field">
          <span>{t('fav.lines')}</span>
          <LineToggles conns={conns} selected={selected} onChange={setLines} />
        </div>
      )}
      <div className="actions">
        <button className="btn" disabled={first} onClick={() => onMove(-1)} aria-label="Up">↑</button>
        <button className="btn" disabled={last} onClick={() => onMove(1)} aria-label="Down">↓</button>
        {fav.lines.length === 1 && (
          <button className="btn" onClick={() => useUi.getState().open({ kind: 'route', id: fav.lines[0].routeId, directionId: fav.directionId })}>{t('line.stops')}</button>
        )}
        <button className="btn danger" onClick={onRemove}>{t('common.remove')}</button>
      </div>
    </div>
  );
}
