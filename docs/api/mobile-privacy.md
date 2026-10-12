# Privacy-focused API clients

Changes 1–6 prepare desktop, Mobile Safari, and future Capacitor clients. Device
GPS stays on the device. Notifications and device registrations are deferred.

## Geography and local lookup

New generator `snake-v1.5.0` publishes original WGS84 boarding records, canonical
GTFS stop IDs, parent station IDs, accessibility, pattern/route/direction/headsign
relationships, and each boarding record's `displayFeatureId`. Schematic points
are display coordinates only. Parent IDs are agency identities, not fabricated
station centroids. These are rail boarding records, not a walking-route graph or
an inventory of station entrances.

Every new viewer map contains `geographicPoints` per feature and a
`ttc-stop-directory` alongside its geometry. The directory also exists as a
separate precomputed D1 artifact. No public request builds it or fetches GTFS.

`shared/transit/nearby.ts` caches a device-only 500 m grid per map object. Lookup
includes every cell intersecting the 2.5 km search radius and ranks candidates
with Haversine distance to original boarding points. Multiple platforms resolve
to one display feature using their minimum distance; accessibility filtering
uses each boarding point, rather than a cluster-wide assumption. Outside the
local projection's date-line/polar limits the bounded directory scan preserves
correctness. This is straight-line proximity, not walking distance.

Legacy cached maps remain readable using their old geographic-transform
fallback. Accurate original-coordinate lookup becomes available after
regeneration; legacy schematic positions do not become original geography.

## Public release contract

| Endpoint                                       | Purpose                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `GET /api/v1/manifest?map=ttcstatus`           | Resolve stable/active to matching immutable map and directory URLs  |
| `GET /api/v1/map/ttcstatus?artifact=123`       | Exact map artifact; also supports `HEAD` and ETags                  |
| `GET /api/v1/stops?map=ttcstatus&artifact=123` | Exact original-coordinate directory; also supports `HEAD` and ETags |
| `GET /api/v1/openapi.json`                     | OpenAPI 3.1 contract, including response schemas and account inputs |

The other map names are `streetcar` and `snake`. A manifest may resolve an explicit
`tag`. A pinned artifact selector cannot be combined with a tag, and IDs cannot
cross map names. Clients verify matching `X-Map-Artifact` and `X-Network-Version`
before installing the pair atomically. Download the full directory, then search
locally; there is no server-side nearest-stop endpoint or location-derived tile
request. A map's embedded directory avoids a second download for existing UI
clients.

Immutable URLs carry an immutable cache policy. Completed artifacts cannot be
rewritten under the same ID/generator version. Regenerate with a bumped generator
version to change content. Explicitly tagged artifacts and their directories
survive raw-network retention; untagged old releases may eventually return 404.
On 404, resolve a fresh manifest and replace the cached pair together.

Mutable tag/active endpoints retain their existing caching behaviour. Manifests
are `no-store`. Older releases without published directories return `stops: null`
in the manifest and a clear `stop-directory-not-ready` response from `/stops`.

`ttc-schematic-map`, `ttc-viewer-map`, `ttc-stop-directory`, and
`ttc-release-manifest` identify formats explicitly. Their current schema version
is 1. Consumers tolerate additive response fields; changes to existing field
meaning, units, types, required inputs, or identity semantics require a new
format/schema/API version. ISO timestamps are UTC; service timestamps are epoch
milliseconds and durations use their named units. New UI clients reject unknown
map formats/schema versions while accepting old cached payloads without format
identities. Generate `docs/api/openapi.json` with `npm run build:contracts`.

## Privacy boundary and authentication

The outgoing HTTP seam rejects unsupported query fields and validates account
and event bodies before transport. API routing has the same query allowlist;
account schemas and event schemas reject extra fields. Device coordinates,
accuracy, geohashes, quadrants, bounds, and movement histories are not accepted
inputs or recorded analytics. Local grid keys are never transmitted. An optional
`located` event contains only that broad action name; it carries no position,
stop, route, or cell. Existing anonymous action analytics remain distinct from
account data.

Application failure logs contain only a normalized route, method, and error
class. Raw request URLs, query values, exception text, tokens, and payloads are
omitted. Wrangler disables automatic invocation logs and redacts query strings.
Normal connection metadata such as IP addresses still exists at the hosting
provider; this is GPS privacy, not network anonymity.

