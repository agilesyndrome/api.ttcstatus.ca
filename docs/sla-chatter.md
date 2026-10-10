# SLA work chatter

Working notes for the implementation of the stories in
[sla-stories.md](sla-stories.md), with [sla.md](sla.md) as the project background.
This file is the honest log: what was done, what was verified, what is pending, and
every deviation from the story cards' ideal acceptance criteria.

## Objective (recorded verbatim from the user's /goal command)

> complete all stories in docs/sla-stories , use docs/sla.md for background about
> the project. Use docs/sla-chatter.md for recording notes about your work. When a
> story is complete mark it as done in docs/sla-stories.md. Work in parallel if the
> stories allow it. Push NOTHINg to git, deploy nothing

**Operating constraints (derived, kept strict):**

- **No git pushes, no commits** — all work stays as local file changes only.
- **No deploys** — nothing may touch Cloudflare remotely: no `wrangler deploy`, no
  remote D1, no production/edge verification. Everything is verified locally
  (unit tests, `pre-flight`, dev-stack-shaped harnesses).
- **Honesty rule for story status:** a story is marked done in `sla-stories.md`
  when its implementable scope is complete and locally verified. Acceptance
  criteria that _inherently require a deployed stack or a production soak_ are
  implemented as far as they can be (code, tests, instrumentation, runbooks) and
  recorded in the **Deployment-pending ledger** below. Nothing is marked done
  silently on the strength of an unverifiable claim.

**Tooling caveat:** the goal-mode tool stored a truncated objective ("H") after
repeated transport truncation of the long objective text; the full objective above
is authoritative for that (completed) work.

## Objective 2 — the /sla status page (goal of 2026-10-10, recorded verbatim)

> A slick looking page at /sla that mimics the style of USA-status.com. Continuing
> our code on the sla branch, create a new page (non-map) that looks like the page at
> USA-status.com showing a (filterable) list of routes & stops and the little green
> yellow red bars based on the TTC's designated metric of how often they met their
> SLA. For SLA publish either check the schedule in static feed / schedule data,
> (probably best) or if data is not there consider the TTC's published metrics on
> TTC.ca (seems harder) for each route publish the SLA TTC indicates and show as
> many tick marks as you have data segments for…. This cannot be computed in real
> time so if you need to address what happens when real time data comes in, do
> that — this page should be fast to load and not suddenly ask the server to
> calculate SLA metrics. Bonus points for showing the roll up from real time 30
> second data to rolling up to daily, weekly with larger width boxes (you'll need
> to calculate those too)

**Tooling caveat (repeated):** the goal-mode tool again truncated the stored
objective (to "S") — the same transport bug as Objective 1's "H". The verbatim
text above is authoritative for this work. (`&amp;` in the command payload is a
transport encoding artifact for "routes & stops".)

**Carried-forward operating constraints (unchanged from Objective 1):** no git
commits or pushes; no deploys or remote Cloudflare access (no `wrangler deploy`,
no remote D1); everything verified locally (unit suites, `pre-flight`,
dev-stack-shaped harnesses, fixture-intercepted browser checks); deploy-dependent
acceptance criteria go to the deployment-pending ledger honestly. The promise
lens is a lens: nothing in the delivered-service pipeline changes its behaviour.

**Epic 8 is the implementation of this objective** — story cards in
[sla-stories.md](sla-stories.md), work logged below in the work log.

## Progress tracker

| ID   | Story                                                                  | Status                                         |
| ---- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| E0S1 | Service contracts                                                      | ✅ done                                        |
| E0S2 | Service configuration & frozen decisions                               | ✅ done                                        |
| E5S1 | Feature-flag backbone                                                  | ✅ done (deployed-stack gate pending — ledger) |
| E0S3 | Rollup storage migration                                               | ✅ done                                        |
| E0S4 | Spike: fold-write shape & D1 limits                                    | ⬜ done                                        |
| E0S5 | Spike: DO alarm precision & tick idempotency                           | ⬜ done                                        |
| E0S6 | Ground-truth scenario corpus                                           | ✅ done                                        |
| E0S7 | Preview fixture adapter                                                | ⬜ done                                        |
| E0S8 | DO binding, env plumbing, green board                                  | ⬜ done                                        |
| E1S1 | Recorder DO scaffold & tick loop                                       | ⬜ done                                        |
| E1S2 | Network bootstrap in the DO                                            | ⬜ done                                        |
| E1S3 | Streetcar touches: matching & emission                                 | ⬜ done                                        |
| E1S4 | Streetcar direction & dwell dedupe                                     | ⬜ done                                        |
| E1S5 | Subway touch detection                                                 | ⬜ done                                        |
| E1S6 | Window store & pruning                                                 | ⬜ done                                        |
| E1S7 | Recorder-core purity & test harness                                    | ⬜ done                                        |
| E1S8 | Ops & data-citizenship docs                                            | ⬜ done                                        |
| E2S1 | Headway extraction with censoring                                      | ✅ done                                        |
| E2S2 | Renewal wait E[W]                                                      | ✅ done                                        |
| E2S3 | Residual wait R(e)                                                     | ✅ done                                        |
| E2S4 | Two-axis dryness & states                                              | ✅ done                                        |
| E2S5 | Back-to-back marker                                                    | ✅ done                                        |
| E2S6 | Self-baseline sourcing (window)                                        | ✅ done                                        |
| E2S7 | Moment merging for rollups                                             | ✅ done                                        |
| E2S8 | Corpus end-to-end assertions                                           | ✅ done                                        |
| E6S1 | Analytics Engine counters                                              | ⬜ done                                        |
| E3S1 | GET /api/v1/service/stops                                              | ⬜ done                                        |
| E3S2 | GET /api/v1/service/wave                                               | ⬜ done                                        |
| E3S3 | Service API contract & budget tests                                    | ⬜ done                                        |
| E5S2 | Debug overlay v0                                                       | ⬜ done                                        |
| E5S3 | Space-time replay (debug panel)                                        | ⬜ done                                        |
| E6S2 | Public API docs (experimental)                                         | ⬜ done                                        |
| E6S3 | Browser tests (test:service)                                           | ⬜ done                                        |
| E4S1 | Fold mechanics                                                         | ⬜ done                                        |
| E4S2 | Rollup storage & 36-hour retention                                     | ⬜ done                                        |
| E4S3 | GET /api/v1/service/history                                            | ⬜ done                                        |
| E4S4 | History tests                                                          | ⬜ done                                        |
| E4S5 | Fold-failure grace                                                     | ⬜ done                                        |
| E5S4 | Stop "today so far" sparkline                                          | ⬜ done                                        |
| E2S9 | Rollup-stabilized self-baselines                                       | ⬜ done                                        |
| E6S4 | One-week soak review                                                   | ⬜ done                                        |
| E6S5 | Docs finalized & reconciled                                            | ⬜ done                                        |
| E6S6 | Hand-off: polished-overlay epic proposal                               | ⬜ done                                        |
| E7S1 | The dream overlay (polish epic, part 1)                                | done                                           |
| E7S2 | The sweep + the heartbeat (polish epic, part 2)                        | done                                           |
| E7S3 | Local-dev overlay bypass (polish epic, dev UX)                         | done                                           |
| E7S4 | Thin dual-direction streams on the track; direction + speed as honesty | done                                           |
| E7S5 | The 5-minute cadence fix (dev env)                                     | done                                           |
| E7S6 | The snail slime + gradient softening (polish epic)                     | done                                           |
| E7S7 | Subways disabled; snake game hard-suspend (polish epic)                | done                                           |
| E8S1 | SLA targets from the static feed (the promise, published)              | ✅ done                                        |
| E8S2 | SLA compliance math (pure, promise-lens)                               | ✅ done                                        |
| E8S3 | Tier 3: daily/weekly SLA folds (the precompute)                        | ✅ done                                        |
| E8S4 | GET /api/v1/sla/report (precomputed-only serving)                      | ✅ done                                        |
| E8S5 | The /sla page (USA-status-style status page)                           | ✅ done                                        |
| E8S6 | Docs & reconciliation (Epic 8 close)                                   | ✅ done                                        |

