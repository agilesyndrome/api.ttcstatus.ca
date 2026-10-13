# Transport optimization — work thunks (agent notes)

Running notes for agents executing `docs/optimize-transport.md` (the plan; epics
E1–E7, stories in attack order). This file records what was done, where, and
what the next agent needs to know. Written per the plan's conventions: stories
in order, live validations only at epic boundaries, focused unit tests ~5%.

> Path note: the goal command said `dopcs/optimize-transport-thunks.md`; that
> is a typo for `docs/` — notes live here, beside the plan.

## Ground rules (from the plan)

- Order of attack = story table order: E1S1 → E1S2 → E1S3 → E1S4 → E1S5 → E2… → E7S7.
- No fallback doctrine: public fleet data served from published live objects only.
- Broadcast-only transport: no identity, no location, no query strings on the live host.
- `TRANSPORT CONTRACT` comment lands at the seam in E5S1 (before any native work).
- Live validations (typecheck, `check:boundaries`, `test:app`, `build:api`,
  `test:browser`) run only at epic boundary stories.
- Cloudflare **dashboard/infra** steps (bucket creation, custom domain attach,
  cache/transform/WAF rules) cannot be done from this checkout — they are
  recorded here as operator runbook items and everything scriptable (wrangler
  config, code) is done in-repo.

## Progress ledger

Every story gets a status here, updated the moment it completes:
`[ ]` not started · `[~]` in progress · `[x]` code-complete (operator items noted) ·
`(op)` = Cloudflare dashboard/CLI operator runbook, not doable from this checkout.

- [x] E1S1 — live bucket + custom domain + cache rule + R2 CORS policy — **dashboard steps executed by the user (2026-10-12)**;
      the `live/t/` lifecycle rule is CONFIRMED — 7 days (user, 2026-10-13; see Outstanding)
- [x] E1S2 — tick-document contract + pure writer + unit tests
- [x] E1S3 — recorder publishes per-tick docs to R2 (non-fatal failures)
- [x] E1S4 — `auth/config` live block + `public, max-age=300`
- [x] E1S5 — Epic 1 boundary (code validations; deploy verification = runbook)
- [x] E2S1 — config client, fetch once per launch, no fallback URL
- [x] E2S2 — tick derivation + path-template URL builder (shared/live/config)
- [x] E2S3 — three-case fetch contract; 5xx/Retry-After/x-live parsing deleted
- [x] E2S4 — UI states: outage banner, waiting-for-config, age unchanged
- [x] E2S5 — standalone viewer repointed (no hardcoded vehicle URL)
- [x] E2S6 — code boundary done; staged-rollout dashboards = runbook
- [x] E3S1 — public vehicle route + `vehicleResponse` deleted; OpenAPI regenerated
- [x] E3S2 — recorder write-only confirmed + commented
- [ ] E3S3 (op) — WAF ~100/min/IP on `/api/*` (dashboard rule) — **REVISIT after deploy stabilizes (user instruction)**
- [ ] E3S4 (op) — observability dashboards/alerts + CPU limits (limits already set) — **REVISIT (user instruction)**
- [ ] E3S5 — boundary: verify removal under a rush (needs deploy + traffic)
- [x] E4S1 — local JWKS/JWT verification module + fixture-token tests
- [x] E4S2 — 401/403 grant gate on `/api/v1/service/*`; `private`; no edge cache
- [x] E4S3 — client sends the session; signed-out = zero service requests
- [ ] E4S4 (op) — per-session caps keyed on JWT `sub` (WAF rule, dashboard) — **REVISIT after deploy stabilizes (user instruction)**
- [x] E4S5 — SLA MRU pricing decision — **decided**: keep `/sla` members-only
      (~200K MRU ≈ $2,825/mo at 10% adoption is priced-before-shipped, per §Clerk
      caveat; a broader audience would get a separate endpoint with its own policy)
- [ ] E4S6 — boundary: 401/403/`private` vs live Clerk tokens (needs deploy)
- [x] E5S1 — TRANSPORT CONTRACT comment at the seam (in `shared/live/polling.ts`)
- [x] E5S2 — Capacitor platform adapters — **already existed** (`services/platform/capacitor/`:
      lifecycle `appStateChange` → the `active` seam; pollers pause on inactive ⇒
      foreground-only by construction)
- [x] E5S3 — native build config — **already satisfied**: `VITE_API_ORIGIN` reaches only the
      config fetch; grep confirms no live host/cadence/path baked into any client source
