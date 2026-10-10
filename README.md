# api.ttcstatus.ca

Cloudflare Workers + D1 + R2 backend for TTCstatus.

Clerk sign-up/login, protected account Journals, and opt-in public badge profiles
are implemented. See [Clerk setup](docs/clerk-setup.md) for the two required
Cloudflare bindings, the D1 migration, local development, and activation steps.
The TTC status map and transit APIs remain available without signing in.

The status map includes streetcars and subway/LRT Lines **1, 2, 4, 5 and 6**, using TTC Complete GTFS. Live streetcars use GPS observations; subway trains use explicitly labelled next-station predictions from TTC Subway Trip Updates. See [subway map setup and feed semantics](docs/subway-map.md) for local preview, realtime coverage and production rollout. The historical `streetcar` API paths remain compatible.

A scheduled Worker checks the static source nightly, downloads it only when it changes, imports the rail subset into D1, invokes the map generator, and publishes a precomputed `snake-v1` artifact.

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
- Imports streetcars and Lines 1, 2, 4, 5 and 6 into versioned D1 rows.
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

The `snake-v1.3.1` generator provides one schematic layout for paths, graph nodes,
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
`workers/map-generator/src/source/physical-tracks.json`. Database overlays with matching
IDs take precedence over the bundled defaults.

Detailed physical Queens Quay geometry also supplies bends missing from coarse
scheduled shapes. Matching 509/510/310 segments within 55 metres are aligned to
that corridor; their original projected GTFS vertices remain in `gtfsSourcePoints`.
The inferred graph's distances follow the physical alignment.

The physical overlays also include McCaul's Queen–Dundas–College connections
and nine audited turnback loops, including Coxwell, Oakwood and Kipling. These
remain available when scheduled GTFS shapes omit them. See the
[physical loop audit](docs/physical-loop-audit.md) for coverage and source notes.

The debug SVG draws shared edges once, uses distinct schematic route colours,
labels major streets and terminals, and includes a City of Toronto mainland
shoreline and north arrow. The shoreline is simplified in metres and uses the
same continuous display transform as rail. A shared edge shows one daytime route colour; its tooltip lists all
services on it. Geographic context labels are approximate and separate from
service/track data. Inline route numbers identify visible corridors, overnight
variants use their daytime route colours, and dashed grey indicates physical
track without scheduled streetcar service.

The local vite preview (`npm run dev:viewer`) serves `/api/v1/map/streetcar`
from `data/fixtures/streetcarmap.json` (or `.wrangler/preview/rail-map.json`
after `make dev/new`, or `MAP_INPUT`), laid out by the real map-generator
geometry without credentials, D1 or feed downloads. For the legacy v1.0.1
fixture, the preview recovers approximate metre coordinates from the audited
Ossington overlay because that format omitted its geographic display transform.
Production generation uses D1 source coordinates directly, and an older
schematic with retained source geometry is rebuilt through the current
generator rather than displayed unchanged.

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
8. The delivered-service recorder (`ServiceRecorder`, a singleton Durable Object) polls both live feeds once every 30 seconds — 2,880 acquisition cycles per day, constant. It runs in `always` mode (decided in docs/sla.md §9): it measures delivery nobody is watching, which is the entire point. That constant rate is typically below today's busy-period per-isolate fan-out (100 page viewers already drive ~3.3 snapshot requests/second through the shared caches), and off-peak it is new but trivial, constant traffic to the same public feeds, attributed exactly as everything else here. Its storage is bounded by construction: raw touch events live 30 minutes inside the Durable Object; rollups are one small D1 row per directional stop per 5 minutes with 36-hour retention; nothing else persists.

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

### `GET /api/v1/version`

Reports the deployed Worker version metadata (`id`, `tag`, `timestamp`) from the
Cloudflare `CF_VERSION_METADATA` binding, plus the site's source repository.
Manual `wrangler deploy` builds carry no binding-backed version and answer with
`deploy: null`. The homepage footer independently shows `ttcstatus.ca v<version>`
with a source link to the deployed Git commit, both embedded at build time
(`package.json` version plus `WORKERS_CI_COMMIT_SHA` from Workers Builds).

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

### `GET /api/v1/service/stops` · `GET /api/v1/service/wave` (experimental)

