/**
 * Monetisation seam. The web build ships no-op implementations; native builds plug in
 * e.g. @capacitor-community/admob and RevenueCat / cordova-plugin-purchase here.
 * UI code only talks to this module, never to an SDK directly.
 */

export type AdPlacement = 'map-bottom' | 'list-inline';

export interface AdsProvider {
  init(): Promise<void>;
  /** Whether a banner slot should be reserved for this placement. */
  enabled(placement: AdPlacement): boolean;
}

export interface PurchasesProvider {
  init(): Promise<void>;
  isPremium(): boolean;
  /** Resolves true when the purchase completed. */
  purchasePremium(): Promise<boolean>;
  restore(): Promise<boolean>;
  onChange(cb: (premium: boolean) => void): () => void;
}

/** Feature limits for free vs premium. Tune once the business model is decided. */
export const LIMITS = {
  free: { favorites: Infinity, planLegs: Infinity },
  premium: { favorites: Infinity, planLegs: Infinity },
};

const noAds: AdsProvider = {
  init: async () => {},
  enabled: () => false,
};

const noPurchases: PurchasesProvider = {
  init: async () => {},
  isPremium: () => false,
  purchasePremium: async () => false,
  restore: async () => false,
  onChange: () => () => {},
};

export const ads: AdsProvider = noAds;
export const purchases: PurchasesProvider = noPurchases;
