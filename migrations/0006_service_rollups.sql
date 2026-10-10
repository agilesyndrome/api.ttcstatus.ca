-- Delivered-service rollups (sla.md §3.7, §4.3, §4.5): one row per directional
-- stop per 5-minute bucket, kept for a rolling 36 hours. Moments (n, Σh, Σh²)
-- merge exactly across buckets; medians never do. fold_hash makes refolding a
-- DO restart byte-identical (idempotency by construction, INSERT OR REPLACE).
-- No existing table changes anywhere in this feature.
CREATE TABLE service_rollups (
  stop_id TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  n INTEGER NOT NULL CHECK (n >= 0),
  headway_sum REAL NOT NULL CHECK (headway_sum >= 0),
  headway_sum_sq REAL NOT NULL CHECK (headway_sum_sq >= 0),
  max_gap_seconds REAL NOT NULL CHECK (max_gap_seconds >= 0),
  first_touch_at INTEGER,
  last_touch_at INTEGER,
  back_to_back INTEGER NOT NULL DEFAULT 0 CHECK (back_to_back >= 0),
  distinct_vehicles INTEGER NOT NULL DEFAULT 0 CHECK (distinct_vehicles >= 0),
  route_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(route_ids)),
  coverage_bits INTEGER NOT NULL DEFAULT 0 CHECK (coverage_bits >= 0),
  fold_hash TEXT NOT NULL CHECK (length(fold_hash) BETWEEN 8 AND 128),
  PRIMARY KEY (stop_id, bucket_start)
);

CREATE INDEX idx_service_rollups_bucket_start ON service_rollups (bucket_start);
