import type { CacheStore } from '../contracts';

const DATABASE = 'ttc-ui-cache';
const STORE = 'snapshots';
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cache upgrade blocked'));
  }).catch((error) => {
    database = undefined;
    throw error;
  });
  return database;
}

async function transact(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
) {
  const db = await openDatabase();
  return new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    // Resolve only after commit: a successful request can still be rolled back.
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Cache aborted'));
  });
}

export const browserCache: CacheStore = {
  get: (key) => transact('readonly', (store) => store.get(key)),
  async set(key, value) {
    await transact('readwrite', (store) => store.put(value, key));
  },
  async remove(key) {
    await transact('readwrite', (store) => store.delete(key));
  },
};
