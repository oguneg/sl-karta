import type { Mode } from '../../../shared/types';

export function LineBadge({ line, color, textColor = '#fff', mode, size = 'md' }: {
  line: string; color: string; textColor?: string; mode?: Mode; size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className={`badge badge-${size} ${mode ? `badge-${mode}` : ''}`} style={{ background: color, color: textColor }}>
      {line}
    </span>
  );
}

const paths: Record<Mode, string> = {
  // Simple 24px pictograms.
  // Stockholm's tunnelbana 'T' sign.
  metro: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.2a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6zM7.2 7.2h9.6v2.4h-3.6V17h-2.4V9.6H7.2z',
  train: 'M12 2C8 2 5 2.5 5 6v9.5A3.5 3.5 0 0 0 8.5 19L7 20.5v.5h2l2-2h2l2 2h2v-.5L15.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-3-4-7-4zM7 7h4.25v4H7V7zm5.75 0H17v4h-4.25V7zM8.5 14a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  tram: 'M13 5l.75-1.5H17V2H7v1.5h4.75L11 5c-3.13.09-6 .73-6 3.5V17a2.5 2.5 0 0 0 2.5 2.5L6 21v.5h2.23l2-2H14l2 2h2V21l-1.5-1.5A2.5 2.5 0 0 0 19 17V8.5c0-2.77-2.87-3.41-6-3.5zM12 17.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM17 13H7V8h10v5z',
  bus: 'M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4S4 2.5 4 6v10zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm1.5-6H6V6h12v5z',
  ship: 'M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99a8.75 8.75 0 0 0 8 0c1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68a1 1 0 0 0-.66-1.25L20 10.62V6a2 2 0 0 0-2-2h-3V1H9v3H6a2 2 0 0 0-2 2v4.62l-1.29.42a1 1 0 0 0-.66 1.25L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z',
  other: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
};

export function ModeIcon({ mode, size = 18, color = 'currentColor' }: { mode: Mode; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={paths[mode]} fill={color} fillRule={mode === 'metro' ? 'evenodd' : undefined} />
    </svg>
  );
}