- [x] E5S4 — native session driver — **already satisfied**: `AccountProvider` adapter seam +
      `createApiClient({token, credentials:'omit'})` per the ui-platform contract
- [ ] E5S5 — boundary: real-device validation (operator; deferred to final validation)
- [x] E6S1 — location-query rejection on every public path
- [x] E6S2 — `shared/transit` device-only invariant comments
- [ ] E6S3 — boundary: final full validation + doc reconcile
- [x] E7S1 — generator core moved verbatim into `workers/api/src/mapgen/` (import paths fixed only)
- [x] E7S2 — env merged: one `Env` (comment notes the mapgen-consumed vars)
- [x] E7S3 — sync generates in-process (drop service binding); jobs bookkeeping preserved
- [x] E7S4 — debug render in-process (admin-gated, enforcement preserved)
- [x] E7S5 — map-generator worker deleted (grep clean outside docs/history)
- [x] E7S6 — CODEMAP/README/docs/ops scripts reconciled
- [ ] E7S7 — boundary: end-to-end regeneration vs production (needs deploy)
- [ ] E8S1 — **fix the stale Playwright suite** (the last thing we do):
      rewrite `check-ui`, `check-mobile`, `check-auth`, `check-i18n`,
      `check-subway`, `check-snake`, `check-hackathon`, `check-exploration`
      against the current "Nav v2" UI — the pre-existing selector staleness
      documented in Final work + Open questions (checkboxes → layer buttons,
      `Sign in` button, `Paramètres de langue` link, `↗ Share map`,
      `504 King` route button, `.live-status` → `.route-pulse`). Runs after
      every other story closes; `check-offline-shell` + `check-service` pass.

## Live-validation policy (user directive)

- **Browser tests (`test:browser`, `test:ui`, any Playwright checks) are NOT
  run during epic work.** They run once, at the very end (after all epics),
  per the user's explicit instruction. Epic boundary "full suite" runs are
  interpreted as: typecheck + `check:boundaries` + `test:app` +
  `build:api` only, mid-work.
- A Vite preview server (`npm run dev:viewer`, port 4173) must be running
  for browser checks — start it only for the final run.

## Epic 1 — Live publication infrastructure

### E1S1 — Public live bucket + custom domain + rules (S)

Status: **DONE — wrangler config in-repo + the user executed the dashboard steps (2026-10-12).**

- `workers/api/wrangler.jsonc`: added `LIVE_BUCKET` R2 binding
  (`bucket_name: ttcstatus-live`), a `live` var block
  (`LIVE_PUBLIC_BASE`, `LIVE_UPDATE_SECONDS`, `LIVE_PATH_TEMPLATE`),
  and commented runbook.
- Dashboard steps — **all executed by the user (2026-10-12)**:
  1. ✔ Bucket `ttcstatus-live` created.
  2. ✔ Custom domain `live.ttcstatus.ca` attached (R2 public bucket).
  3. ✔ Cache rule set (respect origin TTL; objects carry `max-age=600`).
  4. ✔ CORS set **as an R2 bucket CORS policy** (not a Transform Rule) — see
     the Operator runbook section for the exact policy + the `*` rationale.
  5. ✔ `live/t/` lifecycle rule CONFIRMED — expires after **7 days** (user,
     2026-10-13), not the ~1 day this plan sketched. One prefix rule covers
     both documents (vehicles + `service-stops.json`). The longer window
     costs ~$0.08/mo of storage and doubles as a 7-day replay tape of the
     rendered field — see docs/optimize-overlay-thunks.md (E6S3).
- Accept check (run after first deploy): `cf-cache-status: HIT` on second
  fetch of `live/t/<tick>/vehicles.json`, native `304` with `If-None-Match`,
  CORS headers present cross-origin.

### E1S2 — Tick-document contract + pure writer (S)

Status: **done.**

- New pure module `workers/api/src/realtime/tick-doc.ts`:
  - `tickIdAt(epochMs, updateSeconds)` — the shared `floor(epoch/(s*1000))` grid.
  - `buildTickDocument(snapshot | null, tickId, fallback?)` → `TickDocument` =
    `{ ...VehicleSnapshot, tickId, outage? }` (byte-compatible superset of the
    public vehicle response shape). `snapshot: null` (total upstream failure)
    yields `{ vehicles: [], outage: { since, tickId } }` — outage is a body
    field, never a status. Empty-but-valid fleet is NOT an outage. No I/O, no
    clock reads; `since` derived from the tick grid.
