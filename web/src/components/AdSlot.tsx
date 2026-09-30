import { ads, type AdPlacement } from '../platform/monetization';

/**
 * Reserved space for a banner ad. Renders nothing unless the ads provider enables the placement,
 * so layouts stay unchanged on web and for premium users.
 */
export function AdSlot({ placement }: { placement: AdPlacement }) {
  if (!ads.enabled(placement)) return null;
  return <div className={`ad-slot ad-${placement}`} data-placement={placement} aria-hidden="true" />;
}
