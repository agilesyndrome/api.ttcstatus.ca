import { platform } from '../platform';

export interface CachedSnapshot<T> {
  value: T;
  savedAt: number;
  etag?: string;
  version?: string;
}
const writes = new Map<string, Promise<void>>();

/** A sign-out deletion must follow any pending save, including native filesystem writes. */
async function mutate(key: string, operation: () => Promise<void>) {
  const pending = (writes.get(key) ?? Promise.resolve()).then(operation).catch(() => {});
  writes.set(key, pending);
  await pending;
  if (writes.get(key) === pending) writes.delete(key);
}

/** Cache keys include the API origin so preview and production never exchange snapshots. */
export function snapshotKey(scope: string, resource: string, origin: string) {
  return `ui:v1:${encodeURIComponent(origin)}:${scope}:${resource}`;
}

export async function readSnapshot<T>(
  key: string,
  valid: (value: unknown) => value is T,
): Promise<CachedSnapshot<T> | undefined> {
  try {
    const cached = await platform().cache.get(key);
    if (
      !cached ||
      typeof cached !== 'object' ||
      !('value' in cached) ||
      !('savedAt' in cached) ||
      typeof cached.savedAt !== 'number' ||
      !Number.isFinite(cached.savedAt) ||
      !valid(cached.value)
    )
      return;
    return cached as CachedSnapshot<T>;
  } catch {
    return;
  }
}

export async function saveSnapshot<T>(key: string, snapshot: CachedSnapshot<T>) {
  // Private mode or a full disk must not turn a successful network load into a failure.
  await mutate(key, () => platform().cache.set(key, snapshot));
}

export const removeSnapshot = (key: string) =>
  mutate(key, () => platform().cache.remove(key));