Status legend: ⬜ todo · 🔨 in progress · ✅ done (see log) · ⏸ blocked

## Deployment-pending ledger

Every acceptance criterion that requires a deployed stack, remote D1, or a
production soak lives here until it can be verified. Each entry names the story,
the clause, what _was_ done locally, and the command a human with deploy rights
would run to close it out.

(Entries are appended as stories complete.)

**L1 — E5S1 AC#6: end-to-end flag grant on a deployed stack.**
Done locally: migration schema, CLI, endpoint and hook are all implemented and
unit-tested (`tests/service/feature-flags.test.mjs`, 5 green); the endpoint's
auth path is exercised the same way `tests/accounts` does it (auth handled
upstream by `authenticateAccount`). Pending (needs deploy rights):
`npm run db:migrate:remote` (runs in the deploy pipeline), then
`npm run feature:enable -- voidOverlay drew@easleyowl.com`, then sign in as two
different accounts and diff `GET /api/v1/me/features` — the granted account
shows `voidOverlay`, the other shows `[]`.

**L2 — E0S3/E5S1 migrations against real D1.** Both schemas verified through
the SQLite D1-shaped harness; `npm run db:migrate:local` (wrangler, local
miniflare state) runs at E0S8 when the DO binding lands; the remote apply is
part of the normal deploy pipeline.

**L3 — Stage 1 exit gate: ≥ 48 h of continuous 30-second ticks with healthy
telemetry in the auth'd /api/v1/feed/status, deployed.**
Done locally: the loop ran unattended for the whole work session (70+ ticks,
real feeds, drift <= 16 ms, tick work 368-403 ms, zero upstream failures
while the feeds were up) and every honesty rule is unit- and
browser-verified. Pending: the multi-day continuous production measurement.
A human with deploy rights runs the normal deploy, then checks
`GET /api/v1/feed/status` (Bearer SYNC_TOKEN) at intervals across two days;
`recorder.recentFireTimes`, `lastTickDurationMs`, `foldFailures` carry the
evidence.

**L4 — E6S4: the 7-day production soak against real billing.**
Done locally: everything measurable without a deploy is in
docs/sla-soak-review.md (cadence, tick cost, fold throughput, live payload
verifications, budget tests). Pending: cost and tick health over seven
continuous production days, reviewed against the doc's cost model, before
any polish-epic work starts (the stages doc's own gate).

**L5 — E5S1 AC#6 / migrations: remote D1 apply + end-to-end flag grant.**
(Consolidates L1/L2.) The deploy pipeline applies migrations 0005/0006
remotely; then `npm run feature:enable -- voidOverlay <user-or-email>`, sign
in as that account and one other, and diff `GET /api/v1/me/features`.

**L6 — Epic 8: remote migrations + the first live fold + report on the
deployed stack.** Done locally: migrations 0007 (schedule tables) and 0008
(Tier 3) verified through the SQLite D1-shaped harness; the derivation,
fold, and endpoint all exercised end-to-end against seeded data; the page
browser-verified through the preview fixture. Pending (needs deploy rights):
`npm run db:migrate:remote` (0007/0008 ride the normal pipeline), one
deploy so the nightly import writes real schedule targets and the hourly
`41 * * * *` cron folds real rollups, then after ≥ 2 hours check
`GET /api/v1/sla/report` (dataThrough today, tick strips populating) and
open `/sla` in a browser. The first ~36 hours only show the growing
today-so-far row until a full day folds — that is the honest behaviour,
not a bug.

**L7 — Epic 8: a week of production data before the weekly boxes mean
anything.** The weekly grain renders as soon as any week has one folded
day, but the wider boxes are honest only once whole weeks exist. After 7
days of production folds, spot-check one route's week compliance against
the exact sum of its days (the E8S3 idempotency test is the reference
derivation).

**L8 — Epic 8: the next production feed flip runs the new schedule
derivation inside workerd for the first time.** Done locally: the
derivation ran against the real completegtfs.zip through the same modules
(end-to-end in Node: 18-23 s, ~595 MB peak RSS, of which the schedule
materials are a fraction — shapes and patterns dominate, and the existing
import already carries those in production); the persistence path is
exercised end-to-end by the importNetworkVersion test through the SQLite
harness. Pending: the first real feed flip (the feed refreshes ~every 6
weeks) runs parse + deriveSlaSchedule + persist inside the production
worker. If it ever trips workerd's memory ceiling, the failure is the
sync pipeline's own loud-and-isolated story (version marked failed_import,
the active map and the previous SLA targets untouched, retried next sync)
— and the fold keeps scoring against the last good targets version.

## Work log

Newest entries at the bottom. Each completed story gets an entry with: what was
built, files touched, tests added, local verification results, and caveats.

### 2026-10-09 — kickoff

- Read `docs/sla.md` and `docs/sla-epics.md`; `docs/sla-stories.md` (43 stories)
  is the work queue.
- Survey of the repo started: router, accounts/Clerk machinery, test harness,
  preview adapters, CLI precedent, UI layout — to implement stories in the
  house style rather than inventing a parallel one.

### 2026-10-09 — E0S1 · E0S2 (contracts + config)

- `shared/service/contracts.ts`: `TouchEvent`, `CoverageInterval`, `RollupRow`,
  `StopServiceState` field-for-field per sla.md §4.3, plus the response DTOs the
  API stories name (`ServiceWave*`, `ServiceHistory*`, `FeatureFlagsResponse`) and
  `VOID_OVERLAY_FLAG`. Timestamps epoch ms; durations seconds.
