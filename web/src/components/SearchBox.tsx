import { useEffect, useRef, useState } from 'react';
import type { RouteInfo, Station } from '../../../shared/types';
import { api } from '../api/client';
import { useT } from '../i18n';
import { showStation, useUi } from '../store/ui';
import { LineBadge, ModeIcon } from './Badges';

type Results = { lines: RouteInfo[]; stations: Station[] };

// Fetched once per session; the list only changes with the timetable.
let popularCache: Promise<Station[]> | undefined;
const loadPopular = () => (popularCache ??= api.popular().catch((e) => {
  popularCache = undefined;
  throw e;
}));

export function SearchBox() {
  const t = useT();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results>();
  const [popular, setPopular] = useState<Station[]>();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Single characters are useful for line numbers ("4"), so search from one character.
    if (!q.trim()) {
      setResults(undefined);
      return;
    }
    const c = new AbortController();
    const id = setTimeout(() => api.search(q, c.signal).then(setResults).catch(() => {}), 150);
    return () => {
      clearTimeout(id);
      c.abort();
    };
  }, [q]);

  useEffect(() => {
    if (open && !popular) loadPopular().then(setPopular).catch(() => {});
  }, [open, popular]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const done = () => {
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
  };
  const pickStation = (s: Station) => {
    done();
    showStation(s.id, s.lat, s.lon);
  };
  const pickLine = (r: RouteInfo) => {
    done();
    const ui = useUi.getState();
    ui.setTab('map');
    ui.open({ kind: 'route', id: r.id, fit: true });
  };

  const empty = !q.trim();
  const nothing = results && results.lines.length === 0 && results.stations.length === 0;

  return (
    <div className="search" ref={boxRef}>
      <input
        ref={inputRef}
        type="search"
        value={q}
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') done();
          if (e.key !== 'Enter' || !results) return;
          // Enter: exact line number wins (typing "14" means the line), else the first stop.
          const exact = results.lines.find((l) => l.line.toLowerCase() === q.trim().toLowerCase());
          if (exact) pickLine(exact);
          else if (results.stations[0]) pickStation(results.stations[0]);
          else if (results.lines[0]) pickLine(results.lines[0]);
        }}
      />
      {open && empty && popular && popular.length > 0 && (
        <div className="search-results">
          <h3 className="search-section">{t('search.popular')}</h3>
          <div className="popular">
            {popular.map((s) => (
              <button key={s.id} className="popular-place" onClick={() => pickStation(s)}>
                <ModeIcon mode={s.modes[0] ?? 'bus'} size={16} />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {open && !empty && results && (
        <div className="search-results" role="listbox">
          {nothing && <p className="empty">{t('search.none')}</p>}
          {results.lines.length > 0 && (
            <>
              <h3 className="search-section">{t('search.lines')}</h3>
              <ul>
                {results.lines.map((r) => (
                  <li key={r.id} role="option" aria-selected="false" onClick={() => pickLine(r)}>
                    <span className="line-result">
                      <LineBadge line={r.line} color={r.color} textColor={r.textColor} mode={r.mode} />
                      <span className="name">{r.name || t(`mode.${r.mode}`)}</span>
                    </span>
                    <ModeIcon mode={r.mode} size={16} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {results.stations.length > 0 && (
            <>
              <h3 className="search-section">{t('search.stops')}</h3>
              <ul>
                {results.stations.map((s) => (
                  <li key={s.id} role="option" aria-selected="false" onClick={() => pickStation(s)}>
                    <span className="name">{s.name}</span>
                    <span className="lines">
                      {s.lines.slice(0, 6).map((l) => (
                        <LineBadge key={l.routeId} line={l.line} color={l.color} textColor={l.textColor} mode={l.mode} size="sm" />
                      ))}
                      {s.lines.length > 6 && <span className="muted small">+{s.lines.length - 6}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