- Unit tests: `tests/live/tick-doc.test.mjs` (fleet / outage / empty / grid
  skew). 4 tests, passing.

### E1S3 — Recorder publishes per-tick docs to R2 (M)

Status: **done (publish call + non-fatal failure recording).**

- `ServiceRecorder` (workers/api/src/service/service-recorder.ts):
  - New telemetry fields `publishFailures` / `lastPublishError` (schema stays
    loose — `RecorderTelemetry` carries them; old stored telemetry without the
    fields merges via spread at write time).
  - New private `publishTickDocument(now, snapshot)` called in `runTick`
    **after** persistence, prune, folds, baseline refresh — off the alarm's
    persistence critical path. Puts `live/t/<tickId>/vehicles.json` (leading
    `/` stripped for the R2 key) with `cache-control: public, max-age=600`,
    `content-type: application/json`. No-op without `LIVE_BUCKET` (local dev).
  - Publish failure → telemetry + `console.error`, never thrown; acquisition,
    folds, retention all survive.
- `Env` (workers/api/src/env.ts): `LIVE_BUCKET?: R2Bucket` (optional).

### E1S4 — `auth/config` gains the `live` block (XS)

Status: **done.**

- The transport discovery lives in `shared/live/config.ts` (pure, shared):
  `LIVE_DEFAULT_PUBLIC_BASE = 'https://live.ttcstatus.ca'`,
  `LIVE_DEFAULT_PATH_TEMPLATE = '/live/t/{tick}/vehicles.json'`,
  `liveTransportConfig(env)` → `{ base, pathTemplate, updateSeconds }`
  (cadence validated via existing `liveUpdateSeconds` clamp 30–300),
  `liveTickPath(pathTemplate, tickId)` → `{tick}` substitution.
  Workers AND web clients consume the same module → one source of truth.
- `authConfig(env)` (workers/api/src/accounts/auth.ts) returns additively:
  `{ enabled, publishableKey, live: liveTransportConfig(env) }`; `liveConfig`
  re-exported from accounts/index.ts.
- Router: `/api/v1/auth/config` cache policy `no-store` → `public, max-age=300`.
- `AccountEnv` (workers/api/src/accounts/env.ts) gains `LIVE_PUBLIC_BASE` /
  `LIVE_PATH_TEMPLATE` / `LIVE_UPDATE_SECONDS` (all optional).
- Wrangler vars mirror the defaults.
- Unit tests: `tests/accounts/auth-config.test.mjs` (block present /
  overrides + bad cadence fallback / Clerk semantics unchanged). 3 tests, passing.

### E1S5 — Epic 1 boundary

Status: **code-side validations done (typecheck clean, `check:boundaries`
pass, `test:app` 90/90 pass incl. new tick-doc + auth-config tests,
`build:api` passes). Browser tests deferred to final validation per user
directive. Deploy + dashboard verification (HITs, 304s, CORS, outage-doc
publish, lifecycle expiry) is the operator runbook in E1S1.**

## Epic 2 — Client repoint to the live path

Status: **E2S1–E2S5 done (code); E2S6 rollout/dashboard = operator runbook.**

- **E2S1 config client**: `web/ui/services/http/live-transport.ts` — `liveTransport()`
  fetches `/api/v1/auth/config` once per launch (module-memory cache; rejection
  clears it so the next activation retries — **never a fallback URL**). The
  parser `parseLiveTransportConfig` lives in `shared/live/config.ts` (shared
  with the standalone viewer; base `''` = same-origin local preview, else
  HTTPS; path template must be an immutable `/live/t/{tick}/…` path).
- **E2S2 tick derivation**: `tickIdAt(epochMs, updateSeconds)` +
  `liveTickPath(pathTemplate, tickId)` in `shared/live/config.ts`;
  `liveTickUrl(transport, tickId)` in `shared/live/polling.ts`.
- **E2S3 three-case contract**: `shared/live/polling.ts` rewritten.
  `requestVehicleUpdate`/`LiveUpdateError`/`x-live-*`/`Retry-After`/503
  parsing **deleted**; `requestTickUpdate(transport, signal, etag?, request?,
now?)` implements exactly: 200 → doc (outage is a body field), 404 → retry
  tick−1 once → `unpublished: true` (keep last-good, normal cadence, NOT a
  failure), anything else → thrown network error (caller backoff).
  `SnapshotUpdate.nextUpdateAt` removed (cadence comes from config).
  `VehiclePoller` keeps ETag/304, 15s timeout, non-overlap, backoff,
  activation semantics; adds the unpublished no-op path. The TRANSPORT
  CONTRACT comment (E5S1) is on `requestTickUpdate`.
