# Map admin — error paths, operator messages, and recovery steps

This is the operator companion to the map pipeline. It tracks every error the
map endpoints can return, which visitor-facing message each one triggers in the
web UI, and how to recover in local dev versus production.

## How a map request flows

```
web UI (useStaticMap.ts)
  → GET /api/v1/map/{ttcstatus|streetcar|snake}[?tag=<tag>]
  → API Worker (workers/api) routeRequest → mapResponse
  → D1 map_artifacts / map_tags / map_artifact_chunks
  → (artifacts are produced by the map-generator Worker via the nightly sync)
```

The map-generator Worker (`workers/map-generator`, dev script `npm run dev:map`)
exposes only `GET /api/healthz`, `POST /api/debug/render`, and
`POST /api/internal/generate`. **It does not serve `/api/v1/map/*` at all** — any
other path on it returns `404 {"error":"not-found"}`.

## Dev/prod parity

`make dev` runs the **same Worker code** production runs, from the same
`wrangler.jsonc` configs:

| Concern          | Production                                                                   | `make dev`                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker runtime   | workerd (deployed)                                                           | workerd (`wrangler dev`), same configs                                                                                                                                                                              |
| Workers          | `ttcstatus-api` + `ttcstatus-map-generator`, `MAP_GENERATOR` service binding | same, pinned: API **8787**, generator 8788, binding `[connected]`                                                                                                                                                   |
| D1/R2            | remote D1/R2                                                                 | local SQLite/R2 in `workers/api/.wrangler/state/v3`, same migrations (`db:migrate:remote` vs `db:migrate:local`), same schema                                                                                       |
| Map pipeline     | cron `17 7 * * *` or `POST /api/v1/admin/sync` (`make admin/sync`)           | `--test-scheduled` (`/__scheduled`) and the same endpoint via `make dev/bootstrap`                                                                                                                                  |
| Operator tooling | `bin/api` with `API_HOST=https://api.ttcstatus.ca`                           | same `bin/api` with `API_HOST=http://localhost:8787`                                                                                                                                                                |
| GTFS source      | `https://…CompleteGTFS.zip`                                                  | your `.env.local` `STATIC_GTFS_URL` — **http(s) converges fully**; only `file://` fixtures fall back to the Node platform-proxy harness (`scripts/dev/bootstrap-local.mjs`), because workerd cannot fetch `file://` |

Known remaining deltas: local secrets come from 1Password env files instead of
Cloudflare secrets; the Vite preview (`npm run dev:viewer`, port 4173) serves
**fixture data** for UI-only work and never exercises D1; and port 8787/8788
pinning only applies to `make dev` — running `npm run dev:map`/`dev:api`
manually lets both default to 8787 again (second one silently bumps to 8788).

## Visitor-facing messages

The UI (`web/ui/features/map/useStaticMap.ts`) maps every failure to one of four
messages. Keys live in `shared/i18n/locales/*/messages.json` (`map.*`).

| Message                                                          | Key                                                       | Shown when                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The streetcar map is being prepared. Please try again shortly." | `map.theStreetcarMapIsBeingPreparedPleaseTryAgainShortly` | 503 with `error: "map-generating"` — a generation job is **running right now**; the map really is on its way.                                                                                                                    |
| **"Map temporarily unavailable while we perform track work."**   | `map.mapTemporarilyUnavailableWhileWePerformTrackWork`    | Every 503 that is _not_ `map-generating` — `map-not-ready` (nothing was ever generated; the pipeline never started or failed), `map-artifact-incomplete` (broken artifact) — **and every 404** (`not-found`, `map-tag-missing`). |
| "We're experiencing a delay. Please try again shortly."          | `map.wereExperiencingADelayPleaseTryAgainShortly`         | Network-level failure (offline, DNS, connection refused — fetch rejects with `TypeError`).                                                                                                                                       |
| "Map request failed ({status})."                                 | `map.mapRequestFailedValue`                               | Any other non-OK status (e.g. 500 `internal-error`).                                                                                                                                                                             |

