import { useMemo, useState } from 'react';
import type { FavoriteRide, PlanRequest } from '../../../shared/types';
import { api } from '../api/client';
import { LineBadge } from '../components/Badges';
import { clock, delayLabel, departureTime, todayIso } from '../format';
import { usePolling } from '../hooks';
import { useLocale, useT } from '../i18n';
import { useFavorites } from '../store/favorites';
import { usePlan, type PlanLeg } from '../store/plan';

export function PlanScreen() {
  const t = useT();
  const locale = useLocale();
  const favorites = useFavorites((s) => s.items);
  const { start, legs, setStart, addLeg } = usePlan();
  const [date, setDate] = useState(todayIso());
  const favById = useMemo(() => new Map(favorites.map((f) => [f.id, f])), [favorites]);
  const validLegs = legs.filter((l) => favById.has(l.favoriteId));

  const req: PlanRequest | null = validLegs.length
    ? {
        date,
        start,
        legs: validLegs.map((l) => {
          const f = favById.get(l.favoriteId)!;
          return {
            stationId: f.fromId, routeIds: f.routeIds, directionId: f.toId ? undefined : f.directionId, toStationId: f.toId,
            notBefore: l.notBefore || undefined, transferMinutes: l.transferMinutes,
          };
        }),
      }
    : null;
  const reqKey = JSON.stringify(req);
  const { data: plan, error } = usePolling(req ? (s) => api.plan(req, s) : null, 60_000, [reqKey]);

  if (favorites.length === 0) {
    return (
      <div className="page">
        <h1>{t('plan.title')}</h1>
        <p className="empty">{t('plan.empty')}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{t('plan.title')}</h1>
      <p className="muted">{t('plan.intro')}</p>
      <div className="plan-controls">
        <label className="field">
          <span>{t('plan.date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} />
        </label>
        <label className="field">
          <span>{t('plan.start')}</span>
          <input type="time" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </label>
      </div>

      <ol className="timeline">
        {validLegs.map((leg, i) => {
          const f = favById.get(leg.favoriteId)!;
          const r = plan?.legs[i];
          const dep = r?.departure;
          const dl = dep && delayLabel(dep, t);
          return (
            <li key={leg.key} className="tl-leg" style={{ ['--line' as string]: dep?.color ?? f.lines[0]?.color }}>
              <div className="tl-time">
                {dep ? <strong className={dep.realtime ? 'rt' : ''}>{clock(departureTime(dep), locale)}</strong> : <strong>–</strong>}
                {r?.arrival && <span className="muted small">{clock(r.arrival, locale)}</span>}
              </div>
              <div className="tl-body">
                <div className="row">
                  {dep
                    ? <LineBadge line={dep.line} color={dep.color} textColor={dep.textColor} mode={dep.mode} />
                    : f.lines[0] && <LineBadge line={f.lines[0].line} color={f.lines[0].color} textColor={f.lines[0].textColor} mode={f.lines[0].mode} />}
                  <div className="tl-title">
                    <strong>{f.fromName}{f.toName ? ` → ${f.toName}` : ''}</strong>
                    <span className="muted">{t('fav.to')} {dep?.headsign || f.headsign}</span>
                  </div>
                </div>
                {dep?.platform && <div className="muted small">{t('dep.platform', { p: dep.platform })}</div>}
                {dl && <div className={dep?.canceled ? 'bad small' : 'late small'}>{dl}</div>}
                {f.toName && r?.arrival && (
                  <div className="small">{t('plan.arrive')} {f.toName} {clock(r.arrival, locale)}</div>
                )}
                {r?.error === 'no_departure' && <div className="bad small">{t('plan.noDep')}</div>}
                {r?.error === 'no_arrival' && <div className="bad small">{t('plan.noArr')}</div>}
                {r && r.alternatives.length > 0 && (
                  <div className="muted small">{t('plan.alt', { t: r.alternatives.map((a) => clock(departureTime(a), locale)).join(', ') })}</div>
                )}
                <LegEditor leg={leg} first={i === 0} last={i === validLegs.length - 1} />
              </div>
            </li>
          );
        })}
      </ol>
      {error ? <p className="bad">{t('status.offline')}</p> : null}

      <AddLeg favorites={favorites} onAdd={addLeg} />
    </div>
  );
}

function LegEditor({ leg, first, last }: { leg: PlanLeg; first: boolean; last: boolean }) {
  const t = useT();
  const { updateLeg, removeLeg, moveLeg } = usePlan.getState();
  return (
    <details className="leg-edit">
      <summary>⋯</summary>
      <div className="leg-edit-body">
        <label className="field">
          <span>{t('plan.notBefore')}</span>
          <input type="time" value={leg.notBefore ?? ''} onChange={(e) => updateLeg(leg.key, { notBefore: e.target.value || undefined })} />
        </label>
        <label className="field">
          <span>{t('plan.transfer')}</span>
          <input
            type="number" min={0} max={120} inputMode="numeric" value={leg.transferMinutes}
            onChange={(e) => updateLeg(leg.key, { transferMinutes: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <div className="actions">
          <button className="btn" disabled={first} onClick={() => moveLeg(leg.key, -1)} aria-label="Up">↑</button>
          <button className="btn" disabled={last} onClick={() => moveLeg(leg.key, 1)} aria-label="Down">↓</button>
          <button className="btn danger" onClick={() => removeLeg(leg.key)}>{t('common.remove')}</button>
        </div>
      </div>
    </details>
  );
}

function AddLeg({ favorites, onAdd }: { favorites: FavoriteRide[]; onAdd: (id: string) => void }) {
  const t = useT();
  return (
    <label className="field add-leg">
      <span>{t('plan.addLeg')}</span>
      <select value="" onChange={(e) => e.target.value && onAdd(e.target.value)}>
        <option value="">{t('plan.pick')}</option>
        {favorites.map((f) => (
          <option key={f.id} value={f.id}>
            {f.lines.map((l) => l.line).join('/')} · {f.fromName} → {f.toName ?? f.headsign}
          </option>
        ))}
      </select>
    </label>
  );
}