- **E2S4 UI states**: `FeedState.awaitingConfig` + outage banner
  (`liveFeedStatus.liveServiceUnavailableSinceValue`) +
  waiting-for-config state in `LiveFeedStatus.tsx`; i18n keys added to
  en-CA + fr-CA catalogs.
- **E2S5 viewer**: `web/map/viewer.ts` repointed — hardcoded
  `/api/v1/vehicles/streetcar` endpoint removed; config fetch (once per
  launch, retry-on-activation) → `requestTickUpdate`; outage banner in
  `updateSnapshotAge`.
- `useVehicleFeed.ts` request closure = `liveTransport()` → `requestTickUpdate`.
- **Preview middleware** (`scripts/preview/preview-api.mjs`): serves
  `/live/t/<tick>/vehicles.json` same-origin (404 future ticks, 304 ETag,
  outage docs, `max-age=600`), and `/api/v1/auth/config` now returns the
  `live` block + `public, max-age=300`.
- Unit tests: `tests/live/live-updates.test.mjs` updated (three-case
  contract, defensive config parse, unpublished-tick poller no-op, cadence
  reschedule). 39/39 live tests pass; `test:app` 92/92; typecheck clean;
  build passes.
- **E2S6**: staged rollout + old-path-traffic dashboards are deploy-time
  operator work. The check-script repointing this section used to track as a
  follow-up is **done** — see Final work (the Playwright scripts now fulfill
  `/api/v1/auth/config` + `/live/t/*/vehicles.json`; `grep vehicles/streetcar
scripts/checks/` is empty).

## Epic 3 — Worker path removal + hardening

Status: **E3S1 + E3S2 done (code); E3S3/E3S4 operator runbook; E3S5 deploy-gated.**

- **E3S1 done**: removed `/api/v1/vehicles/streetcar` from `http/router.ts`,
  deleted `workers/api/src/realtime/response.ts` (vehicleResponse + POP cache +
  ETag/503/x-live logic), removed the path from `contracts/paths.ts`, and
  regenerated `docs/api/openapi.json` via `scripts/build/build-contracts.mjs`
  (the VehicleSnapshot schema itself stays — tick documents use it).
  The old realtime route tests in `tests/live/realtime.test.mjs` were replaced
  by a removal test: the router 404s the path even with a recorder binding.
- **E3S2 done**: recorder `fetch()` doc comment now states the write-only
  construction (public route deleted; binding-only reachability). No behavior
  change was needed — `/states` + `/window` were already service-binding-only.
- **E3S3 (op)**: WAF rate limiting rule ~100 req/min/IP on `/api/*` — Cloudflare
  dashboard. Nothing on `live.ttcstatus.ca`.
- **E3S4 (op)**: dashboards/alerts (request volume, 304 ratio, cache hit ratio,
  MRU count); `limits.cpu_ms: 300000` already set in wrangler config.
- **E3S5**: after deploy — verify removal held under a rush window; bill
  matches the modeled table.
- The local preview still serves `/api/v1/vehicles/streetcar` for older dev
  flows; harmless, but a future cleanup could drop it (clients no longer call it).

## Epic 4 — Overlay grant enforcement

Status: **E4S1–E4S3 done (code); E4S4 operator runbook; E4S5 decision below; E4S6 deploy-gated.**

- **E4S1 done**: `workers/api/src/accounts/verify.ts` — local JWKS/JWT
  verification. `verifySessionToken(token, jwks, {now, issuer, authorizedParties})`
  is pure (RS256 via WebCrypto; checks sub/exp/nbf/iss/azp; fails closed on
  tampering — malformed segments are null, never a 500). `fetchJwks` caches
  per-isolate ~1 h with in-flight dedupe. `verifySession(request, env)` is the
  route-facing helper: 503 without `CLERK_JWKS_URL`, 401 without/invalid Bearer.
  New env: `CLERK_JWKS_URL` (AccountEnv + Worker secret, synchronized from
  `.env.local` or `.env.prod`).
  **No per-request Clerk API call** — the whole point (rate limits + latency).
- **E4S2 done**: router gates `/api/v1/service/*` (stops/wave/history) behind
  `verifySession` + `callerHasFlag(DB, sub, 'voidOverlay')` (new helper in
  `accounts/features.ts`; grant admin stays the existing feature:* workflow).
  401 invalid session, 403 valid session without grant. All three endpoint
  responses now `cache-control: private, …` and the `caches.default`
  put/match code was **deleted** from `service/responses.ts` — no shared
  cache can bypass authorization. Identity only from the verified token.