`"Unable to load the streetcar map."` (`map.unableToLoadTheStreetcarMap`) is the
last-resort string when a thrown value is not an `Error`.

Rule of thumb for operators: **"being prepared" = a generation is running right
now; "Track work" = the pipeline never started or failed; "delay" = the visitor
could not reach the API at all.**

## Server error catalogue

### API Worker (`/api/v1/map/*`, `workers/api/src/maps/responses.ts`)

### API Worker (`/api/v1/map/*`, `workers/api/src/maps/responses.ts`)

| Status / `error`              | Meaning                                                                                                                                                   | UI message                  | Fix                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 200 / 304                     | Artifact served (304 on matching `If-None-Match`).                                                                                                        | —                           | —                                                                                                                             |
| 503 `map-generating`          | No active artifact, **and** the latest `map_generation_jobs` streetcar job has `status = 'running'` — a generation is in progress right now.              | "being prepared"            | None; wait for the job to finish.                                                                                             |
| 503 `map-not-ready`           | No active artifact and **no** running job. The payload's `phase` names one of the operator states below; `guidance` repeats the diagnosis as a one-liner. | **"track work"**            | Follow the `phase` row in the outcome catalogue below. In dev, `make dev` provisions this automatically.                      |
| 503 `map-artifact-incomplete` | Artifact row exists but stored chunk count ≠ expected — a generation was interrupted or the D1 write partially failed.                                    | **"track work"**            | Re-generate for the active version (`npm run map:regenerate:remote`), or roll the `stable` tag back to the previous artifact. |
| 404 `map-tag-missing`         | `?tag=` requested a tag that does not exist for this name (hint text includes the `map:tag` command).                                                     | **"track work"**            | `npm run map:tag -- list`, then `npm run map:tag -- set --name <name> --tag <tag>`.                                           |
| 404 `not-found`               | No route matched. In dev this almost always means you reached the **map-generator** Worker, not the API Worker (see port note above).                     | **"track work"**            | Point at the API Worker's port: `curl -s localhost:<port>/api/healthz` must say `"worker":"ttcstatus-api"`.                   |
| 500 `internal-error`          | Unhandled exception in the API Worker; detail is in Workers Logs only.                                                                                    | "Map request failed (500)." | Check logs; usually D1/R2 unavailable.                                                                                        |

Related but not map-serving: `503 vehicles-unavailable` (live feed, uncached),
`503 network-not-ready` (`/api/v1/network`), `503 auth-unavailable` (accounts).

### Map-generator Worker (`workers/map-generator/src/index.ts`)

| Status / `error`                                                    | Meaning                                                                                  | Fix                                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 404 `not-found`                                                     | Only `healthz`, `debug/render`, and `internal/generate` exist here.                      | n/a (expected).                                                                                                 |
| 404 `generation-disabled`                                           | `SYNC_TOKEN` secret not configured.                                                      | `npx wrangler secret put SYNC_TOKEN -c workers/map-generator/wrangler.jsonc` (and the same for the API Worker). |
| 401 `unauthorized`                                                  | Missing/incorrect `Authorization: Bearer <SYNC_TOKEN>`.                                  | Use the admin token from 1Password/local env.                                                                   |
| 400 `invalid-version-id` / `unsupported-mode` / `unsupported-style` | Bad request body to `/api/internal/generate`.                                            | Send `{ versionId }` for an existing `network_versions` row; mode `streetcar`, style `snake-v1`.                |
| 500 `{message}`                                                     | Generation failed; recorded in `map_generation_jobs.status = 'failed'` with the message. | Fix the cause, re-run generation for the version.                                                               |

## Outcome catalogue — every 503 `phase`, its meaning, and its solution

Every 503 body carries `phase` (`not-started` | `pending` | `running` | `failed` | `completed`) and a one-line `guidance` string. Triage from anywhere:

```bash
curl -s localhost:8787/api/v1/map/ttcstatus | jq '{error, phase, guidance}'
```

