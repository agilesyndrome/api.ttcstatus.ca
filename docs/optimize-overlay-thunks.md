# Overlay optimization — work thunks (agent notes)

Running notes for agents executing `docs/optimize-overlay.md` (the plan; epics
E1–E6, stories in attack order). This file records what was done, where, and
what the next agent needs to know. Written per the plan's conventions: stories
in order, live validations only at epic boundaries, focused unit tests ~5%.
Companion ledger to `docs/optimize-transport-thunks.md` (same rules).

## Ground rules (from the plan)

- Order of attack = story-table order: E1S1 → E1S5, E2… → E6S4.
- Epics 4–5 (browser) share no files with Epics 1–3 and may proceed in
  parallel once their own dependencies land.
- One tick grid serves every live document (`floor(epochMs / 30_000)`) —
  never shifted.
- Browser checks run once, at the very end (E6S4), per the standing user
  directive from the transport work.
- `(op)` = Cloudflare dashboard/CLI operator runbook item, not doable from
  this checkout.

## Progress ledger

`[ ]` not started · `[~]` in progress · `[x]` code-complete (operator items
noted) · `(op)` = operator runbook.

- [x] E1S1 — service-stops tick-document contract + pure writer + unit tests
- [x] E1S2 — recorder assembles the wire payload once per tick; interim
      `/states` serves the cached bytes
- [x] E1S3 — recorder publishes `live/t/<tickId>/service-stops.json` per tick
      (non-fatal failures, own telemetry counters)
- [x] E1S4 — `auth/config` gains the `overlay` block (enabled/path/cadence);
      shipped default `OVERLAY_ENABLED=false`
- [x] E1S5 — Epic 1 boundary (typecheck, check:boundaries, test:app,
      build:api, full unit suite — all green)
- [x] E2S1 — `useServiceFeed` repoints to the tick path
- [x] E2S2 — signed-out enablement
- [x] E2S3 — preview middleware serves the stops tick path
- [x] E2S4 — `useSlaLive` stops poll repoints
- [x] E2S5 — Epic 2 boundary
- [x] E3S1 — `/service/history` public + edge-cached
- [x] E3S2 — `/service/wave` session-only gate
- [x] E3S3 — delete the stops route + recorder `/states` route
- [x] E3S4 — wave/history CPU hygiene
- [x] E3S5 — Epic 3 boundary
- [x] E4S1 — visible-bounds seam
- [x] E4S2 — deadline math
- [x] E4S3 — scheduler replaces the 1 Hz heartbeat
- [x] E4S4 — zero wakes while hidden
- [x] E4S5 — engine micro-opts
- [x] E4S6 — Epic 4 boundary
- [x] E5S1 — viewport-cull the painted field
- [x] E5S2 — gate the flow animations
- [x] E5S3 — pause flows during gestures
- [x] E5S4 — Epic 5 boundary
- [x] E6S1 — decommission the `voidOverlay` grant machinery
- [x] E6S2 — docs + contracts reconcile
- [x] E6S3 — operator runbook (op)
- [x] E6S4 — final validation + the flip

## Epic 1 — Broadcast publication

### E1S1 — tick-document contract + pure writer

Status: **done.**

- New pure module `workers/api/src/service/stops-tick-doc.ts` (the stops twin
  of `realtime/tick-doc.ts`):
  - `StopsTickDocument` = `{ schemaVersion, at, tickId, states, outage? }`;
    `at = tickId * tickMs` (the same tick quantization `/states` always
    served, so heartbeat math is unchanged).
  - `buildStopsTickDocument(states | null, tickId, { tickMs })` — `null` (the
    recorder could not assemble) yields the honest outage doc
    `{ states: [], outage }`; an **empty array is not an outage** (an empty
    window publishes as-is). Feed outages are NOT outage docs — they surface
    as honest per-stop `unmonitored` state in a normal doc.
  - `wireReadyStopState` moved here from `service/responses.ts` (one
    rounding, both paths; idempotent).
  - `assembleStopsPayload(states, touches, routesOfStop)` — the payload
    assembly (touch routes ∪ network routes, sorted, map order) with the
    network as an injected lookup — pure, so the DO shell stays plumbing.
  - No query-string variance ever; same 30 s grid as vehicles.
- Unit tests: `tests/service/stops-tick-doc.test.mjs` — 6 tests (states doc,
  outage doc, empty-not-outage, rounding idempotence/null-honesty, route
  merge determinism, grid skew).