- **E4S3 done**: `useServiceFeed` + `useSlaLive`'s loops now send the session
  (account.request = Bearer-token client) and make **zero** service requests
  while signed out / unloaded (guaranteed-401 polling removed by construction).
- Unit tests: `tests/accounts/verify.test.mjs` (real RSA fixture tokens;
  tamper/expire/nbf/iss/azp/alg-none all fail closed; JWKS cache TTL).
  `tests/service/api.test.mjs` rewritten to run the grant gate end-to-end
  (fixture JWKS over a data: URL; flags DB with granted_at/granted_by).
- **E4S4 (op)**: per-session caps (~10/min on JWT sub) for the granted service
  endpoints — WAF custom rate limiting rule, dashboard.
- **E4S5 — SLA MRU pricing decision**: applying the grant to every `/sla`
  viewer makes each one a billed Clerk MRU. Plan §"Clerk caveat" prices it:
  ~200K MRU ≈ **$2,825/mo** at 10% DAU adoption (vs ~$20–100/mo optimized
  transport). Per the caveat rules this is priced-before-shipped: the decision
  is **keep `/sla` members-only for now** (its report already sits behind the
  verified-session gate; only its live slivers poll the service endpoints,
  which E4S2 now grants). If SLA live data must reach a broader audience,
  split a separate endpoint with an explicitly broader policy + minimized
  response — new API work, never a mutation of this transport. MRU dashboard +
  40K alert = E3S4 runbook.
- **E4S6**: after deploy — verify 401/403/`private` against real Clerk tokens.

## Epic 5 — Capacitor native shell

Status: **all code stories already satisfied by the existing platform
services; E5S5 device validation is operator work at final validation.**

- **E5S1 done**: the TRANSPORT CONTRACT comment (change 6) lives on
  `requestTickUpdate` in `shared/live/polling.ts` — the shared seam both the
  React app and future Swift/Kotlin implementations consume.
- **E5S2 done (pre-existing)**: `web/ui/services/platform/capacitor/` —
  `lifecycle.ts` maps `appStateChange` → the `Activity {active, online}` seam
  that `useActivity`/`VehiclePoller.setActive` already consume; network
  status → `online`. Pollers pause on inactive ⇒ foreground-only by
  construction (no background polling; a WebView timer is not a background
  service). Notifications/preferences/sharing/location adapters unchanged.
- **E5S3 done (pre-existing)**: `VITE_API_ORIGIN` reaches only the config
  fetch (`web/ui/services/http/config.ts`); grep confirms no live host,
  cadence, or vehicle path is baked into any client source. Repointing the
  fleet transport needs no app update.
- **E5S4 done (pre-existing)**: `AccountProvider({adapter})` seam +
  `createApiClient({token, credentials: 'omit'})` is the native session
  driver contract per docs/ui-platform.md; the native shell composes it.
- **E5S5 (op)**: real-device validation — foreground/active transitions,
  the 404 skew path on a skewed device clock, outage rendering. Deferred to
  final validation with the user.

## Epic 6 — Broadcast-only invariant hardening

Status: **E6S1 + E6S2 done (code); E6S3 rolls into final validation.**

- **E6S1 done**: `shared/http/api-queries.ts` gains `locationQueryParameters`
  (lat/latitude/lon/lng/long/longitude/accuracy/geohash/quadrant/cellId/bbox,
  case-insensitive) + `hasLocationQuery(url)`. `privacyQueryResponse` now
  rejects a location-bearing query on **every** path — allowlisted selector
  or not, known route or not, any future live-host-shaped route included —
  before routing/auth/caching. The deleted `/api/v1/vehicles/streetcar` was
  also dropped from `knownRoutes`.
- **E6S2 done**: `shared/transit/spatial-index.ts` carries the full
  BROADCAST-ONLY invariant block (device-only; cell keys never API params or
  telemetry; nearest stop computed locally; location-server-side = new
  authenticated API work with its own review); `nearby.ts` carries a pointer
  comment. `check:boundaries` passes unchanged.
- Test: `tests/api/privacy-contract.test.mjs` E6S1 case — location rejected
  on allowlisted, selector-bearing, unknown, and live-host-shaped paths;
  legitimate selectors still pass.

## Epic 7 — Single-worker consolidation (map-generator → api)

