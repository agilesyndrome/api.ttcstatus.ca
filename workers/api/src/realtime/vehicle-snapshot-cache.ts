import { sha256Hex } from '../../../shared/gtfs/hash';
import { fetchVehicleSnapshot } from './realtime';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';

export interface CachedVehicleSnapshot {
  snapshot: VehicleSnapshot;
  etag: string;
  nextUpdateAt: number;
}

/** Credential-free local previews share acquisitions within their process.
 * Production consumers use the recorder's persisted singleton publication. */
export class VehicleSnapshotCache {
  private cached?: CachedVehicleSnapshot;
  private pending?: Promise<CachedVehicleSnapshot>;
  private retryAt = 0;
  private lastError?: unknown;

  constructor(
    private source: string,
    private attribution: string,
    readonly updateSeconds: number,
    private acquire = fetchVehicleSnapshot,
    private now = Date.now,
  ) {}

  get(): Promise<CachedVehicleSnapshot> {
    if (this.cached && this.now() < this.cached.nextUpdateAt)
      return Promise.resolve(this.cached);
    if (this.pending) return this.pending;
    if (this.now() < this.retryAt) return Promise.reject(this.lastError);

    this.pending = this.acquire(this.source, this.attribution)
      .then(async (snapshot) => {
        // Exclude acquisition time: identical observations can be returned as 304.
        const { fetchedAt: _fetchedAt, ...observations } = snapshot;
        const etag = `"${await sha256Hex(JSON.stringify(observations))}"`;
        this.cached = {
          snapshot,
          etag,
          nextUpdateAt: this.now() + this.updateSeconds * 1000,
        };
        this.retryAt = 0;
        this.lastError = undefined;
        return this.cached;
      })
      .catch((error) => {
        // An unavailable upstream should not be retried by every incoming viewer.
        this.retryAt = this.now() + this.updateSeconds * 1000;
        this.lastError = error;
        throw error;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
}
