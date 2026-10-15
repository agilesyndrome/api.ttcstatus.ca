# GTFS load

How the static GTFS feed becomes a published network version: acquisition,
parsing, materialization, map generation, activation, and retention. Schema
details: [Data.md](Data.md). Operator recovery paths: [map-admin.md](map-admin.md).
Artifact field contract: [snakettc-map-contract.md](snakettc-map-contract.md).

## High level

One source (TTC **Complete GTFS**, Toronto Open Data), one importer, one
publish decision. Every piece of upstream traffic lives in
`workers/api/src/sync/sync.ts` — everything downstream reads either R2 (the
cached ZIP) or D1 (the materialized version), so a reviewer can audit
data-citizenship behavior in one file.

Doctrine, in order of importance:

- **Snapshot-copy versioning.** Each changed feed becomes a new
  `version_id`; its full imported subset is copied into the `gtfs_*` tables
  under that id and never mutated again. Readers filter by one `version_id`
  and see a frozen network. There is no `first_seen`/`last_seen` interval
  model — see "Why not SCD2 intervals" below.
- **Only changed feeds import.** Validator probes (ETag /
  Last-Modified) gate the entire pipeline. Unchanged feeds cost two D1
  statements and nothing else; there are several zero-copy paths that avoid
  even a re-download.
- **Publish, then prune.** The previously active version stays fully intact
  until activation succeeds in one atomic batch; retention only runs after
  publication, and never touches the active version.
- **History by events, not intervals.** Deep history is not kept as stop-row
  intervals (only two snapshots exist); it is kept as compact, permanent
  `feed_change_events` summaries computed from `row_hash` comparisons.

| Stage           | Code                                     | Outcome                                                     |
| --------------- | ---------------------------------------- | ----------------------------------------------------------- |
| Probe & acquire | `sync.ts`                                | Changed ZIP in R2, or a short-circuit with a reason         |
| Import          | `sync-pipeline.ts` → `import-version.ts` | `gtfs_*` + `sla_schedule_*` rows under the new `version_id` |
| Generate maps   | `network-lifecycle.ts` → `mapgen/`       | Immutable chunked artifacts for all three published names   |
| Record delta    | `feed-delta.ts`                          | Permanent compact `feed_change_events` summary              |
| Activate        | `network-lifecycle.ts`                   | One batch flips network + artifact + source pointers        |
| Prune           | `network-lifecycle.ts`                   | Third-oldest versions lose their R2 ZIP and `gtfs_*` rows   |

Triggers: nightly cron `07:17 UTC`, `POST /api/v1/admin/sync` (synchronous,
~1 min on a changed feed), and `npm run map:regenerate:{local,remote}`. All
three run the same code.

## Mid level

### 1. Probe and acquire (`sync.ts`)

1. A 20-minute lease lock (`source_state.lock_until`) serializes syncs; a
   second caller gets `busy`.
2. `HEAD` with conditional validators. `304` → `unchanged` immediately.
   Matching validators (`sameReliableValidators`) → `unchanged`.
3. If the incoming validators match an **inactive** version that still has
   its R2 ZIP (`findReusableCandidate`), that version is re-adopted and
   processed without re-downloading — the recovery path for a sync that
   downloaded but never published.
4. Sources without reliable validators defer the full fetch for
   `NO_VALIDATOR_REFETCH_DAYS` (default 7) since `last_full_fetch_at`.
5. The GET streams straight into R2 multipart upload (10 MiB parts, 512 MiB
   byte cap) — nothing buffers in Worker memory. Key:
   `gtfs/versions/<epoch-ms>.zip`, with the upstream validators stored as
   custom metadata.

Two distinct identities live side by side; do not confuse them:

- `source_etag` / `source_last_modified` — what the **upstream** served;
  used to decide "did the feed change".
- `r2_etag` — the ETag of the **stored ZIP object**; used as the content
  identity of a version. `UNIQUE(source_key, r2_etag)` makes version rows
  idempotent.

That identity is also what catches a metadata-only upstream change: if the
newly downloaded bytes hash to the same R2 etag as the active version
(`downloaded-bytes-identical`), the new object is deleted, only the
validators are updated, and nothing rebuilds. A known `r2_etag` whose R2
source is gone is a hard error (`A known GTFS content version was found but
its retained R2 source is missing`) — see [map-admin.md](map-admin.md).

### 2. Import (`import-version.ts`)

`importNetworkVersion` sets `status = 'importing'`, parses the R2 ZIP with
ranged reads (streaming decompress), then validates before writing:

- **Sanity rails** (`validateStreetcarImport`): coarse lower bounds — at
  least 8 routes, at least 50 stops, patterns ≥ routes, pattern-stops ≥
  stops. Intentionally simple; topology validation belongs to mapgen.
- **Completeness rails** (`validateCompleteFeedRailLines`): the Complete
  feed must still carry geometry for Lines 1, 2, 4, 5, 6.