Status: **E7S1–E7S6 done (code); E7S7 boundary needs a deploy + real sync run.**

- **E7S1 done**: `git mv` of `generate.ts`, `types.ts`, `config.ts`,
  `source/`, `topology/`, `layout/`, `rendering/`, `artifacts/` into
  `workers/api/src/mapgen/` (index.ts + wrangler config stayed behind to die).
  Escaping relative imports fixed mechanically (one extra `../` — every
  escaping target); intra-mapgen relative imports untouched (moved together).
  The generator HTTP shell (`healthz`, auth glue, JSON envelope parsing,
  `/api/debug/render`, `/api/internal/generate` routes) was deliberately
  **not** moved — it died with the worker.
- **E7S2 done**: no new provisioning — `Env` already carried `DB`,
  `SOURCE_ATTRIBUTION`, `SYNC_TOKEN`. `mapgen/types.ts` keeps `MapGeneratorEnv`
  (self-contained dir), structurally satisfied by `SyncEnv`. Merged-env comment
  on `Env` (E7S2) names exactly what mapgen consumes so nobody prunes it.
- **E7S3 done**: `requestMapGeneration(env, versionId)` calls
  `generateStreetcarMap` directly; the route's `map_generation_jobs`
  pending → running → failed bookkeeping moved into it (started_at on entry,
  error message ≤2000 chars on failure, rethrow). `SyncEnv` drops
  `MAP_GENERATOR: Fetcher`; `Fetcher` no longer imported by `env.ts`.
- **E7S4 done**: `maps/debug.ts` renders via `renderDebugMapSvg` in-process —
  `authorizedSync`, 2 MB `readLimitedBytes`, 413 `map-json-too-large`, 400
  `invalid-map-json`, CSP + sandbox + `nosniff` + `no-store`, exactly as the
  two-hop path enforced them.
- **E7S5 done**: `workers/map-generator/` deleted (incl. local .wrangler
  state); `MAP_GENERATOR` binding removed from `workers/api/wrangler.jsonc`;
  `Fetcher` import dropped from `env.ts` + `sync-common.ts` (with the
  "shared only between" comment); `deploy:map`, `deploy:map:dry`, `dev:map`
  scripts removed; `dev-stack.mjs` spawns one worker (8787 only);
  `bootstrap-local.mjs` lost its fake MAP_GENERATOR shim (generation is
  in-process); `regenerate-map.mjs` remote repair reads the API wrangler
  config; `sync-cloudflare-secrets.mjs` manages SYNC_TOKEN once.
  `grep map-generator` is clean outside docs/history.
- **E7S6 done**: `CODEMAP.md` (API table gains `mapgen/`; the "Map generator"
  section rewritten as in-process), README (worker list, deploy steps, debug
  route, secrets), docs/map-admin.md, docs/clerk-setup.md, docs/security.md,
  docs/physical-loop-audit.md, scripts/preview/preview-map.mjs, gitleaks
  comment, Makefile parity notes — all reconciled.
- **E7S7**: needs production — trigger the nightly sync (or `admin/sync`),
  watch generation → the atomic three-name pointer flip → map loads; rehearse
  rollback by redeploying the previous version and re-running generation.
- Tests: `tests/api/api-routes.test.mjs` + `tests/security/inputs.test.mjs`
  rewritten for in-process routes (400 invalid bundle, 200 + CSP/nosniff on a
  valid seed, 413 oversized, generation failure marks the job `failed` then
  throws). `tests/api/privacy-contract.test.mjs`, `tests/map/*`,
  `tests/live/subway.test.mjs`, `scripts/preview/import-rail-map.mjs` —
  import paths repointed only. Full suite: 349/349.

## Final work (after all epics)

