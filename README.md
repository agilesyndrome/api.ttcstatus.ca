# api.ttcstatus.ca

Cloudflare Workers + D1 + R2 backend for TTCstatus.

Clerk sign-up/login, protected account Journals, and opt-in public badge profiles
are implemented. See [Clerk setup](docs/clerk-setup.md) for the two required
Cloudflare bindings, the D1 migration, local development, and activation steps.
The TTC status map and transit APIs remain available without signing in.

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

### `GET /api/healthz`

Worker health check.

### `GET /api/v1/map/streetcar`

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

### `GET /api/v1/network`

Returns active network version metadata and import counts.

### `GET /api/v1/vehicles/streetcar`

Returns one normalized TTC GTFS-Realtime vehicle snapshot: `schemaVersion`,
`fetchedAt`, `feedTimestamp`, source/attribution, `invalidPositions`, and `vehicles`.
Each Flexity observation includes its identity, latitude/longitude, observation
time, and route/trip/bearing/speed when supplied. Coordinates remain independent
of the static network version; the viewer projects against its own map artifact.
The Worker caches successful snapshots for `REALTIME_UPDATE_SECONDS` (default
`30`, valid whole seconds from `30` to `300`). This one setting controls upstream
cache lifetime and the browser cadence; no viewer rebuild is needed to change it.
`X-Live-Update-Seconds` advertises the interval and `X-Live-Next-Update-At` lets
viewers join the shared cache's next refresh. `ETag` / `If-None-Match` return an
empty `304` when observations are unchanged. These headers are exposed through
CORS, including for file previews. Configure `REALTIME_VEHICLE_URL` to override
`https://bustime.ttc.ca/gtfsrt/vehicles`.

Simultaneous misses within an isolate share a pending acquisition. The edge cache
shares snapshots within a Cloudflare location; this is not a global single poller.
Requests are demand-driven, so an unused map causes no background TTC downloads.
Acquisition/decoding failures return an uncached `503 vehicles-unavailable` with
`Retry-After`; the isolate throttles repeated upstream failures for the configured
interval. No vehicle history is persisted.

### `GET /api/v1/feed/status`

Operational source/import status. This endpoint is intentionally `no-store`.

### `POST /api/v1/debug/map/streetcar.svg` (debug endpoint)

Renders a previously generated `streetcarmap.json` bundle as standalone SVG.
The authenticated API proxy forwards the JSON to the map-generator debug
renderer; it does not read D1, fetch GTFS, or invoke the sync pipeline. The
request body is the map JSON and requires `Authorization: Bearer <SYNC_TOKEN>`.
The endpoint is disabled with `404` until `SYNC_TOKEN` is configured on both
Workers, and accepts bundles up to 2 MB.

For remote rendering of a custom JSON bundle (the local Make targets do not
need this endpoint):

```bash
curl -sS -X POST https://api.ttcstatus.ca/api/v1/debug/map/streetcar.svg \
  -H "Authorization: Bearer $SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @streetcarmap.json > streetcar-debug.svg
```

### `POST /api/v1/admin/sync`

Optional manual sync endpoint. It is only enabled when a `SYNC_TOKEN` Worker secret exists and requires:

`Authorization: Bearer <SYNC_TOKEN>`

The endpoint returns `202 Accepted` after scheduling the sync in the background. Check `/api/v1/feed/status` for import or map-generation errors and `/api/v1/map/streetcar` once the active artifact is ready.

Convenience commands (admin commands read `.env` through 1Password CLI;
map commands use the public endpoint without credentials):

```bash
make admin/sync
make map/streetcar
```

The Cron Trigger is the normal production path.

## Rebuild an outdated production map

If the homepage reports “Viewer requires a generated schematic with a graph and
geographic context”, the stored map predates the current generator. Deploying
Workers does not rebuild existing D1 artifacts; normal static sync may skip an
unchanged feed. Rebuild from the already-imported production network instead:

```bash
npm run map:regenerate:remote -- --dry-run  # Read-only generation and viewer validation
npm run map:regenerate:remote             # Validate, store and activate the new map
```

This command uses your Wrangler Cloudflare login and a temporary
[remote D1 binding](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy).
It does not need the admin `SYNC_TOKEN`, download GTFS, or reimport the network.
It shares the static-sync lock, validates the React contract before storing,
switches the map pointer only after all chunks exist, and retains the previous
artifact for rollback. If the active map already uses the current generator,
it leaves that artifact unchanged. Release steps after updating generator code:

```bash
npm run build:api
npm run deploy:map
npm run map:regenerate:remote
npm run deploy:api
```

The React homepage revalidates map data on load and uses a schematic-format URL
so an older cached seed map cannot prevent it from picking up the repaired map.

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

## React UI and Storybook

The homepage is a React/TypeScript app in `web/ui/`. `pages/HomePage.tsx` owns
selection, filters and one shared feed subscription. `components/` contains the
header, footer, SVG map, layer filters, route legend, feed status and stop/vehicle
details. Search accepts stops, routes and reported streetcar numbers (for example,
`4400`, `#4400` or `car 440`). Selecting a streetcar opens its details and centers
the map on its latest position, enabling its layer when needed. Typing a search uses the
shared loaded fleet without additional vehicle requests. The map reuses `web/map/` camera, model and GPS projection helpers.