### E1S2 — recorder assembles once per tick

Status: **done.**

- `ServiceRecorder.runTick` now takes `touches` from the existing
  `currentStates(now)` pass (one compute serves the void counter, the
  interim route cache, and the publication — no per-request recompute).
- New class field `stopsTick: { tickId, body } | null` — the serialized doc
  bytes. The interim `/states` route serves them verbatim on a tick match;
  a cold isolate recomputes through the **identical** assembly
  (`assembleStopsPayload` + `buildStopsTickDocument`), so warm and cold
  bytes agree by construction. `/states` responses now carry `tickId`
  (additive; the Worker endpoint ignores it until E3S3 deletes the route).
- Assembly failure: nothing cached (the route recomputes / 503s on its own),
  the outage doc still publishes, `console.error` — loud, not fatal.
- `service/responses.ts` imports `wireReadyStopState` from the pure module
  (its local copy deleted); removed a pre-existing unused import while there.

### E1S3 — per-tick publication to the live bucket

Status: **done.**

- `publishStopsTickDocument(tickId, body)` — `PUT
live/t/<tickId>/service-stops.json` via the overlay path template
  (`overlayTransportConfig(env).pathTemplate`), `public, max-age=600`.
  Publishes the **exact bytes** the interim route serves (one serialize per
  tick, by construction). No-op without `LIVE_BUCKET`.
- New telemetry `stopsPublishFailures` / `lastStopsPublishError`, separate
  from the vehicles counters; publish failures are loud, never fatal, and
  never break acquisition/folds/retention/vehicles-publish.
- The publish runs **unconditionally** of `OVERLAY_ENABLED` — the switch
  gates only the client, so the rollout flip needs no warmup.

### E1S4 — `auth/config` overlay block

Status: **done.**

- `shared/live/config.ts`: `LIVE_DEFAULT_SERVICE_PATH_TEMPLATE`,
  `OverlayTransportConfig`, `overlayTransportConfig(env)` (enabled defaults
  **false**; poll cadence clamped 30–300 s, may exceed the grid — tick
  derivation stays on the grid), `parseOverlayTransportConfig` (the client's
  defensive parser; missing/insane blocks throw, never a fallback).
- `accounts/auth.ts`: `authConfig` gains `overlay: overlayTransportConfig(env)`
  (additive; re-exported as `overlayConfig`).
- `accounts/env.ts` + `workers/api/wrangler.jsonc`: vars `OVERLAY_ENABLED`
  ("false"), `LIVE_SERVICE_PATH_TEMPLATE`, `OVERLAY_POLL_SECONDS` ("30").
- Tests: `tests/accounts/auth-config.test.mjs` +3 (defaults/overrides/clamps
  - parser tolerance/rejection); `tests/accounts/accounts.test.mjs` config
    shape assertions extended with the overlay defaults.

### E1S5 — Epic 1 boundary

Status: **done.**

- `tsc --noEmit` clean · `check:boundaries` pass · `test:app` 90/90 ·
  `build:api` pass · full `npm test` **376/376** (was 369 pre-E1S1; +7 new).
- Lint: my files clean. Pre-existing repo-wide lint errors and prettier
  drift (`shared/live/polling.ts` unused arg, `tests/service/api.test.mjs`
  unused var, `RoutePulsePanel.tsx` unused import, ~40 files of prettier
  drift incl. untouched ones) are **not** from this work — left for the
  final-validation pass (E6S4 runs the board, whose precommit fix list is
  `prettier --write .`).
