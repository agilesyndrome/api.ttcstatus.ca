# Data

Storage model, the GTFS load path, and the schemas each part of the app
reads/writes. Field-level map contract:
[snakettc-map-contract.md](snakettc-map-contract.md). Stage-by-stage load
mechanics: [gtfs_load.md](gtfs_load.md). Tables live in
`migrations/0001…0011`; each app also has its own section below.

## Where data lives

| Store                         | Contents                                                                                                 | Retention                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------- |
| D1 `ttcstatus`                | GTFS/network rows, map artifacts, stop directories, service rollups, SLA tables, accounts, feature flags | see below                   |
| R2 `ttcstatus-static-gtfs`    | raw source ZIPs (`gtfs/versions/<uuid>.zip`)                                                             | current + previous ZIP only |
| R2 `ttcstatus-live`           | broadcast tick docs `live/t/{tick}/vehicles.json` + `service-stops.json`                                 | 7-day lifecycle             |
| `ServiceRecorder` DO (SQLite) | raw touch windows (~30 min) + last publication                                                           | in-DO only                  |

## D1 tables

Every table gets its own row, grouped under a subsection. Key notation: **PK** primary key, **UK** unique key, **FK**
declared foreign key (D1 enforces these — `scripts/dev/drop-local.sql` must
drop children before parents), `→` a logical reference with no declared
constraint.

### Source

| Table          | Shape                                                                        | Contents and retention                                                               |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `source_state` | **PK** `source_key` · `active_version_id` → `network_versions.id` (implicit) | One row per feed: URL, ETag/Last-Modified, R2 key, active version, lock, last error. |

### Network (versioned)

Every GTFS row is keyed by `version_id`; only the current + previous version's
rows are kept. `feed_change_events` keeps compact summaries forever.

| Table                | Shape                                                                                                                                                          | Contents and retention                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `network_versions`   | **PK** `id` (AUTOINCREMENT) · **UK** (`source_key`, `r2_etag`) · indexed (`source_key`, `active`, `id` DESC)                                                   | Source URL/validators, R2 key, `fetched_at`/`imported_at`/`activated_at`, `status`, `error`, row counts, `active` flag, `raw_retained`. |
| `gtfs_routes`        | **PK** (`version_id`, `route_id`) · `version_id` → `network_versions.id` (implicit)                                                                            | `short_name`, `long_name`, `route_type`, `color`, `text_color`, `row_hash`.                                                             |
| `gtfs_patterns`      | **PK** (`version_id`, `pattern_id`) · indexed (`version_id`, `route_id`) · `route_id` → `gtfs_routes` (implicit, same version)                                 | `direction_id`, `shape_id`, `headsign`, `representative_trip_id`, `trip_count`, `row_hash`.                                             |
| `gtfs_shapes`        | **PK** (`version_id`, `shape_id`) · `version_id` → `network_versions.id` (implicit)                                                                            | `points_json` (WGS84), `point_count`, `row_hash`.                                                                                       |
| `gtfs_stops`         | **PK** (`version_id`, `stop_id`) · `version_id` → `network_versions.id` (implicit)                                                                             | `name`, `lat`, `lon`, `location_type`, `parent_station`, `wheelchair_boarding`, `row_hash`.                                             |
| `gtfs_pattern_stops` | **PK** (`version_id`, `pattern_id`, `stop_sequence`) · indexed (`version_id`, `stop_id`) · `pattern_id` → `gtfs_patterns`, `stop_id` → `gtfs_stops` (implicit) | `row_hash`.                                                                                                                             |
| `feed_change_events` | **PK** `id` · **UK** (`source_key`, `to_version_id`) · `from_version_id`/`to_version_id` → `network_versions.id` (implicit)                                    | `created_at`, `summary_json`.                                                                                                           |

### Map artifacts

Chunked because D1 rows cap at 2 MB; artifacts are immutable per generator
version; directories publish only after all chunks exist.

