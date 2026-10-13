# Code map

Follow an operation from its entrypoint to its storage or rendering boundary.
Each application owns its side effects; shared modules contain contracts and pure
calculations. Public HTTP paths and persisted schemas are independent of these
source file locations.

## API Worker

`workers/api/src/index.ts` supplies the HTTP and scheduled entrypoints.
`http/router.ts` dispatches existing API paths without importing GTFS data itself.

| Directory      | Responsibility                                                                            |
| -------------- | ----------------------------------------------------------------------------------------- |
| `http/`        | Routing, input privacy boundary and consistent CORS response helpers                      |
| `accounts/`    | Clerk authentication, bounded JSON input, owned journal and profile operations            |
| `maps/`        | Artifact selection, map/directory reads, release manifests and protected debug forwarding |
| `realtime/`    | Bounded upstream decoding and vehicle HTTP distribution; acquisition owned by recorder    |
| `service/`     | Delivered-service recorder: pure core, DO shell, window store, folds, endpoints           |
| `sla/`         | SLA status page: hourly Tier 3 folds (daily/weekly) and the precomputed report            |
| `sync/`        | Static download, import, map generation, delta, publication and retention                 |
| `mapgen/`      | In-process map generation (Epic 7): source reads, topology, layout, rendering, artifacts  |
| `contracts/`   | Public OpenAPI document and endpoint descriptions                                         |
| `diagnostics/` | Protected feed diagnostics, allowlisted analytics and deployed-version reporting          |

Only `sync/sync.ts` contacts the static GTFS source. Import reads the cached R2
archive. Public map requests read materialized data; live requests use the bounded
recorder's persisted singleton publication and POP cache. Account ownership comes from verified sessions,
never request fields.

## Map generator (in-process, Epic 7)

The map generator is no longer a second Worker: `workers/api/src/mapgen/`
holds the generator core (`generate.ts` orchestrating load → build → persist,
plus `source/`, `topology/`, `layout/`, `rendering/`, `artifacts/`) and the
sync pipeline and the admin debug route call it as typed functions. The
directory stays self-contained so a future Queues/Workflows offload (or a
re-split) stays mechanical. The old generator's HTTP shell (`healthz`, the
auth glue, the JSON envelope parsing) was deleted with the worker.

Canonical GTFS geometry stays separate from schematic display geometry. Ordinary
geometric crossings do not establish track junctions. The generator version and
map schema are unchanged by source reorganization.

## Shared modules

| Directory                    | Responsibility                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `shared/accounts/`           | Journal validation, backup/merge rules, badges and username validation            |
| `shared/map/`                | Coordinates, projection, camera math, viewer model, vehicle placement and palette |
| `shared/live/`               | Snapshot contracts, freshness, cadence and browser polling                        |
| `shared/service/`            | Delivered-service contracts, config, pure wait metrics, SLA math and the corpus   |
| `shared/transit/`            | Device-only proximity grid, original boarding geography and transit helpers       |
| `shared/contracts/`          | Versioned JSON response/input schemas for OpenAPI                                 |
| `shared/http/`               | HTTP validators and the location-free query contract                              |
| `workers/shared/cloudflare/` | Narrow Cloudflare binding interfaces                                              |
| `workers/shared/gtfs/`       | ZIP, CSV, feed parsing, schedule materials, SLA target derivation, budgets        |
| `workers/shared/http/`       | Bounded byte streams and admin authorization                                      |

`shared/` imports neither application. Workers never import browser implementation
files, and browser modules never import Worker implementation files. Run
`npm run check:boundaries` to enforce these rules.

## Browser applications

`web/ui/pages/` composes pages. `features/map/useHomeWorkspace.ts` composes focused
selection, location, saved-stop and link owners in `workspace/`; `HomeWorkspace.tsx` lays out the map and overlays,
and `HomeSidebar.tsx` composes tool panels. `useStaticMap.ts` owns public map loading.

`web/ui/features/` groups map, accounts, stops, fleet, comparison, journal, export,
service (delivered-service overlay) and sla (the /sla status page), and Snake code
with its component stories. `components/` contains shared page chrome; `hooks/`
contains preferences, viewport, theme and shortcuts. `styles/` contains shell,
mobile, game, and feature styles imported in cascade order.

`features/sla/` is the non-map SLA status page: `useSlaReport.ts` (one cached
fetch per session, plus the per-route stop detail), the pure view helpers in
`sla-view.ts`, and the tick-strip components. Every daily/weekly number comes
from `GET /api/v1/sla/report`; the page never computes or polls. The live
tier (`sla-live.ts` + `useSlaLive.ts`) polls the public stops tick documents
(30 s) and the session-gated `/service/wave` (5 min) surfaces and renders the
last 30 minutes as thin 5-minute slivers at each strip's right edge — the
sliver math runs in the browser, never at request time.

`TransitMap.tsx` renders the interactive map. `useMapCamera.ts` owns resize,
selection focus, gestures and camera controls. `TrackLayer.tsx` renders fixed
tracks. Frozen export state belongs to `features/export/useMapExport.ts`.

`web/map/` remains the standalone viewer. Its `rendering/` directory contains DOM
helpers and label placement. Both viewers use shared map calculations.

`public/snake/v1/` is the archived game. Its game code and artwork stay intact.

## Scripts, tests and artifacts

| Directory             | Responsibility                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| `scripts/build/`      | Standalone viewer build                                                 |
| `scripts/preview/`    | Local API/viewer adapters and browser authentication fixture            |
| `scripts/checks/`     | Browser checks and the import-boundary check                            |
| `scripts/preflight/`  | `./pre-flight` board: config, renderer, runner and gitleaks integration |
| `scripts/operations/` | Explicit production map regeneration and named-map tag publishing       |
| `tests/`              | Tests grouped by operation, with shared compilation and SQLite helpers  |
| `data/fixtures/`      | Unchanged reference map bundles                                         |
| `dist/`               | Generated homepage, viewer and deployment assets; ignored by Git        |

The browser authentication fixture replaces only the SDK/session interface;
separate server tests verify real signed tokens and reject tampering. SQLite-backed
integration tests exercise ownership, revisions, locks, publication and retention.
Test compilation uses disposable temporary directories outside the checkout.

Preview commands write new artifacts to `dist/`, preserving source fixtures.
Vite copies static assets from `public/` into `dist/`; the viewer build adds
`dist/map/index.html`. The API Wrangler configuration serves that output directory.
Run `npm run build:api` before deployment.

The historical design and topology roadmap remain in [ARCHITECTURE.md](ARCHITECTURE.md).

## UI platform services

`web/ui/services/` owns platform adapters, configured HTTP transport, navigation,
and durable cache mechanics. Feature components never import native plugins,
call fetch directly, or access localStorage. `docs/ui-platform.md` documents the
ports, native build configuration, offline behavior, and validation commands.

`App.tsx` retains the map screen across client-side page changes and marks inactive
screens so feed owners stop acquisition. Phone menu content and selection details
are separate presentations of the existing features. `shared/transit/` owns pure
transit calculations and map-link contracts; locale formatting remains in the UI.
