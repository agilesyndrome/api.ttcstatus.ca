# Code Map

A reviewer should be able to understand this project by following one concern at a time. The file boundaries below are intentional architecture boundaries, not just organization for organization’s sake.

## API Worker — `workers/api/src/`

| File | Responsibility |
| --- | --- |
| `index.ts` | HTTP routing, CORS, map response caching, health/status endpoints. It never parses GTFS. |
| `realtime.ts` | Bounded TTC vehicle snapshot acquisition, standard protobuf decoding, Flexity filtering and observation normalization. |
| `vehicle-snapshot-cache.ts` | Demand-driven snapshot cache, concurrent acquisition sharing, ETags and failure cooldown. Reused by the local preview. |
| `sync.ts` | **Only place that talks to the upstream static feed.** HEAD/conditional GET checks, R2 caching, and source politeness live here. |
| `sync-common.ts` | Sync state, source validators, locking, version records, bounded D1 batches. |
| `sync-pipeline.ts` | Tiny orchestration state machine: import → map generation → delta → activation → pruning. |
| `import-version.ts` | Reads the already-cached R2 ZIP, validates the streetcar subset, and writes normalized D1 rows. |
| `feed-delta.ts` | Computes/stores compact changes between static versions. |
| `network-lifecycle.ts` | Calls the map Worker, activates successful versions, and enforces retention. |

The important review boundary is: **only `sync.ts` may fetch TTC static GTFS from the network**. Parsing receives an R2-backed archive. This makes accidental repeated upstream downloads difficult to introduce.

## Map Worker — `workers/map-generator/src/`

| File | Responsibility |
| --- | --- |
| `index.ts` | Internal Service Binding endpoint. |
| `generate.ts` | Tiny orchestration: load → build → persist. |
| `repository.ts` | Reads one normalized network version from D1. |
| `build-map.ts` | Converts canonical network data into the public Snake map bundle. No persistence. |
| `geometry.ts` | Projection, distance, simplification, bounds, and display transforms. No database or HTTP concerns. |
| `artifact-store.ts` | Hashes, chunks, and persists the completed map artifact in D1. |
| `config.ts` | Deterministic map-format/generator constants. |
| `types.ts` | D1 row and map-generator domain types. |

This is preparation for the topology-aware schematic generator in `ARCHITECTURE.md`: geometry can evolve without rewriting ingestion, caching, or API serving.

## Shared — `workers/shared/`

| File | Responsibility |
| --- | --- |
| `gtfs.ts` | Streetcar-only GTFS normalization; no upstream network I/O. |
| `zip.ts` | R2 ranged ZIP access and member decompression. |
| `csv.ts` | CSV parsing helpers. |
| `hash.ts` | Stable hashes for normalized rows and artifacts. |
| `models.ts` | Canonical parsed GTFS types. |
| `cloudflare.ts` | Narrow Cloudflare binding interfaces. |
| `map-projection.ts` | Serialized geographic transform, GPS/map conversion, source-distance interpolation and track matching. Shared with the generator and browser. |
| `live-vehicles.ts` | Map-independent vehicle/snapshot contract and freshness policy. |
| `live-config.ts` | Default interval and validation for the runtime `REALTIME_UPDATE_SECONDS` setting. |

## Interactive viewer — `web/map/`

| File | Responsibility |
| --- | --- |
| `model.ts` | Builds viewer data, preserving the map's source geometry and transform. |
| `live-status.ts` | Pure snapshot projection and articulated streetcar placement, with previous-edge continuity. |
| `live-updates.ts` | HTTP/ETag acquisition and cancellable, non-overlapping polling with server cadence, timeout and backoff. |
| `viewer.ts` | Map rendering, camera interactions, stops, routes and optional live status. |
| `camera.ts` | Pure camera bounds/zoom/pan helpers. |

`scripts/dev-viewer.mjs` retains the standalone HTML preview.
`scripts/preview-api.mjs` adapts the real snapshot acquisition module for the
React Vite preview. `scripts/build-viewer.mjs` embeds static map data
and the browser bundle; observations are requested at startup and refreshed while
the live layer is enabled, visible, and online.

## React homepage — `web/ui/`

| File | Responsibility |
| --- | --- |
| `pages/HomePage.tsx` | Loads the API map; owns filters, selection and the shared feed. |
| `hooks/useVehicleFeed.ts` | One cancellable poller; visibility/connectivity lifecycle and snapshot state. |
| `components/TransitMap.tsx` | SVG geometry, articulated vehicles, pan/pinch/zoom and keyboard selection. |
| `components/PageHeader.tsx` | Branding and stop/route search. |
| `components/MapFilters.tsx` | Controlled live/label/overnight layer checkboxes. |
| `components/RouteLegend.tsx` | Route highlighting and physical-track legend. |
| `components/LiveFeedStatus.tsx` | Loading, paused, stale and failed feed presentation. |
| `components/StopDetails.tsx` | Stop and vehicle facts. |
| `components/PageFooter.tsx` | Map context and source attribution. |
| `stories/` | Local fixtures, component variants and interaction checks. |

`vite.config.mjs` builds homepage assets into `public/` and mounts the local API
adapter only during development. `.storybook/` uses an independent Vite config
so component stories never start the TTC acquisition adapter. Production Worker
routing reserves `/api/*` for JSON/API responses and serves `/` from UI assets.

## Review invariants

Future changes should preserve these rules:

1. Public map/network reads never contact the TTC static feed. Vehicle snapshot requests use a short edge cache and bounded acquisition; they do not import static GTFS.
2. Static source access occurs only at the sync boundary and remains conditional/cached.
3. A downloaded source is parsed from R2, not fetched repeatedly from upstream.
4. A network does not become active until its map artifact is generated successfully.
5. Canonical GTFS data and display geometry remain separate.
6. Physical infrastructure missing from scheduled GTFS is explicit in `infrastructure_overlays`.
7. Old raw ZIPs are bounded by retention policy rather than accumulating nightly.
8. Geometry functions remain free of D1/HTTP concerns so topology work stays reviewable.
