# Overlay optimization plan — the void overlay for every user

Companion to [optimize-transport.md](./optimize-transport.md) (the fleet path's plan):
same conventions, same doctrines, same tick grid. Execution notes live in
`docs/optimize-overlay-thunks.md` (created by the first executing agent), per the
transport plan's convention.

## Goal

Ship the delivered-service overlay (the void field) to **every visitor** — signed-out,
no grant, no Clerk — at the same cost asymptote the fleet got: **O(ticks), not
O(users)**, with rendering that does not set phones on fire.

Premise (user decision): every story below lands in one release, then the overlay is
on for everyone. The per-user `voidOverlay` grant is **decommissioned, not extended**.

## What the overlay does today — and why that cannot go to everyone

- Every enabled viewer polls `/api/v1/service/stops` every 30 s. Each poll: Worker
  invocation → D1 grant read (`callerHasFlag`) → singleton `ServiceRecorder` DO
  subrequest → **the DO recomputes the whole field per request** (window SQL reads +
  `serviceStatesAt` over ~3 k stops) → the Worker re-serializes, double-stringifies and
  SHA-256s the body. `cache-control: private` (correct for granted data) means nothing
  absorbs fan-out. The payload is tick-stable, so all of that per-request work buys
  bytes that already exist — the DO's own `runTick` computes the identical states once
  per tick for the void-stops counter and throws them away.
- Seeing the overlay requires Clerk sign-in → billed per MRU.
- Browser: a 1 Hz heartbeat (`useNow`) re-advances every stop, rebuilds a giant
  signature string, and with ~3 k stops at 0.25-quantised dryness some stop crosses a
  visible step nearly every second — so the field effectively full-repaints per second.
  Every monitored segment also renders a second `<line>` with an infinite
  `stroke-dashoffset` keyframe; SVG dash animation is main-thread paint, so at
  city-wide zoom that is thousands of concurrent 60 fps paint loops.

At the 2M-DAU / 1M-concurrent-9am design point (optimize-transport.md's own model):

| Line                          | All-users, today                                                                    | After this plan                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Worker requests (stops)       | 18B/mo ≈ $5,400 + CPU $720–1,440                                                    | CDN hits — **$0**                                                |
| Singleton DO                  | 33 k req/s at 9am through one object — impossible (falls over long before the bill) | write-only again; $0 marginal                                    |
| Clerk MRU (sign-in to see it) | $2,825/mo @ 200 k … ~$32 k @ 2M                                                     | **$0** — no sign-in required                                     |
| R2                            | —                                                                                   | writes ≈ $0.78/mo, edge fetches ≤ $19/mo, storage ~$0.05/mo      |
| Browser (per open tab)        | 86,400 full recompute-repaint cycles/day; thousands of paint animations             | wakes only at visible-change deadlines; viewport-gated animation |

The detection math itself (void thresholds, unmonitored honesty, baselines, the shared
machine running identically server- and browser-side) needs no rework. This plan fixes
the pipes and the paint.

## The five levers (why the epics are shaped this way)

1. **Publish, don't serve.** The stops payload is broadcast data — identical for every
   viewer, tick-quantized, derived from public feeds. It gets the per-tick immutable
   R2 + CDN treatment `vehicles.json` got. `?routes=` was never a client dependency
   (`routeIds` ship per state; filtering is local).
2. **One transport path, no fallback.** The Worker stops route and the recorder's
   `/states` route are deleted when traffic reaches them ≈ 0 — not feature-flagged.
3. **Access model, priced honestly.** History is broadcast (public + edge-cached);
   wave stays a members surface (session-only — the E4S5 decision stands); the per-user
   flag dies everywhere. The grant lookup that would have needed caching is deleted
   instead.
4. **Wake on truth, not on a timer.** Dryness grows one second per second, so a stop's
   next visible change is computable exactly. The heartbeat schedules at the earliest
   actual change — fewer wakes than 1 Hz _and_ transitions land at the true moment.
5. **Animate what's on screen.** Flows gate on viewport, minimum length and gestures;
   the colour field carries the information, motion is emphasis.

## Conventions

- **IDs.** `E{epic}S{story}` — Epic 4, Story 2 is `E4S2`.
- **Order.** Stories are listed in chronological attack order; within an epic, the
  order is dependency order. An epic starts after the previous epic's boundary story
  passes, with one carve-out: **Epics 4–5 (browser engine + paint) share no files with
  Epics 1–3 (transport/access)** — they may proceed in parallel once their own
  dependencies land; the epic-boundary rule otherwise holds.
- **Sizes.** **XS** (hours), **S** (≤ a day), **M** (a few days). **Nothing is Large.**
  Any story that grows past M is split on the spot.
- **Testing 95/5.** Each story ships focused unit tests for its new pure modules
  (~5% of its effort). Live validations (typecheck, `check:boundaries`, `test:app`,
  `build:api`) run only in epic boundary stories, and the **browser suite runs once, at
  the very end** (E6S4) — the same directive optimize-transport.md worked under.
- **`(op)`** = Cloudflare dashboard/CLI operator item, not doable from this checkout.
- **One tick grid serves every live document**: `tickId = floor(epochMs / 30_000)`,
  shared with `vehicles.json`. Do not shift this grid (see optimize-transport.md's
  warning about the synchronized-global-404 day). Cadence changes are client poll
  cadence only; tick derivation stays on the grid.

## Story map — the attack order

Status is marked here as work completes: `[x]` = code-complete and
boundary-validated, `[ ]` = not started. Per-story details, decisions and
operator items live in `docs/optimize-overlay-thunks.md`.

| #   | ID   | Story                                                                         | Epic | Size | Depends on        | Status |
| --- | ---- | ----------------------------------------------------------------------------- | ---- | ---- | ----------------- | ------ |
| 1   | E1S1 | Service-stops tick-document contract + pure writer                            | 1    | S    | —                 | [x]    |
| 2   | E1S2 | Recorder assembles the wire payload once per tick; `/states` serves bytes     | 1    | S    | E1S1              | [x]    |
| 3   | E1S3 | Publish `service-stops.json` per tick to the live bucket                      | 1    | S    | E1S2              | [x]    |
| 4   | E1S4 | `auth/config` gains the `overlay` block (the rollout switch)                  | 1    | XS   | —                 | [x]    |
| 5   | E1S5 | **Epic 1 boundary: the live path exists end-to-end**                          | 1    | XS   | E1S1–E1S4         | [x]    |
| 6   | E2S1 | `useServiceFeed` repoints to the tick path (three-case contract)              | 2    | S    | E1S5              | [x]    |
| 7   | E2S2 | Signed-out enablement (config switch replaces the flag)                       | 2    | S    | E1S4, E2S1        | [x]    |
| 8   | E2S3 | Preview middleware serves the stops tick path from fixtures                   | 2    | S    | E1S1              | [x]    |
| 9   | E2S4 | `useSlaLive` stops poll repoints to public ticks                              | 2    | S    | E2S1              | [x]    |
| 10  | E2S5 | **Epic 2 boundary: no client path reaches the Worker stops route**            | 2    | XS   | E2S1–E2S4         | [x]    |
| 11  | E3S1 | `/service/history` goes public + edge-cached                                  | 3    | S    | —                 | [x]    |
| 12  | E3S2 | `/service/wave`: session-only gate (per-user flag deleted)                    | 3    | XS   | —                 | [x]    |
| 13  | E3S3 | Delete the stops route + the recorder's `/states` route                       | 3    | S    | E2S5              | [x]    |
| 14  | E3S4 | wave/history CPU hygiene: serialize once, ETag once per tick                  | 3    | S    | E3S1, E3S2        | [x]    |
| 15  | E3S5 | **Epic 3 boundary: removal + access model validated**                         | 3    | XS   | E3S1–E3S4         | [x]    |
| 16  | E4S1 | Visible-bounds seam (camera viewport → service layer)                         | 4    | S    | —                 | [x]    |
| 17  | E4S2 | Deadline math (pure): ms-to-next-visible-change per stop                      | 4    | S    | —                 | [x]    |
| 18  | E4S3 | The scheduler replaces the 1 Hz heartbeat                                     | 4    | M    | E4S1, E4S2        | [x]    |
| 19  | E4S4 | Zero wakes while hidden                                                       | 4    | XS   | E4S3              | [x]    |
| 20  | E4S5 | Engine micro-opts: numeric signature, memoized geometry, visible-only advance | 4    | S    | E4S1, E4S3        | [x]    |
| 21  | E4S6 | **Epic 4 boundary: wakeups profiled before/after**                            | 4    | XS   | E4S1–E4S5         | [x]    |
| 22  | E5S1 | Viewport-cull the painted field                                               | 5    | M    | E4S1              | [x]    |
| 23  | E5S2 | Gate the flow animations (visible + minimum length)                           | 5    | S    | E5S1              | [x]    |
| 24  | E5S3 | Pause flows during camera gestures                                            | 5    | S    | E5S2              | [x]    |
| 25  | E5S4 | **Epic 5 boundary: device spot-check + element counts**                       | 5    | XS   | E5S1–E5S3         | [x]    |
| 26  | E6S1 | Decommission the `voidOverlay` grant machinery                                | 6    | S    | E2S5, E3S5        | [x]    |
| 27  | E6S2 | Docs + contracts reconcile                                                    | 6    | S    | E6S1 (order only) | [x]    |
| 28  | E6S3 | Operator runbook: rules, caps, dashboards (op)                                | 6    | XS   | E1S5              | [x]    |
| 29  | E6S4 | **Final validation + the flip**                                               | 6    | XS   | E1–E5 complete    | [x]    |

## Epic 1 — Broadcast publication (the stops doc on the live path)

Outcome: the recorder publishes an immutable per-tick service-stops document to the
public live bucket beside `vehicles.json`, computed once per tick — and the interim
`/states` route serves the same bytes instead of recomputing per request.

- [x] **E1S1 — Service-stops tick-document contract + pure writer (S).** New pure module
      (e.g. `workers/api/src/service/stops-tick-doc.ts`), the stops twin of the vehicles
      tick-doc: `buildStopsTickDocument(states | null, tickId, { tickMs })` →
      `{ schemaVersion: 1, at, tickId, states: StopServiceState[] , outage? }` where the
      states are wire-rounded (`wireReadyStopState` moves here) and `routeIds` are baked in.
      A recorder that cannot see anything publishes
      `{ states: [], outage: { since, tickId } }` — the change-2 honesty pattern;
      `unmonitored`/`collecting` per-stop states carry the honest story inside a normal
      doc. No query-string variance ever on this path (format variants are paths). Same
      tick grid as vehicles. Accept: unit tests for states / outage / empty / grid skew.
- [x] **E1S2 — Recorder assembles the wire payload once per tick (S).** Move the
      `routesByStop` assembly and wire rounding into `runTick`'s existing `currentStates`
      pass (it already computes states for the void counter), serialize once, and have the
      interim `/states` route serve the stored bytes. The per-request recompute — window
      SQL + `serviceStatesAt` + per-stop sorts on every poll — becomes once per tick.
      Accept: `/states` returns identical bytes within a tick (test); telemetry shows one
      compute per tick.
- [x] **E1S3 — Publish `service-stops.json` per tick (S).** `publishTickDocument` grows a
      second `PUT`: `live/t/<tickId>/service-stops.json`, `cache-control: public,
max-age=600`, `content-type: application/json`, non-fatal failure telemetry beside the
      vehicles publish. No-op without `LIVE_BUCKET`. Accept: both objects appear per tick in
      preview; a deliberately broken stops publish never breaks acquisition, folds or
      retention.
- [x] **E1S4 — `auth/config` gains the `overlay` block (XS).** Additive
      `overlay: { enabled: boolean, pathTemplate: string, pollSeconds: number }` from new
      wrangler vars (`OVERLAY_ENABLED`, `LIVE_SERVICE_PATH_TEMPLATE`,
      `OVERLAY_POLL_SECONDS`). `enabled: false` is the shipped default until E6S4 — **the
      rollout is a var flip, no client release**. `pollSeconds` may exceed the 30 s grid
      (clients poll less often than ticks exist); tick derivation stays on the grid.
      Accept: unit tests for block shape, defaults and fallbacks; response stays
      `public, max-age=300` and additive.
- [x] **E1S5 — Boundary (XS).** Typecheck + `check:boundaries` + `test:app` + `build:api`;
      the preview publish path verified (states doc + outage doc); the `live/t/`
      lifecycle rule covers the new prefix (op: verify once); bucket CORS is already `*`
      and the page CSP's `connect-src` already includes the host — assert both so nobody
      "fixes" them away.

## Epic 2 — Client repoint to the live path

Outcome: the overlay's data path is the CDN; the enable prerequisite is the config
block, not an account.

- [x] **E2S1 — `useServiceFeed` repoints (S).** Config → tick URL (the existing
      `liveTickPath` / `requestTickUpdate` seam in `shared/live`) → the three-case
      contract: **200** → use the doc; **404** → retry `tick − 1` once → last-good
      (unpublished is a no-op, not a failure); **network error** → last-good + existing
      backoff. Keep ETag/304 (R2 native), hidden/offline pausing, non-overlap, immediate
      refresh on activation. Delete the `x-live-*` parsing — cadence comes from
      `overlay.pollSeconds`. An outage doc renders the honest unavailable state (states
      empty, age honest) — never a fabricated void, never a "failed" banner for publish
      lag. Accept: unit tests for all three cases + clock skew; `grep '/api/v1/service/stops'`
      over `web/` comes back empty.
- [x] **E2S2 — Signed-out enablement (S).** `ServiceLayer`'s enable predicate becomes
      `requested && !suspended && data && overlayConfig.enabled` — no account state in it,
      no `useFeatureFlags` import. Layer-off still means **zero requests**, unchanged.
      Accept: signed-out fixture render shows the field; zero fetches with the layer off.
- [x] **E2S3 — Preview middleware serves the stops tick path (S).**
      `scripts/preview/preview-api.mjs` serves `/live/t/<tick>/service-stops.json` from the
      service fixtures: 404 future ticks, 304 via ETag, outage docs, `max-age=600` — the
      vehicles path's exact mechanics. Accept: the dev overlay works same-origin; the
      browser check scripts intercept the new path.
- [x] **E2S4 — `useSlaLive` stops poll repoints (S).** The `/sla` live tier reads the
      public stops ticks (the same broadcast data); the report page itself stays
      members-only (E4S5 decision). The wave poll is untouched (E3 keeps it). Accept:
      `/sla` slivers render from fixtures via the tick path.
- [x] **E2S5 — Boundary (XS).** Code validations; prove by grep + unit that no client path
      can reach the Worker stops route — the gate for E3S3's deletion.

## Epic 3 — Access model + Worker path removal

Outcome: history is public broadcast data; wave is the members surface it always was
(minus the per-user flag); the Worker stops route and the recorder's `/states` route
are gone — the recorder is write-only again.

- [x] **E3S1 — `/api/v1/service/history` goes public (S).** The selected stop's expanded
      card details are broadcast (identical per stop for everyone); the narrowing-filter
      requirement (`?stop=` or `?routes=`) stays so queries stay bounded. Router
      restructure: history leaves the grant block; `private` → `public, max-age=300` with
      the map endpoints' edge-cache pattern (cache keyed by full URL). OpenAPI + paths
      regenerate. Accept: signed-out card fetch works; the second identical fetch is an
      edge HIT.
- [x] **E3S2 — `/service/wave`: session-only gate (XS).** The `callerHasFlag` check is
      deleted; the verified-session gate stays (the `/sla` members decision). Per-session
      caps move to the (op) runbook. Accept: 401 unauthenticated; any valid session reads
      (no flag lookup — the grant read that would have needed caching is deleted instead);
      unit test.
- [x] **E3S3 — Delete the stops route + the recorder's `/states` route (S).** Router line,
      `serviceStopsResponse`, and the DO's `/states` handler are deleted; OpenAPI +
      `contracts/paths.ts` regenerate; a removal test mirrors the vehicles one. The
      internal per-tick compute from E1S2 is a method call, not a route — it stays.
      Accept: `/api/v1/service/stops` returns the router's 404; no code path reaches the
      DO for states.
- [x] **E3S4 — wave/history CPU hygiene (S).** Both still serialize twice + SHA-256 per
      request, and their payloads are tick-stable — hash once per tick (isolate cache keyed
      by tickId) and serialize once. Members-only volume makes this cheap to skip; it is
      done because it is wrong, not because it is expensive. Accept: a unit test asserts
      one serialize + one hash per tick under N same-tick requests.
- [x] **E3S5 — Boundary (XS).** Full code validations once; removal held; history public +
      cached; wave session-only.

## Epic 4 — The field engine (wake on truth, not on a timer)

Outcome: the 1 Hz heartbeat is gone. The overlay recomputes and repaints only when a
visible value actually crosses a visible step — and the transition lands at the true
moment, not the next tick of a 1 s clock. (File-independent of Epics 1–3; may run in
parallel once E4S1/E4S2 land.)

- [x] **E4S1 — Visible-bounds seam (S).** `TransitMap`/`useMapCamera` expose the current
      world-rect viewport (+ margin) to the service layer, memoised on camera idle; a pure
      helper tests a feature/edge bbox against it. No per-frame allocations. Accept: unit
      tests for the helper and the margin behaviour.
- [x] **E4S2 — Deadline math (S, pure).** The inverse of `advanceStopState`: per stop, the
      ms until its next _visible_ change — the next 0.25-quantised dryness step, or the
      fresh→due / due→void / void-absolute boundary, whichever comes first;
      blind/collecting stops never schedule. An aggregator takes the minimum with clamps
      (≥ 250 ms floor, ≤ 5 s safety re-check). Accept: unit tests pin exact crossing times
      and must agree with `advanceStopState`'s semantics (the wave-field tests already pin
      those).
- [x] **E4S3 — The scheduler replaces `useNow` (M).** One `setTimeout` at the earliest
      visible deadline; reschedule on feed tick, camera change, selection change;
      `statesByStop` advances on wake; the 1 s interval is deleted. Accept: wakeups drop
      from 86,400/day to a few hundred at typical zoom (profile); transitions still land
      within 250 ms of the true moment (unit).
- [x] **E4S4 — Zero wakes while hidden (XS).** The scheduler gates on the same
      `activity.active` seam the feed already uses. Accept: a hidden tab performs no timer
      work (unit + manual).
- [x] **E4S5 — Engine micro-opts (S).** Numeric rolling-hash signature (replaces the
      O(stops) string join per wake); WeakMap-memoised `cumulative()` per edge (geometry is
      static per map version); precomputed `Map<edgeId, Edge>` for `carTint`'s linear
      `edges.find`; `advanceStopState` runs only for visible stops (E4S1's set). Accept:
      unit tests; the hash covers exactly the fields the string held.
- [x] **E4S6 — Boundary (XS).** Wake and repaint counts profiled before/after
      (devtools), unit suite green.

## Epic 5 — Paint & animation (what's on screen is all that moves)

Outcome: DOM count and paint cost scale with the viewport, not the network.

- [x] **E5S1 — Viewport-cull the painted field (M).** `TrackService` paints only edges
      intersecting the visible rect (+ margin); the painted memo keys on the visible-edge
      set + the field signature. City zoom renders hundreds of elements, not thousands.
      Accept: an element-count assertion at two zoom levels; no field hole when panning
      (the margin covers the seam).
- [x] **E5S2 — Gate the flow animations (S).** Flow dashes animate only for visible
      segments longer than a few on-screen px; short or off-screen pieces render static
      colour. `prefers-reduced-motion` behavior is unchanged (already `animation: none`).
      Accept: the animated-element count at city zoom is bounded by the same assertion as
      E5S1.
- [x] **E5S3 — Pause flows during camera gestures (S).** One class toggle from the camera's
      gesture state: no 60 fps paint fight with pan/zoom. Accept: manual gesture check + a
      unit test for the toggle.
- [x] **E5S4 — Boundary (XS).** Mid-range-phone spot check (the iPhone-smoking test) and
      a reduced-motion regression pass.

## Epic 6 — Decommission the gate, reconcile, flip

- [x] **E6S1 — Decommission the `voidOverlay` grant machinery (S).** `VOID_OVERLAY_FLAG`
      deleted from `shared/service/contracts.ts` (router references are already gone after
      E3); `useFeatureFlags.ts` deleted; the `feature:*` CLI stays (generic machinery —
      other flags may come); existing `feature_flags` rows for `voidOverlay` are harmless —
      prune with a one-off script or leave, decide in-story; sla.md §4.7's gate language is
      rewritten. Accept: `grep voidOverlay` is clean outside docs and git history.
- [x] **E6S2 — Docs + contracts reconcile (S).** README overlay section (a public feature
      on the live path — no CLI, no sign-in), docs/sla.md, an optimize-transport.md
      cross-reference (its change-4 "stays on the Worker + auth path" clause is superseded
      by this plan), CODEMAP, OpenAPI regenerated, Storybook overlay stories render
      signed-out. Accept: a doc grep for stale gate instructions comes back empty.
- [x] **E6S3 — Operator runbook (XS, op).** Verify the `live/t/` lifecycle rule covers both
      objects; per-session WAF caps now target wave/history only; dashboards: stops-tick
      cache-hit ratio, publish-failure alert, MRU watch (the overlay no longer contributes
      MRUs).
- [x] **E6S4 — Final validation + the flip (XS).** The full pre-flight board and the
      browser suite, once (the deferred live validations). Then `OVERLAY_ENABLED=true` in
      the dashboard — every user has the overlay, no release required. Watch a real rush;
      the bill matches the modeled table.

## Explicit non-stories

- **60 s overlay cadence** — `overlay.pollSeconds` makes it a var flip; the product
  call is deferred deliberately (a "just serviced" flip can lag up to a tick).
- **`service-stops.min.json` slim variant** — measure wire bytes and parse cost first;
  the format-variant rule already permits the path if the number demands it.
- **Canvas/WebGL field rewrite** — culling + animation gating should make it
  unnecessary; revisit only with profiling evidence.
- **Publishing the wave doc** — re-decide only if/when `/sla`'s live tier goes
  broader (the E4S5 decision stands); it is members-only at 5-min cadence today.
- **Query-string variants on the live host** — forbidden forever
  (optimize-transport.md change 1). The stops doc is one path, one shape.
- **WS/SSE** — unchanged deferral, same revisit triggers as the transport plan.

## Completion conditions

- `cf-cache-status: HIT` for `service-stops.json` tick objects on the custom domain;
  native `304`s with `If-None-Match`; CORS headers present cross-origin.
- A recorder that cannot see anything publishes `{ states: [], outage }` docs every
  tick; clients render the honest unavailable state; a blind stop is never a void.
- No client code path reaches `/api/v1/service/stops`; the router 404s it; the
  recorder's `/states` route is deleted; the recorder is write-only for states.
- Signed-out visitors see the overlay; layer-off means zero requests; the
  `voidOverlay` grant is gone from code, CLI workflows and docs.
- History is public and edge-cached; wave is session-only; per-session caps (op)
  exist for wave/history.
- The heartbeat wakes only at visible-change deadlines (profiling evidence), never
  while the tab is hidden; transitions land at the true moment.
- Flow animations are viewport- and length-gated, pause during gestures, and respect
  `prefers-reduced-motion`; element counts at city zoom match the assertions.
- The 9am rush adds ≈ zero origin requests (bounded by colos × ticks); the monthly
  bill matches the modeled table; dashboards and alerts are live.
