import type { DurableObjectStorageLike } from '../../../shared/cloudflare/bindings';
import { chunkString } from '../../../shared/storage/chunks';
import type { PublishedSnapshot, SnapshotStore } from './published-snapshot';

/** One latest public snapshot, chunked below SQLite row limits. Atomic publication
 * survives isolate eviction; no account or device data belongs in this store. */
export class RecorderSnapshotStore implements SnapshotStore {
  private initialized = false;
  constructor(private storage: DurableObjectStorageLike) {}

  private initialize() {
    if (this.initialized) return;
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS published_snapshot (
      chunk_index INTEGER PRIMARY KEY, payload TEXT NOT NULL
    )`);
    this.initialized = true;
  }

  read(): PublishedSnapshot | null {
    this.initialize();
    const rows = this.storage.sql
      .exec('SELECT payload FROM published_snapshot ORDER BY chunk_index')
      .toArray() as { payload: string }[];
    return rows.length
      ? (JSON.parse(rows.map((row) => row.payload).join('')) as PublishedSnapshot)
      : null;
  }

  write(value: PublishedSnapshot): void {
    this.initialize();
    const chunks = chunkString(JSON.stringify(value));
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM published_snapshot');
      for (const [index, payload] of chunks.entries()) {
        this.storage.sql.exec(
          'INSERT INTO published_snapshot (chunk_index, payload) VALUES (?, ?)',
          index,
          payload,
        );
      }
    });
  }
}
