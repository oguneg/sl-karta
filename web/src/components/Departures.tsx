import type { Departure, Station } from '../../../shared/types';
import { countdown, delayLabel, departureTime } from '../format';
import { useLocale, useT } from '../i18n';
import { lineFavKey, stopFavKey, useFavorites } from '../store/favorites';
import { useUi } from '../store/ui';
import { LineBadge } from './Badges';

/** Star for a whole stop: favourites everything departing from it. */
export function StopStar({ station }: { station: Station }) {
  const t = useT();
  const id = stopFavKey(station.id);
  const isFav = useFavorites((s) => s.items.some((x) => x.id === id));
  const { add, remove } = useFavorites.getState();
  return (
    <button
      className={`star ${isFav ? 'on' : ''}`}
      aria-pressed={isFav}
      aria-label={isFav ? t('fav.removeStop') : t('fav.addStop')}
      title={isFav ? t('fav.removeStop') : t('fav.addStop')}
      onClick={(e) => {
        e.stopPropagation();
        if (isFav) remove(id);
        else add({ id, fromId: station.id, fromName: station.name, lines: [], modes: station.modes });
      }}
    >
      {isFav ? '★' : '☆'}
    </button>
  );
}

export function StarButton({ station, dep }: { station: Pick<Station, 'id' | 'name'>; dep: Departure }) {
  const t = useT();
  const id = lineFavKey(station.id, dep.routeId, dep.directionId);
  const isFav = useFavorites((s) => s.items.some((x) => x.id === id));
  const { add, remove } = useFavorites.getState();
  return (
    <button
      className={`star ${isFav ? 'on' : ''}`}
      aria-pressed={isFav}
      aria-label={isFav ? t('fav.remove') : t('fav.add')}
      title={isFav ? t('fav.remove') : t('fav.add')}
      onClick={(e) => {
        e.stopPropagation();
        if (isFav) remove(id);
        else add({
          id,
          fromId: station.id,
          fromName: station.name,
          routeIds: [dep.routeId],
          directionId: dep.directionId,
          headsign: dep.headsign,
          lines: [{ routeId: dep.routeId, line: dep.line, mode: dep.mode, color: dep.color, textColor: dep.textColor }],
        });
      }}
    >
      {isFav ? '★' : '☆'}
    </button>
  );
}

export function DepartureRow({ dep, now, station, showStar = true }: {
  dep: Departure; now: number; station?: Pick<Station, 'id' | 'name'>; showStar?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const delay = delayLabel(dep, t);
  const open = useUi((s) => s.open);
  return (
    <li className={`dep ${dep.canceled ? 'canceled' : ''}`} onClick={() => open({ kind: 'route', id: dep.routeId, directionId: dep.directionId })}>
      <LineBadge line={dep.line} color={dep.color} textColor={dep.textColor} mode={dep.mode} />
      <div className="dep-main">
        <div className="dep-head">{dep.headsign}</div>
        <div className="dep-sub">
          {dep.platform && <span>{t('dep.platform', { p: dep.platform })}</span>}
          {delay && <span className={dep.canceled ? 'bad' : 'late'}>{delay}</span>}
          {!dep.realtime && <span className="muted">{t('dep.scheduled')}</span>}
        </div>
      </div>
      <div className="dep-time">
        <strong className={dep.realtime ? 'rt' : ''}>{countdown(departureTime(dep), t, locale, now)}</strong>
        {dep.delay !== undefined && Math.abs(dep.delay) >= 60 && (
          <s className="muted">{new Date(dep.scheduled * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' })}</s>
        )}
      </div>
      {showStar && station && <StarButton station={station} dep={dep} />}
    </li>
  );
}
