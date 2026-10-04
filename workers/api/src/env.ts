import type { D1Database, Fetcher, R2Bucket } from '../../shared/cloudflare/bindings';
import type { SyncEnv } from './sync/sync';
import type { AccountEnv } from './accounts';

export interface Env extends SyncEnv, AccountEnv {
  DB: D1Database;
  GTFS_BUCKET: R2Bucket;
  MAP_GENERATOR: Fetcher;
  STATIC_GTFS_URL: string;
  SOURCE_ATTRIBUTION: string;
  NO_VALIDATOR_REFETCH_DAYS?: string;
  SYNC_TOKEN?: string;
  REALTIME_SUBWAY_URL?: string;
  REALTIME_VEHICLE_URL?: string;
  REALTIME_UPDATE_SECONDS?: string;
}