`phase` comes from the newest `map_generation_jobs` streetcar row. Generation and
**activation are two separate steps**: the generator writes artifacts with
`active = 0` and marks its job `completed`; the sync pipeline's
`activateNetworkVersion` flips `active = 1` afterwards, and only when the whole
set is complete. That split is why a job can be `completed` while no map is
active — the phase that says "generated, never activated".

| `phase`                              | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Solution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not-started`                        | No generation job has ever been recorded — the pipeline has literally never run against this D1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Run the sync. Locally: `make dev` (provisions D1/R2 and bootstraps) or `make dev/new` (drops and recreates local D1 first). Against an environment with `SYNC_TOKEN`: `POST /api/v1/admin/sync` (`make admin/sync` for prod).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pending`                            | A job row was inserted (`network-lifecycle.ts` queues it before calling the generator) but never moved to `running` — the map-generator service call failed before generation started (service binding missing, 401 `unauthorized`, or 404 `generation-disabled` because `SYNC_TOKEN` is unset on the generator).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Check the API Worker logs for the generator call failure. Set the `SYNC_TOKEN` secret on **both** Workers (`npx wrangler secret put SYNC_TOKEN -c workers/map-generator/wrangler.jsonc`, and the same for `workers/api`), then re-run the sync.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `running`                            | A generation is executing right now. The UI shows "being prepared" (`error: "map-generating"`) — the only state where that message is accurate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | None. Wait for it to finish; the sync activates the map when generation completes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `failed`                             | Generation started and threw. The payload includes the job's `completed_at` and error text; the same text is stored in `map_generation_jobs.error` and echoed by the generator's 500.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Read the error text, fix the cause, re-run the sync. Common causes: D1 schema drift (run migrations), a missing R2 source ZIP for the version ("A known GTFS content version was found but its retained R2 source is missing"), or a generator change that broke the React contract (watch the generator Worker logs).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `completed` (but no active artifact) | Generation finished and wrote artifact rows, **but activation never flipped any `active = 1`**. `activateNetworkVersion` refuses to activate unless: the network version is active, every chunk of the artifact is stored (`chunk_count` matches), **and** the same version also carries complete `snake` and `ttcstatus` companion artifacts. So either activation threw one of its "Cannot activate…" refusals, or the process died between generation and activation. **Most common real cause: published-set drift** — a new board name (e.g. `ttcstatus`) was added to the generator after this D1 state was last generated, so the artifact never existed here; unchanged-feed syncs then short-circuit and never backfill it, and stale-but-valid `streetcar`/`snake` artifacts keep serving, hiding the gap. | 1. Inspect what exists: `npx wrangler d1 execute ttcstatus --local --command "SELECT id, name, style, active, chunk_count FROM map_artifacts ORDER BY id DESC" -c workers/api/wrangler.jsonc` (drop `--local` for prod) — check that `streetcar`, `snake` **and** `ttcstatus` each have an `active = 1` row. 2. Re-run the sync only if the GTFS feed changed — on unchanged validators it short-circuits (`source-validators-unchanged`) and never regenerates, so it will **not** backfill a missing artifact. 3. Backfill or re-activate without a feed change: `npm run map:regenerate:local` (local D1) or `npm run map:regenerate:remote` (production D1). Regeneration only reports `unchanged` when the **complete published set** — `streetcar` + `snake` + `ttcstatus`, each active with every chunk stored — is present; a current schematic alone is not enough, so this is the repair path for published-set drift. `make dev` runs it automatically. 4. Once you've confirmed the rows are complete, you can also flip the pointer manually: `UPDATE map_artifacts SET active = CASE WHEN name = '<name>' THEN 1 ELSE 0 END WHERE mode = 'streetcar'`. |

The remaining 503, `map-artifact-incomplete`, is the runtime cousin of
`completed`: activation succeeded once, but the chunks behind the active
artifact no longer match its `chunk_count` (pruning gone wrong, partial D1
write). Same solution path as `completed`.

## Recovery steps

### Local dev

`make dev` is the whole local stack with dev/prod parity: it builds the UI,
migrates local D1/R2, starts **both Workers from their production wrangler
configs** (`wrangler dev` — the real Worker code in workerd; API pinned to 8787,
map-generator to 8788, the `MAP_GENERATOR` service binding connecting them,
`--test-scheduled` for the cron path), then bootstraps the map via
`make dev/bootstrap`:

- **`STATIC_GTFS_URL` is http(s)** — `dev/bootstrap` is the _exact_ production
  operator motion: `bin/api POST /api/v1/admin/sync` against
  `http://localhost:8787`, running the real download → import → generate →
  activate pipeline inside the Worker.
- **`STATIC_GTFS_URL` is `file://`** (offline fixture) — `dev/bootstrap` falls
  back to the Node platform-proxy harness
  (`node scripts/dev/bootstrap-local.mjs`), because workerd cannot fetch
  `file://` URLs. The harness runs the same `syncStaticGtfs` /
  `generateStreetcarMap` module code, so the pipeline logic is identical — only
  the fetch runtime differs.

`make dev/bootstrap` re-runs the pipeline against a running stack any time
(like `make admin/sync` for prod). `make dev/new` drops and recreates local D1
from the same migrations, then `make dev` re-provisions.

If the site still errors after `make dev`:

1. **Confirm the API Worker owns 8787** (make dev pins it; only manual
   `npm run dev:map` / `dev:api` sessions can collide on the default port):

   ```bash
   curl -s localhost:8787/api/healthz   # must say "worker":"ttcstatus-api"
   ```

   If it says `ttcstatus-map-generator`, some other wrangler session owns
   8787 — kill it (`pkill -f wrangler`) and rerun `make dev`.

   A `404 {"error":"not-found"}` from `curl localhost:8787/api/v1/map/ttcstatus`
   almost always means you reached the **map-generator** Worker, whose catch-all
   404 answers everything outside its three routes.

2. **Re-run the pipeline** with `make dev/bootstrap` and read the JSON outcome —
   it is the same response `make admin/sync` returns in production.

3. **Verify**:

   ```bash
   curl -s localhost:8787/api/v1/map/ttcstatus -o /dev/null -w '%{http_code}\n'  # 200
   curl -s 'localhost:8787/api/v1/map/ttcstatus?tag=stable' -o /dev/null -w '%{http_code}\n'
   ```

The credential-free Vite preview (`npm run dev:viewer`, port 4173) serves
fixtures instead and never exercises D1 — use it to develop UI states without
provisioning anything.

### Production

Production depends on the nightly cron (`17 7 * * *` UTC) on the API Worker,
which runs the full download → import → generate → activate pipeline.

1. **Check the last sync outcome** — Workers Logs for the `ttcstatus-api`
   Worker, message `static GTFS sync result`.
2. **Re-run the pipeline** if the nightly failed (e.g. upstream GTFS outage):

   ```bash
   curl -X POST https://<api-host>/api/v1/admin/sync -H "Authorization: Bearer $SYNC_TOKEN"
   ```

   Unlike a `ctx.waitUntil` continuation, this endpoint answers with the real
   pipeline outcome, so import/generation failures are visible directly.

3. **Re-pin the stable tag** if the active artifact is broken and you want to
   roll back instead of regenerate:

   ```bash
   npm run map:tag -- list
   npm run map:tag -- set --name ttcstatus --tag stable --artifact <id>
   ```

4. **Regenerate a broken or missing artifact** — `npm run map:regenerate:remote` re-runs generation for the active network version directly against production D1 (and only reports `unchanged` when the complete published set — `streetcar` + `snake` + `ttcstatus` — is active, so it doubles as the prod repair path for published-set drift). The lower-level alternative is POSTing to the map-generator service (`/api/internal/generate`) with `{ "versionId": <id> }` and the admin token — the same thing the sync pipeline does after a successful import.
5. **Verify** with `curl -s https://ttcstatus.ca/api/v1/map/ttcstatus -o /dev/null -w '%{http_code}'` → `200`, and `jq .error` on any failure to identify which row of the catalogue above you are in.

If the site shows "Map temporarily unavailable while we perform track work" in
production, the pipeline is down: start at step 1. If it shows "being prepared",
a generation is running right now — give it a minute before investigating.
