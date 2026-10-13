/** A process-wide Map-backed stub of the Workers edge cache.
 *
 * The suite runs with `--test-isolation=none`, and several test files assign
 * `globalThis.caches` at import time — the last assignment would win for
 * every test in the process, silently breaking any file that expects
 * different semantics. One shared store with one stub shape keeps every
 * assignment coherent regardless of load order: files that need a cold
 * cache call `clearEdgeCache()` before the requests they assert on, and the
 * store itself is exported for size/contents assertions. */
const store = (globalThis.__edgeCacheStore ??= new Map());

export const edgeCacheStore = store;

export const clearEdgeCache = () => store.clear();

globalThis.caches = {
  default: {
    async match(key) {
      const id = typeof key === 'object' && key && 'url' in key ? key.url : String(key);
      return store.get(id) ?? null;
    },
    async put(key, response) {
      const id = typeof key === 'object' && key && 'url' in key ? key.url : String(key);
      store.set(id, response);
    },
  },
};