| Table                       | Shape                                                                                                                                                                                                  | Contents and retention                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `map_artifacts`             | **PK** `id` · **UK** (`version_id`, `mode`, `style`, `generator_version`) · `version_id` → `network_versions.id` (implicit) · indexed (`mode`, `style`, `active` and `name`, `active`, both `id` DESC) | `name` (streetcar/snake/ttcstatus), `mode`, `style`, `etag`, `byte_size`, `chunk_count`, `created_at`, `active` flag. |
| `map_artifact_chunks`       | **PK** (`artifact_id`, `chunk_index`) · `artifact_id` → `map_artifacts.id` (implicit)                                                                                                                  | Ordered `payload` chunks.                                                                                             |
| `map_tags`                  | **PK** (`name`, `tag`) · **FK** `artifact_id` → `map_artifacts(id)` · indexed (`artifact_id`)                                                                                                          | `updated_at`.                                                                                                         |
| `map_generation_jobs`       | **PK** `id` · indexed (`version_id`, `mode`, `status`)                                                                                                                                                 | `version_id`, `mode`, `generator`, `status`, `created_at`/`started_at`/`completed_at`, `error`.                       |
| `map_stop_directories`      | **PK** `artifact_id` · **FK** `artifact_id` → `map_artifacts(id)` ON DELETE CASCADE                                                                                                                    | `etag`, `chunk_count`, `schema_version`.                                                                              |
| `map_stop_directory_chunks` | **PK** (`artifact_id`, `chunk_index`) · **FK** `artifact_id` → `map_artifacts(id)` ON DELETE CASCADE                                                                                                   | Ordered `payload` chunks.                                                                                             |

### Physical track (unversioned)

| Table                     | Shape       | Contents and retention                                                                                                                                                                                               |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infrastructure_overlays` | **PK** `id` | `mode`, `name`, `kind`, `scheduled_service`, `points_json`, `source_note`, `verified_at`, `enabled` flag. Carried forward, audited — no `version_id`; DB overlays with matching IDs win over `physical-tracks.json`. |

### Accounts

Clerk owns identity; every table is keyed by Clerk `user_id`; `revision` CAS
writes.

| Table              | Shape                                         | Contents and retention                                              |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------- |
| `user_profiles`    | **PK** `user_id` · **UK** `username` (NOCASE) | `public_badges` (0/1), `color_mode` (`standard`/`redgreen`/`full`). |
| `user_journals`    | **PK** `user_id` (1:1 with profile)           | `entries` JSON (≤ 500 entries, app-enforced), `revision` (CAS).     |
| `user_saved_stops` | **PK** `user_id` (1:1 with profile)           | `stop_ids` JSON (≤ 100 stop IDs, app-enforced), `revision` (CAS).   |

### Flags

| Table                  | Shape                      | Contents and retention                            |
| ---------------------- | -------------------------- | ------------------------------------------------- |
| `feature_flags`        | **PK** (`flag`, `subject`) | `granted_at`, `granted_by` (per-subject grants).  |
| `feature_flag_cohorts` | **PK** `flag`              | `percentage` (0–100), `updated_at`, `updated_by`. |

The overlay is NOT here — it's the `OVERLAY_ENABLED` wrangler var.

### Delivered service

| Table             | Shape                                                         | Contents and retention                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `service_rollups` | **PK** (`stop_id`, `bucket_start`) · indexed (`bucket_start`) | One row per directional stop per 5-minute bucket: `n`, `headway_sum`, `headway_sum_sq`, `max_gap_seconds`, `first_touch_at`/`last_touch_at`, `back_to_back`, `distinct_vehicles`, `route_ids` JSON, `coverage_bits`, `fold_hash` (idempotent refold). 36-hour retention. |

### SLA

Schedule rows are versioned like GTFS rows. Daily/weekly rollups are kept
**indefinitely by design** — the page is history; a day whose rollup data aged
out before its fold is skipped **without rows**.

| Table                  | Shape                                                                                            | Contents and retention                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sla_schedule_dates`   | **PK** (`version_id`, `date_key`) · indexed (`version_id`, `class_key`)                          | `class_key` (exact `service_id` set).                                                                                                                                                                                                                    |
| `sla_schedule_targets` | **PK** (`version_id`, `stop_id`)                                                                 | `name`, `direction_id` (0/1), `headsign`, `route_ids_json`, `headways_json`, `row_hash`.                                                                                                                                                                 |
| `sla_route_targets`    | **PK** (`version_id`, `route_id`)                                                                | `number`, `name`, `overnight` (0/1), `headways_json`, `stops_json`, `row_hash`.                                                                                                                                                                          |
| `sla_daily`            | **PK** (`scope`, `scope_id`, `day_key`) · `scope` CHECK (`route`/`stop`) · indexed (`day_key`)   | Additive metrics: `services`, `headway_sum`, `headway_sum_sq`, `max_gap_seconds`, `back_to_back`, `compliant_seconds`, `gap_seconds`, `coverage_seconds`, `span_seconds`; `final`, `targets_version_id` (schedule version the fold used), `computed_at`. |
| `sla_weekly`           | **PK** (`scope`, `scope_id`, `week_key`) · `scope` CHECK (`route`/`stop`) · indexed (`week_key`) | Same additive metrics as `sla_daily`; a week is the exact sum of its days.                                                                                                                                                                               |
| `sla_fold_meta`        | **PK** `key`                                                                                     | `value` (`folded_through`, `ran_at`).                                                                                                                                                                                                                    |