1. **Final validation ran (2026-10-12)**:
   - `tsc --noEmit` clean · `check:boundaries` pass · `npm test` **349/349** ·
     `build:api` (ui + viewer) pass.
   - Live preview path verified end-to-end: `/api/v1/auth/config` serves the
     `live` block (base `''` same-origin, real cadence), `/live/t/<tick>/vehicles.json`
     serves the real fixture snapshot, future ticks 404.
   - Transport-relevant browser fixes applied so the deferred final run could
     exercise the new contract:
     - `scripts/preview/auth-fixture.mjs`: `/api/v1/auth/config` fixture now
       includes the `live` block (without it the client fails closed).
     - Check scripts repointed from `/api/v1/vehicles/streetcar` +
       `x-live-*` headers to `**/live/t/*/vehicles.json` tick docs
       (check-ui/mobile/app-readiness/snake/hackathon/exploration/subway/
       auth/i18n/collection).
     - Map-route interception globs gained the `*` suffix — the app has
       requested `/api/v1/map/ttcstatus?client=2` since "Nav v2 (#5)" and the
       old globs never matched the query (pre-existing).
     - check-ui: `.live-status` assertion → `.route-pulse .pulse-total`
       ("1 total on routes"); checkbox toggle → the Explore panel's
       aria-pressed layer button; second-poll ETag revalidation now waits the
       config cadence (31 s).
   - **Pre-existing breakage found (NOT transport): the whole Playwright
     suite is stale against the "Nav v2 (#5)" UI redesign and was failing
     before this work.** Confirmed failures, all in selectors for UI elements
     that no longer exist: `Include overnight routes`/`Show live vehicles`
     checkboxes (now layer buttons in ExplorePanel), `Sign in` button,
     `Paramètres de langue` link, `↗ Share map` button, `504 King` route
     button, `.live-status` section (imported but never rendered).
     `check-offline-shell` and `check-service` PASS. Rewriting the stale UX
     assertions is UI-QA work beyond docs/optimize-transport.md — needs a
     decision (see Open questions).
2. Operator/deploy-gated stories (E1S1 dashboard, E1S5 deploy checks, E2S6
   rollout share, E3S3 WAF rule, E3S4 dashboards/alerts + E4S4 per-session
   caps + MRU alert, E3S5/E4S6/E5S5/E7S7 validations) — the runbook lines
   are in each epic's section above.

## Operator runbook — dashboard/deploy steps (user-executed)

Progress as of 2026-10-12 (user did these in the Cloudflare dashboard):

1. **Bucket created** ✔ `ttcstatus-live` — the `LIVE_BUCKET` binding in
   `workers/api/wrangler.jsonc` now resolves at deploy time.
2. **Domain attached** ✔ `live.ttcstatus.ca` (R2 custom domain, native
   ETag/304).
3. **Cache rule set up** ✔ (respect origin TTL — objects carry
   `public, max-age=600` from the recorder).
4. **R2 CORS policy set** ✔ — recommended policy (one source of truth; no
   Transform Rule needed alongside it):
   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["if-none-match"],
       "ExposeHeaders": ["etag"],
       "MaxAgeSeconds": 300
     }
   ]
   ```
   **Why `*` (user question, 2026-10-12):** partly the native shell (WebView
   origins vary — `capacitor://localhost`, `ionic://localhost`,
   `https://localhost`, custom schemes — and R2 CORS is a dashboard edit, so
   an allowlist would make every new app ID a release gate), but mostly
   because these are public broadcast bytes with no credentials, ever:
   CORS is a browser-read control, not an access control (anyone can fetch
   the URL sans CORS regardless), so allowlisting buys no security. `*`
   also keeps the "repoint a shipped binary without an app update" rule
   true. An allowlist would be right only if this data were authenticated
   or per-user — the plan forbids both on this path.
5. **TODO(1Password) — JWKS URLs (E4S1 deploy gate):** `.env.local` and
   `.env.prod` now carry
   `CLERK_JWKS_URL=op://easley.ca/<vault item>/clerk_jwks_url`:
   - `op://easley.ca/ttcstatus.local/clerk_jwks_url` →
     `https://easley-pipefishl-2286.clerk.accounts.dev/.well-known/jwks.json`
     (dev instance frontend API host, decoded from the `pk_test_…` key).
   - `op://easley.ca/api.ttcstatus.ca/clerk_jwks_url` → the **prod**
     instance's `https://<prod-frontend-api-host>/.well-known/jwks.json`
     (Clerk Dashboard → API Keys, or decoded from the `pk_live_…` key).
     Public material, not secrets — 1Password placement just matches the
     other Clerk values. Until they resolve, `verifySession` treats an
     unresolved `op://…` literal as unconfigured → honest `503
auth-unavailable` on `/api/v1/service/*` (fail-closed, same convention
     as `clerkKey()` in `accounts/auth.ts`). Then run the E4S6 accept check:
     signed-out → 401; valid token without `voidOverlay` → 403; granted →
     200 `private`.