Delivered-service analytics (docs/sla.md): what the streetcars and trains
**actually did**, not what they promised. Both endpoints read the recorder
singleton — a Durable Object sampling both live feeds once every 30 seconds —
and follow the vehicles-endpoint conventions: `ETag` / `If-None-Match` return an
empty `304` between 30-second ticks, `X-Live-Update-Seconds` /
`X-Live-Next-Update-At` advertise the cadence, responses are CORS-exposed with a
~15 s edge cache, and an unreachable recorder returns an uncached
`503 service-unavailable` with `Retry-After`. **Experimental until the overlay
is polished.** Nothing existing routes through these endpoints.

- `/api/v1/service/stops` — per **directional** stop: `lastTouchAt`,
  `minutesSince` (the absolute axis), `medianHeadwayOwnSeconds` (the stop's own
  delivered baseline), `irregularity` (CV², the bunching tax),
  `expectedWaitSeconds` (the residual R(e) for a rider who has already waited),
  `dryness` (the self-relative axis), `state` (`fresh` / `due` / `void` /
  `unmonitored` / `collecting`), a coverage badge, and `routeIds` for
  `?routes=` filtering. Unmonitored time is never rendered as a void — a feed
  outage is a blind spot, not evidence of anything.
- `/api/v1/service/wave` — delta-encoded windowed touch lists per route
  pattern; one request reconstructs the full 30-minute space-time plot for the
  replay view (the wave of void as pure geometry — no detection step).
- `/api/v1/service/history` — merged-moment summaries (`n`, mean headway,
  `CV²`, worst wound, back-to-back, coverage ratio) per stop or per route over
  any sub-window of the rolling 36 hours, via `?stop=`, `?routes=`, `?from=`
  (one narrowing filter required; stop-scoped queries also return the
  5-minute per-bucket series for the sparkline). Moments merge exactly;
  quantiles are gamma approximations, labelled as such. Cached 1–5 minutes.

The browser surface is a per-user-gated debug overlay: grant it with
`npm run feature:enable -- voidOverlay <clerk-user-or-email>` and it appears on
the map for that account only; signed-out visitors see nothing.

### `GET /api/v1/feed/status`

Operational source/import status. This endpoint requires
`Authorization: Bearer <SYNC_TOKEN>` (same admin credential as `/api/v1/admin/*`);
it exposes internal pipeline diagnostics (source URLs, R2 keys and raw error text)
and is therefore no longer public. Unauthenticated requests receive `401`, and a
Worker without `SYNC_TOKEN` returns `404`. Check locally or from the laptop with:

```bash
make admin/sync/status
```

### `POST /api/v1/debug/map/streetcar.svg` (debug endpoint)

Renders a previously generated `data/fixtures/streetcarmap.json` bundle as standalone SVG.
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
  --data-binary @data/fixtures/streetcarmap.json > streetcar-debug.svg
