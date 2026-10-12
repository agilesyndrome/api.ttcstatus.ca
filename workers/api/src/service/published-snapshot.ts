import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { sha256Hex } from '../../../shared/gtfs/hash';

export interface PublishedSnapshot {
  configKey: string;
  snapshot: VehicleSnapshot | null;
  etag: string | null;
  checkedAt: number;
  nextUpdateAt: number;
}

export interface SnapshotStore {
  read(): PublishedSnapshot | null;
  write(value: PublishedSnapshot): void;
}

/** Owned by the recorder singleton. Alarms and public consumers share one
 * acquisition, including a persisted retry window after an upstream outage. */
export class SnapshotPublisher {
  private pending?: Promise<PublishedSnapshot>;

  constructor(
    private store: SnapshotStore,
    private acquire: () => Promise<VehicleSnapshot>,
    private configKey: string,
    private intervalSeconds: number,
    private now = Date.now,
  ) {}

  get(): Promise<PublishedSnapshot> {
    if (this.pending) return this.pending;
    const stored = this.store.read();
    if (stored?.configKey === this.configKey && stored.nextUpdateAt > this.now())
      return Promise.resolve(stored);
    this.pending = this.refresh().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async refresh(): Promise<PublishedSnapshot> {
    let snapshot: VehicleSnapshot | null = null;
    let etag: string | null = null;
    try {
      snapshot = await this.acquire();
      // Acquisition time is metadata; unchanged observations still validate as 304.
      const { fetchedAt: _fetchedAt, ...observations } = snapshot;
      etag = `"${await sha256Hex(JSON.stringify(observations))}"`;
    } catch {
      // Never present a previous healthy fleet as a new observation during outage.
      snapshot = null;
      etag = null;
    }
    const checkedAt = this.now();
    const tickMs = this.intervalSeconds * 1000;
    const value = {
      configKey: this.configKey,
      snapshot,
      etag,
      checkedAt,
      nextUpdateAt: (Math.floor(checkedAt / tickMs) + 1) * tickMs,
    };
    this.store.write(value);
    return value;
  }
}
