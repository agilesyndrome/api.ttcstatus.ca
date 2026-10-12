import type {
  AnalyticsEngineDataset,
  D1Database,
  DurableObjectNamespaceLike,
  R2Bucket,
  WorkerVersionMetadata,
} from '../../shared/cloudflare/bindings';
import type { SyncEnv } from './sync/sync';
import type { AccountEnv } from './accounts';

export interface Env extends SyncEnv, AccountEnv {
  // Merged env (docs/optimize-transport.md E7S2): the map-generator worker
  // folded into this one, so this single Env feeds everything — including
  // src/mapgen/ (generate.ts + source/topology/layout/rendering/artifacts).
  // The mapgen path consumes exactly: DB, SOURCE_ATTRIBUTION, SYNC_TOKEN —
  // all already declared here or via SyncEnv. Do not prune them.
  DB: D1Database;
  GTFS_BUCKET: R2Bucket;
  /** Dedicated public live bucket (optimize-transport.md change 1): the
   * recorder publishes one immutable tick document per 30 s tick. Optional so
   * local dev runs without it — publish then no-ops (recorded in telemetry). */
  LIVE_BUCKET?: R2Bucket;
  /** The recorder singleton Durable Object (sla.md §4.4). */
  SERVICE_RECORDER: DurableObjectNamespaceLike;
  ANALYTICS?: AnalyticsEngineDataset;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  STATIC_GTFS_URL: string;
  SOURCE_ATTRIBUTION: string;
  NO_VALIDATOR_REFETCH_DAYS?: string;
  SYNC_TOKEN?: string;
  REALTIME_SUBWAY_URL?: string;
  REALTIME_VEHICLE_URL?: string;
  REALTIME_UPDATE_SECONDS?: string;
  // SLA service configuration (shared/service/config.ts validates; §0A/E0S2).
  SERVICE_SAMPLE_SECONDS?: string;
  SERVICE_TICK_TOLERANCE_SECONDS?: string;
  SERVICE_TOUCH_RADIUS_METRES?: string;
  SERVICE_DWELL_DEDUPE_SECONDS?: string;
  SERVICE_BACK_TO_BACK_SECONDS?: string;
  SERVICE_FRESH_DRYNESS_RATIO?: string;
  SERVICE_VOID_DRYNESS_RATIO?: string;
  SERVICE_VOID_ABSOLUTE_MINUTES?: string;
  SERVICE_HISTORY_HOURS?: string;
  SERVICE_BASELINE_MIN_TOUCHES?: string;
  SERVICE_RESIDUAL_MIN_SAMPLES?: string;
  SERVICE_WAIT_SHRINK_PRIOR?: string;
  SERVICE_RECORDER_MODE?: string;
  // Promise-lens configuration (shared/service/config.ts validates; Epic 8).
  SLA_TOLERANCE_RATIO?: string;
  SLA_MET_RATIO?: string;
  SLA_DEGRADED_RATIO?: string;
}