```

### `POST /api/v1/admin/sync`

Optional manual sync endpoint. It is only enabled when a `SYNC_TOKEN` Worker secret exists and requires:

`Authorization: Bearer <SYNC_TOKEN>`

The endpoint runs the whole pipeline inside the request and returns the final outcome — `unchanged`, `updated` (with `versionId`) or `busy` — so a changed feed takes roughly a minute before the response arrives. Keep the request open until then: an interrupted run leaves the downloaded version for the nightly cron, which resumes it. (Earlier revisions answered `202 Accepted` immediately and continued via `ctx.waitUntil`, but the runtime caps background continuation at about 30 seconds past the response — enough for an unchanged check, silently too short to download, import and generate a changed feed.) Check `/api/v1/feed/status` for import or map-generation errors and `/api/v1/map/streetcar` once the active artifact is ready.

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

## Named map artifacts and tags

Every imported network version publishes immutable map artifacts under a
**name**, which is also the public API path:

| Name        | Path                    | Contents                                                                                                                                |
| ----------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `streetcar` | `/api/v1/map/streetcar` | The schematic status map (`snake-v1` style)                                                                                             |
| `snake`     | `/api/v1/map/snake`     | The derived game board (collapsed, rounded, trimmed)                                                                                    |
| `ttcstatus` | `/api/v1/map/ttcstatus` | The stable site map the homepage consumes: the same derived board published under its own immutable name, decoupled from the snake game |

The nightly import (and `npm run map:regenerate:remote`) stores and activates
both artifacts atomically. Any artifact can additionally be pinned with
arbitrary **tags** (`latest`, `stable`, …) from the command line:

```bash
npm run map:tag -- list
npm run map:tag -- set --name streetcar --tag stable                     # newest artifact
npm run map:tag -- set --name streetcar --tag latest --artifact 42
npm run map:tag -- set --name snake --tag stable --generator-version snake-v1.4.1
npm run map:tag -- set --name ttcstatus --tag latest                     # pin the stable site map
npm run map:tag -- clear --name streetcar --tag experimental
```

Tag resolution on `GET /api/v1/map/<name>`:

1. `?tag=<tag>` must exist, otherwise the request fails with `map-tag-missing`
   (tags never fall back silently).
2. Without `?tag=`, a `stable` tag wins when one is pinned.
3. Otherwise the pipeline's `active` pointer serves the map, so publishing
   never breaks just because nobody tagged anything.

The board artifacts (`snake` and `ttcstatus`) are published as fully derived
viewer payloads (they have no `graph` section), so the homepage consumes them
exactly as served. **The homepage defaults to the stable `ttcstatus` name** —
the same derived board frozen under its own immutable artifact — so future
snake-game changes (board geometry, gameplay, performance work) land on the
`snake` name only and can never touch the production status map; pin
`?mapVersion=` or use `?map=streetcar` / `?map=snake` on `/xplore` to preview
the other boards.

## Provisioning

### Cloudflare deploy configuration

This repository contains two Workers, so configure two Cloudflare Workers Builds projects
from the same repository. Both projects use the same gating build command:

- API project: root directory `/`, build command `npm run ci`, deploy command
  `npm run deploy:api`
- Map project: root directory `/`, build command `npm run ci`, deploy command
  `npm run deploy:map`

The deploy commands apply pending D1 migrations (`npm run db:migrate:remote`)
before shipping either Worker, so a deploy can never run ahead of the schema
it needs. Migrations are tracked and idempotent; both projects share one
database, so whichever deploy runs first brings the schema up to date. A
failed migration stops the deploy.

`npm run ci` is the deploy gate: it runs `npm run pre-flight` (secret scans,
boundary check, typecheck, lint, format check, unit tests, build), then the
Storybook build and `wrangler deploy --dry-run` for both Workers. If any step
fails, Cloudflare never deploys. Deploying is therefore safe on every push:
the code that reaches the deploy command has passed the same checks as the
local pre-commit hook and GitHub Actions.

Deploy the map project before the API project because the API uses a Service Binding to it.
Both projects must have the same D1 database bound to the `DB` binding. Replace
`REPLACE_WITH_D1_DATABASE_ID` in both Wrangler configurations before the first deploy;
Wrangler cannot deploy a remote D1 binding with that placeholder.

Enter the Cloudflare build and deploy commands without Markdown backticks. For the
map project, use these literal values:

```text
Build command: npm run ci
Deploy command: npm run deploy:map
```

The static import is intentionally a heavyweight production job and requires a **Workers Paid** plan so the API and map-generator Workers can use the configured CPU budget. The nightly Cron Trigger runs it in the background; the manual endpoint runs the same pipeline inline within its request. Normal API reads remain lightweight because they never parse GTFS.

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

Deploy the map generator first because the API Worker has a Service Binding to it.
These manual deploys are the break-glass path for when Cloudflare Workers Builds
is unavailable; normally Cloudflare deploys every push after `npm run ci` passes:

```bash
npm run pre-flight
npm run deploy:map
npm run deploy:api
```

## React UI and Storybook

The homepage is a React/TypeScript app in `web/ui/`. `features/map/useHomeWorkspace.ts` owns
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

Vite writes the homepage and hashed JS/CSS into `dist/` for Worker
asset deployment. Static assets are copied from `public/`. The standalone HTML preview remains at `/map/`. All API Worker
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

### Pre-flight board

Every quality gate in this repository runs through one command:

```bash
./pre-flight            # the full board: secret scans, boundaries, types,
                        # lint, format, tests and builds
