# api.ttcstatus.ca

Cloudflare Workers + D1 + R2 backend for TTCstatus.

The first implementation focuses on the static streetcar network. A scheduled Worker checks the TTC Surface GTFS source nightly, downloads it **only when the source changes**, imports the streetcar subset into D1, invokes a separate map-generator Worker, and publishes a precomputed `snake-v1` map artifact for fast API reads.

## Architecture in this revision

### API / static-import Worker

`workers/api`

Responsibilities:

- Cron-triggered source check at `07:17 UTC` daily.
- `HEAD` probe first, so the normal nightly request is metadata-only.
- Conditional `GET` with `If-None-Match` / `If-Modified-Since` when a download may be required.
- Seven-day conservative fallback before a full fetch if the source ever stops publishing useful validators.
- Streams the source ZIP directly into R2 rather than buffering it in Worker memory.
- Reads individual ZIP entries from R2 using ranged reads and streaming `deflate-raw` decompression.
- Imports only `route_type=0` streetcar data into versioned D1 rows.
- Refuses to activate obviously incomplete imports.
- Calls the map-generator Worker only when a new static feed was actually imported.
- Activates the new network only after map generation succeeds.
- Deletes superseded raw R2 ZIPs and old canonical rows after successful activation.
- Retains lightweight version/change summaries instead of raw nightly snapshots.

### Map-generator Worker

`workers/map-generator`

Responsibilities:

- Runs only when the importer detects a changed static feed.
- Reads the new version from D1.
- Projects WGS84 TTC geometry into local metre-like coordinates.
- Simplifies shapes with RDP while preserving endpoints.
- Retains GTFS shape IDs and directed edge references while deduplicating shared corridor segments.
- Rotates Toronto's street grid 16 degrees upright and continuously compresses the outer network to give downtown more display space.
- Generates geographic stop clusters for display while keeping source stop IDs.
- Adds manually-audited infrastructure overlays that GTFS cannot describe when no scheduled trip uses them.
- Writes the complete JSON map artifact back to D1 before the version can become active.

The `snake-v1.3.0` generator provides one schematic layout for paths, graph nodes,
stops and geographic context. It retains simplified source geometry in local
metres, edge lengths and distance mappings so display distortion need not change
game speed. The graph is inferred from scheduled shapes and the audited overlays;
it is not a complete inventory of physical track or permitted switches. Mere
line crossings do not become junctions without a nearby source vertex. Full
topology enrichment remains described in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

Explicitly labelled replacement-bus patterns are excluded from the rail graph,
with their original IDs and headsigns retained in `excludedServices`. A streetcar
route ID alone does not prove that a shape follows tracks. Versioned physical
overlays restore Bathurst/Vaughan's St. Clair connection, western St. Clair,
Lake Shore to Long Branch through the Humber tunnel, and Kingston Road to Bingham
when the feed does not schedule streetcars there. These use the TTC track-network
reference, mapped OpenStreetMap rail and, for two intervening corridors, approximate
City of Toronto road centrelines. Source notes and licences are in
`workers/map-generator/src/physical-tracks.json`. Database overlays with matching
IDs take precedence over the bundled defaults.

Detailed physical Queens Quay geometry also supplies bends missing from coarse
scheduled shapes. Matching 509/510/310 segments within 55 metres are aligned to
that corridor; their original projected GTFS vertices remain in `gtfsSourcePoints`.
The inferred graph's distances follow the physical alignment.

The debug SVG draws shared edges once, uses distinct schematic route colours,
labels major streets and terminals, and includes a City of Toronto mainland
shoreline and north arrow. The shoreline is simplified in metres and uses the
same continuous display transform as rail. A shared edge shows one daytime route colour; its tooltip lists all
services on it. Geographic context labels are approximate and separate from
service/track data. Inline route numbers identify visible corridors, overnight
variants use their daytime route colours, and dashed grey indicates physical
track without scheduled streetcar service.

Generate a local preview without credentials, D1, deployment or feed downloads:

```bash
npm run map:preview
npm run typecheck
npm test
```

