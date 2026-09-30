import { useEffect, useRef, useState } from 'react';
import type { Station } from '../../../shared/types';
import { api } from '../api/client';
import { useT } from '../i18n';
import { showStation } from '../store/ui';
import { LineBadge } from './Badges';

export function SearchBox() {
  const t = useT();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Station[]>();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(undefined);
      return;
    }
    const c = new AbortController();
    const id = setTimeout(() => api.search(q, c.signal).then(setResults).catch(() => {}), 180);
    return () => {
      clearTimeout(id);
      c.abort();
    };
  }, [q]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const pick = (s: Station) => {
    setOpen(false);
    setQ('');
    showStation(s.id, s.lat, s.lon);
  };

  return (
    <div className="search" ref={boxRef}>
      <input
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
          if (e.key === 'Enter' && results?.[0]) pick(results[0]);
        }}
      />
      {open && results && (
        <ul className="search-results" role="listbox">
          {results.length === 0 && <li className="empty">{t('search.none')}</li>}
          {results.map((s) => (
            <li key={s.id} role="option" aria-selected="false" onClick={() => pick(s)}>
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
      )}
    </div>
  );
}
