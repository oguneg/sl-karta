import { useMemo, useState } from 'react';
import type { FavoriteRide } from '../../../shared/types';
import { api } from '../api/client';
import { AdSlot } from '../components/AdSlot';
import { LineBadge } from '../components/Badges';
import { countdown, delayLabel, departureTime } from '../format';
import { useNow, usePolling } from '../hooks';
import { useLocale, useT } from '../i18n';
import { useFavorites } from '../store/favorites';
import { showStation, useUi } from '../store/ui';

export function FavoritesScreen() {
  const t = useT();
  const items = useFavorites((s) => s.items);
  return (
    <div className="page">
      <h1>{t('tab.favorites')}</h1>
      {items.length === 0 && <p className="empty">{t('fav.empty')}</p>}
      <div className="cards">
        {items.map((f, i) => (
          <FavCard key={f.id} fav={f} first={i === 0} last={i === items.length - 1} />
        ))}
      </div>
      {items.length > 0 && <AdSlot placement="list-inline" />}
    </div>
  );
}

function FavCard({ fav, first, last }: { fav: FavoriteRide; first: boolean; last: boolean }) {
  const t = useT();
  const locale = useLocale();
  const now = useNow(10_000);
  const { remove, move } = useFavorites.getState();
  const [editing, setEditing] = useState(false);
  const { data: deps } = usePolling(
    (s) => api.departures(fav.stationId, { minutes: 120, route: fav.routeId, direction: fav.directionId, limit: 4 }, s),
    30_000,
    [fav.id],
  );

  return (
    <article className="card fav">
      <div className="fav-head">
        <LineBadge line={fav.line} color={fav.color} textColor={fav.textColor} mode={fav.mode} size="lg" />
        <button className="fav-title" onClick={() => showStation(fav.stationId)}>
          <strong>{fav.stationName}</strong>
          <span className="muted">{t('fav.to')} {fav.headsign}</span>
          {fav.toStationName && <span className="muted small">{t('fav.getOff')}: {fav.toStationName}</span>}
        </button>
        <button className="icon-btn" aria-expanded={editing} aria-label="⋯" onClick={() => setEditing(!editing)}>⋯</button>
      </div>
      <ol className="next-deps">
        {deps?.slice(0, 4).map((d) => {
          const dl = delayLabel(d, t);
          return (
            <li key={d.tripId} className={d.canceled ? 'canceled' : ''}>
              <strong className={d.realtime ? 'rt' : ''}>{countdown(departureTime(d), t, locale, now)}</strong>
              {dl && <span className={d.canceled ? 'bad small' : 'late small'}>{dl}</span>}
            </li>
          );
        })}
        {deps && deps.length === 0 && <li className="muted">{t('dep.none')}</li>}
      </ol>
      {editing && (
        <div className="fav-edit">
          <GetOffPicker fav={fav} />
          <div className="actions">
            <button className="btn" disabled={first} onClick={() => move(fav.id, -1)} aria-label="Up">↑</button>
            <button className="btn" disabled={last} onClick={() => move(fav.id, 1)} aria-label="Down">↓</button>
            <button className="btn" onClick={() => useUi.getState().open({ kind: 'route', id: fav.routeId, directionId: fav.directionId })}>{t('line.stops')}</button>
            <button className="btn danger" onClick={() => remove(fav.id)}>{t('common.remove')}</button>
          </div>
        </div>
      )}
    </article>
  );
}

function GetOffPicker({ fav }: { fav: FavoriteRide }) {
  const t = useT();
  const update = useFavorites((s) => s.update);
  const { data: route } = usePolling((s) => api.route(fav.routeId, s), 3600_000, [fav.routeId]);
  const options = useMemo(() => {
    const dir = route?.directions.find((d) => d.directionId === fav.directionId);
    if (!dir) return [];
    const i = dir.stops.findIndex((s) => s.stationId === fav.stationId);
    const seen = new Set<string>();
    return dir.stops.slice(i + 1).filter((s) => !seen.has(s.stationId) && !!seen.add(s.stationId));
  }, [route, fav.directionId, fav.stationId]);
  return (
    <label className="field">
      <span>{t('fav.getOffPick')}</span>
      <select
        value={fav.toStationId ?? ''}
        onChange={(e) => {
          const s = options.find((o) => o.stationId === e.target.value);
          update(fav.id, { toStationId: s?.stationId, toStationName: s?.name });
        }}
      >
        <option value="">–</option>
        {options.map((s) => <option key={s.stationId} value={s.stationId}>{s.name}</option>)}
      </select>
    </label>
  );
}