This reads `streetcarmap.json`, writes `streetcar-schematic.json`, and refreshes
`streetcar-debug.svg`. It preserves the input map. For the legacy v1.0.1 fixture,
the preview recovers approximate metre coordinates from the audited Ossington
overlay because that format omitted its geographic display transform. Production
generation uses D1 source coordinates directly. Optional positional arguments are
input JSON, output JSON, output SVG. An older schematic with retained source
geometry is rebuilt through the current generator rather than displayed unchanged.

Download the current published JSON, render it locally, and open it in your
default browser with one command (run `npm install` first):

```bash
make map/debug
```

This saves the API response as `streetcarmap.json`, generates
`streetcar-schematic.json` and `streetcar-debug.svg`, and opens a local
`streetcar-debug.html` wrapper so SVG file associations cannot send the preview
to an image editor. Rendering uses the same code as the map-generator Worker;
there is no JSON re-upload, sync, or debug token required. The JSON endpoint
returns the pre-generated map; this command does not regenerate the production
artifact from GTFS. Failed downloads stop the command and preserve the previous
input file.

Use `make map/streetcar/svg` to render an existing `streetcarmap.json` without
downloading again. Set `API_HOST` to select another API, or `MAP_OPEN` to a browser
opener executable (for example, `MAP_OPEN=echo make map/debug` to print the preview
URL in a headless environment). The browser wrapper fits the entire map and
legend into the viewport, with zoom buttons, drag-to-pan and a Fit map button.

See [the SnakeTTC map contract](./docs/snakettc-map-contract.md) for gameplay and
distance mapping. SnakeTTC currently uses its own hand-built graph; consuming this
bundle requires a game-side adapter.

For a file-by-file reviewer guide, see [`CODEMAP.md`](./CODEMAP.md).

## Data citizenship

The importer is deliberately stingy with Toronto Open Data bandwidth.

1. It checks the source once per night, at an off-minute rather than the top of an hour.
2. It performs a `HEAD` request first.
3. Matching ETag / Last-Modified validators mean **no ZIP download**.
4. When a download is needed, it sends conditional request headers.
5. The raw ZIP is streamed once into R2 and all parsing happens from that local copy.
6. At steady state R2 stores **at most the current and immediately-previous changed ZIP**, not one snapshot per night. This gives us cheap rollback/diff reproducibility without accumulating raw history.
7. Historical tracking is stored as compact D1 metadata/change summaries instead of duplicated raw feeds.

The source URL is the TTC Surface GTFS resource published through Toronto Open Data and paired with the TTC GTFS-Realtime surface feed.

Attribution included in generated API artifacts:

> Contains information licensed under the Open Government Licence - Toronto

## Why R2 + D1

**R2** is the source-file cache. It keeps the expensive ZIP local to Cloudflare while an import is in progress and preserves only the current and immediately-previous changed source artifacts for reproducibility and safe rollback.

**D1** stores the structured streetcar network and the final generated map. The API does not parse GTFS on user requests.

D1 has a 2 MB maximum row size, so generated maps are stored as ordered chunks. This keeps each row comfortably below the limit while still allowing the API Worker to reconstruct a map with only a handful of indexed D1 row reads. The resulting immutable network-version response is also placed in the Workers Cache API at the edge.

## Infrastructure overlays

The initial migration includes one intentionally non-GTFS streetcar segment:

- Ossington Avenue between Dundas and College — `kind=diversion`, `scheduled_service=false`.

This exists because static GTFS describes **scheduled service**, not every piece of physical streetcar track. Infrastructure overlays remain separate and auditable rather than being disguised as scheduled GTFS geometry.

The map generator also carries the versioned physical corridors described above,
so previews and production generation share the same topology even before a
database overlay has been added. None of those corridors invents passenger
service or directed turn permissions.

## Public API

### `GET /healthz`

Worker health check.

### `GET /v1/map/streetcar`

Returns the complete pre-generated `snake-v1` streetcar map JSON.

The response includes:

- network version
- source metadata / attribution
- fixed display dimensions
- routes
- simplified display paths
- infrastructure-only segments
- deduplicated geographic stop clusters

The endpoint supports `ETag` / `If-None-Match` and is cached by immutable network version at the edge.

### `GET /v1/network`

Returns active network version metadata and import counts.

### `GET /v1/vehicles/streetcar`

Returns one normalized TTC GTFS-Realtime vehicle snapshot: `schemaVersion`,
`fetchedAt`, `feedTimestamp`, source/attribution, `invalidPositions`, and `vehicles`.
Each Flexity observation includes its identity, latitude/longitude, observation
time, and route/trip/bearing/speed when supplied. Coordinates remain independent
of the static network version; the viewer projects against its own map artifact.
The Worker caches successful snapshots at the edge for 15 seconds and returns
an uncached `503 vehicles-unavailable` on acquisition/decoding failure. Configure
`REALTIME_VEHICLE_URL` to override `https://bustime.ttc.ca/gtfsrt/vehicles`.

### `GET /v1/feed/status`

Operational source/import status. This endpoint is intentionally `no-store`.

### `POST /v1/debug/map/streetcar.svg` (debug endpoint)

Renders a previously generated `streetcarmap.json` bundle as standalone SVG.
The authenticated API proxy forwards the JSON to the map-generator debug
renderer; it does not read D1, fetch GTFS, or invoke the sync pipeline. The
request body is the map JSON and requires `Authorization: Bearer <SYNC_TOKEN>`.
The endpoint is disabled with `404` until `SYNC_TOKEN` is configured on both
Workers, and accepts bundles up to 2 MB.

For remote rendering of a custom JSON bundle (the local Make targets do not
need this endpoint):

```bash
curl -sS -X POST https://api.ttcstatus.ca/v1/debug/map/streetcar.svg \
  -H "Authorization: Bearer $SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @streetcarmap.json > streetcar-debug.svg
```

### `POST /v1/admin/sync`

Optional manual sync endpoint. It is only enabled when a `SYNC_TOKEN` Worker secret exists and requires:

`Authorization: Bearer <SYNC_TOKEN>`

The endpoint returns `202 Accepted` after scheduling the sync in the background. Check `/v1/feed/status` for import or map-generation errors and `/v1/map/streetcar` once the active artifact is ready.

Convenience commands (admin commands read `.env` through 1Password CLI;
map commands use the public endpoint without credentials):

```bash
make admin/sync
make map/streetcar
```

The Cron Trigger is the normal production path.

## Provisioning

### Cloudflare deploy configuration

This repository contains two Workers, so configure two Cloudflare Workers Builds projects
from the same repository:

- API project: root directory `/`, build command `npm run build:api`, deploy command
  `npx wrangler deploy -c workers/api/wrangler.jsonc`
- Map project: root directory `/`, build command `npm run build:map`, deploy command
  `npx wrangler deploy -c workers/map-generator/wrangler.jsonc`

Deploy the map project before the API project because the API uses a Service Binding to it.
Both projects must have the same D1 database bound to the `DB` binding. Replace
`REPLACE_WITH_D1_DATABASE_ID` in both Wrangler configurations before the first deploy;
Wrangler cannot deploy a remote D1 binding with that placeholder.

Enter the Cloudflare build and deploy commands without Markdown backticks. For the
map project, use these literal values:

```text
Build command: npm run build:map
Deploy command: npx wrangler deploy -c workers/map-generator/wrangler.jsonc
```

The static import is intentionally a background production job and requires a **Workers Paid** plan so the API and map-generator Workers can use the configured CPU budget. Normal API reads remain lightweight because they never parse GTFS.

Create one D1 database and one R2 bucket:

```bash
npx wrangler d1 create ttcstatus
npx wrangler r2 bucket create ttcstatus-static-gtfs
```

Put the returned D1 database ID into both:

- `workers/api/wrangler.jsonc`
- `workers/map-generator/wrangler.jsonc`

replacing `REPLACE_WITH_D1_DATABASE_ID`.