- `shared/service/config.ts`: the `shared/live/config.ts` pattern (validated
  defaults, env overrides, **fallback to default — never clamped — when out of
  range**, matching `liveUpdateSeconds` semantics).
- Decisions recorded in sla.md §9: recorder mode **`always`** (viewer-coupled
  recording would bias the record); initial thresholds (30 s sample, 40 m radius,
  120 s dwell dedupe, 45 s b2b, fresh r<0.5, void r≥2 or ≥15 min absolute,
  baseline ≥3 touches, 36 h history).
- Semantics decisions for the corpus (recorded here because the doc leaves them
  open): **censored gaps** = first-in-window edge gap + outage-overlapping gaps +
  the ongoing gap, all excluded from moments and counted in coverage;
  **baseline tier** uses the ≥3-_touches_ rule (sla.md §4.6), i.e. ≥2 complete
  headways; **medianHeadwayOwn** = empirical median of uncensored window
  headways at Stage 1 (hand-derivable everywhere), gamma-approx when only
  rollup moments exist (Stage 3, labelled approx); **expectedWait = R(e)** per
  E3S1 ("expectedWait R(e)"), with E[W] as the internal shrinkage target; when
  sample variance is ~0 the gamma path degenerates to deterministic
  `R(e) = max(H̄ − e, 0)` (sla.md §3.3's "counts down to 0" for even service).
- Tests: `tests/service/config.test.mjs` (6 green). Typecheck green.
- Note: `npm run typecheck` caught the initial out-of-range semantics mismatch
  (clamp vs fallback) — house pattern (fallback) wins.

### 2026-10-09 — E5S1 (feature-flag backbone)

- Spike outcome (recorded in CLI header + migration comment): Clerk session
  claims in this repo expose only the **user id** server-side
  (`workers/api/src/accounts/auth.ts` reads `state.toAuth()?.userId`; zero
  `email` references anywhere in `workers/api/src`). Table PK = `(flag, subject)`
  with subject = Clerk user id; the CLI accepts **either** — emails resolve via
  the Clerk Backend API (`GET /v1/users?email_address=…`) when
  `CLERK_SECRET_KEY` is exported, with a clear error telling the operator to
  pass the user id otherwise.
- `migrations/0005_feature_flags.sql`; `scripts/operations/feature-flags.mjs`
  (pure functions + remote-D1 CLI on the `tag-map.mjs` precedent; `typescript`
  and `wrangler` imported lazily so tests can import the module without
  wrangler); npm scripts `feature:enable|disable|list`.
- `GET /api/v1/me/features` via `ownedAccountResponse` (new case in
  `accounts/index.ts`): `no-store` + CORS (deviates from plain `accountReply`
  deliberately — the story card specifies CORS for this endpoint).
- `web/ui/features/service/useFeatureFlags.ts`: one fetch per user per session
  (module-level promise cache), `loaded/available/has()/overlayEnabled`.
  Nothing consumes it yet — that is the point.
- Tests: `tests/service/feature-flags.test.mjs` — 5 green (SQLite round-trip
  incl. upsert; flag-name validation; subject resolution incl. fake Clerk API;
  endpoint payload/headers/empty-for-strangers).
- Deployed-stack end-to-end → ledger **L1**.

### 2026-10-09 — E0S3 (rollup migration)

- `migrations/0006_service_rollups.sql`: `service_rollups` per `RollupRow`
  contract, PK `(stop_id, bucket_start)`, `idx_service_rollups_bucket_start`,
  `route_ids` JSON with `CHECK(json_valid)`, `fold_hash` for byte-identical
  refold verification. No existing table touched.

### 2026-10-09 — E0S6 + Epic 2 Track B (corpus + the math)

- `shared/service/fixtures.ts`: six scenarios (clockwork, waiting-paradox,
  one-way-void, terminal-dwell, night-and-day, outage, outage-live) plus the
  §3.2 worked example, every expected value hand-derived in comments. Fixed one
  fixture bug found by the suite (terminal-dwell edge-gap censoring: 2, not 1).
- `shared/service/wait-metrics.ts`: headways+censoring, moments, E[W], R(e)
  (empirical + gamma-MoM with NR incomplete-gamma machinery), two-axis
  dryness/states, back-to-back, window baselines, moment merging, fold
  derivation, live-state assembly.
- Tests: `tests/service/{wait-metrics,states,merging,scenarios}.test.mjs` —
  the corpus suite asserts every hand-derived expectation end-to-end.
  50/50 service tests, 239/239 full suite, typecheck green.
- **Design reconciliations recorded here (the doc left these open):**
  1. **`RollupRow.n` counts uncensored headways, not touches.** sla.md §4.3's
     comment says "touches", but §3.7's "n, Σh, Σh² → exact H̄ and CV²" only
     works if n is the headway count; E2S7's done-when ("merged CV² equals raw,
     exactly") is the testable claim, so it wins. Contracts comment updated.
  2. **Leading gaps.** Each bucket's moments include the gap from the previous
     observed touch into the bucket's first touch, so every consecutive touch
     pair is counted exactly once across buckets and a 19-minute bunch gap
     crossing a boundary survives folding (otherwise the day-level CV² would
     miss precisely the voids the product exists to show). Consequence for
     E4S1: fold each bucket when it completes, while its raw rows (and the
     predecessor touch) are still inside the 30-minute window — refold stays
     byte-identical and race-free.
  3. **Shrinkage is a Stage-1 no-op by construction** (the delivered baseline
     IS the window sample); E2S9's rollup moments make it a real stabilizer.
  4. **`expectedWait` = R(e)** per story 3.1's "expectedWait R(e)"; E[W] is the
     internal shrinkage target.
  5. **R(e)'s "growth" is the jump at bunch-gap boundaries** (hand-derived
     corpus: 541 s → 1079 s as e crosses 30 s); within a regime it counts down.
  6. **Back-to-back counts pairs on the full consecutive-touch chain**, so a
     pair straddling a bucket boundary still counts.
  7. **`maxCrossGapSeconds` added to merged spans**; `worstGapSeconds()`
     combines intra-bucket and cross-bucket wounds for history summaries.

### 2026-10-09 — Stage 0 complete + Stage 1 Track A (the recorder)

- **E0S4 (fold-write spike)**: `scripts/operations/fold-write-spike.mjs`
  measures the real insert code through a D1-shaped SQLite adapter:
  chunked multi-row INSERTs (7 rows x 13 cols = 91 params, under D1's
  100/query) at ~19 ms vs ~47 ms per-row for a 2000-row worst-case fold;
  idempotent rewrite proven. Production shape lives in
  `workers/api/src/service/rollup-writes.ts` (tested).