```bash
npm run dev:viewer       # React homepage + credential-free local API, port 4173
npm run storybook        # Components and interaction examples, port 6006
npm run build:api        # Typecheck + React assets + standalone HTML viewer
npm run build:storybook  # Standalone component catalogue in storybook-static/
```

Storybook uses fixed local fixtures and never requests the TTC feed. Each
component has its own stories; search, filters and route selection include
`play` interaction checks. After `npx playwright install chromium`, run
`npm run test:ui` against the running React preview and `npm run test:stories`
against running Storybook for browser checks. `UI_URL`, `STORYBOOK_URL` and
`CHROMIUM_PATH` can override the defaults. Browser UI checks intercept TTC
responses with fixtures. Feed stories cover loading, empty, live, stale, paused
and unavailable states. The setup follows the official
[Storybook React/Vite framework](https://storybook.js.org/docs/get-started/frameworks/react-vite/).

Vite writes the homepage and hashed JS/CSS into `public/` for the existing Worker
asset deployment. The standalone HTML preview remains at `/map/`. All API Worker
routes now start with `/api/`, including `/api/healthz`; the previous `/v1/*` and
`/healthz` paths are retired. Unknown `/api/*` requests return JSON errors.
The map-generator service routes also moved under `/api/`; deploy the map Worker
before the API Worker when releasing this change.

For 100 visible viewers at the default 30-second cadence, the site receives about
3.3 snapshot requests per second on average. One page hook serves every UI
component; route and layer changes do not open more feed subscriptions. Worker
edge caching and in-flight acquisition sharing reuse the fleet snapshot. ETags
avoid resending unchanged fleets; static map geometry is loaded separately and
is not sent with each update. Cache sharing is per Cloudflare location/isolate,
not a guarantee of one global TTC fetch. The 100-viewer unit test verifies
coalescing inside one snapshot store. This is cached HTTP polling, with up to
one configured interval of latency, rather than a persistent push connection.

## Local development

### Hackathon: your commute cockpit

The React homepage now includes:

- **My stops**: save up to 100 stops, return to them with one click, and see gold
  stars on the map. Bookmarks stay in this browser. Removed network stops remain
  removable bookmarks rather than silently disappearing.
- **Near me**: request your location to find the five closest boarding stops
  within 2.5 km, with an optional filter for listed accessible boarding. Location
  accuracy is displayed; coordinates stay in the tab and are never saved or
  included in shared links. Clear location removes the marker and results.
- **Streetcars nearby**: selected stops list up to three fresh vehicle reports
  on their routes within 2 km. Choose a car to inspect and center it on the map.
  Distances are straight-line geographic distances, not arrival predictions;
  cars can be travelling either direction.
- **Route pulse**: fresh vehicle counts per route, stale counts and the median
  reported speed for a selected route. Counts describe observations rather than
  service frequency, delays or route reliability. Missing speed stays unknown.
- **Share map**: copy a link to a stop, route or streetcar and its map layers.
  Clipboard restrictions reveal a selectable link. The URL updates as you
  explore; opening a streetcar link focuses it after its live position arrives.
  Missing stops/routes and cars absent from the feed have explanatory messages.
- **Surprise me**: jump to a random boarding stop in the visible daytime or
  overnight network and explore somewhere new.
- **Day/night themes**: follow the system theme initially, with a persistent
  manual toggle. Layer preferences also survive reloads; shared links override
  those preferences.
- **Fleet explorer**: the Fleet tab filters the shared snapshot by car/route,
  assignment and fresh/stale/off-track status. Sort by car number, fresh reported
  speed, or geographic distance after using Near me. Large results are paged in
  groups of 20. Download all filtered reports as CSV, including timestamps,
  freshness, vehicle coordinates and source attribution. Unknown speeds remain
  blank; external
  strings are escaped against spreadsheet formula execution. Personal location
  is excluded from exports.
- **Stop comparisons**: the Compare tab places A/B pins on the map, fits both
  stops into view and compares geographic distance and listed accessible
  boarding. Route connections require a streetcar pattern to visit the start
  boarding point before the destination; shared route numbers and physical
  track do not establish a connection. Variants report the number of intervening
  stops and scheduled destinations. Swap endpoints, include overnight patterns,
  choose from dropdowns or pick on the map/header search. Stop details offer
  **Compare from here** and **Compare to here**. Comparisons and tab selection
  are shareable. This is a static comparison, not a time-based journey planner;
  it does not calculate transfers or arrival predictions.
- **Follow a streetcar**: selecting a car offers an optional follow mode. Fresh
  GPS fixes move the camera; stale fixes wait for recovery. Panning, zooming,
  fitting the map, locating yourself or switching tools pauses following.
- **Stop directory**: the Stops tab searches by place, street or route name,
  filters boarding places/stations, listed accessible boarding and saved stops,
  and pages through results. Sort geographically after using Near me. The
  directory includes overnight service independently of map layers.
- **Streetcar journal**: sign in and explicitly add a selected car to an account
  collection of up to 500 unique vehicle IDs. Write notes, search the collection,
  see whether a car is in the current live feed, and earn five collection badges.
  Recording does not save GPS fixes or observation history. Download a JSON
  backup and restore it by merging new cars; existing notes are preserved.
  Removal asks for confirmation. A supplied overnight assignment earns the Blue
  Night badge regardless of when you save it.
- **Take a map with you**: use **Save map** below the map to preview a frozen
  copy of the current view. Download a self-contained SVG or print/save a PDF
  through the browser. The paper palette, route key, north arrow, snapshot dates
  and sources travel with the map. Your location marker and saved-stop stars
  are omitted; visible car reports can also be excluded. Exports work offline.
- **Keyboard help**: press `?` or click the header help button. `/` focuses
  search; `E`, `F`, `C`, `D`, `J` open the tool tabs; `P` previews a printable map; `S` saves/removes the selected stop;
  `N` switches theme; `R` resets the map. Shortcuts ignore text fields, select
  menus, modifier keys and open dialogs, and can be disabled persistently.
  Tool tabs also support arrow keys, Home and End.

These features reuse the existing single vehicle subscription and loaded map,
without additional TTC polling. Account journals use the protected API and D1
tables described in [Clerk setup](docs/clerk-setup.md). Storage restrictions keep
preferences and bookmarks in memory for the current visit; journals are saved
to the signed-in account. Geolocation runs only after pressing **Find nearby stops** and requires
a secure browser context (HTTPS or localhost).

Run the fixture-based browser checks against a local preview:

```bash
npm run dev:viewer
npm run test:ui
npm run test:mobile
npm run test:hackathon
npm run test:exploration
npm run test:collection
```

`test:hackathon` covers persistence, deep links, location privacy, fresh/stale
vehicle filtering, route activity, themes, mobile layout, and blocked browser
storage/clipboard/location. It intercepts API requests with local fixtures.
Use `UI_URL` and `CHROMIUM_PATH` to select a preview or installed Chromium.
New component states are also available in Storybook.

`test:mobile` checks iPhone touch selection, the collapsible details panel,
search keyboard dismissal, comparison picking, and 320–430px layouts.
`test:exploration` checks fleet paging/sorting, downloaded CSV content and formula
escaping, geographic sorting, comparison links and picking, shortcut opt-out,
following across virtual-time feed refreshes, and layouts down to 320 pixels.
`test:collection` checks stop-directory filters/paging/geographic sorting, manual
journal recording and notes, badge unlocking, persistence, JSON backup/merge and
removal, exported SVG contents/privacy, the print stylesheet and PDF output, and
all five tabs at phone widths. It uses offline fixtures for all API requests.

Preview the interactive map with real streetcar positions, without credentials
or a D1 import:

```bash
make dev
```

This runs `npm run dev:viewer`. Open `http://127.0.0.1:4173/`.
The React homepage loads the map from
`/api/v1/map/streetcar` and enables live streetcars by default. Positions refresh
every 30 seconds while the layer is enabled.
Updates pause with the layer off, in hidden tabs, or offline; returning to an
overdue view refreshes immediately. Only one request runs at a time. Failed
refreshes keep the last positions and retry with backoff up to five minutes.
Unchanged feeds use `304`, and existing car markers and keyboard focus survive
refreshes. New cars are added and cars absent from a full snapshot are removed.

The public TTC feed provides complete GTFS-Realtime HTTP snapshots. No documented
public push transport was found, so this implementation polls snapshots rather
than opening an SSE/WebSocket connection. GTFS defines feed messages as HTTP GET
responses: [GTFS-Realtime reference](https://gtfs.org/documentation/realtime/reference/#message-feedmessage).
Movement reflects received GPS fixes; positions are not extrapolated between them.

Change `REALTIME_UPDATE_SECONDS` in `workers/api/wrangler.jsonc` to `60`, `120`,
or `300` (five minutes). The browser learns the setting from every API response,
including errors and `304`. Invalid values fall back to 30 seconds. The local
server uses the same acquisition/cache modules and accepts the same setting:

```bash
REALTIME_UPDATE_SECONDS=300 npm run dev:viewer
```

Use `npm run dev:viewer -- --port 4175` to change the preview port. React components
reload as you edit them; restart after changing environment settings.

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
Each refresh supplies the previous matched edge for continuity; it never matches in display
pixels or treats a geometric crossing as a graph connection. Matching is an
estimate against the inferred, simplified graph rather than surveyed track.

Transport and decoding live in `workers/api/src/realtime.ts`; the plain observation
contract lives in `workers/shared/live-vehicles.ts`; snapshot projection and body
placement live in `web/map/live-status.ts`. `web/map/live-updates.ts` owns cancellable
polling, cadence, ETags, timeouts and backoff; `workers/api/src/vehicle-snapshot-cache.ts`
shares acquisitions, and `workers/shared/live-config.ts` validates the interval.
No live history is written to D1/R2.
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