Install dependencies and apply the migration:

```bash
npm install
npm run db:migrate:remote
```

Optional manual-sync secret:

```bash
npx wrangler secret put SYNC_TOKEN -c workers/api/wrangler.jsonc
```

The map-generator debug renderer uses the same secret name independently:

```bash
npx wrangler secret put SYNC_TOKEN -c workers/map-generator/wrangler.jsonc
```

Deploy the map generator first because the API Worker has a Service Binding to it:

```bash
npm run deploy:map
npm run deploy:api
```

## Local development

Preview the interactive map with real streetcar positions, without credentials
or a D1 import:

```bash
npm run dev:viewer
```

Open `http://127.0.0.1:4173/map/` and check **Show live status**. Each page load
requests one snapshot; toggling the checkbox reuses it. Reload for a new snapshot.
The local server uses the same TTC acquisition and decoder as the API Worker,
with a 15-second shared cache to avoid a feed request for every viewer. Set `PORT`
to change the preview port. Restart the server after editing source files.

The feed reports Flexity cars numbered 4400–4663, including those without assigned
trips. Replacement buses are excluded by vehicle identity. Stale observations
(over two minutes old, unknown time, or a future time) are faded. Cars farther
than 100 metres from known rail use geographic placement and are labelled **Off
mapped track**; yards and missing physical corridors must not be mistaken for
scheduled rail. The viewer shows counts, the snapshot time, vehicle details, and
a failure message if the feed is unavailable. Cars have five articulated sections
with exaggerated length for readability; the cab marks the reported position.

`workers/shared/map-projection.ts` is the reusable GPS bridge, shared by the
generator and viewer and usable in a future streaming Worker. The map serializes
its complete geographic transform (including projection reference, rotation,
compression, and display scale). `gpsToMap` / `mapToGps` support free geographic
locations such as a person's position. `matchGpsToTrack` operates in source metres,
uses route and bearing hints, then interpolates the retained edge distance mapping.
It accepts a previous edge for future continuity; it never matches in display
pixels or treats a geometric crossing as a graph connection. Matching is an
estimate against the inferred, simplified graph rather than surveyed track.

Transport and decoding live in `workers/api/src/realtime.ts`; the plain observation
contract lives in `workers/shared/live-vehicles.ts`; snapshot projection and body
placement live in `web/map/live-status.ts`. No live history is written to D1/R2.
Streaming acquisition can later replace the snapshot transport while reusing
these models and projection functions. The current phase does not infer a trip
pattern or direction when the source omits them.

Apply the local D1 migration:

```bash
npm run db:migrate:local
```

Run the two Workers in separate terminals:

```bash
npm run dev:map
```

```bash
npm run dev:api
```

Wrangler can exercise the scheduled handler locally using its scheduled test route.

## Storage lifecycle

For each actual source change:

1. New ZIP is streamed to `gtfs/versions/<uuid>.zip` in R2.
2. New streetcar rows are imported under a new `version_id` in D1.
3. Map generator writes `snake-v1` artifact chunks for that version.
4. The source pointer flips to the new active version.
5. Current + immediately-previous canonical rows/map artifacts are retained; older materialized rows are removed.
6. Current + immediately-previous changed raw ZIPs are retained in R2; older raw source objects are deleted.
7. `network_versions` and `feed_change_events` keep compact long-term change history.

This intentionally avoids the expensive pattern of preserving complete raw daily snapshots.

## Next geometry work

The v1 generator establishes the important separation between canonical GTFS geometry and generated display geometry. The next map-generator iterations can add the deeper rules already captured in `ARCHITECTURE.md`, including:

- protected topology anchors
- physical corridor graph extraction
- route-pattern normalization
- canonical edge / display edge linear referencing
- topology-preserving simplification
- constrained heading optimization
- terminal-loop treatment
- better crossing-vs-junction semantics
- trip-pattern matching and temporal continuity for streamed vehicle projection
- automated route-connectivity regression tests

Those changes can happen inside the map-generator Worker without changing the public API contract.
