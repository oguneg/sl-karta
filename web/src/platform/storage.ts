import type { StateStorage } from 'zustand/middleware';

/**
 * Key/value storage used by all persisted stores.
 * Web: localStorage. When wrapped with Capacitor, swap for @capacitor/preferences here
 * (localStorage in a native webview can be purged by the OS under storage pressure).
 */
export const storage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // storage unavailable (private mode): keep in memory only
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};