- **E0S5 (alarm spike)**: measured the REAL recorder loop live in
  `wrangler dev` (the make dev stack core): median cadence 30.000 s, max
  fire offset 16 ms across ticks, tick work 84 ms with both real feeds
  available. The 10 s tick tolerance in config has ~600x headroom;
  tickId idempotency proven (duplicate/late alarms are no-ops, unit
  tested). Local dev only - nothing deployed.
- **E0S8 (plumbing + green board)**: first durable_objects binding +
  DO migration + 13 SERVICE_* vars in wrangler.jsonc; Env extended;
  narrow DO interfaces in workers/shared/cloudflare/bindings.ts (house
  style); db:migrate:local applies 0005+0006 cleanly; dry-run validates;
  pre-flight board fully green (9/9) after fixing lint/format (three
  pre-existing format failures in snake files and docs were also
  formatted - the board was partially red before this work).
- **Track A (E1S1-E1S8 + E6S1)**: recorder-core.ts (pure state machine:
  streetcar matching via matchGpsToTrack with continuity + direction
  corroboration + dwell dedupe; subway prediction-aging with flap
  idempotency; coverage runs), network.ts (active-version bootstrap,
  edges from shapes), window-store.ts (DO SQL window, prune boundary,
  fold-ready), service-recorder.ts (thin shell: alarm loop, feeds,
  persist, prune, states, analytics counters, /states + /window seams),
  recorder-fixtures.ts (nearside platforms with side-by-side tracks,
  subway scripts). One epic-boundary test file
  (tests/service/recorder.test.mjs, 14 tests) covers every story's
  done-when through the SQLite harness, no DO runtime. Full suite
  255/255 at the boundary; typecheck green.
- **Fixture geometry lesson (recorded)**: nearside adversarial cases need
  side-by-side tracks offset in LATITUDE with platforms also offset along
  the street; offsetting only longitude puts both tracks on one line and
  every fix matches both edges at distance 0.
- Per user steering: testing now happens at EPIC boundaries, not per
  story. Full suite + board at each epic edge.

### 2026-10-09 — Stages 2-4 complete: first light, the long memory, the hand-off

- **Epic 3 (E3S1-E3S3)**: /service/stops + /service/wave with the
  vehicles-endpoint conventions (ETag/304 per tick via tick-quantized DO
  payloads, ~15 s edge cache, X-Live-* headers, wire rounding, honest 503).
  One real bug found by LIVE verification: the DO route paths never matched
  because the DO name sat in the URL path (`/service-recorder/states`) -
  moved to the hostname (`https://service-recorder.internal/states`). After
  the fix every endpoint was verified against the real live recorder:
  634 stops / 98 real voids / 10 wave patterns / 112 history stops with real
  CV2 (0.07-0.78).
- **E0S7**: the preview adapter serves the corpus through the real math
  (states, wave, 36 h history folded with deriveRollupRows/merge; merged
  stats reconcile by hand) - overlay development ran on it from Stage 0.
