import { ALL_MODES } from '../../../shared/types';
import { LineBadge, ModeIcon } from '../components/Badges';
import { MapView } from '../components/MapView';
import { Icon } from '../components/Icon';
import { SearchBox } from '../components/SearchBox';
import { usePolling } from '../hooks';
import { api } from '../api/client';
import { useT } from '../i18n';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';

export function MapScreen() {
  const t = useT();
  const modes = useSettings((s) => s.modes);
  const toggleMode = useSettings((s) => s.toggleMode);
  const highlight = useUi((s) => s.highlightRoute);
  const setHighlight = useUi((s) => s.setHighlight);
  const { data: route } = usePolling(highlight ? (s) => api.route(highlight, s) : null, 3600_000, [highlight]);

  return (
    <div className="map-screen">
      <MapView />
      <div className="map-top">
        <SearchBox />
        {/* Compact mode toggles: the icon carries the mode colour when shown, grey when hidden. */}
        <div className="mode-chips" role="group" aria-label={t('map.filter')}>
          {ALL_MODES.map((m) => (
            <button
              key={m}
              className={`mode-chip mode-${m} ${modes.includes(m) ? 'on' : ''}`}
              aria-pressed={modes.includes(m)}
              aria-label={t(`mode.${m}`)}
              title={t(`mode.${m}`)}
              onClick={() => toggleMode(m)}
            >
              <ModeIcon mode={m} size={20} />
            </button>
          ))}
        </div>
        {highlight && route && (
          <button className="route-pill" onClick={() => setHighlight(undefined)} aria-label={t('line.hide')}>
            <LineBadge line={route.line} color={route.color} textColor={route.textColor} mode={route.mode} size="sm" />
            <span>{route.directions[0]?.headsign} – {route.directions[1]?.headsign ?? ''}</span>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