./pre-flight check      # the same, minus the two build routes
./pre-flight check lint # only the named routes
./pre-flight precommit  # auto-fix commands from security.json (prettier
                        # --write), then the full board — what the git
                        # pre-commit hook runs
```

The board is configured entirely by `security.json` at the repository root:
which routes exist, their commands, the tools they need, and the baseline
time each one takes. The `precommit.fix` list in the same file is what the
git pre-commit hook runs first — `prettier --write .` — so formatting is
fixed in the working tree before the format route checks it. Every run
reports its time as a percentage of its
baseline, so a test that quietly became 40% slower over the years shows up
as `delayed +40%` on the board. Slow runs never fail anything — only real
check failures do.

Interactive terminals get the departure board (routes, spinners, live
times). Headless environments — CI, pipes, `CI=1` — drop the pretty output
automatically and stream plain `[route]`-prefixed logs instead.

The secret scans use gitleaks. On first use it is downloaded to `.tools/`
(ignored by Git) for Linux, macOS or Windows from the release pinned in
`security.json`, verified against pinned SHA-256 digests. One route scans
the working tree (tracked plus new files, so ignored `.env.local` and
`.env.prod` stay private); the other scans the full git history. The two
historical findings from before the `SYNC_TOKEN` rotation are acknowledged
in `.gitleaksignore`; any new finding fails the board.

```bash
./pre-flight status               # every route: SKIP/ON/OFF, baseline, tools
./pre-flight skip test            # skip a route on the NEXT run only
./pre-flight on test              # enable a route (cancels a pending skip)
./pre-flight off secrets-history  # disable a route in security.json
./pre-flight baseline             # re-record baseline times on this machine
./pre-flight install              # (re)install tools such as gitleaks
./pre-flight help                 # everything else
```

`npm run check` and `npm run check:secrets` route through the same board.
Swapping a tool — the secret scanner, say — is a one-line edit of that
route's `command` in `security.json`; the runner, board and baselines are
unchanged. `{bin:tsc}`-style tokens resolve to the local `node_modules`
binary on any platform, and a tool with an `install` entry is probed and
installed automatically before its checks run. On Windows, run the same
commands as `node pre-flight …`.

### Hackathon: your commute cockpit

The React homepage now includes:

- **My stops**: save up to 100 stops, return to them with one click, and see gold
  stars on the map. Signed-in saves live in the account database
  (`/api/v1/me/stops`) with revision-checked updates like the streetcar journal;
  signed-out visitors keep them in this browser, and they merge into the account
  on sign in. Removed network stops remain
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
  collection of up to 500 unique vehicle IDs, or enter a car number directly. Mark
  cars Seen or Ridden, upgrade a sighting after a ride, edit private notes and remove
  entries. Older entries default to Seen. Changes are saved to the signed-in
  account on the server; entries, statuses and notes are never public. Search the collection,
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
to the signed-in account. Geolocation runs only after pressing the **◎ locate
button** on the map (described to assistive tech as **Locate me & centre map**)
and requires a secure browser context (HTTPS or localhost).

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
`/api/v1/map/ttcstatus` (the stable board; the preview middleware derives it
from the local fixtures exactly like the deployed generator) and enables live streetcars by default. Positions refresh
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

`shared/map/projection.ts` is the reusable GPS bridge, shared by the
generator and viewer and usable in a future streaming Worker. The map serializes
its complete geographic transform (including projection reference, rotation,
compression, and display scale). `gpsToMap` / `mapToGps` support free geographic
locations such as a person's position. `matchGpsToTrack` operates in source metres,
uses route and bearing hints, then interpolates the retained edge distance mapping.
Each refresh supplies the previous matched edge for continuity; it never matches in display
pixels or treats a geometric crossing as a graph connection. Matching is an
estimate against the inferred, simplified graph rather than surveyed track.

Transport and decoding live in `workers/api/src/realtime/realtime.ts`; the plain observation
contract lives in `shared/live/vehicles.ts`; snapshot projection and body
placement live in `shared/map/live-status.ts`. `shared/live/polling.ts` owns cancellable
polling, cadence, ETags, timeouts and backoff; `workers/api/src/realtime/vehicle-snapshot-cache.ts`
shares acquisitions, and `shared/live/config.ts` validates the interval.
No live history is written to D1/R2.
Streaming acquisition can later replace the snapshot transport while reusing
these models and projection functions. The current phase does not infer a trip
pattern or direction when the source omits them.

Apply the local D1 migration:

```bash
npm run db:migrate:local
```

Or run the whole local stack with dev/prod parity — `make dev` builds the UI,
migrates local D1/R2, starts both Workers from their production `wrangler.jsonc`
configs (API pinned to 8787, map-generator to 8788, real `MAP_GENERATOR` service
binding between them, `--test-scheduled` for the cron path), and bootstraps the
map through the same `POST /api/v1/admin/sync` endpoint production operators use:

```bash
make dev            # start the whole local stack + bootstrap the map
make dev/bootstrap  # re-run the pipeline against a running stack (local only)
make dev/new        # drop + recreate local D1, then make dev
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

