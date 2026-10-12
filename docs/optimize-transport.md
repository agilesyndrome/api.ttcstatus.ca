# Transport optimization plan

## Goal

Scale the browser data path to **2 million daily users** with a **9am rush of
1 million concurrently open tabs**, without a bill that grows linearly with
users, while keeping the recorder's 30-second acquisition cadence, the
existing public vehicle API response shape, and server-enforced
authorization for experimental service data.

The cost driver at this scale is **requests that invoke the Worker**. The fix
is to remove per-user request billing from the public data path by serving
identical public bytes from the CDN — not to tune polling intervals. Do not
add a streaming protocol or a delta ledger while the recorder samples
upstream every 30 seconds; push buys no freshness at that cadence.

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

### Why the previous draft does not scale here

The earlier version priced a 1,000-browser ceiling (~$23/mo overage) and
recommended 60-second polling to save ~$13/mo. At the 2M-DAU design point that
same change saves ~$2.7K/mo of a ~$6–7K/mo bill — and leaves the cost curve
**linear in users forever**. It also traded away product freshness (60-second
vehicle positions) for a saving that the CDN change below makes unnecessary.

## Changes

### 1. Serve the public vehicle snapshot from the CDN (highest impact)

The snapshot is identical for every user, already quantized to the 30-second
tick, and public. Publish it once per tick to object storage and let
Cloudflare's cache serve every browser:

- The recorder (already awake every 30 seconds) additionally `PUT`s the
  published snapshot to a **dedicated public R2 bucket** (e.g. `live/vehicles.json`)
  with object metadata `cache-control: public, max-age=25` and its ETag. A
  dedicated bucket keeps the GTFS archive bucket private. R2 `PUT`s are atomic
  per object; a read during a tick lands on the previous good object.
- Attach an [R2 custom domain] (e.g. `live.ttcstatus.ca`). Cache hits at the
  edge invoke no Worker and touch no R2 — free and unlimited. Only per-POP
  revalidations reach R2 (~300 colos × 2,880 ticks/day), bounded by topology,
  **not by user count**.
- R2 custom domains already provide `ETag`/`If-None-Match` → native `304`s, so
  the client's existing 304 handling works unchanged. Add CORS and the static
  `x-live-update-seconds: 30` header via [Transform Rules] (no Worker on this
  path). The per-tick `x-live-next-update-at` value cannot be a static
  transform: include `nextUpdateAt` in the published JSON body instead; the
  client treats the header/body as optional and falls back to 30 s.
- Browser change is small: point the poller in `shared/live` at the custom
  domain. Keep ETag retention, 304 handling, hidden/offline pause, backoff,
  and immediate refresh on visibility return exactly as they are.
- **Never publish protected data this way.** Only the public fleet snapshot.
  Overlay/service/SLA data stays on the Worker + auth path.
- Keep the existing Worker vehicle endpoint as the recovery/fallback surface
  (and for the standalone viewer if desired); it bills only what actually
  hits it.
- Verify `cf-cache-status: HIT`, native `304`s, and CORS before cutting the
  client over.

This changes the cost asymptote from O(users) to O(ticks): **≈ $6–7K/mo →
≈ $25–100/mo** (see tables).

### 2. Keep 30-second client polling; drop the 60-second downgrade

With the CDN serving the snapshot, request count is cost-neutral. There is no
reason to double staleness for ordinary map viewers; vehicle positions every
60 seconds already reads as laggy. Keep the client at 30 seconds and keep the
recorder at 30 seconds.

The 60-second interval remains the **fallback lever only**: if CDN offload is
rejected, it halves the baseline request bill (~$2.7K/mo at this scale) and
must be decided as that trade-off, not as a "$13/mo" one. If the Worker path
stays primary, also add ±15–20% jitter to poll intervals so a million clients
do not fire on the same tick.

### 3. Enforce the overlay grant at the API (kept, with amendments)

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
  subrequest, latency, and Clerk rate limits.
- The SLA page consumes these endpoints. Applying the grant there makes every
  `/sla` viewer a billed Clerk user — that is a **cost decision, not just a
  security one**: see the Clerk caveat below and price it before shipping. If
  SLA live data must reach a broader audience, give it a separate endpoint with
  an explicitly broader policy and a minimized response.

### 4. Keep the Worker recovery path stampede-safe

Even with the CDN serving the snapshot, the Worker path (fallback endpoint,
overlay, SLA) must survive synchronized bursts:

- Serve up to one-tick-stale while a single request refreshes the POP entry
  (single-flight / stale-while-revalidate), and label staleness via headers so
  the existing "never serve stale as fresh" honesty is preserved.
- Do not put a synchronous singleton-DO subrequest on the rush-hour critical
  path; the recorder's publication should be write-only for the public path.

### 5. Rate limiting and abuse controls

At 18B requests/month of legitimate traffic, scrapers and probes ride along,
and every `/api/*` probe invokes the Worker:

- WAF [rate limiting rules] on `/api/*` (per-IP; stricter for
  unauthenticated/ungranted service endpoints).
- Keep per-invocation CPU limits configured (denial-of-wallet is a real
  failure mode at this volume).
- Watch the 304 ratio and cache hit ratio in dashboards; investigate drops.

### 6. Observability before scale

