import { useEffect } from 'react';
import { api } from './api/client';
import { AdSlot } from './components/AdSlot';
import { SheetHost } from './components/Sheets';
import { useT } from './i18n';
import { FavoritesScreen } from './screens/FavoritesScreen';
import { MapScreen } from './screens/MapScreen';
import { NearbyScreen } from './screens/NearbyScreen';
import { PlanScreen } from './screens/PlanScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useUi, type Tab } from './store/ui';
import { useApplyTheme } from './theme';

const TAB_ICONS = {
  map: 'M15 5.1 9 3 3 5v16l6-2.1 6 2.1 6-2V3l-6 2.1zM10 5.4l4 1.4v11.8l-4-1.4V5.4zM5 6.4l3-1v11.8l-3 1V6.4zm14 11.2-3 1V6.8l3-1v11.8z',
  near: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14z',
  star: 'm12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  day: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11zM7 11h5v5H7z',
  more: 'M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
};

const TABS: { id: Tab; icon: keyof typeof TAB_ICONS }[] = [
  { id: 'map', icon: 'map' },
  { id: 'nearby', icon: 'near' },
  { id: 'favorites', icon: 'star' },
  { id: 'plan', icon: 'day' },
  { id: 'settings', icon: 'more' },
];

function useMeta() {
  const setMeta = useUi((s) => s.setMeta);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const m = await api.meta();
        setMeta(m);
        timer = setTimeout(run, m.status === 'loading' ? 5000 : 60_000);
      } catch {
        setMeta(useUi.getState().meta, true);
        timer = setTimeout(run, 10_000);
      }
    };
    void run();
    return () => clearTimeout(timer);
  }, [setMeta]);
}

function StatusBanner() {
  const t = useT();
  const meta = useUi((s) => s.meta);
  const offline = useUi((s) => s.offline);
  if (offline) return <div className="banner bad">{t('status.offline')}</div>;
  if (meta?.status === 'loading') return <div className="banner">{meta.message ?? t('status.loading')}</div>;
  if (meta?.status === 'error') return <div className="banner bad">{meta.message}</div>;
  if (meta?.source === 'demo') return <div className="banner demo">{t('status.demo')}</div>;
  return null;
}

export function App() {
  useApplyTheme();
  useMeta();
  const t = useT();
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);

  return (
    <div className={`app tab-${tab}`}>
      <main className="stage">
        <MapScreen />
        <StatusBanner />
        <AdSlot placement="map-bottom" />
      </main>
      <aside className="panel">
        {tab === 'map' && <div className="page"><p className="muted">{t('map.hint')}</p></div>}
        {tab === 'nearby' && <NearbyScreen />}
        {tab === 'favorites' && <FavoritesScreen />}
        {tab === 'plan' && <PlanScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </aside>
      <SheetHost />
      <nav className="tabbar" aria-label="Main">
        {TABS.map((x) => (
          <button key={x.id} className={tab === x.id ? 'on' : ''} aria-current={tab === x.id ? 'page' : undefined} onClick={() => setTab(x.id)}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d={TAB_ICONS[x.icon]} fill="currentColor" /></svg>
            <span>{t(`tab.${x.id}`)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
