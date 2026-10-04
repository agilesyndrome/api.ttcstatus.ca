# Code map

Follow an operation from its entrypoint to its storage or rendering boundary.
Each application owns its side effects; shared modules contain contracts and pure
calculations. Public HTTP paths and persisted schemas are independent of these
source file locations.

## API Worker

`workers/api/src/index.ts` supplies the HTTP and scheduled entrypoints.
`http/router.ts` dispatches existing API paths without importing GTFS data itself.

| Directory      | Responsibility                                                                 |
| -------------- | ------------------------------------------------------------------------------ |
| `http/`        | Routing and public/private JSON response helpers                               |
| `accounts/`    | Clerk authentication, bounded JSON input, owned journal and profile operations |
| `maps/`        | Map/network reads, map caching and protected debug forwarding                  |
| `realtime/`    | Bounded vehicle acquisition, decoding, snapshot cache and HTTP response        |
| `sync/`        | Static download, import, map generation, delta, publication and retention      |
| `diagnostics/` | Existing public feed-status response                                           |

Only `sync/sync.ts` contacts the static GTFS source. Import reads the cached R2
archive. Public map requests read materialized data; live requests use the bounded
snapshot acquisition and cache. Account ownership comes from verified sessions,
never request fields.

## Map generator

`workers/map-generator/src/index.ts` handles the internal service binding and
protected debug rendering. `generate.ts` orchestrates load → build → persist.

| Directory    | Responsibility                                                      |
| ------------ | ------------------------------------------------------------------- |
| `source/`    | D1 reads, audited physical tracks, shoreline and service selection  |
| `topology/`  | Canonical track graph, shared corridors and traversals              |
| `layout/`    | Public map bundle construction                                      |
| `rendering/` | Debug contracts, runtime validation, label placement and SVG markup |
| `artifacts/` | Artifact hashing, chunking and persistence                          |

Canonical GTFS geometry stays separate from schematic display geometry. Ordinary
geometric crossings do not establish track junctions. The generator version and
map schema are unchanged by source reorganization.

## Shared modules

| Directory                    | Responsibility                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `shared/accounts/`           | Journal validation, backup/merge rules, badges and username validation            |
| `shared/map/`                | Coordinates, projection, camera math, viewer model, vehicle placement and palette |
| `shared/live/`               | Snapshot contracts, freshness, cadence and browser polling                        |
| `shared/http/`               | HTTP validator comparison                                                         |
| `workers/shared/cloudflare/` | Narrow Cloudflare binding interfaces                                              |
| `workers/shared/gtfs/`       | ZIP, CSV, feed parsing, canonical records and input budgets                       |
| `workers/shared/http/`       | Bounded byte streams and admin authorization                                      |

`shared/` imports neither application. Workers never import browser implementation
files, and browser modules never import Worker implementation files. Run
`npm run check:boundaries` to enforce these rules.

## Browser applications

`web/ui/pages/` composes pages. `features/map/useHomeWorkspace.ts` owns the main
workspace state and transitions; `HomeWorkspace.tsx` lays out the map and overlays,
and `HomeSidebar.tsx` composes tool panels. `useStaticMap.ts` owns public map loading.

`web/ui/features/` groups map, accounts, stops, fleet, comparison, journal, export
and Snake code with its component stories. `components/` contains shared page
chrome; `hooks/` contains preferences, theme and shortcuts. `styles/` contains the
homepage stylesheet.

`TransitMap.tsx` renders the interactive map. `useMapCamera.ts` owns resize,
selection focus, gestures and camera controls. `TrackLayer.tsx` renders fixed
tracks. Frozen export state belongs to `features/export/useMapExport.ts`.

`web/map/` remains the standalone viewer. Its `rendering/` directory contains DOM
helpers and label placement. Both viewers use shared map calculations.

`public/snake/v1/` is the archived game. Its game code and artwork stay intact.

## Scripts, tests and artifacts

| Directory             | Responsibility                                                         |
| --------------------- | ---------------------------------------------------------------------- |
| `scripts/build/`      | Standalone viewer build                                                |
| `scripts/preview/`    | Local API/viewer adapters and browser authentication fixture           |
| `scripts/checks/`     | Browser checks, source credential scan and import-boundary checks      |
| `scripts/operations/` | Explicit production map regeneration command                           |
| `tests/`              | Tests grouped by operation, with shared compilation and SQLite helpers |
| `data/fixtures/`      | Unchanged reference map bundles                                        |
| `dist/`               | Generated homepage, viewer and deployment assets; ignored by Git       |

The browser authentication fixture replaces only the SDK/session interface;
separate server tests verify real signed tokens and reject tampering. SQLite-backed
integration tests exercise ownership, revisions, locks, publication and retention.
Test compilation uses disposable temporary directories outside the checkout.

Preview commands write new artifacts to `dist/`, preserving source fixtures.
Vite copies static assets from `public/` into `dist/`; the viewer build adds
`dist/map/index.html`. The API Wrangler configuration serves that output directory.
Run `npm run build:api` before deployment.

The historical design and topology roadmap remain in [ARCHITECTURE.md](ARCHITECTURE.md).