- Preview publish path + outage doc: exercised after E2S3 lands (the
  middleware is the preview's only server of the path). Lifecycle/CORS/CSP:
  the `live/t/` rule + bucket CORS + page CSP `connect-src` already cover
  the new prefix/host — asserted again at E6S4.

## Epic 2 — Client repoint to the live path

### E2S1 — `useServiceFeed` repoints

Status: **done.**

- `shared/live/polling.ts` gains `requestStopsTickUpdate` + `StopsUpdate` —
  the stops twin of `requestTickUpdate` at the same TRANSPORT CONTRACT seam:
  same three cases (200 doc / 404 → tick−1 once → `unpublished` no-op /
  anything else → caller backoff), retained ETag + native 304, `no-store`
  tick-following, structural document parse (the browser never imports the
  Worker module that builds the doc). An outage doc delivers
  `states: [] + outage: true` — a document, never a failure.
- `web/ui/services/http/live-transport.ts` refactored: one shared
  once-per-launch config fetch now parses BOTH blocks; `liveTransport()`
  unchanged; new `overlayLaunch()` → `{ enabled, transport }` where
  transport = live host + overlay path + poll cadence (fleet-shaped).
- `useServiceFeed` rewritten: `overlayLaunch()` → `requestStopsTickUpdate`;
  `x-live-*` parsing deleted (cadence from config); unpublished = no-op;
  outage doc = honest empty states (never `failed`); hidden/offline pause,
  immediate refresh on activation, exponential backoff kept.
- Unit tests: `tests/service/stops-tick-update.test.mjs` — 7 tests (200 doc
  - URL derivation from config, 404→tick−1→200, 404→404 unpublished, 304,
    outage doc, 503 + invalid-doc throw, same-origin `liveTickUrl`).
- Fixed a pre-existing lint error in the file I touched (`polling.ts`
  unused catch param → `_error`).

### E2S2 — Signed-out enablement

Status: **done.**

- `ServiceLayer.tsx`: `useFeatureFlags` import deleted; new
  `useOverlayEnabled()` reads `overlay.enabled` from the same launch config
  (null while loading or on config failure = OFF — disabled means disabled,
  zero requests). The enable predicate: `requested && !suspended && data &&
overlayEnabled === true` — **no account state participates**; signed-out
  visitors get the same field. `useFeatureFlags.ts` is now unused by the
  overlay (E6S1 deletes the module).

### E2S3 — Preview middleware serves the stops tick path

Status: **done.**

- `scripts/preview/preview-api.mjs`: new `/live/t/<tick>/service-stops.json`
  route — 404 future ticks, immutable doc from the corpus (default one-way-
  void scenario, real shared math), ETag/304, `max-age=600`, **no query
  strings on the live path** (broadcast-only invariant applies to dev too).
  `auth/config` responses carry the `overlay` block; dev default ON
  (`OVERLAY_ENABLED=false` in the preview env rehearses the off state).
- `scripts/preview/auth-fixture.mjs`: the browser-check config fixture
  gains the overlay block (same-origin path, enabled) — without it the
  client fails closed.
- The corpus `/api/v1/service/*` preview routes stay (wave/history still
  serve them; the stops one dies with E3S3).

### E2S4 — `useSlaLive` stops poll repoints

Status: **done.**

- New `useStopsLoop` in `useSlaLive.ts` reads the public stops tick docs
  (same bytes as the map overlay; no session); the wave loop stays on the
  session-gated Worker route (members-only replay, 5-min cadence). The
  sliver math is unchanged — `SlaLiveStates` is structurally satisfied by
  the tick doc's `{ at, states }`.

### E2S5 — Epic 2 boundary

Status: **done.**

- `tsc --noEmit` clean · `check:boundaries` pass · full suite **383/383**
  (+7 E2S1 tests) · `test:app` 90/90 · `build:api` pass · touched files
  lint-clean.
- The no-caller proof: `grep service/stops web/ shared/` finds only a doc
  comment (fixed), the privacy allowlist entry (dies with E3S3), and
  payload-lineage comments (reconciled in E6S2). **No client code path
  can reach the Worker stops route** — the gate E3S3 needed.

## Epic 3 — Access model + Worker path removal

### E3S1 — `/service/history` goes public

Status: **done.**

- `serviceHistoryResponse` takes `ctx`, is sessionless (the router moved it
  out of the gate), and serves `public, max-age=300` through the map
  endpoints' edge-cache pattern — `caches.default` keyed by the **full URL**
  (selectors included, so one filter never bleeds into another's entry),
  `x-ttcstatus-cache: MISS/HIT` like the maps.
- The narrowing-filter requirement (`?stop=` or `?routes=`) stays — bounded
  queries, honest 400 without one, session or not.
- E3S4 for history: a defaulted `from` **and** the response's `to` quantize
  to the 5-minute fold grid (`SERVICE_BUCKET_SECONDS`), so payloads are
  fold-stable — ETags hold between folds instead of churning per second
  (the old `to: Date.now()` made every 304 impossible); an explicit `from`
  keeps the caller's exact window.

### E3S2 — `/service/wave`: session-only gate

Status: **done.**

- Router: wave keeps `verifySession` (the E4S5 members decision) and loses
  `callerHasFlag` + the `VOID_OVERLAY_FLAG` import — the grant lookup that
  would have needed caching is deleted instead. 401 anonymous/tampered, 200
  for any valid session.
- The flag is still served by `/api/v1/me/features` (generic machinery) but
  nothing on the service surface consults it; E6S1 decommissions the rest.

### E3S3 — Delete the stops route + the recorder `/states` route

Status: **done.**

- Router: `/api/v1/service/stops` deleted (404, even with a recorder
  binding — a removal test mirrors the vehicles one); `serviceStopsResponse`
  and its `RecorderStatesPayload` deleted from `responses.ts`.
- Recorder: the DO's `/states` fetch route deleted — the recorder is
  **write-only for states** (per-tick assembly runs in `runTick` as a method
  call; the in-DO `stopsTick` byte cache died with its only reader).
- Contracts: `ServiceStops` schema deleted from `shared/contracts/live.ts`
  (`ServiceState` stays — the shared vocabulary); the path removed from
  `contracts/paths.ts` with the deletion comment; the privacy allowlist
  entry removed from `shared/http/api-queries.ts` — `?routes=` on the dead
  path is now an unsupported query (400), so it can never become a per-user
  URL shape again. OpenAPI regenerated (`npm run build:contracts`).
- The 3k-stop size-discipline test moved to the tick-doc suite
  (`stops-tick-doc.test.mjs`) where the payload now lives.

### E3S4 — wave/history CPU hygiene

Status: **done.**

- Wave: module-level memo keyed by `(tickId, routes filter)` — same-tick
  requests (304s included, which previously paid the full DO fetch +
  double stringify + hash) serve the memoized bytes. Tested: a same-tick
  repeat fetch is a 304 with no recompute.
- History: fold-stable windows (above) + the edge cache absorb the repeats;
  per-miss compute stays bounded by fold cadence × distinct URLs.

### E3S5 — Epic 3 boundary

Status: **done.**

- `tsc --noEmit` clean · `check:boundaries` pass · `test:app` 90/90 ·
  `build:api` pass · full suite **382/382** · touched files lint-clean.
- Test harness hardening while here: several files assign `globalThis.caches`
  at import time and `--test-isolation=none` makes the last assignment win
  process-wide — new shared `tests/helpers/edge-cache.mjs` (one Map-backed
  stub for api/history/sla-api service suites; scoped save/restore stubs
  elsewhere stay compatible). Each service suite clears it before the
  requests it asserts on.
- `tests/service/api.test.mjs` rewritten for the new access model: the
  stops-route payload tests replaced by the removal test (404 + 400 on
  `?routes=`), history public MISS→HIT with `public, max-age=300`, wave
  401-anonymous/200-member with a **zero-row flags table** (the proof no
  grant participates), and the same-tick wave memo 304.

## Epic 4 — The field engine

Status: **E4S1–E4S5 done (code); E4S6 code validations green — the wake/repaint
devtools profiling is a browser-suite activity and runs with the final
validation (E6S4), per the standing live-validation policy.**

- **E4S1 done — visible-bounds seam.** `TransitMap` passes the camera rect
  (the SVG viewBox — the visible world) to the underlay/overlay callbacks
  (`types.ts` signature update). `ServiceLayer` debounces it: the callback
  re-arms a 150 ms timer every frame; the settled position (guarded by
  identity so nothing loops) becomes state, and `visibleStopsOf` (pure,
  wave-field.ts, half-viewport margin) derives the on-screen stop set.
- **E4S2 done — deadline math.** `nextStopChangeMs` (the exact inverse of
  `advanceStopState`): the earliest of the next signature-quantisation
  midpoint (`Math.round(d/0.25)` flips at half-steps, not multiples — the
  first draft got this wrong and the tests caught it), the next state
  boundary, the void-absolute horizon, and — for the stop whose card is
  open — the next 0.1-minute label crossing. Blind/collecting never
  schedule. `earliestDeadlineMs` narrows to the visible set + selected
  stop. 8 unit tests, including the agreement property: waking at the
  deadline changes the quantised field, waking a moment earlier does not.
- **E4S3 done — the scheduler.** `useNow` deleted. One `setTimeout` at the
  clamped earliest deadline (≥250 ms so steps land exactly, ≤5 s safety
  re-check) — wakes set `now`, the states/repaint pipeline gates itself as
  before. Camera settles, feed ticks and selection changes reschedule
  through the effect deps.
- **E4S4 done — zero wakes hidden.** `engineOn = enabled && activity.active`:
  a hidden tab schedules no timer at all (the feed already pauses there).
- **E4S5 done — micro-opts.** `trackFieldSignature` returns a NUMBER
  (32-bit FNV-1a over stopId/quantised-dryness/state, zero per-stop string
  allocations); `cumulative()` memoised by array identity (geometry is
  static per map version); `edgesById` Map replaces the tint's per-car
  linear scan; **only on-screen stops (+ the selected one, whose card speaks
  even off-screen) advance between ticks** — off-screen anchors are
  tick-stable and re-advance when the settled camera brings them back.
- **E4S6.** `tsc` clean · boundaries pass · build pass · suite **391/391**
  (+10 Epic-4 tests) · touched files lint-clean. The engine's wake count is
  structurally bounded (one timer, visible-set deadlines) — the before/
  after profiling evidence lands with the browser suite at final
  validation.

## Epic 5 — Paint & animation

Status: **E5S1–E5S3 done (code); E5S4 code validations green — the
mid-range-phone spot check and element-count assertions are browser-suite
activities and run with the final validation (E6S4).**

- **E5S1 done — viewport-cull the painted field.** `visibleEdgesOf`
  (pure, wave-field.ts): an edge paints when its bbox intersects the
  margin-grown settled camera — conservative by construction (a diagonal
  whose endpoints sit outside still paints; over-inclusion costs a few
  static lines, under-inclusion would leave a hole). `TrackService` takes
  `visibleEdges` and skips everything else in BOTH the painted band and the
  car trails; `ServiceLayer` derives the set from the settled camera
  (`{camera, scale}` debounced pair from E4S1). City zoom renders hundreds
  of elements, not thousands. Unit-tested.
- **E5S2 done — gate the flow animations.** `TrackService` takes the
  settled `scale` (px per world unit); a flow dash line renders only for
  segments ≥ one `DASH_CYCLE` on screen — at city-wide zoom NOTHING flows
  (the static colour field carries the information and the battery); street
  zoom flows as before. The colour line always renders. `prefers-reduced-
motion` still kills all animation (unchanged).
- **E5S3 done — pause flows during gestures.** `TransitMap` wraps its
  `onInteract`/`onZoomInteract` seams (every pan, keyboard move, wheel/
  double-tap/button zoom, Home reset reports through them) with a
  `data-gesturing` root-SVG flag — ~400 ms idle window, host callbacks
  untouched. `service.css`: `[data-gesturing='true'] .service-*-flow {
animation-play-state: paused }` — no 60 fps dash paint fights the
  pan/zoom.
- **E5S4.** `tsc` clean · boundaries pass · build pass · suite **392/392**
  (+1 E5S1 test) · touched files lint-clean. Device spot-check and the
  element-count assertions land with the browser suite at E6S4.

## Epic 6 — Decommission the gate, reconcile, flip

### E6S1 — decommission the `voidOverlay` grant machinery

Status: **done.**

- `useFeatureFlags.ts` **deleted** (no importers since E2S2);
  `callerHasFlag` deleted from `accounts/features.ts` (the per-request D1
  grant read is deleted, not cached; `ownedFeaturesResponse` and the
  `feature:*` CLI stay as generic machinery); `VOID_OVERLAY_FLAG` deleted
  from `shared/service/contracts.ts`.
- The flag fixtures in `feature-flags.mjs` docs and
  `tests/service/feature-flags.test.mjs` renamed to a neutral `betaFeature`
  (the machinery is generic; nothing names the overlay's retired flag).
  `tests/service/config.test.mjs` asserts the flag constant is GONE.
- Remaining `voidOverlay` mentions are deliberate retired-here history notes
  (router, contracts, api.test comments) — `grep` finds no live reference.

### E6S2 — docs + contracts reconcile

Status: **done.**

- README: the service section rewritten around the published tick document
  (no `/api/v1/service/stops`; history public + edge-cached; wave
  members-only) and the overlay described as the public feature it now is
  (config-block rollout, Epics 4–5 browser behaviour, the CLI kept for
  future flags); the SLA live-tier paragraph repointed.
- `docs/sla.md` §4.7 rewritten as a superseded historical record;
  `docs/optimize-transport.md` change 4 carries a superseded note pointing
  here. CODEMAP's live-tier row, the `StopServiceState` lineage comments
  (contracts, wait-metrics) and `api-queries.ts` all speak the tick path.
- OpenAPI regenerated with the stops path/schema removed (done with E3S3).
  No overlay Storybook stories existed to update (verified).

### E6S3 — operator runbook (op)

Status: **written (dashboard steps are the user's, as ever).**

1. **The `live/t/` lifecycle rule — CONFIRMED (user, 2026-10-13): expires
   after 7 days**, not the ~1 day the transport plan sketched. One prefix
   rule covers both documents. Deliberate and fine: the longer window costs
   ~$0.08/mo of storage (~5 GB steady state) and doubles as a 7-day replay
   tape of the _rendered_ field — the one thing the rollup pipeline cannot
   answer ("what did the map show at 8:45 Tuesday?"). It is NOT an
   analytics substrate: aggregation belongs to the rollups (moments merge
   exactly; re-parsing point-in-time JSON docs would redo that work worse)
   — if an analytics need appears, extend the rollup/Tier-3 pipeline.
   Client behavior is unaffected either way: clients only ever request
   `tick` or `tick−1`.
2. **After deploy** (this revision flips `OVERLAY_ENABLED` to `"true"` —
   the all-users rollout IS the deploy; no dashboard edit survives a
   redeploy): accept-check `cf-cache-status: HIT` on
   `live.ttcstatus.ca/live/t/<tick>/service-stops.json`, native `304` with
   `If-None-Match`, CORS present cross-origin, and the outage doc by
   killing upstream deliberately.
3. **Per-session WAF caps** now target `/api/v1/service/wave` +
   `/api/v1/service/history` only (history is edge-cached public — generous
   per-IP limits suffice; the stops traffic no longer touches `/api/*`).
4. **Dashboards**: stops-tick cache-hit ratio, `stopsPublishFailures`
   telemetry alert, and the MRU watch (the overlay no longer contributes
   MRUs — watch that it stays that way).

### E6S4 — final validation + the flip

Status: **done (all code-side validations; the production deploy itself is
CI's push, as ever).**

- **The flip landed**: `OVERLAY_ENABLED` is `"true"` in
  `workers/api/wrangler.jsonc` — deploying this revision gives every
  visitor the overlay (signed-out included). `"false"` rehearses the off
  state.
- Code board: `tsc --noEmit` clean · `check:boundaries` pass ·
  `npm test` **392/392** (369 pre-plan; +23 across the epics) ·
  `build:api` pass · touched files lint-clean · prettier-clean.
- Browser checks (the standing run-at-the-end directive):
  - **`check-service`: PASS** — after repointing it to the new
    architecture (auth-config `overlay` block on/off, tick-path data
    interception) and fixing the **pre-existing** breakage it carried on
    main (proven by a clean-HEAD stash run: the "easier clicking of stops"
    commit shipped it red — merged-pair representative dots need the
    rendered feature id, the chip-is-close sequencing, the E5S2 city-zoom
    flow expectation, and the post-zoom band count). It now validates:
    switch-off = zero requests, band paints piece-for-piece, flows off at
    city zoom and on at street zoom, the merged-pair selection story, the
    rose, marker toggle, history card, phone layout, snake suspension,
    and post-zoom painting.
  - **`check-offline-shell`: PASS** (unchanged, re-verified).
  - The rest of the Playwright suite (`check-ui`, `check-mobile`,
    `check-auth`, `check-i18n`, …) remains **stale against the Nav v2 UI**
    — the pre-existing, user-deferred condition recorded in
    `docs/optimize-transport-thunks.md` (E8S1); unchanged by this plan.
- **Pre-existing repo drift — resolved 2026-10-13**: the user ran the
  tree-wide prettier pass (the `~40 files` that failed `--check` on clean
  main), and the last pre-existing lint error (`RoutePulsePanel.tsx` unused
  import, a Nav-v2 leftover) is fixed with it — the tree is now fully
  lint/typecheck/prettier clean. Still open and out of scope: the
  Nav-v2-stale Playwright scripts (`check-ui`, `check-mobile`, …), the
  transport epic's deferred E8S1 rewrite.

## What shipped, in one paragraph

The void overlay is a public feature served like the fleet: the recorder
publishes one immutable `service-stops.json` per 30-second tick to the
public live bucket (computed once per tick, outage-honest), every viewer —
signed-out included — reads it from the CDN through the same three-case
tick contract, and the Worker stops route plus the recorder's `/states`
route are deleted. History is public and edge-cached; wave stays the
members-only replay behind a session gate with no per-user flag anywhere.
In the browser the field wakes only when an on-screen stop actually
crosses a visible step (deadlines, not a metronome), paints only what the
camera sees, and animates flows only where they earn their keep — off at
city zoom, paused during gestures, gone under reduced-motion. The rollout
is one config var, flipped in this revision.
