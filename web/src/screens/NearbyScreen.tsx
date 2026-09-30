import { Fragment, useEffect, useState } from 'react';
import type { Station } from '../../../shared/types';
import { api } from '../api/client';
import { AdSlot } from '../components/AdSlot';
import { LineBadge } from '../components/Badges';
import { DepartureRow } from '../components/Departures';
import { SkeletonRows } from '../components/Sheets';
import { distance } from '../format';
import { useNow, usePolling } from '../hooks';
import { useT } from '../i18n';
import { showStation } from '../store/ui';

const FALLBACK = { lat: 59.3313, lon: 18.0596 }; // T-Centralen

type Pos = { lat: number; lon: number; fallback?: boolean };

function usePosition() {
  const [pos, setPos] = useState<Pos>();
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setPos({ ...FALLBACK, fallback: true });
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => setPos((prev) => {
        // Ignore jitter below ~40 m to avoid refetching constantly.
        if (prev && !prev.fallback && Math.abs(prev.lat - p.coords.latitude) < 0.0004 && Math.abs(prev.lon - p.coords.longitude) < 0.0007) return prev;
        return { lat: p.coords.latitude, lon: p.coords.longitude };
      }),
      () => setPos((prev) => prev ?? { ...FALLBACK, fallback: true }),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return pos;
}

export function NearbyScreen() {
  const t = useT();
  const pos = usePosition();
  const { data: stations, error } = usePolling(
    pos ? (s) => api.nearby(pos.lat, pos.lon, 1000, s) : null,
    120_000,
    [pos?.lat, pos?.lon],
  );

  return (
    <div className="page">
      <h1>{t('tab.nearby')}</h1>
      {!pos && <p className="muted">{t('nearby.locating')}</p>}
      {pos?.fallback && <p className="notice">{t('nearby.denied')}</p>}
      {error && !stations ? <p className="empty">{t('status.offline')}</p> : null}
      {stations && stations.length === 0 && <p className="empty">{t('nearby.none')}</p>}
      <div className="cards">
        {stations?.map((s, i) => (
          <Fragment key={s.id}>
            <NearbyCard station={s} live={i < 8} />
            {i === 2 && <AdSlot placement="list-inline" />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function NearbyCard({ station, live }: { station: Station; live: boolean }) {
  const now = useNow();
  const { data: deps } = usePolling(live ? (s) => api.departures(station.id, { minutes: 60, limit: 6 }, s) : null, 30_000, [station.id, live]);
  return (
    <article className="card">
      <button className="card-head" onClick={() => showStation(station.id, station.lat, station.lon)}>
        <div>
          <h2>{station.name}</h2>
          <div className="chips">
            {station.lines.slice(0, 10).map((l) => (
              <LineBadge key={l.routeId} line={l.line} color={l.color} textColor={l.textColor} mode={l.mode} size="sm" />
            ))}
          </div>
        </div>
        {station.distance !== undefined && <span className="dist">{distance(station.distance)}</span>}
      </button>
      {live && !deps && <SkeletonRows n={2} />}
      {deps && deps.length > 0 && (
        <ul className="dep-list compact">
          {deps.slice(0, 4).map((d) => <DepartureRow key={d.tripId + d.stopId} dep={d} now={now} station={station} />)}
        </ul>
      )}
    </article>
  );
}