CORS supports GET/HEAD/POST/PUT/OPTIONS and exposes ETags, map identities, schema
versions, and live cadence headers on successful and failed responses. Accounts
use bearer session tokens, never cookie-only authorization. Account and conflict
responses are `no-store`; public transit downloads are anonymous.

Clerk verifies signed token `azp` against `CLERK_AUTHORIZED_PARTIES`, including
`https://ttcstatus.ca` and `capacitor://localhost`. A custom native scheme/host
must be explicitly configured. Empty configured parties fail closed. Token party
verification is independent of caller-controlled HTTP Origin and CORS. Tokens
without `azp` are rejected by this policy; a future native SDK flow must issue a
compatible session token or introduce a separately reviewed audience-bound
native-token contract. No auth check is weakened to accommodate a WebView.

Signed fixture tokens cover the Capacitor party, foreign/missing parties,
expiry/tampering, and user isolation. Actual sign-in redirects, universal-link
entitlements, and Clerk instance redirect allowlists belong to the future native
app integration and require its real configuration; no iPhone sign-in claim is
made by these unit tests.

## Single live-feed owner

The ServiceRecorder singleton owns `fetchRailSnapshot`. Its alarms and internal
`/snapshot` consumers share one coalesced acquisition on the recorder tick grid.
The latest publication is chunked and committed atomically in DO SQLite, so an
isolate restart reuses the snapshot or outage retry window. Feed configuration
changes invalidate that persisted publication.

Public vehicle responses read the publication, never fetch upstream feeds or
query static D1. POP caches expire by the next acquisition; ETags exclude fetch
time while preserving observations and partial feed availability. Both feeds
down yields an uncached 503, not an apparently fresh copy of an old fleet.
`REALTIME_UPDATE_SECONDS` controls client cadence independently of
`SERVICE_SAMPLE_SECONDS`, which controls acquisition. Preview tooling may retain
its process-local cache; production has one feed owner.

## Revision conflicts and reconnects

Saved stops and journals preserve compare-and-swap writes. Their 409 bodies are:

```json
{
  "error": "saved-stops-conflict",
  "revision": 4,
  "current": { "stopIds": ["stop:example"], "revision": 4 }
}
```

The current state belongs exclusively to the verified owner. The UI persists a
pending edit locally before PUT, scoped to account/resource/API origin. It merges
independent edits and retries a conflict once. Journals merge by vehicle ID;
concurrent changes to the same entry require an explicit choice. Choosing local
changes retains unrelated remote entries. Saved-stop merges apply local
additions/removals without silently truncating an over-limit result.

Failed drafts stay in memory and, when device storage is available, survive reconnects and cold starts. Reconnect refreshes server state
without replacing a retained draft; retry/discard controls remain available.
Cached offline documents stay read-only. Sign-out removes server snapshots and
pending drafts together; session changes abort in-flight edits and prevent an
old account's conflict retry from using a new session. Local inferred nearest
stops never become cloud favourites automatically.

## Rollout

1. Apply `0009_stop_directories.sql` before deploying the generator/API. Existing
   deployment commands run D1 migrations; no migration was applied remotely here.
2. Deploy both Workers, then regenerate the active map with
   `npm run map:regenerate:remote`. This uses cached canonical GTFS and does not
   require a new upstream download.
3. If stable tags point to older artifacts, deliberately move them to the new
   generator's artifacts with the existing `map:tag` command. Pinned old releases
   remain unchanged. The manifest shows whether the selected release has geography.
4. Existing deployments already have the recorder binding/migration; the new
   snapshot table initializes on its first recorder request or alarm.

Validation focuses on local units and builds. Real-device sign-in, production
rollout, and notification delivery were not exercised or enabled.

## References

Clerk. (n.d.). [Session tokens](https://clerk.com/docs/guides/sessions/session-tokens).

Clerk. (n.d.). [authenticateRequest()](https://clerk.com/docs/reference/backend/authenticate-request).

Cloudflare. (n.d.). [SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

Cloudflare. (n.d.). [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

OpenAPI Initiative. (2024). [OpenAPI Specification v3.1.1](https://spec.openapis.org/oas/v3.1.1.html).