- **Epic 5 (E5S2/E5S3/E5S4)**: VoidOverlay (split directional markers, five
  states at a glance, hatched unmonitored, b2b badges, reduced-motion),
  space-time replay with scrubber, and the 36 h sparkline; the flag gate
  means zero render AND zero /service/* requests when off (browser-proven).
- **Epic 4 (E4S1-E4S5)**: the fold orchestrator (leading-gap design: fold
  buckets while raw rows survive, aged predecessors fall back to folded D1
  rows), hourly 36 h retention, /service/history with exact merged moments
  and per-bucket series, and fault-injected fold-failure grace. Live folds
  wrote 2,529 real rollup rows to local D1.
- **E2S9**: rollup-stabilized baselines via one grouped D1 aggregate per
  fold cycle; the 15-minute night case is now due-calm instead of
  collecting; window-rich behaviour byte-identical.
- **E6S2/E6S3**: README entries (experimental-marked), CODEMAP rows, and
  the test:service Playwright check (states, gating, night-vs-day,
  unmonitored-vs-void, replay, sparkline, zoom health) - all green against
  the real preview stack.
- **Stage 4 (E6S4/E6S5/E6S6)**: soak review published with local live
  evidence; docs reconciled; the polished-overlay proposal published with
  the §11 hooks verdicts and the GO recorded (provisional on the
  production soak).
- **Final state: 43/43 stories done.** Full suite 269/269; pre-flight board
  9/9; typecheck, lint, format clean; nothing committed or pushed (per the
  goal's constraint) - all work is local working-tree changes.

### 2026-10-09 — The dream overlay (E7S1: the polish epic's first light)

User steer: "the intuitive type of UI that was an iPhone in grandma's
hands, with the brain of a PhD UI developer. Seeing the coming wave as the
stops aren't serviced on a route needs to be intuitive based on the math
data we now have."

What shipped (all local; nothing pushed or deployed, per the standing
constraint):

- **The brain — `web/ui/features/service/wave-field.ts`** (pure, tested):
  the dryness field along a route pattern at ANY moment (live or scrubbed),
  computed from the wave's ordered stops + touches with the same shared
  `drynessAndState` truth the API uses; void runs identified as wave
  segments with the coming stops named; plain-language sentences
  (`stopSentence`, `waveSentence`) so every number speaks; a
  colour-weakness-safe state ramp where fresh/void differ in lightness as
  well as hue.
- **The corridor — `WaveField.tsx`**: the wave, drawn. Lanes of the field
  per ordered stop, the void run outlined with its travel arrow, per-lane
  plain tooltips, tap-a-lane to select. `live` pins the field at the wave's
  end; `replay` scrubs the wedge back to the moment it was still forming —
  the §3.9 sentence ("consecutive stops rise through fresh -> due -> void")
  is now something you watch happen.
- **The markers — `VoidOverlay` reworked**: wait-timer rings that FILL as
  dryness approaches the void horizon (r drawn, not described); gentle
  pulse on void only, never under reduced motion; hatched unmonitored
  unchanged; thumb-sized transparent hit targets that never blanket a
  neighbour; selected halo.
- **The story — `StopCard.tsx`**: tap a marker (map or lane) and the stop
  tells you what happened in words: "19 min without a car — usually every
  5.8 min (3.2x the usual). Next car ~ 4 min." with the facts grid, the
  pair-passed-here badge, and the blind-spot apology. Every phrase is a
  served number.
- **One selection everywhere**: map markers, corridor lanes, and the
  sparkline selector share one selected stop.

**The discovery that mattered (recorded for the future):** React `onClick`
on map-scene elements never fires — the camera owns all pointer input via
pointer capture and hit-tests interactive elements by `data-feature` /
`data-vehicle` in `onPointerUp`. The overlay now plugs into that house
protocol with `data-service-stop` (wired through TransitMap ->
useMapCamera -> onSelectServiceStop), so markers are tappable exactly the
way stop features are, and the tap still respects following/driving
semantics.

- **Contract additions (additive):** `ServiceWaveResponse.coverage` (so
  the field can tell unmonitored from unserviced at any scrub moment) and
  `StopServiceState.routeIds` (already served by the DO; now typed).
  Fixture stop positions spread per scenario so preview markers never
  stack.
- **Tests at the epic boundary (per user steering):**
  `tests/service/wave-field.test.mjs` (5 green — field states, scrub
  honesty including unmonitored-in-outage, sentence numbers, wave
  headline, colour ramp) and the Playwright check extended: corridor
  lanes/wedge/arrow/sentence, replay scrub dissolves and restores the
  wedge, marker tap opens the card with the plain sentences, lane tap
  selects. Full suite 274/274, board 9/9, UI builds clean.
- **Live verification:** against the real recorder on the dev stack -
  638 stops (all with routeIds, 548 with R(e)), the wave serving 229
  route patterns (63 lanes / 295 touch dots on the busiest), and the
  earlier zero-pattern scare was just the freshly-restarted isolate
  waiting for its first alarm cycle.
- Retired `ReplayDiagram.tsx` (the WaveField's scrub IS the replay now —
  one visualization for live and history).

### 2026-10-09 — E7S2: Part 2 — the sweep and the heartbeat ("animated honestly")

User steer: "Talk out part 2 and let's roll!" The talked-out rule: **motion
only from measured data** — no decorative animation; every moving pixel is a
number we already serve. Two motions shipped:

- **The sweep ("▶ watch" chip on the corridor).** A ~20 s time-lapse of the
  last 30 minutes: the field re-computes at a requestAnimationFrame-advanced
  scrub point (throttled to ~12 fps), so the wedge forms behind the pair and
  sweeps lane by lane — and it LANDS ON LIVE, because "now" is the moment
  grandma cares about. Dragging the slider (pointerdown) pauses into replay;
  the live chip cancels; the scrubber stays visible with progress. Motion
  comes only from the field's own state changes — no easing, no springs.
- **The heartbeat (the map breathes between ticks).** Everything was
  30-second-quantized; a stop hitting r = 2.0 twelve seconds after a tick
  waited 18 more seconds to show it. Now a 1 Hz clock advances elapsed
  honestly (elapsed since lastTouchAt genuinely grows one second per second)
  and re-scores with the SAME shared drynessAndState: rings fill in real
  time, labels tick up, stops cross fresh -> due -> void at the true moment.
  Guardrails (all tested): R(e) and baselines stay tick-fresh (numbers about
  gaps, not clocks); coverage stays tick-fresh; unmonitored and collecting
  never advance into a verdict; the wave feed now polls every 30 s with
  retained ETag (304 keeps the payload) and keeps the last good wave on
  failure; the live field's breathing FREEZES if the wave payload is staler
  than 45 s — stale data must not pretend to tick forward.

New brain functions (pure, tested — 8/8 in wave-field.test.mjs):
advanceStopState (per-marker heartbeat) and advanceField (corridor
heartbeat, segments re-form between ticks). routeFieldAt refactored onto a
shared withSegments() so the wave segments can never disagree between live
and advanced paths.

Verified: browser check extended and green — press ▶ watch (aria-pressed),
scrubber appears, the wedge forms MID-SWEEP (waitFor visible), cancel to
live returns aria-pressed false. 277/277 suite, board 9/9, typecheck/lint/
format clean. One strict-mode lesson: a map stop named "Mount Olive Station"
collides with getByRole name 'live' — the check uses exact: true.

### 2026-10-09 — E7S3: the local-dev overlay bypass (why the map looked empty)

User steer: "Shouldn't I see more on this map, especially around Queen?"
(They were viewing the 0.0.0.0-bound dev stack from the LAN.) Diagnosis from
the live stack: the car layer was fine (237 streetcars, 20 on the 501) and
the delivered-service data was rich (98 Queen stops, 39 in void at that
moment) — but the overlay never mounts locally because it is per-user gated
through Clerk, and local dev has no Clerk keys (those come from 1Password
via make dev's .env.local). Auth disabled -> no sign-in -> no flags -> no
overlay. The gate was working exactly as designed; it was just undemoable
at home.

Shipped: an explicit dev-only bypass — when the site itself runs without
auth (`account.enabled === false`, only true locally since production
always has Clerk configured), `?voidOverlay=1` opts in, persisted in
sessionStorage so refreshes keep it. Production can never fire it.

Verified against the REAL worker (no fixtures, no interception): plain load
= 0 markers, 0 panel, and 0 /service/* requests (the gate still holds);
`?voidOverlay=1` = 603 live markers (181 fresh / 242 due / 179 void /
1 collecting), panel live, 38 corridor lanes, zero slow requests, zero page
errors, and session persistence across a plain reload. The browser check
still passes (its fixture keeps auth enabled, so the bypass never fires and
the flag-off assertion still sees zero requests): 277/277, board 9/9.

### 2026-10-09 — E7S4/E7S5: thin dual streams, and the frozen-streetcars fix

User steer: lines too thick; animate BOTH directions on the track with the
animation direction being the direction of travel; speed related to delay
("green goes faster — faster arrival of streetcars there"). Plus: streetcars
not updating live positions?

**E7S4 — the dual-stream track.** Each direction now paints its OWN thin
stream (1.8 map units vs the old 4.5 band), side by side on the track
(perpendicular offset ±1.15), each flowing in its own travel direction, at
the speed its state earns: fresh 1.6 s (brisk — cars come quickly here), due
2.8 s, void 5.5 s (the slow drift), unmonitored static. The nearside lie is
gone — anchors are per-direction, a one-way void paints one stream only and
the healthy twin keeps its truth (unit-tested both ways). The travel-direction
assumption is recorded honestly in code: edges inherit point order from the
route's direction-0 pattern, so direction 0 flows forward, direction 1
reversed; the selected stop's card always carries the named ground truth.
Renderer: TrackService rewritten (two lines per piece, CSS flow keyframes
fwd/rev, per-piece animation-duration); brain: wave-field.ts gained
STREAM_OFFSET/STREAM_WIDTH, per-direction anchors, flowsForward/flowSeconds
per segment, and a pure streamOffset(). Browser check rewritten: the DOM must
equal the brain piece-for-piece (colours within heartbeat tolerance, states
exact), twin directions asserted (void wave beside a fresh stream), both
flow directions and both speeds asserted. The click path moved to the
feature's own keyboard route (focus + Enter) because live streetcars park
on platforms and rightly win the pointer tap.

**E7S5 — the frozen streetcars, diagnosed.** NOT the service pipeline: the
local dev stack was serving vehicles at a FIVE-MINUTE cadence
(x-live-update-seconds: 300) because .env.local (the make dev env, which
wrangler auto-loads in dev) sets CLOUDFLARE_INCLUDE_PROCESS_ENV=true and
REALTIME_UPDATE_SECONDS=300, and my earlier "restarts" never actually killed
workerd (the PID file held the nohup wrapper). The upstream feed itself is
alive (two raw fetches 40 s apart differ). Fix: run the dev stack with
CLOUDFLARE_INCLUDE_PROCESS_ENV=false and REALTIME_UPDATE_SECONDS=30 —
verified live: 97 of 236 cars moved in ~40 s, cadence headers correct. For
make dev at the 5-minute pace deliberately, that stays the user's call.

All green: wave-field tests 8/8, browser check PASS, 277/277, board 9/9.
The stack is live on 0.0.0.0:8787 with the 30 s cadence.

### 2026-10-10 — E7S6: the snail slime, and the softened gradient

User steer: "from the head of the streetcar backwards to the last stop
should be green (like the streetcar leaves a green trail of snail slime?)
this should help show the clear indicator of which streetcar is clearing
the delay; also soften the transition between colours with more
gradienting."

- **The slime (honest math):** a matched, non-stale car drags a green trail
  on ITS direction's stream from its head back to the last stop it passed —
  true because a car that just passed those stops has just serviced them;
  the recorder concludes the same next tick. carTrailSegments() clips the
  edge's polyline to [last stop, car] with dash-phase continuity; the
  clearing car is now visible — advancing into the red with fresh green
  behind it. Live-verified: 166 trail pieces behind real cars, all green.
- **The softening:** (1) long polyline pieces subdivide at ~24 display
  units (cap 8/piece) so the colour bends along the stretch instead of one
  flat colour vertex-to-vertex — the live map now paints ~1,136 graded
  pieces; (2) the between-stops interpolation eases with smoothstep, so
  transitions spend their change slowly near stops; (3) every flow dash
  carries a --dash-start phase (distance mod the 28-unit cycle) and the
  keyframes shift by exactly one cycle, so the whole route flows as ONE
  continuous current — no seams where the gradient subdivides.
- Unit tests 10/10 (subdivision counts, bending colours, phase advance,
  trail fwd/rev/before-first-stop/unmatched/stale/other-edge); the browser
  check now also asserts the phase custom property on every flow line and
  that any rendered trail is fresh green. 279/279 suite, board 9/9 (two
  checks slower than baseline — the suite grew).

### 2026-10-10 — E7S7: subways off, snake game guaranteed clean

User steer: disable the void overlay for all subways; ensure it is not on
in the snake game.

- **Subways off, enforced in the brain:** `isSubwayOnlyStop()` (a stop whose
  routes are all 1/2/4/5/6) is filtered inside `anchorsOfEdge` itself, so
  subway stops can never anchor the field, tint, or trail — no caller can
  forget the filter. `surfaceStatesByStop()` additionally filters the live
  layer, so subway stops open no card either (a shared stop like a
  streetcar-route platform keeps its truth). Subway cars return no tint
  explicitly (belt and braces; their edges anchor nothing anyway).
- **Snake game guaranteed clean:** the layer is hard-suspended while the
  game is open (`suspended` flag → enabled=false → the feed makes zero
  requests; underlay/overlay/card all null). The game also renders its own
  TransitMap with no service props, so it is structurally clean AND
  enforced.
- Tests: unit (subway-only drops, shared stops stay, empty-routeIds stay,
  subway-only edge paints nothing); browser check extended — a subway stop
  in full void paints nothing, selects to no card, and the snake game shows
  no field/marker/card with ZERO /service/* requests while open (the
  wake-up refetch after closing is legitimate and excluded from the count).
  280/280, board 9/9.

### 2026-10-10 — Epic 8: the /sla status page (the promise lens, made public)

Objective 2 (recorded verbatim above). All local; nothing committed, pushed,
or deployed, per the standing constraint. The promise lens is a lens —
nothing in the delivered-service pipeline changed behaviour.

**E8S1 — the promise, derived from the feed the site already downloads.**
The nightly sync already streams the complete GTFS zip from R2 (the map's
own source); the streetcar parser now collects schedule materials during
the same passes (every streetcar trip's calendar class + per-stop departure
times + headsigns — the pass was already being paid for stop_times), and
`workers/shared/gtfs/sla-schedule.ts` (pure) derives per directional stop
and per route the scheduled headway per hour-of-day band, per **exact
active-service class** ('1', '2', '1+4401', … from calendar.txt +
calendar_dates.txt — never weekday folklore, so holiday overlays and
school-day layers keep their own promises). Departure-gap medians per hour
band (one inserted tripper cannot move a corridor's promise); a date whose
class publishes no streetcar service publishes no promise. Persisted per
network version (migrations 0007) — a feed flip never mixes schedules; a
re-import is byte-identical (row hashes, deterministic orders). Feed
version + validity ride the class keys; a stale schedule is visible, not
hidden.

**E8S2 — the math (shared/service/sla-metrics.ts, pure).** Compliance is
**time-weighted**: the share of monitored gap time within θ =
scheduled × tolerance. Time-weighting is the honest choice (a rider inside
a 19-minute gap experiences all of it) AND the additive one (gap-time and
compliant-time sum exactly, so day → week → route rollups are sums). The
within-θ estimate is E[min(H, θ)] under the gamma-MoM fit of the merged
moments — the same machinery as the history quantiles, degenerate-safe at
CV²≈0 (clockwork exact) — and is labelled an approximation everywhere.
The §3.2 table reproduces time-weighted: 1/19/1/19 at a 10-minute SLA is
0.8 (15 of the first 19 minutes are within θ), never the count-based 0.5.
Toronto day/week keys with DST-probe boundaries (23 h and 25 h days tested
in both DST directions). 13 hand-derived unit tests.

**E8S3 — the precompute (workers/api/src/sla/fold.ts + migrations 0008).**
The answer to "this cannot be computed in real time": an hourly cron
(`41 * * * *`, dispatched in scheduled() by cron string) folds completed
Toronto days from the 5-minute rollup tier into long-lived daily rows —
per stop and per route — before the 36-hour retention can prune them,
then recomputes touched weeks as the exact sum of their days, and
refreshes the current day's explicitly-partial row (final=0) so the page
shows live recording being absorbed without ever computing for a
visitor. Self-healing: missed runs backfill any day whose data still
survives; a day is foldable only while its EARLIEST bucket still
survives retention — exactly a 12-hour post-midnight grace (what
SERVICE_HISTORY_HOURS=36 buys: 24 h of day + 12 h of grace) — and a day
past that grace is skipped forward WITHOUT rows even if some late
buckets physically remain (folding survivors would present a partial day
as final); idempotent by construction.
Hours with no scheduled service stay out of the denominator; DST wall
hours are offset-aware (the repeated 1 a.m. maps to the 1 a.m. promise).
Subways excluded by construction — only stops the streetcar schedule
targets are folded.

**E8S4 — GET /api/v1/sla/report (precomputed-only).** Reads the Tier 3
tables + the schedule targets; never derives, never touches the recorder,
never scans the rollup tier. Routes sorted numerically with published-SLA
bands (weekday/Saturday/Sunday from the newest respective dates in the
feed window), day and week tick strips ('as many tick marks as you have
data segments for' — no fabricated pre-history), `?route=` for the
directional-stop detail. ETag/304 stable between folds (generatedAt is
the newest fold underneath the payload, not the wall clock); ~5-minute
edge cache; honest collecting payload on a fresh deploy. Worst realistic
payload (17 routes × 90 days + 14 weeks) well under the byte budget.

**E8S5 — the page (web/ui/features/sla/, public /sla).** USA-status.com
anatomy on the house design language: banner (route counts meeting the
SLA + overall % + data-through), filter box (narrows routes and loaded
stop detail live), grain toggle (daily 12×26 px boxes, **weekly 34 px
wider boxes**), route rows (number, name, status, overall %, published-SLA
line, strip), expandable stops with headsigns ("towards …"), legend
including the hatched partial-today box, and the methodology footnote
stating tolerance, gamma approximation, unmonitored-never-counted, and
route-rolls-up-stops. One fetch on load (session-cached module-level),
one cached fetch per expanded route, zero /sla requests when the page is
not opened, i18n en-CA + fr-CA, reduced-motion safe, non-map (the map
stack never loads). Preview fixture route in the dev middleware serves
a deterministic report covering every state; Playwright check
`npm run test:sla` green; rendering audited programmatically (all bands
distinct, grain widths, no overflow).

**E8S6 — docs.** CODEMAP rows; README public-API entry + the /sla page
pointer; sla.md §9 decisions (promise lens shipped, tolerance/bands,
Tier 3 retention + scheduling, time-weighting) and §10 non-goals scoped
honestly (schedule bands the page publishes ≠ the old blanket "no
schedule ingestion"; Tier 3 is the deliberate exception recorded in §9).

**Verification at the epic boundary:** unit suites (13 math + 3
derivation + 3 import + 3 fold + 5 endpoint) green; full repo suite
**304/304**; pre-flight board **9/9**; typecheck/lint/format clean; the
UI builds; the page verified in a real browser through the preview
fixture (banner, strips in every band, weekly grain, expand, filter,
methodology, zero-error console). Live-feed verification: the fold and
endpoint are exercised against the seeded SQLite harness exactly as
production D1 would see them — the deployed-stack items are in the
ledger below.

**Lessons recorded:** (1) under `--test-isolation=none`, every test
file's module code runs before any test — a caching caches.default stub
in one file poisons the ETag keys of every other suite; the history
suite's never-caching stub is the pattern to copy (my Map-backed one
broke four /service tests until I switched). (2) Playwright route globs
must match the full URL including the query string — `**/api/v1/sla/
report` silently misses `?route=…`; use a trailing `*`. (3) GTFS
departure-gap hour attribution: the gap belongs to the hour of the
departure that started it (23:50 → 01:30 next day is the 23:00 band's
promise, 6000 s), which the overnight-trip test pins.

### 2026-10-10 — Epic 8 post-close: real-feed verification, two derivation

### fixes, and the LAN dev stack

User steer: the /sla page showed "report unavailable" on the running stack, and
the stack should be restarted on 0.0.0.0 when done. Diagnosis: the
work-in-progress was complete, but the running `make dev` worker (started in
the previous session) had hot-reloaded the new route code without the new
migrations — `/api/v1/sla/report` was an honest 500. Nothing was wrong with
the feature; the stack was stale.

**Real-feed verification (the first run of E8S1's derivation on the actual
completegtfs.zip):** 17 streetcar routes, 680 stops, 4 calendar classes
('1', '2', '3', '4+5' — the Thanksgiving-holiday set), 32 dates, 18-23 s,
~595 MB peak in Node. Two real bugs found and fixed, both now unit-pinned:

1. **Route bands inherited corridor service** (the 306 claimed 24-hour
   service from the 506's daytime departures at their shared stops).
   Fix: parser materials now key departures per stop → service → ROUTE, and
   route-level bands derive from the route's OWN departures at its member
   stops. Stop-level bands stay pooled across streetcar routes (a rider at
   a stop cares about every route serving it). Verified on the real feed:
   the 306's weekday bands are now 1:00–6:59 only (10/15/20-min), null by
   day — its true blue-night span. (My earlier prototype sketch that showed
   "evening 306 departures" was a timezone-shifted strftime artifact — raw
   GTFS seconds 25:33–29:48 are 1:33–5:48 a.m., the honest overnight span.)
2. **Rapid lines leaked into streetcar targets** (Lines 5/6 are route_type 0
   like streetcars, so the type-only filter missed them). Fix: the E7S7
   rapid-line set (1/2/4/5/6 by number) is excluded in the derivation —
   matching `isSubwayOnlyStop`'s rule in the delivered-service brain.

Both fixes are pinned by the synthetic-fixture tests (a night route sharing
a corridor; a Line-5 LRT that only the number rule catches; hand-derived
own-departure bands). Full suite 304/304; board 9/9 after.

**Local stack bring-up (so the real page renders on the LAN):**

- Migrations 0007/0008 applied to local D1 (`db:migrate:local`).
- Schedule targets seeded into local D1 from the real feed via the real
  derivation code (one-off script; the production path is the nightly
  import, which writes these on the next feed flip). 32 dates, 680 stops,
  17 routes under version 1.
- The recorder's surviving local rollup data (~13 h of real touches from
  the previous session's soak, 40k rows) + the hourly fold triggered via
  `--test-scheduled`: first run folded 2026-10-09 final (514 rows), today's
  partial, and week 2026-10-05 (529 weekly rows); the second run was a clean
  idempotent no-op on the final day. Live report served through the real
  worker: 17 routes with real published schedules, real compliance bands,
  and real stop detail — browser-verified, zero console errors.
- Cosmetic fix from the real page: GTFS headsigns already read "East - 506
  Carlton towards …", so the stop rows no longer wrap them in a second
  "towards" (the i18n key was removed from both catalogues).
- `run_worker_first` gained `/__scheduled` so wrangler's --test-scheduled
  trigger reaches the worker instead of the SPA fallback (production 404s
  the path; nothing lives there).
- vite.config.mjs: the dev server host is now `UI_HOST || '127.0.0.1'` (same
  convention as UI_URL) — `UI_HOST=0.0.0.0 npm run dev:viewer` shares the
  preview on the LAN.

**Dev stack state:** the preview stack (fixture report) runs on 0.0.0.0:4173;
the real-worker stack (real recorded data) runs on 0.0.0.0:8787 with the 30 s
cadence env (CLOUDFLARE_INCLUDE_PROCESS_ENV=false,
REALTIME_UPDATE_SECONDS=30) — the E7S5 lesson applied. Both `/sla` pages
serve; the fold refreshes today's partial at every :41 cron (triggerable
immediately via `curl 'http://localhost:8787/__scheduled?cron=41+*+*+*+*'`).

### 2026-10-10 — Epic 8 amendment: the advertised grid + class-visible

### schedules (user steer)

Two steers, both shipped same-session and verified against the real feed:

1. **"Do SLA pages understand weekend and holidays?"** — the scoring always
   has (every date folds against its exact calendar class; Thanksgiving
   Oct 12 has its own class '5' in the seeded schedule). What was missing
   was VISIBILITY: the published line rendered only the weekday bands. Now
   the endpoint serves weekday / Saturday / Sunday / holiday bands
   (holidays detected as dates whose class differs from the most recent
   same-weekday date's), the page renders one line per distinct class,
   and identical class lines collapse into one labelled group — the 506
   reads "Weekday / Saturday / Holiday: every 10 min (…) · Sunday: every
   10 min (…)" and its genuinely-later Sunday start stays visible.
2. **The advertised 5-minute grid, floored at 10** — targets publish and
   score at the TTC's advertised granularity: 8–12 min is "10", 13–17 is
   "15", and nothing ever advertises better than 10 minutes even where
   the schedule offers it (a 5-min corridor publishes 10). Implemented
   as `advertisedHeadwaySeconds` in sla-metrics, applied at derivation
   AND at both read paths (the fold's θ and the endpoint's published
   bands), so legacy pre-grid rows score identically to fresh ones and
   display can never disagree with θ.

The grid change exposed a real display bug: `scheduledBands` merged
equal-value bands across service gaps (the 506's 0:00–3:00 and 4:00–24:00
runs merged into one all-day band claiming 3:00–4:00 service). Fixed with
an adjacency check and pinned by a hand-derived test.

Local stack re-synced: re-derived the real feed through the quantizer
(506 weekday = "every 10 min (0:00–3:00) · every 10 min (4:00–24:00)",
306 = "10 / 15 / 20 min overnight"), re-seeded local D1, refreshed today's
partial through the fold (overall compliance moved 73.0% → 78.2% under
the advertised 10-min × 1.5 rule — the honest consequence of a floor at
10). Suite 306/306 (+2 tests: the quantizer grid, the non-adjacent-merge
pin); board 9/9; check-sla PASS; both LAN stacks re-verified with zero
console errors.

### 2026-10-10 — /sla card cleanup (user steer)

Three readability changes, all on the route card: the full "Scheduled:"
class lines moved into the collapsible (detail on demand — the collapsed
card is exactly two lines: title row and tick strip); the "Show stops"
pill became a small ▸/▾ arrow left of the route number (same
aria-expanded semantics, keyboard-reachable, labels retained for screen
readers); and "within SLA" is gone from every percentage — route, stop,
banner, and tooltips now read "74.8%". check-sla extended: the published
line must be ABSENT while collapsed, appear on expand with every class
label, and the toggle's aria-expanded must flip.

### 2026-10-10 — The live tier: thin slivers for the last 30 minutes

### (user steer)

"I was hoping a tiny bar would be at the right side of the chart
representing real time and last 30 minutes… instant realtime should be
easier to distinguish in this chart from thicker dailys." Shipped as the
chart's third grain: a dashed divider, then six 3px slivers (one per
completed 5-minute bucket of the recorder's rolling window) at each
strip's right edge — visually distinct from the 12px daily bars and the
34px weekly boxes, in both grains. The strip's right edge label reads
"now" when the live tier is present.

Honesty preserved end-to-end: the report gains `targets.todayClass` and
per-route `todayHeadways` (today's advertised targets — pure table
reads, still no request-time SLA computation); the page polls the
recorder's EXISTING live surfaces — /api/v1/service/stops every 30 s
(retained ETag, the recorder computed the states on its own tick) and
/api/v1/service/wave every 5 minutes for the 30-minute backfill — and
the sliver math runs in the browser (sla-live.ts, the map overlay's
wave-field pattern): a stop is within the promise at a bucket's end when
elapsed-since-last-touch ≤ today's target × tolerance, the same θ the
fold uses. Dry stops are judged from the live states' lastTouchAt (a
corridor silent for the whole window is red, never excluded); a bucket
inside a feed outage renders grey, unmonitored; unpromised hours are
hollow; the oldest sliver is often honestly thin (the states only
remember each stop's LATEST touch, so pre-window touches inside the
oldest bucket are unknowable — no-data, never guessed).

Verified: 7 hand-derived brain tests (grid alignment, clockwork
all-green, dry-corridor red via states, 3-of-4 = degraded banding,
outage grey vs clean, stop-level against its route's target, Toronto
wall-hour); endpoint tests for todayClass/todayHeadways (adaptive to
the run day); check-sla extended (six slivers on the 506, thin widths,
aria labels, legend, and the daily-strip assertions scoped to exclude
slivers). Live against the real recorder: the 506's slivers read
85.7% / 96.9% / 100% with the oldest honestly no-data; zero console
errors. One transient to know about: during wrangler's hot reload of
the DO the wave patterns can be briefly empty — the brain's
states-fallback keeps the slivers honest (computed from live states
alone) until the window refills. Suite 313/313; board 9/9.

### 2026-10-10 — The local-cron question, answered definitively

The earlier watcher on "does wrangler dev fire the hourly fold cron?"
was a FALSE POSITIVE: its grep found my own manual `/__scheduled`
trigger from ~15:58 UTC, not an automatic fire. The log is unambiguous —
exactly one "SLA rollup result" entry, immediately followed by `GET
/__scheduled 200 OK`, and no second entry at 16:41 or 17:41.
**wrangler dev does not fire crons on schedule** (--test-scheduled only
exposes the trigger endpoint). Consequences, recorded plainly:

- On the local stack, today's bar only refreshes when the fold is
  triggered. `make sla/fold` now does it (the admin/sync precedent):
  `curl '$(API_LOCAL)/__scheduled?cron=41+*+*+*+*'`.
- In production the real cron fires hourly at :41 UTC — no nudge needed.
- A stale today-bar on :8787 means "the fold hasn't been nudged," never
  "the recorder stopped" — the live slivers prove the recorder is
  ticking (they read the recorder's live state directly, not the fold).