## How GTFS loads into the model

Source: TTC **Complete GTFS** (Toronto Open Data; Open Government Licence —
Toronto). Streetcars + Lines 1, 2, 4, 5, 6 are imported; Line 3 and buses are
not; replacement-bus patterns are excluded but retained in
`excludedServices` for audit.

Same code runs from all three triggers (nightly cron `07:17 UTC`,
`POST /api/v1/admin/sync`, `npm run map:regenerate:remote`):

1. `HEAD` probe → conditional `GET` only when validators changed (7-day
   fallback if the source stops publishing validators).
2. Stream ZIP into R2; parse it from there (ranged reads, streaming
   decompress) — nothing buffers in Worker memory.
3. Import into D1 under a new `version_id` (`gtfs_*` tables above; raw
   shapes stay in D1).
4. Map generation in-process: D1 source coordinates → local metre
   projection → topology (shared corridor edges, observed turns, audited
   infrastructure overlays) → schematic display geometry → `snake-v1`
   artifact.
5. Store artifacts chunked; activate version + artifacts only after the
   whole artifact exists.
6. Retention: current + previous versions/artifacts/ZIPs; older ones deleted.

The published map bundle (format `snake-v1`, schema version 1) carries
`routes`, `patterns` (→ `paths` with ordered `edgeRefs`), `stops`
(`edgeId`, `distanceAlongMetres`, `edgeFraction`), `infrastructure`,
`graph.nodes`/`graph.edges` (`sourcePoints`, `lengthMetres`, route/path/
infrastructure membership, `observedTurns`), `geographicPoints` per feature
and the `ttc-stop-directory` (original WGS84 boarding records + display
cluster mapping, also stored standalone in D1 via 0009).

## Schema around parts of the app

- **Live fleet** — tick document = one snapshot (`schemaVersion`, `fetchedAt`,
  `vehicles[]`). 30 s tick grid shared by every client. No vehicle history
  in D1/R2 beyond the 7-day tick archive.
- **Delivered service** — recorder raw touches (30 min, DO) →
  `service_rollups` (5-min moments) → `/api/v1/service/history|wave` reads.
  Moments merge **exactly** across buckets and windows.
- **SLA report** — nightly import derives scheduled headway bands from the
  same ZIP (zero new upstream traffic) into `sla_schedule_*` keyed by
  calendar `class_key` (weekday/Saturday/Sunday/holiday sets are exact,
  never merged). Hourly cron folds `service_rollups` into `sla_daily`/
  `sla_weekly` (additive rows: a week = exact sum of its days).
- **Accounts** — journal entries, saved stops, colour mode; all
  revision-checked; Clerk owns identity, D1 owns data.
- **Analytics** — not D1: Cloudflare Analytics Engine dataset
  `ttcstatus_metrics`, allowlisted actions only (see [analytics.md](analytics.md),
  [privacy.md](privacy.md)).

## Caveats that will burn you

- Only **moments** (n, Σh, Σh²) merge exactly. Medians never do; quantiles
  are gamma approximations, labelled as such everywhere.
- 36-hour retention prunes `service_rollups`. If the hourly fold
  (`41 * * * *`) doesn't run before a bucket ages out, that data is gone;
  aged-out days are skipped **without rows** — honest absence, never a
  fabricated zero.
- `sla_daily`/`sla_weekly` are never auto-pruned. Deleting history is a
  deliberate operator action.
- GTFS is **service truth, not track truth**. Physical corridors GTFS
  doesn't schedule come from `infrastructure_overlays` (D1) and
  `workers/api/src/mapgen/source/physical-tracks.json` (versioned,
  audited; DB overlays with matching IDs win). Proximity alone never
  creates a junction.
- Unmonitored time is never rendered as a void — a feed outage is a blind
  spot (`{ states: [], outage }`), not evidence about service.
- Map artifacts are immutable: changing content means a new generator
  version and a regenerate; the same ID/generator version can't be
  rewritten. Tags (`stable`, `latest`) pin names to artifacts.
- SLA schedule rows are keyed by `version_id` — never mix schedules across
  network versions.
- Map format/schema version is 1: additive fields are tolerated; changing
  meaning, units, or types requires a new schema/API version.
- `service_rollups.fold_hash` makes refolding a DO restart byte-identical
  (`INSERT OR REPLACE`). Keep folds idempotent.
