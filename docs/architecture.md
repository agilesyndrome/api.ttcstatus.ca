# Architecture

## High level

One Cloudflare Worker, one React SPA, three storage tiers.

- **`ttcstatus-api` Worker** (single Worker — map generation is in-process):
  serves the React app (assets from `dist/`), the public JSON API
  (`/api/v1/*`), the members-only account surface, admin/debug endpoints,
  and the `lite` text-only status board (`/lite*`, in flight).
- **D1 `ttcstatus`**: network versions + imported GTFS rows, map artifacts
  (chunked) + stop directories, delivered-service rollups + SLA tables,
  accounts, feature flags.
- **R2**: `ttcstatus-static-gtfs` (source ZIP cache, current + previous only)
  and `ttcstatus-live` (public broadcast tick documents on
  `live.ttcstatus.ca`, world-readable, 7-day lifecycle).
- **`ServiceRecorder` Durable Object**: polls both live feeds every 30 s
  (`always` mode), keeps raw touch windows ~30 minutes in DO SQLite, folds
  5-minute rollups to D1 (36-hour retention), and publishes one immutable
  tick document per tick (`live/t/{tick}/vehicles.json` and
  `service-stops.json`).
- **Transport doctrine**: broadcast-only. Public fleet/service bytes are
  CDN-served immutable tick documents on a shared 30 s tick grid; no
  per-user requests, no Worker fallback route, no dual error contract.
  Device location never crosses the wire.
- **Crons**: `17 7 * * *` nightly static sync; `41 * * * *` hourly SLA fold
  (folds `service_rollups` into daily/weekly before 36-hour retention prunes).
- **Frontend**: React/Vite in `web/ui/` (map, fleet, journal, saved stops,
  Status panel, Replay, Snake), Clerk accounts (journal/saved stops/Status/
  Replay are signed-in only; map and transit APIs stay public), Storybook +
  Playwright checks, en-CA/fr-CA i18n.

## Medium level

### API surface

| Endpoint | Auth | Notes |
| -------- | ---- | ----- |
| `GET /api/v1/map/{streetcar\|snake\|ttcstatus}[?tag=]` | public | Immutable chunked artifacts; tag resolution: explicit tag (must exist) → `stable` tag → active pointer. ETag/304, edge-cached. |
| `GET /api/v1/manifest`, `GET /api/v1/stops` | public | Map + original-geography stop directory as matching immutable pairs (`X-Map-Artifact`/`X-Network-Version`). |
| `GET /api/v1/network`, `/api/v1/version`, `/api/healthz` | public | Pipeline metadata, deploy version. |
| `GET /api/v1/vehicles/streetcar` | public | Demand-driven snapshot; worker/POP cache shares acquisition, ETag/304, `503 vehicles-unavailable` on failure. |
| `live/t/{tick}/…` (live host) | public | Broadcast tick docs; 304 between ticks. No `/api/v1/service/stops` route exists. |
| `GET /api/v1/service/history` | public | Precomputed rollup reads; edge-cached by full URL. |
| `GET /api/v1/service/wave` | Clerk session | The members-only replay surface: verified session, `private`, never shared-cached. |
| `GET /api/v1/sla/report` | Clerk session | Precomputed daily/weekly compliance; `private` cache envelope. |
| `GET /api/v1/auth/config` | public | Clerk publishable key + live-host discovery at runtime. |
| `POST /api/v1/event` | public | Allowlisted analytics actions only. |
| `/api/v1/me/*`, `GET /api/v1/profiles/*` | Clerk / public | Journal, saved stops, colour mode; public badge profiles when opted in. |
| `POST /api/v1/admin/sync`, `GET /api/v1/feed/status`, debug render | `SYNC_TOKEN` | Full pipeline inline (~1 min on a changed feed). |
| `GET /api/v1/openapi.json` | public | OpenAPI 3.1 contract (`npm run build:contracts`). |

### Map pipeline (GTFS → artifact)

Nightly cron, `POST /api/v1/admin/sync`, and
`npm run map:regenerate:remote` all run the same code:

1. `HEAD` probe; conditional `GET` only when validators changed (7-day
   fallback if the source stops publishing them).
2. Stream ZIP into R2 (never buffered); parse via ranged reads.
3. Import streetcars + Lines 1, 2, 4, 5, 6 into versioned D1 rows
   (`version_id`); refuse incomplete imports.
4. In-process mapgen (`workers/api/src/mapgen/`): D1 source → WGS84 → local
   metres → topology → schematic layout (16° grid rotation, downtown
   compression) → artifacts.
5. Store artifacts chunked in D1, then atomically activate version +
   artifacts (streetcar / snake / ttcstatus names).
6. Retention: keep current + immediately-previous versions, artifacts, and
   raw ZIPs; `feed_change_events` keeps compact history.

### Live pipeline

`ServiceRecorder` (30 s alarm) → coalesced upstream acquisition → DO SQL
windows → 5-minute fold to `service_rollups` → immutable tick documents to
`LIVE_BUCKET`. Browsers join the shared tick grid from their own clock and
advance the field locally between ticks. Overlay for every visitor is
gated by the `OVERLAY_ENABLED` var, not a feature-flag row.

### Accounts

Clerk-verified bearer token → ownership by `user_id` → revision-checked
(CAS) writes for journals and saved stops with defined 409 merge rules.

### Quality gates

`./pre-flight` (configured by `security.json`): gitleaks (tree + history),
module boundaries, typecheck, lint, format, unit tests, builds. `npm run ci`
= pre-flight + Storybook build + `wrangler deploy --dry-run` — the Cloudflare
deploy gate. Deploy command `npm run deploy:api` applies D1 migrations first.

## File layout

Full walkthrough: [CODEMAP.md](../CODEMAP.md).

```
workers/api/src/     http/ router+CORS · accounts/ Clerk+owned data ·
                     maps/ artifacts · realtime/ snapshot distribution ·
                     service/ recorder (core, DO, windows, folds) ·
                     sla/ hourly folds + report · sync/ static import ·
                     mapgen/ in-process generator (source, topology,
                     layout, rendering, artifacts) · lite/ text board ·
                     contracts/ OpenAPI · diagnostics/
shared/              map/ projection+palette · live/ snapshot contracts,
                     polling, replay tick · service/ contracts+SLA math ·
                     accounts/ journal/badges validation · transit/
                     device-only nearby lookup · contracts/ http/
web/ui/              pages/ · features/ (map, accounts, stops, fleet,
                     journal, export, service, sla, replay, snake) ·
                     components/ · services/ platform adapters
                     (browser/capacitor), http, navigation, cache ·
                     styles/ (cascade-ordered)
scripts/             dev/ (dev-stack, with-secrets, headers) · checks/ ·
                     preflight/ · operations/ (map regen, tags, flags) ·
                     preview/ · build/
migrations/          0001–0011, applied by deploy before shipping
```

## Caveats that will burn you

- There is no second Worker: `mapgen/` runs in-process, `wrangler.jsonc`
  has no service bindings. Don't re-split casually.
- `POST /api/v1/admin/sync` is synchronous. An interrupted changed-feed run
  leaves the work to the nightly cron.
- Deploys do not rebuild maps. After generator changes:
  `npm run build:api && npm run deploy:api && npm run map:regenerate:remote`.
- D1 rows cap at 2 MB — map artifacts and stop directories are chunked by
  design. Never store a big payload in one row.
- `workers_dev` is `false`; production traffic must reach the
  `ttcstatus.ca` zone or it bypasses the WAF.
- Live bucket lifecycle is 7 days = Replay's horizon. `service_rollups`
  retention is 36 h; if the hourly fold cron doesn't run, that day is gone.
- `/__scheduled` exists only under `wrangler dev --test-scheduled`;
  `make sla/fold` nudges the hourly fold locally.
- Map generation requires a changed feed or an explicit regenerate; a
  normal deploy with an unchanged feed ships no new map.
