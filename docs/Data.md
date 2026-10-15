# Data

Storage model, the GTFS load path, and the schemas each part of the app
reads/writes. Field-level map contract:
[snakettc-map-contract.md](snakettc-map-contract.md). Tables live in
`migrations/0001…0011`; each app also has its own section below.

## Where data lives

| Store                         | Contents                                                                                                 | Retention                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------- |
| D1 `ttcstatus`                | GTFS/network rows, map artifacts, stop directories, service rollups, SLA tables, accounts, feature flags | see below                   |
| R2 `ttcstatus-static-gtfs`    | raw source ZIPs (`gtfs/versions/<uuid>.zip`)                                                             | current + previous ZIP only |
| R2 `ttcstatus-live`           | broadcast tick docs `live/t/{tick}/vehicles.json` + `service-stops.json`                                 | 7-day lifecycle             |
| `ServiceRecorder` DO (SQLite) | raw touch windows (~30 min) + last publication                                                           | in-DO only                  |

## D1 tables

| Group               | Tables                                                                                                                                                                                                                             | Shape                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source              | `source_state`                                                                                                                                                                                                                     | one row per feed: URL, ETag/Last-Modified, R2 key, active version, lock, last error.                                                                                                                                |
| Network (versioned) | `network_versions`, `gtfs_routes`, `gtfs_patterns`, `gtfs_shapes`, `gtfs_stops`, `gtfs_pattern_stops`, `feed_change_events`                                                                                                        | every GTFS row keyed by `version_id`; only current + previous version's rows kept; `feed_change_events` keeps compact summaries forever.                                                                            |
| Map artifacts       | `map_artifacts` (`name` = streetcar/snake/ttcstatus, immutable per generator version), `map_artifact_chunks` (ordered payload chunks), `map_tags` (name+tag → artifact), `map_generation_jobs`, `map_stop_directories` + `_chunks` | chunked because D1 rows cap at 2 MB; directories publish only after all chunks exist.                                                                                                                               |
| Accounts            | `user_profiles` (username unique NOCASE, `public_badges`, `color_mode`), `user_journals` (≤ 500 entries JSON), `user_saved_stops` (≤ 100 stop IDs)                                                                                 | keyed by Clerk `user_id`; `revision` CAS writes.                                                                                                                                                                    |
| Flags               | `feature_flags` (per-subject grants), `feature_flag_cohorts` (percentage rollouts)                                                                                                                                                 | the overlay is NOT here — it's the `OVERLAY_ENABLED` wrangler var.                                                                                                                                                  |
| Delivered service   | `service_rollups`                                                                                                                                                                                                                  | one row per directional stop per 5-minute bucket: `n`, `headway_sum`, `headway_sum_sq`, `max_gap_seconds`, first/last touch, back-to-back count, coverage bits, `fold_hash` (idempotent refold). 36-hour retention. |
| SLA                 | `sla_schedule_dates`, `sla_schedule_targets`, `sla_route_targets` (versioned like GTFS rows), `sla_daily`, `sla_weekly`, `sla_fold_meta`                                                                                           | daily/weekly kept **indefinitely by design** — the page is history.                                                                                                                                                 |

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