Add per-endpoint request/304/cache-hit dashboards and spike alerting using
Workers Observability and the GraphQL Analytics API — no per-request telemetry
bills. **Do not** add per-request `writeDataPoint` calls to get it; the
recorder's existing once-per-tick analytics is the right pattern.

### 7. Defer push (WS/SSE) as a product decision, not a cost decision

With WebSocket hibernation on sharded DOs, outgoing fan-out messages are free
and connections are ~$0.15/M — push would cost tens of dollars a month at 1M
concurrent. But the recorder samples upstream every 30 seconds, so push buys
**zero freshness gain** today while adding reconnect, fan-out, queue-bound,
and fallback machinery. Revisit only if the recorder cadence drops below ~10
seconds or the product demands event-driven updates. See [Workers pricing] and
[Durable Objects pricing] when evaluating any persistent-connection design.

### Non-changes

- Keep `cache: 'no-store'` on pollers: it is deliberate tick-following, and
  browser/egress bytes are free either way.
- Do not slim the JSON schema: 11.5 KB wire / 78.8 KB decoded is a client
  parse concern, not a server cost.
- Keep ETags/304: they help users' data plans and R2 supports them natively.
- Do not merge overlay/SLA stores while they are separate pages.
- The asset pipeline (immutable + CDN + IndexedDB + service-worker precache)
  is already free at any scale; leave it alone.

## Monthly cost with this plan (2M DAU)

| Line | Assumption | Monthly |
| --- | --- | --- |
| Browser vehicle requests | 18B/mo, all CDN hits — no Worker, no R2 | **$0** |
| R2 writes (publish) | 2,880/day, $4.50/M Class A | $0.39 |
| R2 reads (edge revalidations) | ≤ ~300 colos × 86.4K ticks/mo ≈ 26M, $0.36/M Class B; realistically fewer colos with warm entries | ≤ $9.40 (expect less) |
| R2 storage | ~3 retained versions × ~12 KB | <$0.01 |
| Worker requests + CPU (overlay, SLA, auth, fallback) | ~20–40M requests | ~$10–30 |
| Durable Object | alarms 86.4K/mo < 1M included; duration within 400K GB-s; SQLite rows est. $10–60 (unchanged from today, measure) | ~$10–60 |
| Workers plan minimum | — | $5 |
| **Total** | | **≈ $25–100/mo, roughly flat vs DAU** |

### The 9am rush with this plan

1M concurrent tabs → ~33,000 CDN hits/second → **$0 marginal**; origin
revalidations stay bounded at ~300 colos × 120 ticks ≈ 36K R2 reads ≈ **one
cent** for the hour. Doubling DAU to 4M leaves this table essentially
unchanged; the baseline table doubles.

Both models exclude bot/probe traffic (see change 5) and assume the 10%
`/sla` adoption used above.

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
plan is ≈ $25–100/mo. **A blanket auth requirement would cost ~5× the entire
unoptimized transport bill and ~500× the optimized one.**

Rules we will hold ourselves to:

- **Auth never goes on the transit data path.** The map, vehicles, and
  schedule stay unauthenticated (this is also what keeps change 1 possible).
- Treat every expansion of what requires sign-in (including change 3 applied
  to the SLA page) as a Clerk MRU line item, priced before shipping.
- Dashboard the MRU count and alert at **40K** (headroom under the 50K
  cliff), with a monthly review of retained-user growth.
- If retained auth users approach ~50K, evaluate cheaper gates for
  API-authorization-only needs: Cloudflare Access/service tokens, a
  Worker-issued JWT against D1, or passkeys — Clerk stays for the rich
  account/profile/journal UX, not for blanket API gating.

## Implementation order

1. Publish the snapshot to a dedicated public R2 bucket on each recorder tick;
   add the custom domain, [cache rules], and [Transform Rules] (CORS +
   `x-live-update-seconds`; `nextUpdateAt` in the body). Verify `HIT`s,
   native `304`s, and CORS.
2. Point the browser vehicle poller at the custom domain; keep ETag, backoff,
   visibility, and immediate-refresh-on-activation behavior.
3. Enforce the overlay grant server-side on the service endpoints (401/403,
   `private`, local JWKS verification, no client-supplied identity). Price
   the SLA-page MRU impact before including `/sla` in the grant.
4. Keep 30-second client cadence; discard the 60-second downgrade (retain it
   only as the documented fallback with jitter).
5. Add WAF rate limiting on `/api/*`, per-invocation CPU limits, and
   observability dashboards + alerts (requests, 304 ratio, cache hit ratio,
   MRU count).
6. Keep the Worker recovery path single-flight and stampede-safe.

## Completion conditions

- `cf-cache-status: HIT` for the vehicle snapshot on the custom domain;
  `If-None-Match` returns native `304`s; the 9am rush adds ~zero origin
  requests (bounded by colos × ticks, not users).
- Recorder sampling stays at 30 seconds; client vehicle polling stays at 30
  seconds with immediate refresh on activation/visibility return; outage,
  stale-data, and `304` behavior remain honest.
- Unauthenticated calls to service endpoints return `401`; granted callers
  work; a signed-in caller without the grant receives `403`; no protected
  response is reachable through `caches.default`, the R2/CDN path, or query
  parameters.
- Only public fleet data is published to R2; overlay/SLA/account data never
  leaves the authenticated Worker path.
- Rate limits, dashboards, and alerts exist and fired correctly through a
  real rush; the monthly bill matches the modeled table (investigate gaps).
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