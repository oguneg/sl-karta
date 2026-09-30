import { useT } from '../i18n';
import { useSettings, type Theme } from '../store/settings';
import { useUi } from '../store/ui';

export function SettingsScreen() {
  const t = useT();
  const { lang, theme, setLang, setTheme } = useSettings();
  const meta = useUi((s) => s.meta);
  return (
    <div className="page">
      <h1>{t('tab.settings')}</h1>

      <section className="card settings">
        <h2>{t('settings.language')}</h2>
        <div className="segmented">
          {(['sv', 'en'] as const).map((l) => (
            <button key={l} aria-pressed={lang === l} aria-selected={lang === l} onClick={() => setLang(l)}>
              {l === 'sv' ? 'Svenska' : 'English'}
            </button>
          ))}
        </div>

        <h2>{t('settings.theme')}</h2>
        <div className="segmented">
          {(['system', 'light', 'dark'] as Theme[]).map((th) => (
            <button key={th} aria-pressed={theme === th} aria-selected={theme === th} onClick={() => setTheme(th)}>
              {t(`settings.theme.${th}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="card settings">
        <h2>{t('settings.premium')}</h2>
        <p className="muted">{t('settings.premium.body')}</p>
        <button className="btn primary" disabled>{t('settings.premium.soon')}</button>
      </section>

      <section className="card settings">
        <h2>{t('settings.data')}</h2>
        {meta && (
          <ul className="plain">
            <li>{meta.source === 'demo' ? t('settings.source.demo') : t('settings.source.gtfs')}{meta.feedVersion && meta.source !== 'demo' ? ` · ${meta.feedVersion}` : ''}</li>
            <li>{meta.realtime.vehicles === 'gps' ? t('settings.vehicles.gps') : t('settings.vehicles.schedule')}</li>
          </ul>
        )}
        <p className="muted small">{t('settings.about')}</p>
      </section>
    </div>
  );
}