6. **REVISIT LATER (user instruction): WAF rules + observability**
   (E3S3, E3S4, E4S4) — after the deploy stabilizes and there is real
   traffic to observe:
   - WAF rate limiting: ~100 req/min/IP on
     `http.request.uri.path contains "/api/"`; a second rule ~10 req/min
     keyed on the session-token claim for the `/api/v1/service/` paths;
     nothing on `live.ttcstatus.ca`.
   - Dashboards + alerts: request volume per endpoint, 304 ratio, cache hit
     ratio, **MRU count with an alert at 40K** (Clerk Dashboard → usage).
   - `limits.cpu_ms: 300000` already set in wrangler (denial-of-wallet guard).

## Outstanding — everything not yet done, in order

### Doable by the next agent from this checkout

- **E8S1 — fix the stale Playwright suite** (the last story, by user
  directive): rewrite `check-ui`, `check-mobile`, `check-auth`,
  `check-i18n`, `check-subway`, `check-snake`, `check-hackathon`,
  `check-exploration` against the current "Nav v2" UI (failure inventory in
  Final work #1). `check-offline-shell` + `check-service` already pass.
- **`make dev` now boots the full stack** (2026-10-12):
  `scripts/dev/dev-stack.mjs start` spawns the API Worker (8787, wrangler,
  single worker) **and the Vite viewer** (4173, `strictPort`) — the viewer is
  a required component since Epic 2 (the tick path is same-origin and only
  the preview middleware serves `/live/t/<tick>/vehicles.json`; the worker
  SPA cannot, by the no-fallback doctrine). Both ports are bind-probed,
  both health checks are awaited (`/api/healthz`, `/`), a death of either
  component tears the whole stack down loudly, and the existing
  lock-file + `TTC_DEV_STACK_ID` + process-group machinery stops any
  previous stack (and orphans) before starting. `make dev/status` /
  `dev/stop` list/stop the viewer automatically (generic over lock workers).
  **Dev flow: `make dev/new` (first time) → `make dev` → open
  http://127.0.0.1:4173** — no second terminal needed anymore.

### User one-time steps (1Password / dashboard)

- **1Password: add the two `clerk_jwks_url` fields** (runbook step 5) —
  `.env.local` / `.env.prod` already reference them; until they resolve,
  `/api/v1/service/*` answers honest 503s (fail-closed).
- **R2 lifecycle rule — DONE (confirmed 2026-10-13)**: `live/t/` objects
  expire after 7 days (not the ~1 day this plan sketched). Storage stays
  ~5 GB steady state (~$0.08/mo); see docs/optimize-overlay-thunks.md for
  what the longer window is (and is not) good for.
- **Deploy this branch** (`npm run deploy:api` after
  `npm run db:migrate:remote`) — then the accept checks: HIT/304/CORS on
  `live.ttcstatus.ca`, config caching, outage-doc publish (kill the
  upstream deliberately and watch the honest `{ vehicles: [], outage }` doc
  appear), lifecycle expiry.

### User / next-agent after deploy stabilizes (REVISIT, per user instruction)

- **E3S3/E3S4/E4S4**: WAF per-IP ~100/min on `/api/*`; per-session ~10/min on
  the granted service endpoints; dashboards + alerts incl. **MRU alert at
  40K** (runbook step 6).
- **E3S5**: watch a real 9am rush — removal held, bill ≈ the modeled table
  (~$20–100/mo; investigate gaps).
- **E4S6**: 401/403/`private` against live Clerk tokens.
- **E7S7**: trigger the nightly sync (`/__scheduled` or `admin/sync`) →
  import → generation → the atomic `streetcar`+`snake`+`ttcstatus` pointer
  flip → map loads; rehearse rollback (redeploy previous version, re-run).
- **E5S5**: real-device checks (foreground transitions, skewed-clock 404
  path, outage rendering).
- **E2S6**: watch old-path share ≈ 0 (nothing calls the deleted Worker route
  anymore; only cached old web shells might until they refresh).

## Open questions / decisions log

- **Stale Playwright suite (needs a user decision):** the browser checks
  reference the pre-"Nav v2 (#5)" UI and fail on selectors that no longer
  exist (checkboxes, nav links, share button, route buttons, `.live-status`).
  Transport-relevant paths were repointed and verified; the remaining UX
  assertions need a rewrite against the current UI (out of transport scope).
- `tickId` grid: `floor(epochMs / 30_000)` — identical formula in recorder
  (`service-recorder.ts`) and clients (`shared/live`). Do not shift this grid;
  disagreement = synchronized global 404 (see plan's profanity-permitted comment).
- Live host/cadence/path template flow: wrangler vars → `authConfig(env)` →
  `/api/v1/auth/config` (`public, max-age=300`) → client memory. Never baked
  into a binary.
