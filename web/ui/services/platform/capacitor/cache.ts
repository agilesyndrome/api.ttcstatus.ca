import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { CacheStore } from '../contracts';

async function pathFor(key: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hash = [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `ttc-cache/${hash}.json`;
}

/** Large snapshots use the app's private files, never its small preference store. */
export const nativeCache: CacheStore = {
  async get(key) {
    try {
      const result = await Filesystem.readFile({
        path: await pathFor(key),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return typeof result.data === 'string' ? JSON.parse(result.data) : undefined;
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    await Filesystem.writeFile({
      path: await pathFor(key),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      data: JSON.stringify(value),
      recursive: true,
    });
  },
  async remove(key) {
    await Filesystem.deleteFile({
      path: await pathFor(key),
      directory: Directory.Data,
    }).catch(() => {});
  },
};