### Streetcar Snake on xplore

The small 🐍 button at the bottom right of the explorer map opens Streetcar
Snake on the same schematic and shared live vehicle feed. Arcade collects each
fresh on-track streetcar once and grows the train; hitting your own tail ends
the run. Purist drives one streetcar at up to 50 km/h and ends on collision with
another fresh on-track streetcar. Feed positions refresh on the explorer's
normal cadence, and stale or off-track reports do not affect either mode.

Free play, signed route missions with return trips, manual switches, keyboard
controls, touch pedals, swipe steering, pinch zoom, next-stop guidance, a
minimap, sound muting and local high scores are available. Use ↑/↓ or +/− for
speed, ←/→/Space or Q/E/R for switches, P to pause and Escape to return to xplore. The
run also pauses when the page becomes hidden or loses focus.

Amber switch markers and green departure arrows show the selected track;
automatic guidance is dashed and manual selection is solid. Terminal turnbacks
carry the train onto the opposite rail without false tail collisions. Original
pedal rates and held-control feedback are retained. See the
[driving review](./docs/snake-driving-review.md) for the classic-game comparison.

The complete original game remains playable at `/snake/v1/`, including its
original map, modes, missions, multipliers, Transit Control events and resume
cookies. Its simulation, styles and icons are copied from `../snakettc`; only
HTML asset URLs and manifest paths are rebased for the archive. No sibling
project is required to build or serve the archive.

Run `npm test` for simulation checks and `npm run test:snake` against a local
viewer for desktop, phone and legacy browser checks. `UI_URL` and
`CHROMIUM_PATH` select the preview URL and browser. Browser checks use fixture
streetcars and do not depend on TTC feed availability.

## Maintaining the code

For a little offline transit spotting, run `npm run map:depot`. It prints an ASCII
streetcar and a route board with stop-cluster and pattern counts from the bundled
map fixture. Use `npm run map:depot -- path/to/map.json` to inspect another local
map. This is a snapshot summary, not live service or departure information;
it requires no credentials or network access and writes no files.

See [CODEMAP.md](CODEMAP.md) for module ownership and dependency boundaries.
Application code lives under `workers/` and `web/`; `shared/` contains pure
contracts and calculations used by both. Components and their stories are grouped
by feature. Reference map bundles in `data/fixtures/` remain immutable fixtures;
preview commands and production builds write generated output into `dist/`.

Run `npm run check` for types, lint, formatting, unit/integration tests,
credential scanning and import boundaries. Run `npm run format` before committing.
Use the existing `test:ui`, `test:auth`, `test:mobile`, `test:hackathon`,
`test:exploration`, `test:collection`, and `test:snake` commands against
`npm run dev:viewer`; `test:stories` runs against `npm run storybook`.

Build with `npm run build:api` before an API deployment: Wrangler serves `dist/`.
The public paths, payloads, generator version, map fixtures and archived game remain
unchanged by the refactor. [Security and deployment notes](docs/security.md)
cover credential replacement and input limits.

## Interface languages

The interface follows the browser’s preferred language and supports Canadian English
and Canadian French. Use the globe link to open **Profile → Browser profile → Language**
and save an override on this browser, without signing in. Unsupported languages fall
back to Canadian English. See [the translation guide](shared/i18n/locales/README.md) for adding
languages and running localization checks.
