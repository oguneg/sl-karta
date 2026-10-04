/** Small UI icon set: 24px grid, 2px rounded strokes (filled star for "saved"). */
const paths = {
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z',
  close: 'M6 6l12 12M18 6L6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, filled = false, className }: {
  name: IconName; size?: number; filled?: boolean; className?: string;
}) {
  const dots = name === 'more';
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={dots ? 3.2 : 2} strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: 'none' }}
    >
      <path d={paths[name]} />
    </svg>
  );
}
