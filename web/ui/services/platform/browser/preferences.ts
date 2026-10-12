import type { PreferenceStore } from '../contracts';

/** Storage failures propagate to callers that can report session-only preferences. */
export const browserPreferences: PreferenceStore = {
  peek(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async get(key) {
    return globalThis.localStorage.getItem(key);
  },
  async set(key, value) {
    globalThis.localStorage.setItem(key, value);
  },
  async remove(key) {
    globalThis.localStorage.removeItem(key);
  },
};
