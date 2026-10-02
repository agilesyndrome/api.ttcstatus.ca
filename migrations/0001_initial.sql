PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_state (
  source_key TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  source_etag TEXT,
  source_last_modified TEXT,
  source_content_length INTEGER,
  r2_etag TEXT,
  r2_key TEXT,
  active_version_id INTEGER,
  last_checked_at TEXT,
  last_full_fetch_at TEXT,
  last_changed_at TEXT,
  lock_until TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS network_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_etag TEXT,
  source_last_modified TEXT,
  source_content_length INTEGER,
  r2_etag TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  imported_at TEXT,
  activated_at TEXT,
  status TEXT NOT NULL,
  error TEXT,
  route_count INTEGER NOT NULL DEFAULT 0,
  pattern_count INTEGER NOT NULL DEFAULT 0,
  shape_count INTEGER NOT NULL DEFAULT 0,
  stop_count INTEGER NOT NULL DEFAULT 0,
  pattern_stop_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  raw_retained INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_key, r2_etag)
);

CREATE INDEX IF NOT EXISTS idx_network_versions_active
  ON network_versions(source_key, active, id DESC);

CREATE TABLE IF NOT EXISTS gtfs_routes (
  version_id INTEGER NOT NULL,
  route_id TEXT NOT NULL,
  short_name TEXT NOT NULL,
  long_name TEXT NOT NULL,
  route_type INTEGER NOT NULL,
  color TEXT NOT NULL,
  text_color TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  PRIMARY KEY(version_id, route_id)
);

CREATE TABLE IF NOT EXISTS gtfs_patterns (
  version_id INTEGER NOT NULL,
  pattern_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  direction_id INTEGER NOT NULL,
  shape_id TEXT NOT NULL,
  headsign TEXT NOT NULL,
  representative_trip_id TEXT NOT NULL,
  trip_count INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  PRIMARY KEY(version_id, pattern_id)
);

CREATE INDEX IF NOT EXISTS idx_gtfs_patterns_route
  ON gtfs_patterns(version_id, route_id);

CREATE TABLE IF NOT EXISTS gtfs_shapes (
  version_id INTEGER NOT NULL,
  shape_id TEXT NOT NULL,
  points_json TEXT NOT NULL,
  point_count INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  PRIMARY KEY(version_id, shape_id)
);

CREATE TABLE IF NOT EXISTS gtfs_stops (
  version_id INTEGER NOT NULL,
  stop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  location_type INTEGER NOT NULL,
  parent_station TEXT NOT NULL,
  wheelchair_boarding INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  PRIMARY KEY(version_id, stop_id)
);

CREATE TABLE IF NOT EXISTS gtfs_pattern_stops (
  version_id INTEGER NOT NULL,
  pattern_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  stop_sequence INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  PRIMARY KEY(version_id, pattern_id, stop_sequence)
);

CREATE INDEX IF NOT EXISTS idx_gtfs_pattern_stops_stop
  ON gtfs_pattern_stops(version_id, stop_id);

CREATE TABLE IF NOT EXISTS infrastructure_overlays (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  scheduled_service INTEGER NOT NULL DEFAULT 0,
  points_json TEXT NOT NULL,
  source_note TEXT NOT NULL,
  verified_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO infrastructure_overlays (
  id, mode, name, kind, scheduled_service, points_json, source_note, verified_at, enabled
) VALUES (
  'ossington-college-dundas',
  'streetcar',
  'Ossington Avenue diversion track',
  'diversion',
  0,
  '[[43.64935,-79.42072],[43.65436,-79.42275]]',
  'Physical track overlay carried forward from the audited snakettc network; no regular scheduled route is required for inclusion.',
  '2026-10-02',
  1
);

CREATE TABLE IF NOT EXISTS map_generation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  generator TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_map_generation_jobs_version
  ON map_generation_jobs(version_id, mode, status);

CREATE TABLE IF NOT EXISTS map_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  style TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  etag TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  UNIQUE(version_id, mode, style, generator_version)
);

CREATE INDEX IF NOT EXISTS idx_map_artifacts_active
  ON map_artifacts(mode, style, active, id DESC);

CREATE TABLE IF NOT EXISTS map_artifact_chunks (
  artifact_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(artifact_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS feed_change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  from_version_id INTEGER,
  to_version_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  UNIQUE(source_key, to_version_id)
);
