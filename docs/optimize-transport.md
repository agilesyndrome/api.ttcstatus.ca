# Transport optimization plan

## Goal

Keep the recorder's 30-second acquisition cadence and the existing public
vehicle API, while reducing avoidable browser requests and protecting the
experimental service data behind the same per-user grant that enables
`voidOverlay`.

Prefer the smallest change that removes real work. Do not add a streaming
protocol, a delta ledger, a new payload format, or a telemetry pipeline unless
the simpler changes below leave a concrete problem unsolved.

## What the current system does

- `ServiceRecorder` is a singleton Durable Object. It acquires the live feeds on
  its 30-second schedule whether or not a browser is open.
- The vehicle endpoint reads the recorder's published snapshot. The browser has
  one vehicle poller per page, retains an ETag, pauses when hidden/offline, and
  backs off after errors.
- The vehicle poller requests with `cache: 'no-store'`. This bypasses the
  browser's HTTP cache so it can check for a new snapshot at the advertised
  cadence. The Worker also uses `caches.default` as an internal per-location
  response cache. That avoids repeating recorder work while the entry is warm;
  it does not avoid invoking and billing the Worker for each browser request.
- An ETag can turn a response into an empty `304`. This saves the response body,
  but the request still reaches the Worker. Cloudflare's [Workers pricing]
  counts requests served from Workers Cache; the Cache API used by this code is
  an in-Worker cache, not a way to remove the inbound request charge.
- The supplied cold-start capture shows about 11.5 KB transferred for the
  vehicle JSON, with about 78.8 KB decoded. That makes compression effective;
  changing the schema to save bytes is lower priority than reducing requests.
- The map overlay and `/sla` are separate pages. Each has its own service-data
  consumers. Sharing a browser store would save requests only if both consumers
  are mounted in the same page; the current layout does not do that. The
  recorder already shares upstream acquisition between them.

At 1,000 browsers polling continuously every 30 seconds, the vehicle endpoint
would receive about 86.4 million requests in a 30-day month. At the published
Workers rate, that is about $23 in request overage after the 10 million included
requests, before CPU and other endpoints. This is a deliberately high,
always-open ceiling, not a traffic forecast. Static assets are free and
ordinary Workers egress has no charge. See [Workers pricing] and [Durable
Objects pricing] when evaluating any persistent connection design.

At 60-second client polling, the same ceiling is 43.2 million requests/month,
or about $10 in request overage. The request-charge saving is about $13/month
at this scale; the direct transfer saving is small in dollar terms because
egress is not billed. The reason to make this change is lower request volume
with a small client-side change, accepting up to 30 seconds more staleness.

## Changes

### 1. Enforce the overlay grant at the API

The current `voidOverlay` check is a UI gate. `/api/v1/service/stops`,
`/api/v1/service/wave`, and `/api/v1/service/history` are routed without Clerk
authentication, so anyone who knows the URLs can read the data. That does not
meet the document's claim that overlay authorization is server-enforced.

Require a verified Clerk session and the caller's `voidOverlay` feature grant
before returning service data. Derive the user ID only from the verified
session; never accept a user ID or grant from query parameters. Return `401`
for a missing/invalid session and `403` when the session is valid but the grant
is absent. Keep feature-flag administration in the existing `feature:enable`,
`feature:disable`, and `feature:list` workflow.

Do not expose a protected response from a shared public HTTP cache. The current
`caches.default` cache is called after request handling begins, so authorization
must run before any cached result is returned. Mark protected responses
`private` (or `no-store` if private caching is not needed); keep authenticated
data out of a cache path that can bypass authorization.

The SLA page also consumes the service endpoints. Apply the same authorization
policy to those consumers: users who need live service data must have the grant.
If SLA live data must be available to a broader audience, give it a separate
endpoint with an explicitly broader policy and a minimized response. Do not
silently leave the shared service endpoints public to preserve that behavior.

### 2. Keep HTTP and reduce polling only where freshness permits

Keep the existing vehicle response as the canonical snapshot and recovery
surface. Keep the recorder at 30 seconds. For ordinary map viewers, change the
client polling interval to 60 seconds while preserving immediate fetch on page
activation/visibility return and the current error backoff. This halves
steady-state vehicle requests and permits up to one additional 30-second tick
of client staleness. Keep 30-second service-state polling for the overlay,
because its stop-state semantics and `fresh`/`due`/`void` transitions are more
time-sensitive. Keep the SLA wave's existing slower cadence.

The 60-second interval is a client delivery choice; it must not alter recorder
sampling or the public endpoint's acquisition behavior. Preserve ETags and
`X-Live-Next-Update-At`. On visibility return, fetch immediately so the client
does not wait for its next scheduled interval.

### 3. Do not build a shared service stream for the current page layout

The service endpoints already read from one recorder. The map overlay and SLA
page are separate routes, so consolidating their React hooks does not currently
coalesce requests from a single browser page. Revisit a shared browser store if
the product later shows overlay and SLA live data together.

A WebSocket or SSE transport would reduce repeated HTTP polls, but it adds
connection lifecycle, reconnect/recovery, fan-out, queue bounds, deployment
fallbacks, and Durable Object duration/request costs. Defer it unless the
60-second vehicle cadence fails the freshness requirement or observed traffic
makes the request cost worth that additional system.

## Implementation order

1. Protect service endpoints with verified identity and the `voidOverlay` grant;
   ensure unauthorized responses cannot be served from a shared cache.
2. Update the affected API contract and browser request path so authorized
   overlay/SLA consumers send their Clerk session. Keep unauthorized UI states
   clear and make no service request for signed-out or ungranted users.
3. Move ordinary vehicle polling to 60 seconds; preserve immediate refresh on
   activation/visibility return and 30-second recorder sampling.
4. Keep the existing JSON snapshots, ETags, and HTTP recovery. Remove duplicate
   polling only if two consumers are actually mounted on the same page.

## Completion conditions

- Direct unauthenticated calls to service endpoints return `401`.
- A signed-in caller without the `voidOverlay` grant receives `403`.
- A granted caller can use the overlay and its service data; revoking the grant
  prevents subsequent API reads.
- No protected response is available through a public shared cache.
- The recorder continues sampling at 30 seconds; ordinary vehicle polling is
  60 seconds and resumes immediately when the page becomes active again.
- Vehicle and service outage, stale-data, and `304` behavior remain honest.

[Workers pricing]: https://developers.cloudflare.com/workers/platform/pricing/
[Durable Objects pricing]: https://developers.cloudflare.com/durable-objects/platform/pricing/