The parser materializes only the **imported subset**: streetcars plus Lines
1, 2, 4, 5, 6; Line 3 and buses are skipped; replacement-bus patterns are
excluded but retained in the artifact's `excludedServices` for audit. Within
`stops.txt`, only stops referenced by imported trips' `stop_times` survive
the `wantedStopIds` filter — `gtfs_stops` is **not** the whole file.

Rows are written **wipe-then-insert**: `clearVersionRows` first deletes all
`gtfs_*` **and `sla_schedule_*`** rows for the version (making a retried
`failed_import`/`importing` idempotent — no UPSERTs into partial state),
then plain INSERTs go through `runBatches` at `BATCH_SIZE = 75` statements
per D1 batch (`sync-common.ts`). Every row carries `row_hash =
fnv1a(JSON.stringify(row))`, a 32-bit content fingerprint used only for
delta comparison.

The promise lens rides the same pass: `deriveSlaSchedule` turns the already-
parsed feed into `sla_schedule_dates` / `sla_schedule_targets` /
`sla_route_targets` — zero new upstream traffic, validated, and persisted in
the same version. On success `network_versions` records the counts
(`route_count` … `pattern_stop_count`) and `status = 'imported'`.

### 3. Generate the map (`network-lifecycle.ts`, `mapgen/`)

Generation runs **in-process** (there is no second Worker):
`map_generation_jobs` bookkeeping (`pending` → `running` → `completed` /
`failed` with error text), then `generateStreetcarMap` reads the version's
`gtfs_*` rows from D1 and builds: WGS84 source coordinates → local metre
projection → topology (shared corridor edges, observed turns, audited
infrastructure overlays) → schematic display geometry → `snake-v1`
artifacts.

Artifacts are **immutable** and **chunked**: `ARTIFACT_CHUNK_CHARACTERS =
300_000` keeps each `map_artifact_chunks` payload row far below D1's 2 MB
row cap; re-storing an artifact deletes its chunks first. The stop directory
(`ttc-stop-directory`, original WGS84 boarding records + display-cluster
mapping) is staged the same way — chunk rows are written before the
metadata row exists, so a failed generation never publishes a partial
directory.

### 4. Record the delta (`feed-delta.ts`)

`recordFeedDelta` compares the previous and new versions by PK join +
`row_hash` (added / removed / changed per table) and writes one
`feed_change_events` row, `UNIQUE(source_key, to_version_id)`, INSERT OR
REPLACE. These summaries are the system's **permanent** change history —
compact by design, never pruned. The first import records `initialImport`
counts instead of a delta.

### 5. Activate (`activateNetworkVersion`)

Refuses to activate unless all three published names — `streetcar`, `snake`,
`ttcstatus` — carry complete artifacts for the version (every chunk stored,
not just a `chunk_count` claim). Then one D1 batch flips everything
together: old `network_versions.active = 0`, old artifacts deactivated, new
version + its three artifacts activated, and `source_state` repointed.
Readers never observe a half-published network.

### 6. Prune (`pruneOldNetworkVersions`)

Retention policy: keep the **two newest** versions and any older version
that is still active. For each pruned version:

