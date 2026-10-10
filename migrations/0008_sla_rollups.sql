-- Tier 3, made a deliberate product decision by the user's /sla goal
-- (docs/sla-stories.md Epic 8, E8S3): daily and weekly SLA rollups per route
-- and per directional stop, folded from the 5-minute service_rollups tier by
-- the hourly SLA cron BEFORE the 36-hour retention can prune a day away.
--
-- Every quantity is additive (moments merge exactly; compliance parts are
-- time-weighted and sum exactly — shared/service/sla-metrics.ts), so a week
-- is the exact sum of its days and a route the exact sum of its stops.
-- Nothing here is ever computed at request time: the /sla report endpoints
-- only read these rows.
--
-- Retention is a product choice, not an accident (sla.md §9): rows are kept
-- indefinitely until a deliberate prune says otherwise — the point of the
-- page is history, and "as many tick marks as you have data segments for"
-- means never silently forgetting a recorded day.
CREATE TABLE sla_daily (
  scope TEXT NOT NULL CHECK (scope IN ('route', 'stop')),
  scope_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  services INTEGER NOT NULL CHECK (services >= 0),
  headway_sum REAL NOT NULL CHECK (headway_sum >= 0),
  headway_sum_sq REAL NOT NULL CHECK (headway_sum_sq >= 0),
  max_gap_seconds REAL NOT NULL CHECK (max_gap_seconds >= 0),
  back_to_back INTEGER NOT NULL DEFAULT 0 CHECK (back_to_back >= 0),
  compliant_seconds REAL NOT NULL CHECK (compliant_seconds >= 0),
  gap_seconds REAL NOT NULL CHECK (gap_seconds >= 0),
  coverage_seconds REAL NOT NULL CHECK (coverage_seconds >= 0),
  span_seconds REAL NOT NULL CHECK (span_seconds >= 0),
  final INTEGER NOT NULL CHECK (final IN (0, 1)),
  targets_version_id INTEGER NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (scope, scope_id, day_key)
);

CREATE INDEX idx_sla_daily_day ON sla_daily (day_key);

CREATE TABLE sla_weekly (
  scope TEXT NOT NULL CHECK (scope IN ('route', 'stop')),
  scope_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  services INTEGER NOT NULL CHECK (services >= 0),
  headway_sum REAL NOT NULL CHECK (headway_sum >= 0),
  headway_sum_sq REAL NOT NULL CHECK (headway_sum_sq >= 0),
  max_gap_seconds REAL NOT NULL CHECK (max_gap_seconds >= 0),
  back_to_back INTEGER NOT NULL DEFAULT 0 CHECK (back_to_back >= 0),
  compliant_seconds REAL NOT NULL CHECK (compliant_seconds >= 0),
  gap_seconds REAL NOT NULL CHECK (gap_seconds >= 0),
  coverage_seconds REAL NOT NULL CHECK (coverage_seconds >= 0),
  span_seconds REAL NOT NULL CHECK (span_seconds >= 0),
  final INTEGER NOT NULL CHECK (final IN (0, 1)),
  targets_version_id INTEGER NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (scope, scope_id, week_key)
);

CREATE INDEX idx_sla_weekly_week ON sla_weekly (week_key);

-- Fold bookkeeping: 'folded_through' (last day_key attempted), 'ran_at'.
-- A day whose rollup data aged out before its fold is skipped forward WITHOUT
-- rows — an honest absence on the page, never a fabricated zero.
CREATE TABLE sla_fold_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
