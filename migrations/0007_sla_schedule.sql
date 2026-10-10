-- The promise lens's source of truth (docs/sla-stories.md Epic 8, E8S1): the
-- schedule the TTC itself publishes in the merged GTFS static feed, derived
-- nightly by the existing import from the SAME R2 zip the map already uses —
-- zero new upstream traffic. Versioned per network version like gtfs_* rows,
-- so a feed flip never mixes schedules across versions.
--
-- class_key: the exact set of streetcar-relevant service_ids active on a date
-- ('1', '2', '1+4401', ...). Exact sets, never merged by weekday folklore —
-- two different holiday schedules stay two different classes, and a date
-- whose set has no published service for a stop simply has no promise there.
--
-- headways_json: { "<classKey>": [h0..h23] } — scheduled headway seconds per
-- hour-of-day band (null = no scheduled service that hour), derived per
-- directional stop from that class's pooled departures (median gap per band,
-- gaps attributed to the hour of the departure that started them).
CREATE TABLE sla_schedule_dates (
  version_id INTEGER NOT NULL,
  date_key TEXT NOT NULL,
  class_key TEXT NOT NULL,
  PRIMARY KEY (version_id, date_key)
);

CREATE INDEX idx_sla_schedule_dates_class ON sla_schedule_dates (version_id, class_key);

CREATE TABLE sla_schedule_targets (
  version_id INTEGER NOT NULL,
  stop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  direction_id INTEGER NOT NULL CHECK (direction_id IN (0, 1)),
  headsign TEXT NOT NULL DEFAULT '',
  route_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(route_ids_json)),
  headways_json TEXT NOT NULL CHECK (json_valid(headways_json)),
  row_hash TEXT NOT NULL CHECK (length(row_hash) BETWEEN 8 AND 128),
  PRIMARY KEY (version_id, stop_id)
);

CREATE TABLE sla_route_targets (
  version_id INTEGER NOT NULL,
  route_id TEXT NOT NULL,
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  overnight INTEGER NOT NULL DEFAULT 0 CHECK (overnight IN (0, 1)),
  headways_json TEXT NOT NULL CHECK (json_valid(headways_json)),
  stops_json TEXT NOT NULL CHECK (json_valid(stops_json)),
  row_hash TEXT NOT NULL CHECK (length(row_hash) BETWEEN 8 AND 128),
  PRIMARY KEY (version_id, route_id)
);
