# Transport optimization plan

## Goal

Scale the browser and native data path to **2 million daily users** with a **9am
rush of 1 million concurrently open tabs**, without a bill that grows linearly
with users, while keeping the recorder's 30-second acquisition cadence, the
existing public vehicle response shape, and server-enforced authorization for
experimental service data.

The cost driver at this scale is **requests that invoke the Worker**. The fix
is to remove per-user request billing from the public data path by serving
identical public bytes from the CDN — not to tune polling intervals. Do not
add a streaming protocol or a delta ledger while the recorder samples upstream
every 30 seconds; push buys no freshness at that cadence.

Two standing doctrines:

- **One transport path, no fallback.** Public fleet data is served from the
  published live objects only. There is no Worker fallback route, no client
  fallback method, and no dual error contract. When the live path is the only
  path, the only error contract is the one it defines (see change 2).
- **Broadcast-only transport.** Shared/public paths carry broadcast data
  only — bytes identical for every user. Device location never crosses the
  wire; nearest stop is computed on the device (see change 7).

Watch the Clerk line: authentication is billed per Monthly Retained User
(MRU), and a broad auth requirement at this scale costs more than the
transport it protects. See [Clerk caveat](#clerk-caveat-watch-item).

## What the current system does

- `ServiceRecorder` is a singleton Durable Object. It acquires the live feeds on
  its 30-second alarm schedule whether or not a browser is open
  (`SERVICE_RECORDER_MODE: always`).
- The vehicle endpoint reads the recorder's published snapshot. The browser has
  one vehicle poller per page, retains an ETag, pauses when hidden/offline, and
  backs off after errors. Polling runs only while the tab is visible.
- The vehicle poller requests with `cache: 'no-store'`. This bypasses the
  browser's HTTP cache so it can check for a new snapshot at the advertised
  cadence. The Worker also uses `caches.default` as an internal per-location
  response cache. That avoids repeating recorder work while the entry is warm;
  it does **not** avoid invoking and billing the Worker for each browser
  request. Cache API hits bill the same as invocations.
- An ETag can turn a response into an empty `304`. This saves the response body,
  but the request still reaches the Worker and bills.
- The cold-start capture shows about 11.5 KB transferred for the vehicle JSON,
  with about 78.8 KB decoded. Compression is effective; egress is free, so
  schema slimming is not a cost lever.
- The map overlay and `/sla` are separate pages with their own service-data
  consumers. The recorder already shares upstream acquisition between them.
- All API paths run the Worker first (`run_worker_first: ["/api/*"]`), so every
  bot probe under `/api/*` bills a request too.
- `/api/v1/auth/config` exists today: unauthenticated, `no-store`, returns
  Clerk `enabled` + `publishableKey`, and is allowlisted by the privacy
  boundary. This plan extends it (change 1) rather than adding a new endpoint.

## Scale target and what it costs today

Design point: 2M DAU, average 2.5h open per day, 30-second client cadence,
30-day month. Like the earlier 1,000-browser model this is a deliberate
ceiling, not a forecast: real usage pauses on hidden tabs, but **1M
foreground tabs at 9am is the peak we engineer for**.

All rates below come from [Workers pricing], [Durable Objects pricing],
[R2 pricing], and [Clerk pricing] (checked October 2026). Cloudflare does not
bill for egress or CDN cache hits.

- Steady state: 2M × 150 min × 2 req/min = **600M vehicle requests/day =
  18B/month**.
- 9am rush: 1M concurrent × 2 req/min = **~33,000 requests/second sustained**.

### Baseline monthly cost (current architecture, 2M DAU)

| Line | Assumption | Monthly |
| --- | --- | --- |
| Worker requests (vehicle) | 18B − 10M included, $0.30/M | **$5,397** |
| Worker CPU (vehicle path) | 2–4 ms avg/request, $0.02/M CPU-ms after 30M | $720–1,440 |
| SLA live polling | 10% of DAU on `/sla` ~30 min/day, ~360M | ~$110 |
| Session/me/features/report | ~20M | ~$5 |
| Durable Object requests | per-POP cache misses: ~300 colos × 2,880 ticks/day, ~26M, $0.15/M after 1M | ~$4 |
| Durable Object duration | always-on alarm loop ≈ 333K GB-s < 400K included | ~$0 |
| Durable Object SQLite rows written | per-tick touches/coverage/state/folds; 50M rows/mo included, $1.00/M after | measure; est. $10–60 |
| Workers plan minimum | — | $5 |
| **Total** | | **≈ $6–7K/mo, linear in DAU** |

### The 9am rush by itself (baseline)

One rush hour with 1M concurrent tabs: 120M requests ≈ **$36 in request
charges plus ~$7 CPU ≈ $43 for that single hour** — about 20% of a day's
bill generated in 1/24 of the day. Worse, the in-POP cache TTLs align to the
30-second tick grid, so at each tick boundary every POP's first request does a
**synchronous subrequest to the singleton recorder DO** (billed as DO
requests, on the request's critical path). That is a synchronized stampede
~once per 30 seconds for the whole rush.

## Changes

### 1. Publish per-tick immutable snapshots to the public live bucket (highest impact)

The snapshot is identical for every user, already quantized to the 30-second
tick, and public. Publish one immutable object per tick and let Cloudflare's
cache serve every browser:

- Path layout: **`live/t/<tickId>/vehicles.json`**, where
  `tickId = floor(epochMs / 30_000)`. This is the same tick grid the recorder
  already uses (`service-recorder.ts` computes `tickId = floor(now / tickMs)`),
  so publishing and requesting agree by construction.
- The recorder (already awake every 30 s) `PUT`s the tick document after each
  acquisition to a **dedicated public R2 bucket**. A dedicated bucket keeps the
  GTFS archive bucket private. Each object is **immutable once written** —
  bytes never change, so edge TTLs are safe and old ticks are stable fallbacks.
- **No "latest" pointer and no mutable key.** Clients derive the current tick
  from their own clock and the cadence from config (change 1b/2). A clock that
  is ahead of publish gets a `404`, not a stale doc (see the error contract).
- `Cache-Control: public, max-age=600` on tick objects (immutable; generous TTL
  is free — old ticks are only requested on skew fallback). Use [cache rules]
  to set TTL/eligibility for the custom-domain host if R2's object metadata
  alone is not sufficient.
- Attach an [R2 custom domain] (e.g. `live.ttcstatus.ca`). Cache hits at the
  edge invoke no Worker and touch no R2 — free and unlimited. Only per-POP
  fetches of each new tick reach R2 (~300 colos × 2,880 ticks/day), bounded by
  topology, **not by user count**.
- R2 provides `ETag`/`If-None-Match` natively → `304`s on same-tick refetches
  (e.g. immediate refresh on visibility return within the same tick). Keep
  sending `If-None-Match`.
- Retention: an R2 lifecycle rule expires `live/t/` objects after ~1 day.
  Storage is negligible (~35 MB/day at 12 KB × 2,880).
- CORS: `Access-Control-Allow-Origin: *` on tick objects via [Transform Rules].
  They are public broadcast data with no credentials, ever; wildcard is
  correct. The `x-live-*` headers are no longer needed on this path — cadence
  comes from config (change 2), not from per-response headers.
- **Never publish protected data this way.** Only the public fleet snapshot.
  Overlay/service/SLA data stays on the Worker + auth path.
- **Format variants are paths, never query strings.** If a future subset or
  encoding is added (`vehicles.min.json`, a binary/protobuf variant), it is
  its own immutable per-tick path. One rule: query strings must never select
  response shape on this host — they fragment edge cache keys unboundedly and
  reintroduce per-user URLs, which is exactly what this design removes.

This changes the cost asymptote from O(users) to O(ticks): **≈ $6–7K/mo →
≈ $20–100/mo** (see tables).

### 1b. Serve transport discovery from `/api/v1/auth/config` (no baked-in URLs)

Native binaries cannot be repointed without an app update, and even the web
build bakes `VITE_API_ORIGIN` at build time. Extend the **existing**
`/api/v1/auth/config` response (it already returns the Clerk publishable key)
with the live transport block:

- `clerk`: `enabled` + `publishableKey` (already present; the publishable key
  is public by design — it ships in every web bundle).
- `live`: `{ base: "https://live.ttcstatus.ca", pathTemplate:
  "/live/t/{tick}/vehicles.json", updateSeconds: 30 }` (exact field names
  settle in implementation; keep the existing response fields additive).
- Clients fetch it **once per launch/session** and cache in memory; it is the
  only source of the live host, cadence, and path template. A binary can be
  repointed, re-cadenced, or migrated to a new host **without an app update**.
- Change its cache policy from `no-store` to `public, max-age=300`: every field
  is public-by-design, and at 2M DAU one uncached config fetch per launch
  would be ~60M Worker requests/month (~$18/mo) for nothing. Cached at the
  edge it is free; a stale `enabled` flip costs ≤ 5 minutes.
- The response stays additive and backward compatible: existing clients ignore
  the new block until their transport is updated.

### 2. The whole client error contract (and the removal of error semantics)

The Worker vehicle endpoint carried the error semantics: honest
`503 {error:'vehicles-unavailable'}` + `Retry-After`, `x-live-*` headers, and
client parsing for all of it. **That route is being removed (change 3), so all
of that logic goes with it.** The live path cannot emit dynamic 5xx statuses
per tick — so the compromise is to move the honesty **into the document body**:

- **The recorder publishes a tick document on every tick, including outages.**
  On total upstream failure it publishes
  `{ schemaVersion: 1, vehicles: [], outage: { since, tickId } }` instead of
  nothing (today it already degrades to `snapshot: null`; this reuses that
  path). An outage doc is still valid, cacheable broadcast data.
- The client contract becomes exactly three cases:
  1. **`200`** → use the document. Outage is a body field, never a status.
      `vehicles: []` + `outage.since` renders the existing
      "service unavailable" state; `fetchedAt`/`tickId` keep staleness honest.
  2. **`404`** → the tick is not published yet (device clock ahead of
      publish) → retry `tickId − 1` once → if that also 404s, keep the
      last-good snapshot with its age and let the next scheduled poll handle
      it. Body `tickId` lets clients detect and resync clock drift.
  3. **network error** → offline → keep last-good with age; existing backoff
      and lifecycle pausing apply unchanged.
- No 5xx parsing, no `Retry-After` handling, no fallback host, no second
  transport implementation. Status codes on the live host mean exactly: 200
  doc, 404 not-yet-published, everything else is network failure.

This keeps the system's "never serve stale as fresh" honesty — it moves it
from the HTTP status layer, which the CDN path cannot speak, into the
published body, which it can.

### 3. Remove the public vehicle endpoint (no fallback)

Per the no-fallback doctrine, the Worker route is **deleted, not feature-flagged**:

- Remove `/api/v1/vehicles/streetcar` from the router. Delete
  `vehicleResponse` and its `caches.default` POP cache, ETag, `503`, and
  `x-live-*` logic. After removal, the public surface has **zero** paths that
  can invoke recorder reads or bill per-user fleet requests.
- The recorder's internal routes (`/snapshot`, `/states`, `/window`) are
  reachable only through the service binding from within the Worker
  (`https://service-recorder.internal` is not public DNS), so removing the
  public route makes them unreachable by construction. The recorder becomes
  **write-only** for fleet data: it acquires upstream and publishes tick docs;
  nothing polls it per request.
- Keep `/api/v1/feed/status` (already admin-gated diagnostics) as the ops
  surface for live feed health. If a manual live-read is ever needed, add an
  admin-gated debug path — never a public one.
- The standalone viewer (`web/map/viewer.ts`) repoints to the same config →
  live-tick contract; it keeps no absolute vehicle URL of its own.
- Client fallback code, once written (config fetch failure → retry config; tick
  404 → previous tick), covers *this* path's own failures. There is no
  fallback **to the Worker**, and no transport code path that could reach it.

### 4. Enforce the overlay grant at the API (kept, config-driven)

The current `voidOverlay` check is a UI gate. `/api/v1/service/stops`,
`/api/v1/service/wave`, and `/api/v1/service/history` are routed without
authentication, so anyone who knows the URLs can read the data.

- Require a verified session and the caller's `voidOverlay` grant before
  returning service data. Return `401` for a missing/invalid session and `403`
  when the session is valid but the grant is absent. Keep feature-flag
  administration in the existing `feature:enable`/`feature:disable`/`feature:list`
  workflow.
- Derive the user ID only from the verified session; never accept a user ID or
  grant from query parameters.
- Mark protected responses `private` (or `no-store`); keep authenticated data out
  of `caches.default`, the R2/CDN path, and any cache that can bypass
  authorization.
- At this scale, verification must be **local JWKS/JWT validation, not a
  per-request Clerk API call** — otherwise every overlay/SLA poll pays a
  subrequest, latency, and Clerk rate limits. The publishable key for client
  sign-in comes from `/api/v1/auth/config`.
- The SLA page consumes these endpoints. Applying the grant there makes every
  `/sla` viewer a billed Clerk user — that is a **cost decision, not just a
  security one**: see the Clerk caveat below and price it before shipping. If
  SLA live data must reach a broader audience, give it a separate endpoint with
  an explicitly broader policy and a minimized response.

### 5. Rate limiting after offload (and "do we really?")

With vehicles on `live.ttcstatus.ca`, the `/api/*` surface shrinks to: config
(edge-cached), `me/features`, `sla/report`, the granted service endpoints, and
accounts. Legitimate per-user volume there is **a handful of calls per
session** — except the service endpoints, which poll at 30 s per *granted*
user only.

So: yes, but small:

- **`/api/*` per-IP WAF [rate limiting rules] at ~100 requests/minute** (down from the
  ~10/second-class allowance that serving vehicle polls through the Worker
  would have required). NAT math: a granted overlay user generates ~2
  requests/min on `/service/stops`; a config-only user generates ~3 per
  *session*. Even 50 commuters behind one carrier NAT stay under 100/min.
- **Per-session (JWT `sub`) caps only on the granted service endpoints**
  (~10/min) — they are the sole per-user pollers left on `/api/*`, and this is
  what protects a NAT cohort when one shared IP has many granted users.
- **No per-IP rate limiting on `live.ttcstatus.ca`.** Cache absorbs whatever
  clients throw at it; HITs are free, and a scraper hammering it costs nothing.
  A generous abuse rule (e.g. 600/min/IP) is optional insurance, not a
  requirement.
- Keep per-invocation CPU limits configured (denial-of-wallet is a real
  failure mode at this volume), and watch 304-ratio and cache-hit dashboards;
  investigate drops.

### 6. Native rollout: Capacitor now, contract comments for Swift/Kotlin later

The native app is a Capacitor shell around the same React bundle
(`docs/ui-platform.md`), so `shared/live` ships to all platforms unchanged.
What the plan adds:

- **Runtime origins, not baked hosts.** The bundle still needs build-time
  `VITE_API_ORIGIN` for the config fetch itself, but every transport URL —
  live host, cadence, path template — comes from `/api/v1/auth/config` at
  launch. A shipped binary never hardcodes `live.ttcstatus.ca`; we can migrate
  hosts without app updates.
- **Native HTTP parity.** The webview's fetch is URLSession/OkHttp underneath;
  both honor `ETag`/`If-None-Match`, `304`, and `max-age` automatically. The
  existing `cache: 'no-store'` flag keeps per-poll semantics identical to web:
  each poll fetches the fresh tick doc and the edge answers from cache.
- **Foreground-only polling.** The platform service maps native lifecycle
  events (Capacitor `appStateChange`) onto the same `active` signal the
  `VehiclePoller`/`useActivity` seam already uses. No background polling — a
  WebView timer is not a background service, and battery/carriers punish it
  (`docs/ui-platform.md` already warns exactly this).
- **The future-native contract, written down now.** When (not if) a Swift or
  Kotlin rewrite happens, the transport must not be rediscovered. Add this
  comment at the transport seam (`shared/live/polling.ts` and the platform HTTP
  service) so the native rewrite has a spec:

  ```ts
  /**
   * TRANSPORT CONTRACT — see docs/optimize-transport.md before changing.
   * A native (Swift/Kotlin) rewrite implements exactly this:
   *  1. On launch: GET {apiOrigin}/api/v1/auth/config → { clerk, live }.
   *     Never bake live hosts into a binary; this fetch is the only origin source.
   *  2. Poll only while foreground/app-active: tick = floor(now / (live.updateSeconds * 1000));
   *     GET {live.base} + pathTemplate with {tick} substituted.
   *  3. 404 ⇒ tick unpublished (clock ahead of publish) ⇒ retry tick−1 once
   *     ⇒ else keep last-good + age and wait for the next scheduled poll.
   *  4. Network error ⇒ offline ⇒ keep last-good + age; existing backoff.
   *  5. Outage is a body field (`outage` + empty `vehicles`), never an HTTP status. No 5xx parsing exists.
   *  6. This path is broadcast-only: never attach device location, user IDs,
   *     or query parameters. Nearest stop is computed locally (shared/transit).
   */
  ```

- Local notifications (reminders for a stop) already work through the
  notification port; they do not touch this transport.

### 7. Broadcast-only transport invariant (location privacy, first-class)

The original plan for phones stands and is now load-bearing: **the app never
sends us device location; nearest stop is computed locally** against the
broadcast snapshot with `shared/transit`'s `LocalSpatialIndex` (grid + exact
Haversine ranking — cell keys are never API parameters or telemetry).

Write it into the transport as a rule, not a side effect:

- The public/shared transport (live tick objects, config) carries **broadcast
  data only**: bytes identical for every user, no identity, no location, no
  per-user URLs (no query strings — see change 1's format-variant rule).
- Nearest stop, sorting, and personalization are client-side computations over
  the snapshot. They cost the server nothing per user *because nothing about
  the request varies per user* — this invariant is the same shape as the cost
  fix, which is why the scaling plan and the privacy plan do not conflict.
- Enforcement stays layered: `shared/transit` keeps the device-only comments,
  `npm run check:boundaries` keeps native plugins out of features, and the
  Worker privacy boundary (`http/privacy.ts`) rejects location-bearing query
  parameters — extend that rejection to every public path, including any
  future live-host-shaped route.
- Any future feature that needs location server-side ("alert me near my stop")
  is **new API work on the authenticated path** with its own privacy and cost
  review — never a mutation of this transport. That sentence exists so nobody
  in 2027 quietly adds `?lat=&lon=` to the tick URL and breaks the cost
  asymptote and the privacy promise in one PR.

### 8. Defer push (WS/SSE *and* APNs/FCM) — revisit triggers only

With WebSocket hibernation on sharded DOs, outgoing fan-out messages are free
and connections are ~$0.15/M — push would cost tens of dollars a month at 1M
concurrent. But the recorder samples upstream every 30 seconds, so push buys
**zero freshness gain** today while adding reconnect, fan-out, queue-bound,
and fallback machinery. Native push (APNs/FCM) is deferred for the same
reason and one more: backgrounded iOS sockets do not survive suspension
anyway. Local notifications via the existing notification port cover the
near-term product need.

Revisit only if the recorder cadence drops below ~10 seconds or the product
demands event-driven updates. If that happens: prefer APNs/FCM for native and
WS/SSE for web — do not "fix" mobile with long-lived sockets.

### Non-changes

- Keep `cache: 'no-store'` on pollers: it is deliberate tick-following, and
  browser/egress bytes are free either way.
- Do not slim the JSON schema: 11.5 KB wire / 78.8 KB decoded is a client
  parse concern, not a server cost.
- Keep ETags/304: they help users' data plans and R2 provides them natively.
- Do not merge overlay/SLA stores while they are separate pages.
- The asset pipeline (immutable + CDN + IndexedDB + service-worker precache)
  is already free at any scale; leave it alone.
- Keep 30-second client polling. With the CDN serving ticks, request count is
  cost-neutral; there is no freshness reason to double staleness.

## Monthly cost with this plan (2M DAU)

| Line | Assumption | Monthly |
| --- | --- | --- |
| Browser/native vehicle requests | 18B/mo, all CDN hits — no Worker, no R2 | **$0** |
| R2 writes (publish) | 2,880/day, $4.50/M Class A | $0.39 |
| R2 reads (edge fetches) | ≤ ~300 colos × 86.4K ticks/mo ≈ 26M, $0.36/M Class B; realistically fewer colos with warm entries | ≤ $9.40 (expect less) |
| R2 storage | lifecycle ~1 day, ~35 MB/day churn | <$0.01 |
| Config fetches | 1 per launch (~60M/mo), edge-cached `max-age=300` → ~0 reach the Worker | ~$0 |
| Worker requests + CPU (config misses, overlay, SLA, auth) | residual only | ~$5–30 |
| Durable Object | alarms 86.4K/mo < 1M included; duration within 400K GB-s; SQLite rows est. $10–60 (unchanged from today, measure) | ~$10–60 |
| Workers plan minimum | — | $5 |
| **Total** | | **≈ $20–100/mo, roughly flat vs DAU** |

### The 9am rush with this plan

1M concurrent tabs → ~33,000 CDN hits/second → **$0 marginal**; origin
fetches stay bounded at ~300 colos × 120 ticks ≈ 36K R2 reads ≈ **one cent**
for the hour. Doubling DAU to 4M leaves this table essentially unchanged;
the baseline table doubles.

Both models exclude bot/probe traffic on `/api/*` (see change 5) and assume
the 10% `/sla` adoption used above.

## Clerk caveat (watch item)

Clerk bills per **Monthly Retained User** (MRU: a user who returns 24+ hours
after signup), not per request. Included: 50K MRUs per app (Hobby/Pro). Overage
bands: $0.02/MRU (50–100K), $0.018 (100K–1M), $0.015 (1M+), on Pro at $25/mo —
see [Clerk pricing].

| Auth scope | MRU | Monthly |
| --- | --- | --- |
| Experimental overlay only (today) | < 1K | ~$0–25 |
| + `/sla` members-only (10% of DAU) | ~200K | **~$2,825** |
| + half the DAU gated | ~1M | **~$17,225** |
| Auth on the main experience | ~2M | **~$32,225** |

For comparison: the unoptimized transport bill is ≈ $6–7K/mo and the optimized
plan is ≈ $20–100/mo. **A blanket auth requirement would cost ~5× the entire
unoptimized transport bill and ~300× the optimized one.** Native apps change
nothing in this table — sign-in is sign-in — which is exactly why the transport
was designed so native never *requires* it.

Rules we will hold ourselves to:

- **Auth never goes on the transit data path.** The map, vehicles, and
  schedule stay unauthenticated (this is also what keeps change 1 possible).
- Treat every expansion of what requires sign-in (including change 4 applied
  to the SLA page) as a Clerk MRU line item, priced before shipping.
- Dashboard the MRU count and alert at **40K** (headroom under the 50K
  cliff), with a monthly review of retained-user growth.
- If retained auth users approach ~50K, evaluate cheaper gates for
  API-authorization-only needs: Cloudflare Access/service tokens, a
  Worker-issued JWT against D1, or passkeys — Clerk stays for the rich
  account/profile/journal UX, not for blanket API gating.

## Implementation order

1. Extend `/api/v1/auth/config` with the `live` block (base URL, cadence, path
   template) and make it edge-cacheable (`public, max-age=300`); keep it
   additive and backward compatible.
2. Recorder publishes per-tick immutable docs (including outage docs) to the
   dedicated public R2 bucket; add the custom domain, cache rules, the CORS +
   Transform Rule, and the ~1-day lifecycle rule. Verify `cf-cache-status:
   HIT`, native `304`s, and CORS.
3. Repoint the browser poller and the standalone viewer: config-driven base +
   tick derivation, `404 → tick−1 → last-good` handling, keep ETag/304, backoff,
   visibility/foreground pausing, and immediate refresh on activation.
4. **Remove** the `/api/v1/vehicles/streetcar` public route and delete the
   client's Worker-fallback and 5xx/`Retry-After` parsing code. Recorder
   routes become binding-only by construction.
5. Enforce the overlay grant server-side on the service endpoints (401/403,
   `private`, local JWKS verification, no client-supplied identity). Price the
   SLA-page MRU impact before including `/sla` in the grant.
6. Add the `/api/*` WAF rule (~100/min/IP), per-session caps on the granted
   service endpoints, per-invocation CPU limits, and observability dashboards +
   alerts (requests, 304 ratio, cache hit ratio, MRU count).
7. Ship the Capacitor shell with build-time origins only for the config fetch;
   map native lifecycle onto the existing `active` seam; write the
   TRANSPORT CONTRACT comment at the transport seam for the future
   Swift/Kotlin rewrite.
8. Extend the location-query rejection in the privacy boundary to every public
   path; keep the broadcast-only invariant in `shared/transit` comments.
9. Defer WS/SSE and APNs/FCM with the revisit triggers above.

## Completion conditions

- `/api/v1/auth/config` returns the Clerk publishable key and the live block;
  a shipped binary contains no live host, cadence, or vehicle path.
- `cf-cache-status: HIT` for tick objects on the custom domain; `If-None-Match`
  returns native `304`s; the 9am rush adds ~zero origin requests (bounded by
  colos × ticks, not users).
- `/api/v1/vehicles/streetcar` returns the router's 404; no client code path can
  reach a Worker vehicle endpoint; the standalone viewer uses the live path.
- The client handles exactly three cases on the live path — 200 document,
  404 → previous tick → last-good, network error → offline — with no 5xx or
  `Retry-After` parsing anywhere.
- A total upstream outage publishes `{ vehicles: [], outage }` docs every tick;
  clients render the honest unavailable state; stale data is never presented as
  fresh (`fetchedAt`/age display unchanged).
- Recorder sampling stays at 30 seconds; client polling stays at 30 seconds
  while foreground, with immediate refresh on activation.
- Unauthenticated calls to service endpoints return `401`; a signed-in caller
  without the grant receives `403`; no protected response is reachable through
  `caches.default`, the R2/CDN path, or query parameters.
- No public path accepts location-bearing parameters; `shared/transit` stays
  device-only; `npm run check:boundaries` passes.
- Rate limits, dashboards, and alerts exist and fired correctly through a real
  rush; the monthly bill matches the modeled table (investigate gaps).
- MRU count is dashboarded with an alert at 40K; any planned expansion of
  required sign-in has a priced MRU line item.

[Workers pricing]: https://developers.cloudflare.com/workers/platform/pricing/
[Durable Objects pricing]: https://developers.cloudflare.com/durable-objects/platform/pricing/
[R2 pricing]: https://developers.cloudflare.com/r2/pricing/
[R2 custom domain]: https://developers.cloudflare.com/r2/buckets/public-buckets/
[cache rules]: https://developers.cloudflare.com/cache/rules/
[Transform Rules]: https://developers.cloudflare.com/rules/transform/
[rate limiting rules]: https://developers.cloudflare.com/waf/rate-limiting/
[Clerk pricing]: https://clerk.com/pricing