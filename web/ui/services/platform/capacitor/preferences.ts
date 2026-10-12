import { Preferences } from '@capacitor/preferences';
import type { PreferenceStore } from '../contracts';

const memory = new Map<string, string>();
export const nativePreferences: PreferenceStore = {
  peek: (key) => memory.get(key) ?? null,
  async get(key) {
    const { value } = await Preferences.get({ key });
    if (value !== null) memory.set(key, value);
    return value;
  },
  async set(key, value) {
    await Preferences.set({ key, value });
    memory.set(key, value);
  },
  async remove(key) {
    await Preferences.remove({ key });
    memory.delete(key);
  },
};