1. If `raw_retained = 1`, delete the R2 source ZIP and set the flag to 0.
   The `network_versions` row itself **survives forever** as a metadata
   tombstone (that's why the counts and validator history live there).
2. One D1 batch, children before parents, deletes the snapshot by
   `version_id`: `gtfs_pattern_stops`, `gtfs_stops`, `gtfs_shapes`,
   `gtfs_patterns`, `gtfs_routes`, then the version's map artifacts —
   **except** artifacts still pinned by `map_tags` (a tag keeps an artifact
   alive past its version).
3. `sla_schedule_*` rows are **not** deleted (see foot-guns).

Prune failures are logged, never fatal: `processVersion` wraps it so a
retention error cannot mark the freshly published map as failed.

### Who reads the snapshot, and when

| Reader                                       | When                           | Query shape                                                            |
| -------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| Map generator (`repository.ts`)              | During generation              | Full scan by `version_id`                                              |
| Recorder bootstrap (`loadNetwork`)           | DO cold start / version flip   | Full scan by active `version_id`, then held in DO memory               |
| Feed delta (`feed-delta.ts`)                 | Once per publish               | PK join across the two retained versions                               |
| SLA backfill (`backfillSlaSchedule`)         | Operator motion after a deploy | Re-derives from the retained R2 ZIP                                    |
| Lite stop-name fallback (`lite/response.ts`) | Directory artifact missing     | **Unversioned** `SELECT stop_id, name FROM gtfs_stops` — see foot-guns |

Note the pattern: every legitimate reader loads a whole snapshot once on a
cold path. Nothing on a hot request path queries `gtfs_*`.

### Cost shape

- **Writes** are bounded by the changed-feed cadence and the two-snapshot
  retention: at most ~2× a theoretical incremental loader, a few times a
  month, in 75-statement batches.
- **Reads** on hot paths approach zero: the map and stop directory are
  edge-cached artifacts with ETag/304; the lite board reads broadcast tick
  documents from R2, not D1.
- The same batch discipline is characterized in
  `scripts/operations/fold-write-spike.mjs` (D1's 100-bound-parameter limit
  per statement, chunked multi-row INSERTs).

### Version status lifecycle

`downloaded` → `importing` → `imported` → `generating_map` → `active`;
failures land in `failed_import` (before generation) or `map_failed`
(during), with error text in `network_versions.error`. Retriable statuses on
the next sync: `downloaded`, `failed_import`, `importing` — each retry
re-imports from a clean slate via `clearVersionRows`.

## Foot-guns

- **An unchanged feed short-circuits before any artifact work.** The
  `source-validators-unchanged` path never regenerates and never backfills a
  missing artifact — the classic _published-set drift_: a new published name
  (e.g. `ttcstatus`) added after the last feed change stays missing until
  you run `npm run map:regenerate:{local,remote}` (the repair path; `make
dev` runs it automatically).
- **Deploys do not rebuild maps.** After a generator change you must run the
  sync or an explicit regenerate; a normal deploy with an unchanged feed
  ships no new map.
- **Only two snapshots exist.** Any feature that needs stop history must
  read `feed_change_events` (or grow a new append-only events table in that
  idiom) — never the `gtfs_*` tables, which are pruned by PK-range delete.
- **Never read `gtfs_*` without a `version_id` filter.** Both the current
  and previous versions' rows are present, so an unversioned query sees a
  mix of two networks deduped last-wins in JS. Lite's stop-name fallback
  does this deliberately (GTFS stop IDs are stable across versions, so the
  names still resolve); new code should not inherit the trick.
- **`gtfs_stops` is the imported subset, not a city directory.** Stops
  outside the imported routes' `stop_times` are absent, and stop identity is
  raw GTFS. The public stop directory is the `ttc-stop-directory` artifact
  served by `/api/v1/stops` (original boarding records + display-cluster
  mapping).
- **`sla_schedule_*` rows are not pruned.** `pruneOldNetworkVersions`
  deletes only `gtfs_*` rows and map artifacts; schedule rows accumulate
  across all historical versions. This is deliberate — `sla_daily`
  `.targets_version_id` must stay resolvable and the operator backfill needs
  prior versions intact — but deleting them is a deliberate operator action,
  and the volume grows one small snapshot per changed feed, forever.
- **Two identities, one job each.** `source_etag` answers "did upstream
  change"; `r2_etag` answers "is this content already a version". Mixing
  them produces either rebuild storms or missed updates. Changing
  `STATIC_GTFS_URL` nulls the stored validators (`ensureState`) on purpose —
  a URL switch forces a fresh comparison.
- **The sync is synchronous and locked.** A 20-minute lease; a concurrent
  trigger gets `busy`; an interrupted changed-feed run leaves the work to
  the nightly cron (the version row and status make the retry safe).
- **Rover-sized payloads must be chunked.** D1 rows cap at 2 MB; artifacts
  and directories chunk at 300,000 characters per row. Never store a big
  payload in one row.
- **`row_hash` is a 32-bit FNV-1a** (`shared/gtfs/hash.ts`) — a fast
  non-cryptographic content hash for delta comparison. Not an integrity
  check, not an ID.
- **The rail-line completeness rail is URL-gated.**
  `validateCompleteFeedRailLines` applies only when the source URL matches
  `completegtfs.zip`; streetcar-only fixtures skip the Lines 1/2/4/5/6
  check by design.
- **Prune lag is possible and harmless.** Retention failures are logged and
  retried at the next publish; don't treat prune as a cost-control lever
  that must succeed on schedule.

### Why not SCD2 intervals

`gtfs_stops` looks like a textbook slowly-changing-dimension candidate, but
the snapshot-copy model wins here on four grounds:

1. **Versions are identities, not timestamps.** Readers ask "the network as
   of version _n_", resolved once from a pointer — not "as of time T". An
   interval model would add temporal predicates to every read and require
   believing activation order equals version order.
2. **SCD2 mutates history.** Interval closing (`UPDATE … SET last_seen`) on
   activation breaks the "old versions are immutable until pruned"
   invariant and complicates retry semantics. Snapshot copies keep
   activation a pure pointer flip and retries a wipe-and-reinsert of one
   `version_id`.
3. **The access patterns are whole-snapshot.** Every real consumer (mapgen,
   recorder bootstrap, delta comparison) loads the complete stop set of one
   version — a PK-range scan under `(version_id, …)` keys, and impossible
   under `(stop_id, first_seen)` keys without temporal filtering.
4. **Retention makes intervals dishonest anyway.** With only two snapshots
   retained, `first_seen`/`last_seen` chains reaching into pruned versions
   would silently truncate into false history. Compact
   `feed_change_events` summaries are the honest permanent record. If
   per-stop attribute history is ever needed, the consistent move is an
   append-only `stop_change_events` table in the same idiom — not intervals
   on the serving table.
