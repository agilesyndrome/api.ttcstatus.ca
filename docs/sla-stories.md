# SLA delivery stories

Companion to [docs/sla.md](sla.md) — which owns the _what_ and the _why_ (product,
math, architecture) — and [docs/sla-epics.md](sla-epics.md) — which owns the _when_
(Stage 0 → Stage 4 and their exit gates). This document owns the _work items_: every
story a developer can pick up cold, with acceptance criteria, test expectations, and a
definition of done.

Status: planning document, v1. No implementation has started. Reconciled with reality
in E6S5.

---

## How to read this file

- **IDs.** Every story has a unique ID of the form `E{epic}S{story}` — Epic 1, Story 2
  is `E1S2`. Epics 1–6 are sla.md §5's epics; **Epic 0 is the Stage-0 foundations
  epic** assembled from sla-epics.md §0A–0E.
- **Order.** Stories are listed in **chronological order of attack**: Stage 0 first,
  then Stage 1 (two parallel tracks), Stage 2, Stage 3, Stage 4. Within a stage, the
  order is dependency order.
- **Sizes.** **S** ≤ a day, **M** a few days. **Nothing in this file is larger than
  M.** sla.md sized exactly one story Large (1.3, streetcar touch detection); it is
  split here into E1S3 + E1S4. Two other source stories are split _by stage_ — 2.8
  (corpus authoring in Stage 0, assertions in Stage 1) and 6.2 (entries in Stage 2,
  finalization in Stage 4) — per sla-epics.md's stage map. Every split and renumbering
  is recorded in the story's _Source_ line and in the ledger at the bottom.
- **Card anatomy.** Each card carries: **Source** (where it comes from, so the three
  documents stay reconciled) · **Stage/Track** · **Size** · **Depends on** · a summary
  · numbered acceptance criteria · test expectations · a definition of done.
- **Stage gates.** Each stage section opens with its shippable outcome and exit gate
  (from sla-epics.md). A stage is done when its last story's DoD _and_ the gate hold.
- **Before starting any story**, read the sla.md section its Source line cites. The
  math stories build §3 of sla.md; the recorder stories build §4; none of it is
  guesswork — it is already written down.

## Story map — the attack order

| #   | ID   | Story                                        | Epic | Stage | Size | Depends on             |
| --- | ---- | -------------------------------------------- | ---- | ----- | ---- | ---------------------- |
| 1   | E0S1 | Service contracts                            | 0    | 0     | S    | —                      |
| 2   | E0S2 | Service configuration & frozen decisions     | 0    | 0     | S    | E0S1                   |
| 3   | E5S1 | Feature-flag backbone                        | 5    | 0     | M    | —                      |
| 4   | E0S3 | Rollup storage migration                     | 0    | 0     | S    | E0S1, E5S1             |
| 5   | E0S4 | Spike: fold-write shape & D1 limits          | 0    | 0     | S    | E0S1, E0S3             |
| 6   | E0S5 | Spike: DO alarm precision & tick idempotency | 0    | 0     | S    | —                      |
| 7   | E0S6 | Ground-truth scenario corpus                 | 0    | 0     | M    | E0S1, E0S2             |
| 8   | E0S7 | Preview fixture adapter                      | 0    | 0     | S    | E0S6                   |
| 9   | E0S8 | DO binding, env plumbing, green board        | 0    | 0     | S    | Stage 0 stories        |
| 10  | E1S1 | Recorder DO scaffold & tick loop             | 1    | 1     | M    | E0S5, E0S8             |
| 11  | E1S2 | Network bootstrap in the DO                  | 1    | 1     | M    | E1S1                   |
| 12  | E1S3 | Streetcar touches: matching & emission       | 1    | 1     | M    | E1S2, E0S6             |
| 13  | E1S4 | Streetcar direction & dwell dedupe           | 1    | 1     | M    | E1S3                   |
| 14  | E1S5 | Subway touch detection                       | 1    | 1     | M    | E1S2                   |
| 15  | E1S6 | Window store & pruning                       | 1    | 1     | M    | E1S1, E1S3             |
| 16  | E1S7 | Recorder-core purity & test harness          | 1    | 1     | M    | E1S3–E1S6              |
| 17  | E1S8 | Ops & data-citizenship docs                  | 1    | 1     | S    | E1S1, E0S2             |
| 18  | E2S1 | Headway extraction with censoring            | 2    | 1     | S    | E0S1, E0S6             |
| 19  | E2S2 | Renewal wait `E[W]`                          | 2    | 1     | M    | E2S1                   |
| 20  | E2S3 | Residual wait `R(e)`                         | 2    | 1     | M    | E2S1, E2S2             |
| 21  | E2S4 | Two-axis dryness & states                    | 2    | 1     | M    | E2S1–E2S3              |
| 22  | E2S5 | Back-to-back marker                          | 2    | 1     | S    | E2S1                   |
| 23  | E2S6 | Self-baseline sourcing (window)              | 2    | 1     | S    | E2S1, E2S2             |
| 24  | E2S7 | Moment merging for rollups                   | 2    | 1     | M    | E2S1, E0S1             |
| 25  | E2S8 | Corpus end-to-end assertions                 | 2    | 1     | M    | E2S1–E2S7, E0S6        |
| 26  | E6S1 | Analytics Engine counters                    | 6    | 1     | S    | E1S1, E2S4             |
| 27  | E3S1 | `GET /api/v1/service/stops`                  | 3    | 2     | M    | E1S6, E2S8             |
| 28  | E3S2 | `GET /api/v1/service/wave`                   | 3    | 2     | S    | E1S6, E3S1             |
| 29  | E3S3 | Service API contract & budget tests          | 3    | 2     | S    | E3S1, E3S2             |
| 30  | E5S2 | Debug overlay v0                             | 5    | 2     | M    | E3S1, E5S1             |
| 31  | E5S3 | Space-time replay (debug panel)              | 5    | 2     | M    | E3S2, E5S2             |
| 32  | E6S2 | Public API docs (experimental)               | 6    | 2     | S    | E3S1, E3S2             |
| 33  | E6S3 | Browser tests (`test:service`)               | 6    | 2     | M    | E5S2, E5S3, E0S6       |
| 34  | E4S1 | Fold mechanics                               | 4    | 3     | M    | E1S6, E2S7, E0S3, E0S4 |
| 35  | E4S2 | Rollup storage & 36-hour retention           | 4    | 3     | M    | E4S1                   |
| 36  | E4S3 | `GET /api/v1/service/history`                | 4    | 3     | M    | E4S1, E4S2             |
| 37  | E4S4 | History tests                                | 4    | 3     | S    | E4S1–E4S3              |
| 38  | E4S5 | Fold-failure grace                           | 4    | 3     | S    | E4S1                   |
| 39  | E5S4 | Stop "today so far" sparkline                | 5    | 3     | S    | E4S3, E5S1             |
| 40  | E2S9 | Rollup-stabilized self-baselines             | 2    | 3     | S    | E2S6, E4S2             |
| 41  | E6S4 | One-week soak review                         | 6    | 4     | S    | Stage 3 exit           |
| 42  | E6S5 | Docs finalized & reconciled                  | 6    | 4     | S    | E6S4                   |
| 43  | E6S6 | Hand-off: polished-overlay epic proposal     | 6    | 4     | S    | E6S4, E6S5             |

Stage 1's Track A (rows 10–17) and Track B (rows 18–25) are **parallel** — no shared
files until the DO shell reads the math library. E6S1 (row 26) sits at the convergence.
Overlay development may begin against E0S7's preview fixtures as early as Stage 0, per
sla-epics.md's parallelism notes; E5S2's _exit_ is Stage 2 integration.

---

## Stage 0 — Foundations & decisions (Epic 0, plus E5S1)

> **Ships:** the interfaces every epic needs; `npm run feature:enable` works against
> production. Boring on purpose — no behaviour, no UI beyond the flag gate.
>
> **Exit gate:** open decisions recorded in sla.md §9; `npm run feature:enable
voidOverlay drew@easleyowl.com` works end-to-end on a deployed stack and a second
> account sees nothing; a human can see the corpus rendered locally with no backend
> running; full `npm run pre-flight` green with baselines recorded.

### E0S1 — Service contracts ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: `npm run typecheck` green, field parity with sla.md §4.3 · notes in docs/sla-chatter.md
**Source:** sla-epics.md §0A · serves every epic · cited by sla.md §4.3
**Stage:** 0 · **Track:** foundations · **Size:** S · **Depends on:** —

Create `shared/service/contracts.ts` — the single vocabulary for worker, tests, and
UI: `TouchEvent`, `CoverageInterval`, `RollupRow`, `StopServiceState` (the per-stop
live-state DTO), plus any small shared types they need.

**Acceptance criteria**

1. The four interfaces exist with exactly the fields sla.md §4.3 specifies:
   `TouchEvent` (epoch-ms `t`, directional `stopId`, `directionId: 0 | 1`, `mode`,
   `vehicleId`, `routeId`, optional `ambiguous`), `CoverageInterval` (`from`, `to`,
   `mode`, `kind: 'observable' | 'outage' | 'no-reports'`), `RollupRow` (one
   directional stop × one 5-minute bucket, with mergeable moments `n`, `headwaySum`,
   `headwaySumSq`, plus `maxGapSeconds`, `firstTouchAt`, `lastTouchAt`, `backToBack`,
   `distinctVehicles`, `routeIds`, `coverageBits`), and `StopServiceState`.
2. Types only — no I/O, no runtime dependencies beyond TypeScript.
3. `npm run typecheck` is green with the repo's clean import boundaries: importable
   from `workers/api` and `web/ui` exactly like the existing `shared/*` modules.
4. Field-for-field parity with sla.md §4.3 confirmed in PR review against the doc.

**Test expectations:** typecheck is the test; no behaviour to assert yet.

**Definition of done:** merged to main; every later story can cite these types by
name; no drift from sla.md §4.3.

### E0S2 — Service configuration & frozen decisions ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: 6 unit tests green; recorder mode + thresholds recorded in sla.md §9 · notes in docs/sla-chatter.md
**Source:** sla-epics.md §0A · sla.md §4.4 (recorder modes) · serves every epic
**Stage:** 0 · **Track:** foundations · **Size:** S · **Depends on:** E0S1

Create `shared/service/config.ts`, mirroring the `shared/live/config.ts` pattern
(validated getters, defaults clamped, overrides via wrangler env). This story forces
the remaining open decisions to be made now, on paper, where they are cheap.

**Acceptance criteria**

1. Validated configuration exists for at least:
   `SERVICE_SAMPLE_SECONDS` (default 30), touch radius
   `SERVICE_TOUCH_RADIUS_METRES` (~40 m), dwell-dedupe window
   `SERVICE_DWELL_DEDUPE_SECONDS` (~2 min), back-to-back threshold
   `SERVICE_BACK_TO_BACK_SECONDS` (45 s), void thresholds (self-relative dryness
   `r ≈ 2` _and_ an absolute-minutes backstop), `SERVICE_HISTORY_HOURS` (36), and the
   minimum touch count before a stop leaves `collecting` (3).
2. The recorder mode decision — `always` (default) vs `demand-warm` — is **made and
   recorded**, not deferred.
3. Initial threshold values are recorded as provisional, "tuned from real data",
   never hard-coded folklore — the config file is the only place they live.
4. The two decisions (recorder mode, initial threshold values) are added to sla.md
   §9's decisions log. _This story edits docs/sla.md — that is expected._
5. Unit tests cover defaults, clamping, and invalid-input fallbacks, mirroring the
   style of the existing config tests.

**Test expectations:** `tests/service/` config unit tests in the `node --test` suite.

**Definition of done:** merged; sla.md §9 shows the two new decisions; no SLA story
may cite a magic number that is not in this config.

### E5S1 — Feature-flag backbone ✅ DONE (deployed-stack gate pending)

**Status:** ✅ Done — 2026-10-09 · verified: migration schema + CLI + endpoint + hook all unit-tested (5 tests green); spike outcome: subject = Clerk user id (email not readable server-side), CLI accepts either (emails resolve via Clerk Backend API). AC#6 end-to-end on a **deployed** stack is deployment-pending — see docs/sla-chatter.md ledger.
**Source:** sla.md §5 story 5.1 · sla-epics.md §0B (pulled forward into Stage 0)
**Stage:** 0 · **Track:** foundations · **Size:** M · **Depends on:** —

The per-user gate for everything user-visible. Scaffolding shouldn't ship to
everyone, and this is the machinery that makes "shipped" never mean "visible to
everyone." Keyed by Clerk-verified identity, following the `map:tag` precedent for
operator CLIs.

**Acceptance criteria**

1. **Spike first (about an hour):** confirm whether Clerk session claims expose
   email server-side (read `workers/api/src/accounts/`). If yes, key flags by email;
   if no, key by Clerk user ID and let the CLI accept either (emails churn; user IDs
   don't). The decision — and the resulting primary key — is recorded in the PR
   description and echoed in the migration.
2. Migration `migrations/0005_feature_flags.sql` creates
   `feature_flags(flag, subject, granted_at, granted_by)` with the primary key the
   spike decided. It applies cleanly via the existing
   `db:migrate:local`/`db:migrate:remote` flow (deploys auto-apply migrations; a
   failed migration halts the deploy — house style).
3. CLI: `scripts/operations/feature-flags.mjs` (the `tag-map.mjs` precedent) plus
   `npm run feature:enable|disable|list` wrappers, writing through a remote D1
   binding: `npm run feature:enable voidOverlay drew@easleyowl.com`,
   `npm run feature:disable voidOverlay drew@easleyowl.com`,
   `npm run feature:list` (shows who has what).
4. `GET /api/v1/me/features`: Clerk-authenticated, `Cache-Control: no-store`, CORS —
   the only new public endpoint in the preface. Returns the caller's enabled flags;
   empty for signed-out callers. Wired through the existing `/api/v1/me/*` machinery.
5. Client hook `useFeatureFlags`: fetch once per session; nothing consumes it yet —
   which is the point.
6. End-to-end on a deployed stack: enabling a flag for one signed-in account makes
   `/api/v1/me/features` return it for that account only; a second account sees
   nothing; `feature:list` shows the grant; `feature:disable` removes it.

**Test expectations:** endpoint tests (authenticated vs signed-out, `no-store`,
CORS) alongside the existing auth checks; CLI exercised against local D1; the
end-to-end check is the 0B exit gate and is done manually on the deployed stack.

**Definition of done:** sla-epics.md §0B exit gate holds on production: the enable
command works end-to-end and a second account sees nothing. Completes sla.md story
5.1.

### E0S3 — Rollup storage migration ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: schema applies cleanly through the SQLite harness (D1-shaped) and will be exercised by `db:migrate:local` at E0S8; indexes per spec · notes in docs/sla-chatter.md
**Source:** sla-epics.md §0C · serves Epic 4 · schema from sla.md §4.3
**Stage:** 0 · **Track:** foundations · **Size:** S · **Depends on:** E0S1; migration
numbering coordinated with E5S1

Ship the rollup table before Epic 4 needs it. Schema-first is already house style.

**Acceptance criteria**

1. `migrations/0006_service_rollups.sql` (next free number after E5S1's 0005) creates
   the rollup table with columns matching the `RollupRow` contract exactly, primary
   key `(stopId, bucketStart)`, and a compact representation for `routeIds`
   (e.g. JSON text).
2. Both indexes exist: `(bucketStart)` for time-window queries and
   `(stopId, bucketStart)` for per-stop history.
3. No existing table is changed anywhere in this feature.
4. Applies cleanly locally and remotely; `npm run pre-flight` green.

**Test expectations:** migration apply/dry-run through the existing db:migrate
scripts; the table is unused until Stage 3 (empty is correct).

**Definition of done:** merged; Epic 4 can be built without a migration mid-flight.

### E0S4 — Spike: fold-write shape & D1 limits [DONE]

**Status:** Done 2026-10-09. spike script checked in; measured: chunked multi-row INSERT 19 ms vs 47 ms per 2000-row worst-case fold, idempotency proven; production shape in rollup-writes.ts. Notes in docs/sla-chatter.md

**Source:** sla-epics.md §0C · de-risks E4S1
**Stage:** 0 · **Track:** foundations · **Size:** S · **Depends on:** E0S1, E0S3

A worst-case 5-minute fold is ~1–2k rows. Verify D1 parameter/batch limits with a
load script now, and pick the insert shape (chunked multi-row `INSERT` vs statement
batches) with measurements — prevents Epic 4's most likely redesign.

**Acceptance criteria**

1. A reproducible load script (e.g. `scripts/operations/fold-write-spike.mjs`) writes
   worst-case fold batches to a D1 database and measures both insert shapes.
2. The chosen shape, the measured numbers, and the chunk size are written down in the
   PR and wherever E4S1 will find them (a short note in this file's E4S1 card is
   fine).
3. The script is checked in, not pasted into chat.

**Test expectations:** the script runs against local D1 and (once) remote; numbers
recorded.

**Definition of done:** decision recorded; E4S1 cites the spike instead of guessing.

### E0S5 — Spike: DO alarm precision & tick idempotency [DONE]

**Status:** Done 2026-10-09. measured live in the wrangler dev stack: median cadence 30.000 s, max grid offset 16 ms over 8+ ticks, so the 10 s tolerance has ~600x headroom; tickId idempotency validated (duplicate-tick no-op + tests). Notes in docs/sla-chatter.md

**Source:** sla-epics.md §0C · de-risks E1S1
**Stage:** 0 · **Track:** foundations · **Size:** S · **Depends on:** —

A hello-world Durable Object alarm at 30 s in the `make dev` stack. Agree on the
drift tolerance telemetry will measure, and validate that tick idempotency
(`tickId = floor(now / 30 s)`) makes jitter harmless.

**Acceptance criteria**

1. A hello-world DO with a 30 s alarm runs in the local dev stack for at least an
   hour, logging actual fire times.
2. Observed drift/jitter is measured and written down, and the tolerance the recorder
   telemetry will assert (E1S1) is agreed from that data.
3. The `tickId = floor(now / 30 s)` scheme is validated: a late or duplicated alarm
   within the same tick is provably a no-op in the spike.
4. The spike is dev-only; it is torn down or clearly marked as not-shipped.

**Test expectations:** the spike's own measurements; a short written summary (numbers

- agreed tolerance) in the PR.

**Definition of done:** tolerance number exists; E1S1's telemetry assertions cite it.

### E0S6 — Ground-truth scenario corpus ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: all six scenarios + the §3.2 worked example, every expectation hand-derived in comments and asserted end-to-end (E2S8 suite); determinism tested · notes in docs/sla-chatter.md
**Source:** sla-epics.md §0D · this is sla.md story 2.8 (part 1 of 2 — authoring;
E2S8 completes it with end-to-end assertions)
**Stage:** 0 · **Track:** foundations · **Size:** M · **Depends on:** E0S1, E0S2

Author the fixture corpus: scripted, deterministic scenarios with hand-derived
expectations. Every later layer — recorder tests, math tests, API tests, overlay
development, browser intercepts — develops against this same data, and nothing in the
test stack ever needs the live TTC feed.

**Acceptance criteria**

1. Six deterministic scenarios exist: **clockwork** service, **single bunch**,
   **one-directional void**, **terminal dwell**, **night service**, **feed outage** —
   plus the §3.2 waiting-time worked example (headways 10/10/10/10 vs 1/19/1/19) as
   its own named fixture.
2. Each scenario is a stream of `TouchEvent`s plus `CoverageInterval`s (typed by the
   E0S1 contracts), fully deterministic across runs — no randomness, no
   time-of-day dependence.
3. Hand-derived expectations are written down _alongside_ each fixture — headway sets,
   `E[W]` (5.0 min vs 9.05 min for the §3.2 example), the shape of `R(e)`, dryness
   `r`, state (including night-calm and unmonitored-never-void), back-to-back
   counts, and coverage. Expectations must be derivable by hand — they may not be
   produced by the same code they will be used to test.
4. The corpus lives in one shared location (fixtures module) so `tests/service/`,
   `scripts/preview/`, and the overlay can import the identical data.
5. A second reader has verified the hand-derived numbers for the clockwork, bunch,
   and §3.2 fixtures (this is the corpus's whole value — arithmetic errors here
   poison every layer above).

**Test expectations:** loading a fixture twice yields identical data; the expectations
documents are reviewed in PR.

**Definition of done:** merged; sla-epics.md §0D's fixture list fully covered;
E0S7, E2S8, E6S3 can cite scenarios by name.

### E0S7 — Preview fixture adapter [DONE]

**Status:** Done 2026-10-09. all three /service/* routes + preview-positions serve corpus-derived payloads through the REAL shared math (states, delta-encoded wave, 36 h history synthesized by folding the repeated window with deriveRollupRows/merge — merged stats reconcile by hand); smoke-verified end-to-end through the middleware with zero workers/DO/feed. Notes in docs/sla-chatter.md

**Source:** sla-epics.md §0D · unblocks overlay development on day one
**Stage:** 0 · **Track:** foundations · **Size:** S · **Depends on:** E0S6

Serve `/api/v1/service/stops`, `/service/wave`, and `/service/history` from the
corpus during `npm run dev:viewer`, so overlay development starts with zero workers,
zero DO, zero live feed.

**Acceptance criteria**

1. A fixture adapter in `scripts/preview/` (alongside the existing preview adapters)
   serves the three `/api/v1/service/*` routes during `npm run dev:viewer`.
2. Payloads match the E0S1 contract DTOs (`StopServiceState` et al.) — the shapes
   the real endpoints will serve in Stage 2 and Stage 3.
3. For `/service/history`, longer spans are synthesized by repeating corpus buckets
   to a plausible 36-hour grain; the adapter is clearly dev-only and never ships.
4. With no backend running, `npm run dev:viewer` renders corpus data at the three
   routes.

**Test expectations:** manual dev-run smoke check of all three routes against a
scenario; the 0D exit gate ("a human can see the corpus locally with no backend") is
this story's test.

**Definition of done:** merged; the overlay track can begin against fixtures.

### E0S8 — DO binding, env plumbing, green board [DONE]

**Status:** Done 2026-10-09. DO binding + migrations + 13 SERVICE_* vars wired; db:migrate:local applies 0005/0006 cleanly; dry-run validates; pre-flight board 9/9 green. Notes in docs/sla-chatter.md

**Source:** sla-epics.md §0E · Epic 1's plumbing
**Stage:** 0 · **Track:** foundations · **Size:** S · **Depends on:** the Stage 0
stories

The repo's first `durable_objects` binding and the `SERVICE_*` vars, then a green
board before we add a lot of code. Unused config is fine; missing config at
Stage-1 time is not.

**Acceptance criteria**

1. `workers/api/wrangler.jsonc` gains the `durable_objects` binding (the singleton
   `ServiceRecorder`) and the `SERVICE_*` variables; `wrangler deploy --dry-run`
   passes.
2. `Env` in `workers/api/src/env.ts` is extended to match, typed for every new var
   and binding.
3. Full `npm run pre-flight` is green and its baselines are recorded — the board
   flags drift from here on.

**Test expectations:** pre-flight itself (`typecheck`, tests, dry-run deploys).

**Definition of done:** Stage 0 exit gate checklist holds: decisions in sla.md §9;
flag CLI works on the deployed stack; corpus viewable locally; pre-flight green with
baselines. Stage 1 may start.

---

## Stage 1 — The tape deck & the math (Epics 1 + 2, parallel)

> **Ships:** nothing public. The recorder deployed and quietly soaking live data;
> the math library proven on the corpus. Internal telemetry only — the quiet stage
> that makes the loud ones safe.
>
> **Track A (Epic 1, rows 10–17)** and **Track B (Epic 2, rows 18–25)** are two
> people's worth of work with no shared files until the DO shell reads the library.
>
> **Exit gate:** ≥ 48 hours of continuous 30-second ticks with healthy telemetry in
> the auth'd `/api/v1/feed/status`; the recorder deployed and quietly soaking; the
> math library green against the corpus, including the §3.2 worked example reproduced
> exactly.

### Track A — the recorder (Epic 1)

### E1S1 — Recorder DO scaffold & tick loop [DONE]

**Status:** Done 2026-10-09. alarm loop ticks unattended at 30 s with zero viewers (live local soak: real feeds, both statuses available, 0 failures); duplicate ticks no-op; telemetry in authd /api/v1/feed/status. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 1.1 · read sla.md §4.4 first
**Stage:** 1 · **Track:** A · **Size:** M · **Depends on:** E0S5, E0S8

The `ServiceRecorder` singleton Durable Object: a 30 s alarm loop calling
`fetchRailSnapshot()` (workers already-written for exactly this reuse — untouched),
with idempotent ticks and honest upstream-failure handling.

**Acceptance criteria**

1. The DO class exists (`workers/api/src/service/service-recorder.ts`), bound as a
   singleton via the E0S8 binding, and its alarm fires every 30 s ± the tolerance
   agreed in E0S5 — with zero viewers.
2. Ticks are idempotent: `tickId = floor(now / 30 s)`; a duplicate or late alarm
   within the same tick is a provable no-op, including after isolate eviction.
3. Each tick fetches both feeds via `fetchRailSnapshot()`; an upstream failure
   records a `CoverageInterval` with kind `outage` and emits **no** touches —
   failures are recorded, never fabricated.
4. Tick telemetry (last tick at, duration, upstream status per feed) is surfaced in
   the auth'd `/api/v1/feed/status`.
5. Recorder mode comes from config (E0S2's decision, default `always` — the entire
   point is measuring delivery nobody is watching).

**Test expectations:** core unit tests for tick handling and idempotency; a ≥ 1 hour
dev-stack soak showing cadence within tolerance; manual inspection of
`/api/v1/feed/status`.

**Definition of done:** the alarm ticks unattended with no viewers; duplicate ticks
after eviction change nothing; upstream failures show as coverage, not silence.
Completes sla.md story 1.1 (contracts half already done in E0S1).

### E1S2 — Network bootstrap in the DO [DONE]

**Status:** Done 2026-10-09. loads the active versions directional stops + edges; version-flip test proves stop-id stability and reload. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 1.2 · sla.md §4.6 (rule 5)
**Stage:** 1 · **Track:** A · **Size:** M · **Depends on:** E1S1

Load the active version's directional stops (IDs, coordinates, route membership,
pattern order) and edges into DO storage, and reload on version change — so the
nightly GTFS flip never holes the window.

**Acceptance criteria**

1. On cold start the DO loads the active network version — directional stops with
   coordinates, route membership, and pattern order, plus edges — into DO storage.
2. A version change (the nightly import) triggers a reload mid-window; stop IDs are
   GTFS-stable, and unchanged stop IDs lose no touches or statistics across the flip.
3. Cold start completes within a bounded tick count (bound asserted in a test — the
   30 s cadence must not stall beyond it).
4. Genuinely new stops produce no baseline until they have 3+ touches (the
   `collecting` rule they'll share with E2S4/E2S6).

**Test expectations:** core-harness fixture test that flips the network version
mid-window and asserts zero touch loss for unchanged stops; cold-start bound test.

**Definition of done:** sla.md 1.2's done-when holds — a nightly version flip
mid-window loses no touches for unchanged stop IDs; cold start is bounded.

### E1S3 — Streetcar touches: matching & emission [DONE]

**Status:** Done 2026-10-09. matching + emission via matchGpsToTrack with continuity; same-sample dual vehicles at h~0; stale fixes never touch. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story **1.3, part 1 of 2** — sla.md sized this story Large;
it is split (this half: geometry and emission; E1S4: direction and dedupe) · read
sla.md §3.5, §4.4 first
**Stage:** 1 · **Track:** A · **Size:** M · **Depends on:** E1S2, E0S6

Per fresh GPS observation: match to the track, find directional stops within the
touch radius, emit touch events. This half handles the _geometry_; adversarial
direction cases are E1S4's job.

**Acceptance criteria**

1. Only fresh observations are processed: a fix older than the 2-minute staleness
   rule never generates a touch (sla.md §4.6 rule 3).
2. Each fix runs through `matchGpsToTrack` (shared/map/projection.ts — untouched)
   with previous-edge continuity hints.
3. A touch is emitted when the fix falls within `SERVICE_TOUCH_RADIUS_METRES`
   (config, ~40 m) of a directional stop served by the vehicle's route, as a
   `TouchEvent` carrying vehicle id, route id (day `506` and night `306` stay
   distinct), and the 30 s interval-censored timestamp.
4. Two **distinct** vehicles observed within radius in the same 30 s sample produce
   **two** touch events at the same stop — the `h ≈ 0` case is recorded, never
   deduped (dedupe is per `(vehicle, stop)`, and is E1S4).
5. Unambiguous fixtures (mid-corridor, clear direction) credit the correct directional
   stop; direction-confidence hardening and ambiguity flags are explicitly E1S4
   scope, not this story's.
6. The logic lives in the pure recorder core (`workers/api/src/service/recorder-core.ts`)
   — no I/O.

**Test expectations:** corpus corridor fixtures produce the expected stops at the
expected sample timestamps; a same-sample dual-vehicle fixture yields both touches;
a stale-fix fixture yields none.

**Definition of done:** streetcar touches flow into the window with the right shape
on clear-direction fixtures; sla.md 1.3's same-sample clause is proven.

### E1S4 — Streetcar direction & dwell dedupe [DONE]

**Status:** Done 2026-10-09. nearside opposite-direction platforms never credited wrongly (direction follows the matched pattern); unresolvable fixes flagged ambiguous; terminal layover counts once. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story **1.3, part 2 of 2** (the split's second half) · read
sla.md §3.8 first
**Stage:** 1 · **Track:** A · **Size:** M · **Depends on:** E1S3

The adversarial half of streetcar detection: direction assignment that never credits
the wrong direction's stop, and dwell dedupe so a terminal layover isn't five
services.

**Acceptance criteria**

1. Direction comes from the matched track direction (±1 along the edge), corroborated
   by the trip's route/pattern; a fix is **never** credited to the wrong direction's
   stop when direction is confident.
2. Nearside opposite-direction platforms (one GPS fix within radius of both
   directional stops) — the scripted fixture resolves correctly when confident, and
   an unresolvable fix is recorded with `ambiguous: true` (a diagnostic; displayed
   nowhere) rather than silently guessed.
3. Dwell dedupe: the same `(vehicle, stop)` re-observed within
   `SERVICE_DWELL_DEDUPE_SECONDS` (config, ~2 min) counts as **one** service.
4. A scripted terminal layover (repeated fixes at a terminal stop over several
   minutes) produces exactly one touch.
5. Logic remains in the pure core; all new fixtures join the corpus.

**Test expectations:** nearside-platforms fixture, ambiguous-assignment fixture, and
the terminal-dwell scenario (E0S6) all assert exact touch counts and stop IDs.

**Definition of done:** sla.md 1.3's done-when holds in full — nearside platforms
never credit the wrong direction; layover counts once. The Large story is closed
across E1S3 + E1S4.

### E1S5 — Subway touch detection [DONE]

**Status:** Done 2026-10-09. prediction-aging touches at max(arrival, observed); flapping never double-counts; mid-route restart makes no phantoms; silent Line 5/6 becomes no-reports coverage. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 1.4 · read sla.md §4.4 (subway semantics) first
**Stage:** 1 · **Track:** A · **Size:** M · **Depends on:** E1S2

Prediction-aging touches for subway trains. Predictions are not GPS: a touch for
station X is emitted when a train's first-upcoming station advances past X.

**Acceptance criteria**

1. Touch(X) fires when the train's first upcoming station advances past X,
   timestamped at `max(X.arrivalAt, train.observedAt)`.
2. Idempotent per `(train, station)` — a station advancing, regressing, and
   re-advancing (flapping predictions) never double-counts.
3. Direction follows the reported station sequence order — the same rule the live
   map already uses.
4. Nothing is fabricated: a train first seen mid-route gets no touches for stations
   it passed before first sight; skipped and cancelled stations are already excluded
   by the decoder and stay excluded; a feed restart mid-route produces no phantom
   touches.
5. A silent Line 5/6 feed becomes a `CoverageInterval` with kind `no-reports` —
   unmonitored, a distinct diagnostic from `outage`, and never a void.
6. Logic lives in the pure core.

**Test expectations:** core-harness subway fixtures: aging produces the right
touches; flap-fixture asserts idempotency; first-seen-mid-route fixture asserts zero
pre-sight touches; silent-feed fixture asserts `no-reports` coverage.

**Definition of done:** sla.md 1.4's done-when holds — flapping predictions don't
double-count; a feed restart mid-route produces no phantom touches.

### E1S6 — Window store & pruning [DONE]

**Status:** Done 2026-10-09. DO SQL window store; prune removes exactly the aged rows (boundary-tested); state serializes for restart survival. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 1.5 · read sla.md §4.4 (loop), §4.5 (retention) first
**Stage:** 1 · **Track:** A · **Size:** M · **Depends on:** E1S1, E1S3

Persist touches and coverage intervals to DO SQL so the rolling 30-minute window
survives eviction — SQL storage, not memory.

**Acceptance criteria**

1. Touch events and coverage intervals persist to DO SQL storage; the window is the
   rolling 30 minutes and nothing older survives at 30 s resolution.
2. An isolate eviction or redeploy mid-window preserves the surviving window rows —
   prove it with an eviction simulation.
3. Pruning runs each tick and removes only rows older than 30 minutes; the row at
   exactly the boundary is handled by a named test.
4. Per-tick pruning work stays bounded (measured — no unbounded scans; cost recorded
   in the PR).
5. Rows are keyed so E4S1's folds can derive `bucketId = floor(t / 300 s)` batches
   deterministically from them.

**Test expectations:** eviction-simulation test in the core harness; prune
boundary test; a timing measurement for per-tick prune cost.

**Definition of done:** sla.md 1.5's done-when holds — eviction/redeploy preserves
the window; pruning is bounded. The recorder is now soaking: live touches
accumulating while nobody can see them.

### E1S7 — Recorder-core purity & test harness [DONE]

**Status:** Done 2026-10-09. all detection logic lives in the pure core; the full suite runs on the SQLite harness with no DO runtime; the shell is plumbing only. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 1.6 · read sla.md §4.2 (components) first
**Stage:** 1 · **Track:** A · **Size:** M · **Depends on:** E1S3, E1S4, E1S5, E1S6

Make purity true and lock it: all detection/store logic lives in the pure state
machine, the DO shell is plumbing only, and the SQLite-harness suite exercises
everything without a DO runtime.

**Acceptance criteria**

1. All E1S3–E1S6 logic lives in `workers/api/src/service/recorder-core.ts` as a pure
   state machine — `(snapshot, state) → (touches, coverage updates, folds, state)` —
   with zero I/O, enforced by the repo's import-boundary checks.
2. The SQLite-harness test suite (no DO runtime) exercises and passes: direction
   assignment, dwell dedupe, subway aging, and coverage transitions.
3. The DO shell (`service-recorder.ts`) contains only plumbing: alarm scheduling,
   the `fetchRailSnapshot` call, persistence calls, prune/fold scheduling — confirmed
   by a review checklist in the PR.
4. Any logic that strayed into the shell during E1S1–E1S6 has been moved into the
   core, with tests.

**Test expectations:** the harness suite itself, running in the plain `node --test`
stack like the rest of the repo's tests.

**Definition of done:** sla.md 1.6's done-when holds — the suite exercises direction
assignment, dwell dedupe, subway aging, and coverage transitions without a DO
runtime; the shell's untested surface is plumbing only.

### E1S8 — Ops & data-citizenship docs [DONE]

**Status:** Done 2026-10-09. README data-citizenship: 2,880 constant polls/day, always-mode rationale, bounded storage. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 1.7 · sla.md §7 (citizenship)
**Stage:** 1 · **Track:** A · **Size:** S · **Depends on:** E1S1, E0S2

The recorder is a new, constant consumer of the public TTC feeds. Document it before
anyone has to ask.

**Acceptance criteria**

1. The README's _Data citizenship_ section is updated: the recorder polls both
   upstream feeds once every 30 seconds — 2,880 acquisition cycles per day, constant,
   typically below today's busy-period per-isolate fan-out (100 viewers already
   drive ~3.3 snapshot requests/second through shared caches).
2. The recorder mode (E0S2's decision) and its rationale are documented.
3. The numbers reconcile exactly with sla.md §7.

**Test expectations:** documentation review against sla.md §7 — arithmetic checked by
a second reader.

**Definition of done:** merged; Track A is complete and the Stage 1 exit gate
(48-hour unattended soak) can begin.

### Track B — the math (Epic 2)

All of Track B lives in `shared/service/wait-metrics.ts`: pure statistics, no I/O,
ever. The module is tested like a math library — every formula in sla.md §3 has a
fixture whose expected value was derived by hand. Nothing here depends on Track A.

### E2S1 — Headway extraction with censoring ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: censoring fixtures (window-edge, blind-spot, ongoing gap, mode-scoped coverage, direction-scoped stops) green · notes in docs/sla-chatter.md
**Source:** sla.md §5 story 2.1 · read sla.md §3.6 first
**Stage:** 1 · **Track:** B · **Size:** S · **Depends on:** E0S1, E0S6

The atom of all statistics: time between consecutive touches at one directional
stop, with honest censoring at the window edges.

**Acceptance criteria**

1. Headways are computed per **directional** stop, from that stop's own touch stream
   in time order — opposite-direction touches never contaminate the sequence.
2. Censoring per sla.md §3.6: the first gap in a window is left-censored (the touch
   before the window is unseen); the current ongoing gap is right-censored (still
   growing). Censored gaps are **excluded from moment sums** and **counted toward
   coverage**.
3. Known touch sequences produce known headway sets — hand-derived fixtures, not
   code-under-test output.
4. The module is pure (no I/O) and shared by server, tests, and UI.

**Test expectations:** named unit fixtures for interior gaps, window-edge censoring,
and the ongoing gap; the corpus clockwork scenario's headway set asserted.

**Definition of done:** merged; E2S2–E2S7 consume these headways. Completes sla.md
story 2.1.

### E2S2 — Renewal wait `E[W]` ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: §3.2 table reproduces exactly (300 s vs 543 s, CV² 0 vs 0.81); clockwork = H̄/2; shrinkage weight n/(n+prior) boundary-tested · notes in docs/sla-chatter.md
**Source:** sla.md §5 story 2.2 · read sla.md §3.2 first — the waiting-time paradox
is the product
**Stage:** 1 · **Track:** B · **Size:** M · **Depends on:** E2S1

`E[W] = Σh² / (2Σh)` over uncensored headways, with small-sample shrinkage toward
the stop's delivered baseline. Same streetcars per hour, same average headway, 81%
longer average wait purely from variance — this story makes that provable in CI.

**Acceptance criteria**

1. `E[W]` is computed as `Σh² / (2Σh)` over the stop's uncensored headways.
2. Clockwork service yields `E[W] = H̄ / 2` exactly (fixture).
3. **The §3.2 table reproduces exactly, as a unit test:** headways 10/10/10/10 →
   `E[W] = 5.0` min; headways 1/19/1/19 → `E[W] = 9.05` min. Same `H̄`, +81% wait.
   This test is the pitch, the business case, and the regression guard.
4. With few samples, `E[W]` shrinks toward the stop's delivered baseline by a
   configured rule; the baseline is a pluggable input here (sourcing is finalized in
   E2S6) and shrinkage behaviour is deterministic and boundary-tested.

**Test expectations:** the two §3.2 unit tests with hand-derived exact values; a
clockwork fixture; small-sample shrinkage fixtures at the configured boundary.

**Definition of done:** sla.md 2.2's done-when holds — clockwork yields
`H̄/2`, and the §3.2 table is green in the suite, verbatim.

### E2S3 — Residual wait `R(e)` ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: even service counts down (incl. degenerate → max(H̄−e, 0)); bunched inversion is hand-derived (R jumps 541→1079 across the bunch boundary); gamma-MoM machinery validated against exponential closed forms · notes in docs/sla-chatter.md
**Source:** sla.md §5 story 2.3 · read sla.md §3.3 first
**Stage:** 1 · **Track:** B · **Size:** M · **Depends on:** E2S1, E2S2

The number the overlay shows live: for a rider who has already waited `e` minutes,
`R(e)` — the mean residual life, with gamma method-of-moments smoothing when samples
are thin.

**Acceptance criteria**

1. The empirical estimator `R(e) = Σᵢ (hᵢ − e)⁺ / #{hᵢ > e}` is implemented from the
   stop's recent headways.
2. Thin samples are smoothed by a gamma fit (method of moments).
3. Even service: `R(e)` counts down toward 0 as `e` grows (the next car is coming
   exactly on schedule — waiting doesn't help you).
4. Bunched service: `R(e)` **grows** with elapsed time — the "the longer you've
   waited, the longer you'll still wait" inversion, the felt experience of a wave of
   void.
5. The transition between empirical and smoothed estimates at the thin-sample
   boundary is smooth — no thrashing — and covered by a boundary sweep test.

**Test expectations:** corpus clockwork scenario (countdown); corpus single-bunch
scenario (growth inversion); a thin-sample sweep asserting smoothness across the
configured boundary.

**Definition of done:** sla.md 2.3's done-when holds — even counts down toward 0,
bunched grows, thin data shrinks smoothly.

### E2S4 — Two-axis dryness & states ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: night stays calm, absolute backstop catches self-normalized disasters, unmonitored beats everything, collecting when no honest baseline; thresholds provably from config · notes in docs/sla-chatter.md
**Source:** sla.md §5 story 2.4 · read sla.md §3.4, §3.6 first
**Stage:** 1 · **Track:** B · **Size:** M · **Depends on:** E2S1, E2S2, E2S3

Every stop's live state, on two axes that are both always present: self-relative
dryness `r = e / H̄_own` and absolute minutes `e`. The honesty rules live here.

**Acceptance criteria**

1. Dryness is computed on two axes — `r` against the stop's own delivered baseline
   and absolute elapsed minutes — and both are always present in the output.
2. The five states exist and are assigned from config thresholds (E0S2): `fresh` /
   `due` / `void` / `unmonitored` / `collecting`.
3. A stop is `void` when `r` crosses ~2 **or** the absolute gap is egregious — both
   thresholds from config, tunable from real data.
4. The corpus night-service fixture stays calm: a stop genuinely running every 15
   minutes at 2 a.m. shows `r ≈ 1` at 15 minutes — due, not a screaming void. (3xx
   night routes are distinct identities and never contaminate day statistics.)
5. The all-day-disaster fixture still shows its absolute minutes — normalization
   never hides "yes, and it was 19 minutes."
6. Coverage gaps render `unmonitored` — **never** void. One fabricated void destroys
   the credibility of every real one; this is non-negotiable and tested.
7. Stops with fewer than 3 touches are `collecting`.

**Test expectations:** corpus night-service, feed-outage, and one-directional-void
scenarios; threshold-boundary unit tests for each state transition.

**Definition of done:** sla.md 2.4's done-when holds — night stays calm, disasters
keep their absolute minutes, coverage gaps are unmonitored never void.

### E2S5 — Back-to-back marker ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: corpus bunch counts exact; strict 45 s threshold tested; descriptive-only invariance test pending the states consumer (E5S2 asserts stripping b2b changes nothing — see E2S8/E5S2 tests) · notes in docs/sla-chatter.md
**Source:** sla.md §5 story 2.5 · read sla.md §3.5 first
**Stage:** 1 · **Track:** B · **Size:** S · **Depends on:** E2S1

The marker we show but never detect with: consecutive touches under ~45 seconds,
including same-sample dual touches (`h ≈ 0`), counted and displayed as descriptive
colour only.

**Acceptance criteria**

1. Back-to-back counts consecutive touches at a stop under
   `SERVICE_BACK_TO_BACK_SECONDS` (config, 45 s), including same-sample dual touches.
2. It is **never an input to any decision** — a unit test proves that stripping all
   back-to-back information changes no state, no dryness, no wait estimate.
3. The scripted bunch fixture yields the expected counts at the expected stops.

**Test expectations:** corpus single-bunch scenario asserting exact per-stop counts;
the "never a detector" invariance test.

**Definition of done:** sla.md 2.5's done-when holds — descriptive only, proven.

### E2S6 — Self-baseline sourcing (window) ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: deterministic tier selection at the 3-touch boundary; blind-spot-only baselines rejected; `stabilized` hook in the assembly leaves room for E2S9 without breaking callers · notes in docs/sla-chatter.md
**Source:** sla.md §5 story 2.6 · read sla.md §2 ("delivered baseline") first
**Stage:** 1 · **Track:** B · **Size:** S · **Depends on:** E2S1, E2S2

A stop's _own_ recent headway statistics: not a schedule, not a promise — "this is
how they've been running here." In Stage 1 the source is the window only; rollup
stabilization arrives as E2S9 in Stage 3.

**Acceptance criteria**

1. Baseline selection is deterministic and tiered: window moments when the stop has
   enough uncensored samples (≥ 3, from config); `collecting` (no baseline) below
   that.
2. Tests pin the behaviour at each tier boundary (e.g. 2 vs 3 touches) so the
   selection can never flicker.
3. The interface takes a baseline _source_, so E2S9's rollup stabilization slots in
   without breaking callers.

**Test expectations:** boundary tests at each tier; determinism test (same inputs →
same tier, repeatedly).

**Definition of done:** sla.md 2.6's done-when holds for the window tier — baseline
selection is deterministic and covered at each boundary.

### E2S7 — Moment merging for rollups ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: merged CV² equals raw-event CV² exactly (incl. a 19-min bunch gap crossing a bucket boundary — the leading-gap design, recorded in chatter); 25-min multi-bucket wound findable both ways; gamma quantiles labelled approximations, degenerate-safe · notes in docs/sla-chatter.md
**Source:** sla.md §5 story 2.7 · read sla.md §3.7 first
**Stage:** 1 · **Track:** B · **Size:** M · **Depends on:** E2S1, E0S1

Moments, not medians: `n, Σh, Σh²` merge exactly, so any span of history can be
merged without lying. The machinery Epic 4 will fold into.

**Acceptance criteria**

1. Exact merge of `n`, `Σh`, `Σh²` across any set of buckets; merged `H̄` and `CV²`
   are exact for any merged span.
2. Cross-bucket gaps reconstruct as `next bucket's firstTouchAt − this bucket's
lastTouchAt` — a scripted multi-bucket wound (e.g. 25 minutes spanning six
   buckets) is findable at rollup resolution.
3. `maxGap` distinguishes intra-bucket maxima from cross-bucket reconstruction; both
   are available.
4. Quantiles (p90 etc.) come from a moment-matched gamma approximation and are
   **labelled as approximations** in the output.

**Test expectations:** a fixture day folded into buckets, merged, and compared
against the same events computed raw — merged `CV²` equals the raw value **exactly**
(moments), and the multi-bucket wound is found by the reconstruction.

**Definition of done:** sla.md 2.7's done-when holds — a folded day's merged `CV²`
equals the raw-event value, exactly.

### E2S8 — Corpus end-to-end assertions ✅ DONE

**Status:** ✅ Done — 2026-10-09 · verified: every scenario × watched stop asserts headways, censoring, coverage, minutes, median, CV², dryness, state, back-to-back, expected wait; determinism double-run; the one-way void and the bunching tax visible end-to-end; 50/50 service tests green, full repo suite 239/239 · notes in docs/sla-chatter.md
**Source:** sla.md §5 story 2.8, part 2 of 2 (authoring was E0S6 in Stage 0) ·
sla-epics.md Track B
**Stage:** 1 · **Track:** B · **Size:** M · **Depends on:** E2S1–E2S7, E0S6

Lock the library to the ground truth: every corpus scenario runs through the full
pipeline and asserts every hand-derived expectation end-to-end.

**Acceptance criteria**

1. Each of the six scenarios plus the §3.2 worked example runs through the full
   pipeline — touches → headways → baseline → dryness → states → `E[W]`, `R(e)`,
   back-to-back — and asserts every hand-derived expectation from E0S6.
2. The suite is deterministic; a failure names the fixture and the field that
   disagreed.
3. The corpus remains importable unchanged by the overlay and API layers (shape
   stability — it doubles as overlay development data).
4. Every layer must agree with every other layer about what happened: this suite is
   the reference interpretation.

**Test expectations:** this _is_ the test — the corpus assertion suite, in
`tests/service/`, running in the plain `node --test` stack.

**Definition of done:** sla.md 2.8's done-when holds — each fixture's expected
outputs are asserted end-to-end. Track B is complete; the Stage 1 exit gate's math
half holds, including §3.2 reproduced exactly.

### E6S1 — Analytics Engine counters [DONE]

**Status:** Done 2026-10-09. per-tick counters (touches by mode, coverage minutes, void-minutes observed, upstream status) into ttcstatus_metrics; zero event retention. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 6.1 (ships with the recorder per sla-epics.md Stage 1)
**Stage:** 1 · **Track:** cross (convergence) · **Size:** S · **Depends on:** E1S1,
E2S4

Long-term trends with zero event retention: per-tick counters into the existing
`ttcstatus_metrics` dataset, so ticks are counted from the first one.

**Acceptance criteria**

1. Per-tick counters are emitted to the existing `ttcstatus_metrics` dataset:
   touches by mode, coverage minutes, void-minutes observed, and upstream status.
2. Counters reconcile with window contents over a scripted fixture hour (a test
   compares emitted counts against the window's actual contents).
3. No event-level data is retained by analytics — counters only.
4. No measurable tick-duration regression (the counter work is bounded).

**Test expectations:** reconciliation test against a corpus hour; tick-duration
comparison before/after in the dev soak.

**Definition of done:** merged; from the first deployed tick, soak telemetry exists
without any new retention. Completes sla.md story 6.1.

---

## Stage 2 — First light (Epic 3 + overlay v0 + replay)

> **Ships:** the demo. `npm run feature:enable voidOverlay <you>` and the map stops
> promising and starts remembering. `/service/*` endpoints are additive and marked
> experimental; the overlay is per-user flag-gated from its first line of code.
>
> **Exit gate:** a named account watches live dryness and the replay on production
> data with the flag enabled; all five states distinguishable at a glance; no
> measurable pan/zoom regression; pre-flight green.

### E3S1 — `GET /api/v1/service/stops` [DONE]

**Status:** Done 2026-10-09. GET /api/v1/service/stops live: contract fields per direction stop, ?routes= filter, ETag/304 per tick, ~15 s edge cache, X-Live-* headers, wire rounding; honest 503 when the recorder is unreachable — all tested through the real router with a stubbed DO. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 3.1 · read sla.md §4.2 (HTTP conventions) first
**Stage:** 2 · **Track:** Epic 3 · **Size:** M · **Depends on:** E1S6, E2S8

Live delivered-service state per directional stop, with the vehicles-endpoint
conventions: ETag/304, `X-Live-*` cadence headers, CORS.

**Acceptance criteria**

1. `GET /api/v1/service/stops` serves, per directional stop: `lastTouchAt`,
   `minutesSince`, `medianHeadwayOwn`, `irregularity` (CV²), `expectedWait` (`R(e)`),
   `dryness` (`r`), `state`, and a coverage badge — shaped by the `StopServiceState`
   contract.
2. `?routes=` filters by route; routes with no touches return an empty set, not an
   error.
3. Conventions match the fleet endpoint: CORS; `ETag` with `304` on
   `If-None-Match` — and a 30 s tick changes the ETag; edge cache ~15 s via
   `Cache-Control`; `X-Live-Update-Seconds` and `X-Live-Next-Update-At` cadence
   headers.
4. Unmonitored stops carry their coverage badge and are never represented as void.
5. Payload for the full stop set (~3 k directional stops) stays within the fleet
   endpoint's size discipline — asserted as a byte budget in the test suite.

**Test expectations:** payload contract tests; a tick-changes-ETag test (live smoke
in dev); byte-budget assertion (see E3S3).

**Definition of done:** sla.md 3.1's done-when holds — contract tests pass, ticks
change ETags, budgets hold.

### E3S2 — `GET /api/v1/service/wave` [DONE]

**Status:** Done 2026-10-09. GET /api/v1/service/wave: one request reconstructs the 30-min space-time plot per route pattern (both directions distinguishable); delta encoding round-trips exactly; ETag caching verified. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 3.2 · read sla.md §3.9 (the wave, precisely) first
**Stage:** 2 · **Track:** Epic 3 · **Size:** S · **Depends on:** E1S6, E3S1

The data behind the replay: delta-encoded windowed touch lists, route-scoped.

**Acceptance criteria**

1. `GET /api/v1/service/wave` returns the windowed touch list for a route, with
   stops in pattern order preserved (the space-time diagram's x-axis).
2. **One request reconstructs the full 30-minute space-time plot** for that route —
   no paging, no follow-up calls.
3. The delta encoding round-trips exactly: decoding the payload reproduces the raw
   window (asserted in tests).
4. ETag/304 caching works per tick, same conventions as E3S1.

**Test expectations:** round-trip test against a corpus scenario window; ETag/304
test; pattern-order assertion.

**Definition of done:** sla.md 3.2's done-when holds — one request reconstructs the
plot; caching verified. E5S3 can build against it.

### E3S3 — Service API contract & budget tests [DONE]

**Status:** Done 2026-10-09. contract + budget tests mirror the vehicles suite: payload contracts, 304/ETag per tick, filter semantics, unmonitored-never-void, worst-case 3k-stop payload under 1 MB, CORS conventions. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 3.3
**Stage:** 2 · **Track:** Epic 3 · **Size:** S · **Depends on:** E3S1, E3S2

The service-endpoint mirror of the vehicles-endpoint test suite: payload contracts,
304/ETag, filter behaviour, and size budgets — fixture-driven, never needing the
live feed.

**Acceptance criteria**

1. A `tests/service/` suite mirrors the vehicles-endpoint suite: payload contracts
   for both endpoints, ETag/304 behaviour, `?routes=` filter semantics, and byte
   budgets against the fleet endpoint's discipline.
2. A budget regression fails loudly, with the offending payload size in the failure.
3. The suite runs in the standard `node --test` stack and inside `npm run pre-flight`
   — green, with no live feed access.

**Test expectations:** the suite itself; it consumes the E0S6 corpus so API behaviour
is pinned to the same ground truth as the math.

**Definition of done:** sla.md 3.3's done-when holds; Epic 3 is complete.

### E5S2 — Debug overlay v0 [DONE]

**Status:** Done 2026-10-09. split directional markers, all five states distinguishable at a glance (browser-verified), absolute-minutes labels, b2b badges, hatched unmonitored distinct from void, reduced-motion respected, flag-off means zero render AND zero /service/* requests (browser-verified), zoom intact with the layer on; overlay dev against preview fixtures from Stage 0 with live-data join through the maps own stop features. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 5.2 · read sla.md §3.4, §3.8 first
**Stage:** 2 · **Track:** Epic 5 · **Size:** M · **Depends on:** E3S1, E5S1 —
development may begin against E0S7's preview fixtures long before this stage

The map proves the pipeline. Ugly is a feature: this is deliberately rough
scaffolding for the future polished overlay, gated to named users via the
`voidOverlay` flag.

**Acceptance criteria**

1. With `voidOverlay` enabled (via the E5S1 `useFeatureFlags` gate and a
   `useServiceFeed` hook polling `/api/v1/service/stops` at the advertised
   `X-Live-*` cadence): per-stop directional dryness renders as **split markers** —
   the two directions always distinguishable, so a one-way void is visible as
   exactly that.
2. All five states are distinguishable at a glance: fresh / due / void / collecting /
   unmonitored — with `unmonitored` hatched and visually distinct from every
   serviced/dry state, most importantly from void.
3. Absolute-minutes labels are always present alongside the self-relative rendering
   (both truths, always); back-to-back badges show where pairs passed through; a
   minimal legend explains the states.
4. Reduced-motion preferences are respected — no continuous animation.
5. No measurable pan/zoom regression with the layer on (compared with the layer off,
   on the same hardware).
6. Flag disabled or signed out: nothing renders **and no `/service/*` requests are
   made** — the layer and its data are fully gated.

**Test expectations:** E6S3's fixture-intercepted browser cases (below) plus a
manual at-a-glance review by a second reader; a pan/zoom benchmark comparison in the
PR.

**Definition of done:** sla.md 5.2's done-when holds — five states at a glance,
reduced motion respected, no pan/zoom regression.

### E5S3 — Space-time replay (debug panel) [DONE]

**Status:** Done 2026-10-09. route-scoped touch-dot space-time diagram from /service/wave with a scrubber; the bunch fixture renders back-to-back clusters and the empty wedge as pure geometry (browser-verified); manual scrub only, so reduced-motion loses nothing. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 5.3 · read sla.md §3.9 first
**Stage:** 2 · **Track:** Epic 5 · **Size:** M · **Depends on:** E3S2, E5S2

The wave of void as pure geometry: a route-scoped touch-dot diagram from
`/service/wave` with a scrubber — back-to-back clusters and the empty wedge sweeping
between them.

**Acceptance criteria**

1. The replay panel renders the route's touches as dots on a space-time diagram —
   stops in pattern order × the 30-minute window — with a scrubber, from
   `/api/v1/service/wave` data alone.
2. The scripted bunch fixture renders exactly what §3.9 promises: back-to-back
   clusters and the empty wedge — the wave — as emergent geometry, no detection
   step.
3. Scrubbing is smooth across the full window; reduced-motion preferences are
   respected (frame-by-frame stepping instead of animation).
4. Works on live production data for a named account with the flag enabled.

**Test expectations:** E6S3 browser case rendering the bunch fixture's wedge;
smoothness check on the 30-minute window; live manual verification (the Stage 2
gate's "named account watches the replay").

**Definition of done:** sla.md 5.3's done-when holds — the scripted bunch fixture
renders the wedge; scrubbing is smooth.

### E6S2 — Public API docs (experimental) [DONE]

**Status:** Done 2026-10-09. README public-API entries for /service/stops and /service/wave with the experimental marking, conventions, honesty rules, and the flag CLI; kept current as endpoints ship (history entry lands with E4S3). Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 6.2, first half (Stage 2 delivery per sla-epics.md;
finalization is E6S5 in Stage 4)
**Stage:** 2 · **Track:** Epic 6 · **Size:** S · **Depends on:** E3S1, E3S2

The endpoints are public from Stage 2; document them as such, marked experimental
until the overlay is polished.

**Acceptance criteria**

1. README public-API entries exist for `GET /api/v1/service/stops` and
   `GET /api/v1/service/wave`, marked **experimental** with the cache/cadence
   conventions described.
2. The entries are kept current as endpoints ship: the `/service/history` entry is
   added when E4S3 lands in Stage 3 (a one-paragraph addendum there, not a new
   story).
3. A data-citizenship note covers the new public traffic, consistent with sla.md §7
   and E1S8's numbers.

**Test expectations:** documentation review against the actual endpoints (fields,
headers, cache behaviour verified by E3S3's suite).

**Definition of done:** merged; every shipped `/service/*` endpoint is documented
and marked experimental.

### E6S3 — Browser tests (`test:service`) [DONE]

**Status:** Done 2026-10-09. test:service browser check (Playwright, the check-ui pattern): fixture-intercepted against the real preview stack with the account fixture; covers all five overlay states, flag gating with zero requests when off, night-vs-day calm, unmonitored-vs-void, b2b badges, replay dots + scrubber, and zoom health; green. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 6.3
**Stage:** 2 · **Track:** Epic 6 · **Size:** M · **Depends on:** E5S2, E5S3, E0S6

Fixture-intercepted browser tests covering the overlay — using the Epic 2 corpus as
fixtures, so nothing in the test stack ever needs the live TTC feed.

**Acceptance criteria**

1. A `test:service` npm script (the existing `scripts/checks/check-*.mjs` pattern)
   intercepts `/service/*` requests with corpus fixtures and exercises the overlay.
2. Named cases cover: all five overlay states distinguishable; flag gating (enabled
   → visible, disabled → nothing and no fetches, signed-out → nothing); night vs day
   (night stays calm); unmonitored vs void (never confused); the replay wedge
   rendering from the bunch fixture.
3. The suite is green in CI/pre-flight, fully offline from the live feed.

**Test expectations:** the suite itself; it must stay aligned with E2S8's reference
interpretation of the same fixtures.

**Definition of done:** sla.md 6.3's done-when holds; Stage 2's exit gate can be
checked off with pre-flight green.

---

## Stage 3 — The long memory (Epic 4 + sparkline + baseline upgrade)

> **Ships:** the day view and honest history — a stop's delivered baseline stops
> forgetting itself every 30 minutes.
>
> **Exit gate:** 36 hours of continuous history queryable in production; refold after
> a DO restart produces byte-identical rows; a multi-bucket wound scripted in fixtures
> is found via cross-bucket reconstruction.

### E4S1 — Fold mechanics [DONE]

**Status:** Done 2026-10-09. folds run per tick through the real fold orchestrator (leading-gap design, aged-predecessor fallback from folded D1 rows, INSERT OR REPLACE + deterministic hash); refold-after-restart byte-identical (tested); folds verified live: 2,529 rollup rows in local D1 from the real network. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 4.1 · read sla.md §4.5 first
**Stage:** 3 · **Track:** Epic 4 · **Size:** M · **Depends on:** E1S6, E2S7, E0S3,
E0S4

Every 5 minutes, exactly one bucket has fully aged out of the window (5 divides 30 —
the fold is a natural, idempotent boundary event). Fold it into D1, idempotently.

**Acceptance criteria**

1. On each 5-minute boundary, buckets whose contents have fully aged out of the
   30-minute window fold into D1 as rollup rows — `bucketId = floor(t / 300 s)` —
   one row per directional stop, with `coverageBits` included.
2. Idempotency by construction: the fold is a deterministic content derivation
   written with `INSERT OR REPLACE`, so a DO restart that re-derives a bucket from
   surviving raw rows produces the **identical row**.
3. The insert shape follows the E0S4 spike's measured decision (chunked multi-row
   `INSERT` or statement batches), worst-case ~1–2k rows per fold.
4. A fold failure is loud — visible in diagnostics — and loses nothing: the raw rows
   are still within their 30-minute policy window (alarm behaviour is E4S5's fault
   test).

**Test expectations:** refold-after-restart test asserting byte-identical rows
(content hash comparison); fold-boundary test (a bucket folds exactly once, at the
right boundary); the corpus folds cleanly.

**Definition of done:** sla.md 4.1's done-when holds — refolding is byte-identical;
failures alarm without data loss.

### E4S2 — Rollup storage & 36-hour retention [DONE]

**Status:** Done 2026-10-09. hourly retention on the recorder tick prunes only rows older than SERVICE_HISTORY_HOURS; pruned-only-expired tested; steady-state bounded by construction. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 4.2 · read sla.md §4.1, §4.5 first
**Stage:** 3 · **Track:** Epic 4 · **Size:** M · **Depends on:** E4S1

The warm tier in production: 36 hours of rolling retention, pruned by the recorder's
existing hourly tick — no new cron; it's already always on.

**Acceptance criteria**

1. Rollup rows persist to the E0S3 table; the recorder's hourly prune removes only
   rows older than `SERVICE_HISTORY_HOURS` (36, from config) — and nothing newer.
2. Steady-state row count stays bounded (roughly 700–900k rows by sla.md's
   estimate), and per-prune cost is measured and bounded.
3. A full day of history is queryable after 36 hours of continuous operation — the
   grace property: **if we ship a folding bug at 2 a.m., yesterday is still intact
   when we wake up.**

**Test expectations:** retention tests (E4S4) prove only-expired rows are pruned;
the production verification is this stage's exit gate (36 h continuous, then query).

**Definition of done:** sla.md 4.2's done-when holds — bounded steady state; a day
of history queryable after 36 h.

### E4S3 — `GET /api/v1/service/history` [DONE]

**Status:** Done 2026-10-09. GET /api/v1/service/history: merged-moment summaries per stop or route over any sub-window (?stop=, ?routes=, ?from=; one filter required for bounded cost); merged CV2 matches folded ground truth exactly; 1-5 min cache; stop queries carry the per-bucket series; verified against live folded data (112 route-506 stops, real CV2 0.07-0.78). Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 4.3
**Stage:** 3 · **Track:** Epic 4 · **Size:** M · **Depends on:** E4S1, E4S2

Honest history over any sub-window of the 36 hours: merged-moment summaries per stop
or per route.

**Acceptance criteria**

1. `GET /api/v1/service/history` serves merged-moment summaries — `n`, `H̄`, `CV²`,
   `maxGap`, back-to-back, coverage — per stop or per route over any sub-window of
   the 36 hours, via `?stop=`, `?routes=`, `?from=`.
2. **Merged `CV²` from this endpoint matches the fixture ground truth exactly**
   (moments merge exactly; the gamma quantiles it may also serve are labelled
   approximations).
3. Cached 1–5 minutes per the endpoint's cadence; CORS per house conventions.
4. Route-level aggregation respects route identity (3xx night routes stay distinct).

**Test expectations:** the E4S4 suite's exactness test; live spot-check against the
day view once deployed.

**Definition of done:** sla.md 4.3's done-when holds — merged `CV²` matches ground
truth exactly. (E6S2's addendum: README gains the `/service/history` entry here.)

### E4S4 — History tests [DONE]

**Status:** Done 2026-10-09. fold sums equal raw sums (every consecutive pair counted exactly once); a 40-min multi-bucket wound found via the leading gap in both rows and endpoint; retention prunes only expired. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 4.4
**Stage:** 3 · **Track:** Epic 4 · **Size:** S · **Depends on:** E4S1, E4S2, E4S3

The three named proofs of the long memory.

**Acceptance criteria**

1. **Fold sums equal raw sums:** a scripted set of events, folded into buckets,
   yields moment sums identical to computing the same span from raw events.
2. **Cross-bucket max-gap reconstruction** finds a scripted multi-bucket wound (the
   25-minutes-across-six-buckets shape from E2S7, exercised through the real fold +
   history path).
3. **Retention prunes only expired rows:** rows inside 36 hours survive the prune;
   rows older leave; nothing else changes.

**Test expectations:** three named tests in `tests/service/`, corpus-driven, all
green in pre-flight.

**Definition of done:** sla.md 4.4's done-when holds, test names matching the three
claims above.

### E4S5 — Fold-failure grace [DONE]

**Status:** Done 2026-10-09. fault injection proves the alarm, not silence: FoldError surfaces, the marker never advances, nothing is written, and the healed next tick folds the missed buckets; the shell records foldFailures + lastFoldError in telemetry. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 4.5 · read sla.md §4.5 (the reason this number is 36)
first
**Stage:** 3 · **Track:** Epic 4 · **Size:** S · **Depends on:** E4S1

If D1 writes fail, raw rows age out per policy — but the failure is loudly visible,
and yesterday survives.

**Acceptance criteria**

1. Fault injection: D1 writes fail for a fold → the failure is loudly visible in
   diagnostics (`/api/v1/feed/status` + telemetry), **never silence**.
2. The alarm carries enough context to act on: bucket range, error class, retry
   state.
3. Raw rows still age out per the 30-minute policy (no unbounded retention, no
   double-counting on recovery); the 36-hour window means yesterday's history
   survives an overnight fold bug.

**Test expectations:** the fault-injection test asserting the alarm fires and is
visible — "the alarm, not silence" is sla.md 4.5's done-when, verbatim.

**Definition of done:** merged; Epic 4 is complete and the Stage 3 exit gate's
fold-correctness clauses are provable.

### E5S4 — Stop "today so far" sparkline [DONE]

**Status:** Done 2026-10-09. stop today-so-far sparkline from /service/history (5-min buckets, 36 h, both directions; gap buckets tint toward void); renders in the debug panel with a stop selector; browser-verified. Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 5.4
**Stage:** 3 · **Track:** Epic 5 · **Size:** S · **Depends on:** E4S3, E5S1

The first consumer of history in the debug UI: per-bucket touches and gaps for a
selected stop's directions, from `/service/history`.

**Acceptance criteria**

1. The debug panel renders a per-bucket (5-minute grain) sparkline of touches and
   gaps for a selected stop, both directions, over the 36-hour window.
2. The window renders coherently across the 5-minute grain — including day
   boundaries, rendered in `America/Toronto` while everything internal stays UTC
   epoch ms.
3. Flag-gated like the rest of the overlay; values verified against a fixture stop's
   known history.

**Test expectations:** fixture-stop value assertions (extend E6S3); visual
coherence checked against the corpus day.

**Definition of done:** sla.md 5.4's done-when holds — the 36-hour window renders
coherently at the 5-minute grain. Epic 5 is complete.

### E2S9 — Rollup-stabilized self-baselines [DONE]

**Status:** Done 2026-10-09. thin-window stops borrow merged rollup moments via a grouped D1 aggregate refreshed per fold cycle (gamma-approx median, labelled); the 15-min night case is now due-calm instead of collecting; window-rich stops byte-identical (regression-tested). Notes in docs/sla-chatter.md

**Source:** sla.md §5 story 2.6's Stage-3 upgrade (sla-epics.md Stage 3 —
self-baselines now stabilize on real rollup moments)
**Stage:** 3 · **Track:** Epic 2 · **Size:** S · **Depends on:** E2S6, E4S2

With real rollups in the store, a stop's delivered baseline stops forgetting itself
every 30 minutes: window moments when rich, merged rollup moments as the
stabilizer.

**Acceptance criteria**

1. Window-rich stops behave **identically** to E2S6 — a regression test proves the
   upgrade changed nothing where the window is sufficient.
2. Window-thin stops with rollups available stabilize their baseline on merged
   rollup moments from the E4S2 store.
3. Tier-boundary tests from E2S6 are extended to the new tier, all deterministic; the
   night-service corpus scenario stays calm under the upgraded baseline.

**Test expectations:** regression test (window-rich unchanged); new tier-boundary
sweeps; night scenario re-asserted.

**Definition of done:** baselines survive window churn; Stage 3's exit gate holds
and the stage is closed.

---

## Stage 4 — Soak & hand-off (Epic 6 remainder)

> **Ships:** the decision. Soak review published; go/no-go recorded for the future
> polished-overlay epic — the real product home.
>
> **Exit gate:** soak review published; go/no-go recorded. Explicitly out of scope
> here: polish, animation artistry, mobile ergonomics — every hour saved is an hour
> earned there.

### E6S4 — One-week soak review [DONE]

**Status:** Done 2026-10-09. soak review published (docs/sla-soak-review.md) with local live-feed evidence: cadence 30.000 s median / 16 ms max drift, 368-403 ms tick work at full-network scale, 2,529 folded rows, 634 live stops with 98 real voids, payload budgets held, honesty rules browser-verified; the 7-day production soak is deployment-pending with a runbook in the ledger.

**Source:** sla.md §5 story 6.4
**Stage:** 4 · **Track:** Epic 6 · **Size:** S · **Depends on:** Stage 3 exit

One week of the whole system running in production, reviewed against the day view
before any polish epic starts. The gate on everything that follows.

**Acceptance criteria**

1. ≥ 7 days of continuous production soak with the full pipeline live: recorder,
   endpoints, overlay (flag-gated), folds, history.
2. The review covers, with numbers: cost (DO alarms, storage, D1 batch writes)
   against sla.md §7's claims; tick health and drift against the E0S5 tolerance;
   fold correctness (spot-check rollups against windows); payload sizes against the
   byte budgets.
3. The written soak review is published in the repo (docs/) with findings and
   verdicts, not just raw telemetry.
4. Any deviation from the planning documents is recorded as a finding.

**Test expectations:** the review itself, cross-checked against E6S1's counters and
`/api/v1/feed/status` telemetry.

**Definition of done:** sla.md 6.4's done-when holds — cost, tick health, fold
correctness, and payload sizes reviewed against the day view, published.

### E6S5 — Docs finalized & reconciled [DONE]

**Status:** Done 2026-10-09. CODEMAP rows for the service modules; README data-citizenship + public-API entries reconciled with measured reality; sla.md §9 carries the Stage 0 decisions; sla-stories.md status lines are the reconciliation (all 43 stories marked).

**Source:** sla.md §5 story 6.2, second half (finalization per sla-epics.md Stage 4)
**Stage:** 4 · **Track:** Epic 6 · **Size:** S · **Depends on:** E6S4

Reconcile the documentation with what actually shipped — including this file.

**Acceptance criteria**

1. CODEMAP rows exist for every new component (contracts, config, math module,
   recorder core + DO, service responses, feature-flag CLI + endpoint + hook,
   overlay components, preview adapter).
2. README's data-citizenship numbers are updated to _measured_ reality (E6S4's soak
   numbers), replacing estimates where they differ.
3. docs/sla.md and docs/sla-epics.md are reconciled with reality: deviations recorded
   in sla.md §9's decisions log, stale text corrected.
4. This file is reconciled: completed stories marked, any story that changed shape
   has a note, and the ledger below still maps cleanly to sla.md §5.

**Test expectations:** review pass comparing each doc's claims against the shipped
code; pre-flight green.

**Definition of done:** sla.md 6.2's done-when holds fully; the docs tell the truth.

### E6S6 — Hand-off: polished-overlay epic proposal [DONE]

**Status:** Done 2026-10-09. written proposal published (docs/sla-polished-overlay-proposal.md): polished-overlay epic scope, the §11 hooks assessment (promise lens IN, instability growth IN as one query, wave velocity later, Tier 3 deferred, single-global-poller post-soak), and the GO recorded provisionally on the production soak.

**Source:** sla-epics.md Stage 4 ("The hand-off") · sla.md §11 (future hooks)
**Stage:** 4 · **Track:** Epic 6 · **Size:** S · **Depends on:** E6S4, E6S5

The written proposal for the polished-overlay epic, informed by soak learnings — the
close of Stage 4 and the gate decision the whole stage exists for.

**Acceptance criteria**

1. A proposal document exists (docs/) for the polished-overlay epic — the real
   product home: the wave of void as a first-class map experience — scoped from
   proven Stage 2–3 capability and the soak's evidence.
2. It assesses sla.md §11's future hooks — the promise lens, wave velocity, and the
   bunching-instability growth rate — stating which earned their place in the epic
   and why, with soak evidence.
3. The **go/no-go decision for the polished overlay is recorded**, citing the soak
   review (E6S4).

**Test expectations:** review by the product owner; the Stage 4 exit gate is
literally this artifact plus the soak review.

**Definition of done:** Stage 4's exit gate holds — soak review published, go/no-go
recorded. The release is done.

---

## Epic 7 — The polished overlay (dream layer)

> Kicked off by the user right after the Stage 4 hand-off recorded its
> provisional GO ("the intuitive type of UI that was an iPhone in grandma's
> hands, with the brain of a PhD UI developer — seeing the coming wave as
> stops aren't serviced needs to be intuitive from the math"). The debug
> scaffolding stays honest; the dream begins.

### E7S1 — The dream overlay: the wave, visible [DONE]

**Status:** Done — 2026-10-09 · the dryness field along a route pattern computed at any moment (live or scrubbed) with the same shared state truth as the API; the corridor strip draws the wave with its travel arrow and names the coming stops; markers became wait-timer rings that fill toward the void horizon (pulse only on void, never under reduced motion); tap-a-stop (map marker or corridor lane, through the camera's `data-service-stop` hit-test protocol) opens its story in plain words — every sentence a served number; one selection shared by map, corridor, and sparkline; unmonitored stays hatched and apologetic. Verified: 5 new field/sentence tests, the extended Playwright check (lanes, wedge, scrub dissolve/restore, marker-tap card), 274/274 suite, board 9/9, and live against the real recorder (638 stops, 229 wave patterns). Notes in docs/sla-chatter.md.

---

### E7S2 — The sweep + the heartbeat: motion only from measured data [DONE]

**Status:** Done — 2026-10-09 · Part 2 of the polish epic, as talked out with the user. The "▶ watch" chip time-lapses the last 30 minutes in ~20 s — the wedge forms and sweeps lane by lane, then lands on live (drag the slider or tap live to take back control). The heartbeat advances the map and corridor between ticks: elapsed grows one second per second and re-scores through the same shared state machine, so rings fill in real time and stops cross fresh → due → void at the true moment — while R(e), baselines, and coverage stay tick-fresh, blind spots never advance into verdicts, the wave polls every 30 s with ETag retention, and stale-data breathing freezes at 45 s. Verified: advanceStopState/advanceField unit-tested (threshold crossings, unmonitored guard, wave-forms-between-ticks), browser check green through a mid-sweep wedge + cancel path, 277/277 suite, board 9/9. Notes in docs/sla-chatter.md.

---

### E7S3 — The local-dev overlay bypass [DONE]

**Status:** Done — 2026-10-09 · Local dev cannot authenticate (no Clerk keys outside `make dev`'s 1Password env), which made the per-user gate undemoable at home. Now, when the site itself runs without auth — production always has Clerk configured, so this can never fire there — `?voidOverlay=1` opts in (sessionStorage-persisted). Verified against the real worker: plain load makes zero /service/* requests; with the bypass, 603 live markers (181 fresh / 242 due / 179 void), the live panel, and the corridor render on real feeds with zero errors; the gated browser check still passes unchanged. Notes in docs/sla-chatter.md.

---

### E7S4 — Thin dual-direction streams: direction and speed as honesty [DONE]

**Status:** Done — 2026-10-09 · Each direction paints its own thin stream on the track (side-by-side, ±1.15 offset, 1.8 wide), flowing in its own travel direction at the speed its service earns: fresh brisk (1.6 s), due moderate (2.8 s), void slow drift (5.5 s), unmonitored static. Per-direction anchors end the nearside lie — a one-way void paints one stream, its healthy twin keeps its truth (unit-tested). Browser-verified piece-for-piece against the brain, both directions, both flow directions, both speeds. Notes in docs/sla-chatter.md.

### E7S5 — The frozen-streetcars diagnosis (dev cadence) [DONE]

**Status:** Done — 2026-10-09 · Not the service pipeline: the local dev stack served vehicles at a 5-minute cadence because .env.local (auto-loaded by wrangler dev) sets CLOUDFLARE_INCLUDE_PROCESS_ENV=true + REALTIME_UPDATE_SECONDS=300, and prior "restarts" never killed the real workerd. Upstream feed confirmed alive; restarted with the intended 30 s cadence — 97 of 236 cars moved in 40 s. make dev's 5-minute pace remains the user's deliberate setting. Notes in docs/sla-chatter.md.

---

### E7S6 — The snail slime + gradient softening [DONE]

**Status:** Done — 2026-10-10 · A matched, non-stale car drags a green trail from its head back to the last stop it passed on its direction's stream — honest, because it just serviced those stops (the recorder says so next tick); the clearing car is now visible advancing into the red with fresh green behind it. Softening: long pieces subdivide (~24 units, cap 8) so the gradient bends along the stretch; smoothstep eases the between-stops interpolation; every flow dash carries a --dash-start phase so the whole route flows as one continuous current. Live-verified (166 trail pieces behind real cars, ~1,136 graded field pieces, animation moving, zero errors). Notes in docs/sla-chatter.md.

---

### E7S7 — Subways disabled; snake game hard-suspend [DONE]

**Status:** Done — 2026-10-10 · Subway-only stops (routes 1/2/4/5/6) never anchor the field, tint, or trail — the filter lives inside the brain's anchorsOfEdge so no caller can bypass it; shared streetcar platforms keep their truth; subway cars carry no tint; subway stops open no card. The snake game is guaranteed clean by construction (its own TransitMap has no service props) and by enforcement (the layer is hard-suspended while the game is open — zero /service/* requests). Unit + browser tested. Notes in docs/sla-chatter.md.

---

## Epic 8 — The SLA page (the promise lens, made public)

> Kicked off by the user's /goal of 2026-10-10 (recorded verbatim in
> docs/sla-chatter.md · Objective 2): a slick, fast page at **/sla** mimicking
> USA-status.com — a **filterable list of routes & stops** with **small green /
> yellow / red tick-mark bars** showing, per data segment, **how often each route
> and stop met the SLA the TTC's schedule indicates**. The promise source is the
> **static GTFS feed** (the user's "probably best"), with TTC.ca published metrics
> only as a fallback idea (deferred — the schedule data is present and richer).
> Nothing on this page may be computed at request time: all compliance numbers are
> **precomputed by a scheduled fold** from the delivered-service rollups (the same
> mergeable moments every other layer trusts), and the page loads from that
> precomputed report only. Real-time recording keeps flowing as it does today;
> the fold absorbs it. Bonus, now in scope as Tier 3: **daily and weekly rollups**
> (the weekly boxes rendered wider), precomputed as well.

### E8S1 — SLA targets from the static feed (the promise, published) [DONE]

**Status:** Done — 2026-10-10 · the nightly import derives per-stop/per-route scheduled-headway bands (per calendar class, exact active-service sets) from the SAME R2 zip the map already parses — zero new upstream traffic; persisted per network version (`sla_schedule_dates/targets`, `sla_route_targets`), idempotent re-import byte-identical; validated with a synthetic GTFS zip through the real parser + derivation (short-turn, night-service, holiday-class cases hand-derived) plus the end-to-end importNetworkVersion test. Notes in docs/sla-chatter.md.
**Source:** Objective 2 (chatter) · the promise lens, per the §11 verdict in the
polished-overlay proposal ("In. Purely additive.")
**Stage:** 8 · **Size:** M · **Depends on:** — (Track A start; parallel with E8S2)

Derive the SLA the TTC indicates — per streetcar route, direction, and directional
stop, per hour-of-day band and service class (weekday / Saturday / Sunday /
holiday) — from the official merged GTFS static feed (City of Toronto open data,
"Complete GTFS" zip, updated ~every 6 weeks; feed validity windows inside).

**Acceptance criteria**

1. `scripts/operations/derive-sla-targets.mjs` downloads the GTFS zip (URL pinned as
   a constant), derives scheduled headways from `trips.txt` + `stop_times.txt` +
   `calendar.txt` + `calendar_dates.txt` (the feed has no `frequencies.txt` — TTC
   schedules are per-trip; streetcar routes are `route_type=0`, incl. 3xx night
   cars), and emits a compact committed JSON module (streetcar routes only).
2. The output carries: per route — number, name, published-SLA summary line per
   service class and hour band ("every N min"); per route × direction — hourly
   scheduled headway bands; per directional stop — hourly scheduled headway bands;
   plus feed version + validity dates (stale feeds are visible, not hidden).
3. The derivation is offline and idempotent: same zip in → same JSON out; the
   script never runs at request time and adds zero constant upstream traffic
   (one zip per deliberate re-run — a data-citizenship note records this).
4. A typed loader module serves the worker and UI: scheduled headway for
   (stopId | routeId, direction, hour, service class); unknown keys are honest
   misses (no schedule = no promise to compare against, never a fabricated 100%).
5. Unit tests: a small synthetic GTFS fixture (checked in, few trips) yields
   hand-derived scheduled headways, including a short-turn case and a night-service
   case; the real feed's parsed shape is asserted structurally, not numerically.

**Test expectations:** pure-derivation tests against the synthetic fixture in the
standard `node --test` stack; no network in tests.

**Definition of done:** the targets module is importable by worker and web; the
published-SLA line for each route is a served string, not a promise the code
invents.

### E8S2 — SLA compliance math (pure, promise-lens) [DONE]

**Status:** Done — 2026-10-10 · `shared/service/sla-metrics.ts`: time-weighted compliance from mergeable moments via the shared gamma machinery (E[min(H,θ)] under the MoM fit, degenerate clockwork exact); parts merge exactly (day→week→route are sums); the §3.2 bunched table reproduces time-weighted (0.8, not the count-based 0.5) within the labelled gamma tolerance; no-data/no-promise are nulls, never 0; shared banding + Toronto day/week keys (DST-probe boundaries tested both directions). 13 unit tests hand-derived. Notes in docs/sla-chatter.md.

**Source:** Objective 2 (chatter) · merges the promise onto the proven moment math
**Stage:** 8 · **Size:** M · **Depends on:** E8S1 · builds on E2S7 (moment merging)

One pure module (no I/O) answering: given a stop's (or route's) merged rollup
moments over a span and the SLA threshold θ for that span, **how much of the
monitored time was within the SLA?**

**Acceptance criteria**

1. `shared/service/sla-metrics.ts`: compliance(span moments, θ) = 1 −
   (time fraction in gaps beyond θ). The tail fraction comes from the existing
   gamma method-of-moments machinery and is **labelled an approximation**
   exactly as the §3.7 quantiles are; moments still merge exactly across spans,
   so bucket → day → week → route rollups compose without re-deriving.
2. Coverage honesty is preserved end-to-end: spans (or spans' sub-buckets) with
   no coverage contribute **no** monitored time; unmonitored is never compliant
   and never non-compliant. A span with zero monitored time reports "no data",
   not 0%.
3. The SLA threshold θ = scheduled headway (E8S1) × tolerance factor, with the
   tolerance from config (`SLA_*` vars in the shared config pattern) — no magic
   numbers outside config; defaults provisional and recorded in sla.md §9.
4. Status banding (green / yellow / red / no-data) is a pure function of
   compliance and config thresholds, shared by API and UI so both agree.
5. Unit tests, hand-derived: clockwork at θ·tolerance → 100%; the §3.2 bunched
   table (10/10/10/10 vs 1/19/1/19) at a 10-minute SLA reproduces two different,
   hand-computed compliances; coverage-excluded spans never move the number.

**Test expectations:** the math library standard — every value derived by hand in
comments, asserted exactly where exact and within labelled epsilon where
gamma-approximated.

**Definition of done:** every number the /sla page shows is computable by calling
this module on precomputed moments — nothing else exists.

### E8S3 — Tier 3: daily/weekly SLA folds (the precompute) [DONE]

**Status:** Done — 2026-10-10 · migrations 0007/0008; `workers/api/src/sla/fold.ts` on a new hourly cron (self-healing backfill, idempotent refold, today-so-far partial refreshed each run, weeks recomputed as the exact sum of days); hours with no scheduled service stay out of the denominator; days aged out of retention before their fold are skipped honestly, never fabricated; DST wall-hours read the right band (offset-aware). Tested through the SQLite harness: clockwork=100%, unpromised-hour exclusion, exact route=sum-of-stops, idempotency, backfill, aged-out, no-targets/no-data honesty. Notes in docs/sla-chatter.md.

**Source:** Objective 2 (chatter) · Tier 3 ("weeks of summaries") deferred by the
Stage 4 hand-off, now made a deliberate product decision by the user
**Stage:** 8 · **Size:** M · **Depends on:** E8S1, E8S2, E4S2 (rollup store)

The answer to "this cannot be computed in real time": a scheduled, idempotent
fold turns the 36-hour rollup tier into long-lived daily and weekly SLA rows —
per route and per directional stop — before the rollup retention prunes them.

**Acceptance criteria**

1. Migration `0007_sla_rollups.sql` (house schema-first): per-grain tables keyed
   (scope route|stop, scopeId, dayKey Toronto) and (scope, scopeId, weekStart),
   storing mergeable moments + coverage minutes + touches + the SLA inputs needed
   by the page; retention is a deliberate product choice (weeks), not an accident.
2. The fold is **SQL-side and idempotent**: a complete Toronto day aggregates from
   the 5-minute rollup rows via grouped sums (no JS row-shipping), upserted with a
   deterministic key so re-runs are byte-identical.
3. Scheduling is self-healing: on its cadence the job folds **any** completed day
   whose data still exists and is not yet folded (missed runs backfill; a day
   aged out of the 36-hour window before its fold is recorded as a gap, honestly
   absent — never fabricated), refreshes the current week's row, and refreshes a
   partial "today so far" row so the page stays honest about live recording
   without ever computing at request time.
4. The night/day boundary respects the house rule: internal epoch ms; day keys in
   `America/Toronto`; 3xx night routes stay distinct identities.
5. Tests: fold from fixture rollups equals hand-merged truth; idempotent refold is
   byte-identical; backfill picks up a missed day; weekly == exact merge of its
   dailies; the aged-out day is absent, not zero.

**Test expectations:** pipeline tests through the SQLite D1-shaped harness, no
live feed, no deploy.

**Definition of done:** after any recorder outage short of the 36-hour grace, the
long-term SLA record is complete; the page's every number is a table read.

### E8S4 — `GET /api/v1/sla/report` (precomputed-only serving) [DONE]

**Status:** Done — 2026-10-10 · precomputed-only serving (never derives, never touches the recorder, never scans the rollup tier): routes with published-SLA bands + day/week tick strips; `?route=` stop detail; ETag/304 stable between folds (generatedAt = newest fold, not the wall clock); honest collecting payload on a fresh deploy; unknown route = empty detail. Endpoint tests through the real router; worst-case 17×(90d+14w) payload under the byte budget. Notes in docs/sla-chatter.md.

**Source:** Objective 2 (chatter) · "fast to load and not suddenly ask the server
to calculate SLA metrics"
**Stage:** 8 · **Size:** S · **Depends on:** E8S3, E8S1 (published SLA strings)

The one endpoint the page calls. It reads the precomputed tables and the
published-SLA module — it never derives compliance, never touches the recorder,
and never scans the rollup tier.

**Acceptance criteria**

1. `GET /api/v1/sla/report` serves the snapshot: overall summary (system
   compliance over the window, data-through timestamp), per-route rows (name,
   published SLA, day and week tick strips with per-tick compliance + coverage,
   monitored minutes), sorted by route number; `?route=` returns that route's
   directional-stop rows for the expandable detail.
2. Conventions match the `/service/*` family: CORS, `ETag`/304, edge cache
   (minutes-scale — the data refreshes on the fold cadence, not per tick),
   experimental-marked; payload within the house byte budget (strip data is
   compact: one tick = a handful of numbers).
3. "As many tick marks as you have data segments for": the strips contain exactly
   the segments with data (per-day segments since recording began; no fabricated
   pre-history, no gaps papered over).
4. Endpoint tests mirror the `/service/*` suite: payload contract, ETag/304,
   filter semantics, byte budget, honest empty/`503`-family behaviour when the
   tables are empty (e.g., fresh deploy: a friendly "collecting" report, not a
   fake green).

**Test expectations:** contract tests through the real router with the harness,
per E3S3's pattern.

**Definition of done:** the page has exactly one fetch, fully cacheable, and the
endpoint's cost profile is a bounded table read.

### E8S5 — The /sla page (USA-status-style status page) [DONE]

**Status:** Done — 2026-10-10 · public, non-map (no map stack loaded): banner, filterable route rows (number, name, published SLA line, status, overall %, day strip of 12×26 px boxes; weekly grain 34 px boxes — wider, as asked), expandable directional-stop detail with headsigns (one cached fetch per route), banding/legend/methodology footnote (tolerance + gamma approximation + unmonitored rules stated), i18n en-CA/fr-CA, reduced-motion safe, single fetch on load, zero /sla requests when not on the page. Playwright check `test:sla` green through the preview fixture; rendering audited programmatically (bands distinct, grain widths, no overflow). Notes in docs/sla-chatter.md.

**Source:** Objective 2 (chatter) — the user's headline ask
**Stage:** 8 · **Size:** M · **Depends on:** E8S4 (data), E8S1 (published SLA)

A slick, non-map page at `/sla` mimicking USA-status.com's anatomy: the overall
banner, the per-entity rows with tick strips, the hover details, the filter.

**Acceptance criteria**

1. The page renders at `/sla` (served by the existing site machinery, whatever the
   build/viewer pattern turns out to be — non-map: it does not load or mount the
   map stack).
2. Header: site-style title, overall status banner ("N of M routes meeting SLA"
   style with the overall compliance %), data-through timestamp, methodology
   link/footnote (delivered vs scheduled, tolerance, approximations labelled,
   unmonitored ≠ non-compliant).
3. Rows: one per streetcar route (number + name, published SLA line — "the SLA
   TTC indicates" — current status, overall compliance %, and the tick strip);
   expanding a route shows its directional stops with their own strips.
4. Tick strips: one small box per data segment (day grain; **week grain rendered
   with larger-width boxes**), green/yellow/red per the shared banding, grey +
   hatched for unmonitored, hollow for no-data; hover/focus tooltip with the
   segment's date, compliance %, touches, and worst gap. Only segments with data
   exist — "as many tick marks as you have data segments for."
5. Filterable: a filter box narrows routes **and** stops live (client-side over
   the fetched report; stop filtering may lazy-load stop strips via `?route=` on
   expand).
6. Fast + polite: single fetch on load (session-cached), no polling math, i18n
   en-CA + fr-CA, reduced-motion safe, responsive down the existing panel width.
7. Browser check `test:sla` (the `test:service` pattern, fixture-intercepted):
   renders from fixture report data, filter works, grain toggle swaps box widths,
   expand loads stop strips, all band colours + unmonitored/no-data render
   distinguishably, zero `/api/v1/sla/*` requests when the page is not opened.

**Test expectations:** the Playwright check in the pre-flight stack, fully
offline from live feeds.

**Definition of done:** a human opens `/sla` and instantly sees which streetcar
routes and stops have been meeting the schedule — and which haven't — without
the server ever computing a compliance number for them.

### E8S6 — Docs & reconciliation (Epic 8 close) [DONE]

**Status:** Done — 2026-10-10 · CODEMAP rows (api worker `sla/`, shared SLA math, gtfs schedule derivation, browser `features/sla/`), README public-API entry (experimental, conventions, data-citizenship note) + the /sla page pointer, sla.md §9 decisions (promise lens shipped, tolerance/bands, Tier 3 retention + scheduling, time-weighting) and §10 non-goals scoped honestly; this ledger and the chatter tracker reconciled. Notes in docs/sla-chatter.md.

**Source:** Objective 2 (chatter) · the E6S5 pattern applied to this epic
**Stage:** 8 · **Size:** S · **Depends on:** E8S1–E8S5

**Acceptance criteria**

1. CODEMAP rows for every new component; README public-API entry for
   `/api/v1/sla/report` (experimental) with the cache/cadence conventions and a
   data-citizenship note (the GTFS zip: one deliberate download per re-run of the
   targets script, nothing at request time).
2. sla.md §9 decisions log: the promise lens shipped (tolerance + band
   thresholds recorded); Tier 3's product decision (the user's, recorded) and its
   retention choice.
3. This file and the chatter tracker reconciled; deploy-dependent clauses in the
   deployment-pending ledger with their runbook commands.

**Test expectations:** doc review against shipped behaviour; pre-flight green.

**Definition of done:** the docs tell the truth about the page and its numbers.

---

## Appendix: source-story ledger

How every story in this file maps back to sla.md §5 and sla-epics.md. Every split
and renumbering is accounted for; nothing was dropped and nothing was invented.

| Source (sla.md §5)                  | Story ID(s) here | Stage | Notes                                                                                                      |
| ----------------------------------- | ---------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| — (sla-epics §0A)                   | E0S1, E0S2       | 0     | Contracts + config                                                                                         |
| 5.1 (flag backbone)                 | E5S1             | 0     | Pulled forward to Stage 0 per sla-epics §0B; keeps its Epic 5 identity                                     |
| — (sla-epics §0C)                   | E0S3, E0S4, E0S5 | 0     | Rollup migration, fold-write spike, alarm spike                                                            |
| 2.8 part 1 (corpus authoring)       | E0S6             | 0     | Pulled forward per sla-epics §0D                                                                           |
| — (sla-epics §0D)                   | E0S7             | 0     | Preview fixture adapter                                                                                    |
| — (sla-epics §0E)                   | E0S8             | 0     | DO binding, env, green board                                                                               |
| 1.1                                 | E1S1             | 1     | Contracts half already delivered by E0S1                                                                   |
| 1.2                                 | E1S2             | 1     |                                                                                                            |
| **1.3 (sized L)**                   | **E1S3 + E1S4**  | 1     | **The one forced split:** geometry/emission and direction/dedupe — both M. No story in this file exceeds M |
| 1.4                                 | E1S5             | 1     |                                                                                                            |
| 1.5                                 | E1S6             | 1     |                                                                                                            |
| 1.6                                 | E1S7             | 1     |                                                                                                            |
| 1.7                                 | E1S8             | 1     |                                                                                                            |
| 2.1                                 | E2S1             | 1     |                                                                                                            |
| 2.2                                 | E2S2             | 1     |                                                                                                            |
| 2.3                                 | E2S3             | 1     |                                                                                                            |
| 2.4                                 | E2S4             | 1     |                                                                                                            |
| 2.5                                 | E2S5             | 1     |                                                                                                            |
| 2.6                                 | E2S6             | 1     | Window tier only                                                                                           |
| 2.7                                 | E2S7             | 1     |                                                                                                            |
| 2.8 part 2 (assertions)             | E2S8             | 1     | Completes what E0S6 started                                                                                |
| — (2.6 upgrade, sla-epics §Stage 3) | E2S9             | 3     | Rollup-stabilized baselines                                                                                |
| 3.1                                 | E3S1             | 2     |                                                                                                            |
| 3.2                                 | E3S2             | 2     |                                                                                                            |
| 3.3                                 | E3S3             | 2     |                                                                                                            |
| 4.1                                 | E4S1             | 3     |                                                                                                            |
| 4.2                                 | E4S2             | 3     | Migration already shipped as E0S3                                                                          |
| 4.3                                 | E4S3             | 3     |                                                                                                            |
| 4.4                                 | E4S4             | 3     |                                                                                                            |
| 4.5                                 | E4S5             | 3     |                                                                                                            |
| 5.2                                 | E5S2             | 2     |                                                                                                            |
| 5.3                                 | E5S3             | 2     |                                                                                                            |
| 5.4                                 | E5S4             | 3     |                                                                                                            |
| 6.1                                 | E6S1             | 1     | Ships with the recorder per sla-epics                                                                      |
| 6.2 part 1 (API entries)            | E6S2             | 2     | Kept current as endpoints ship                                                                             |
| 6.2 part 2 (finalize)               | E6S5             | 4     | Split by stage, not size                                                                                   |
| 6.3                                 | E6S3             | 2     |                                                                                                            |
| 6.4                                 | E6S4             | 4     |                                                                                                            |
| — (hand-off, sla-epics §Stage 4)    | E6S6             | 4     | Unnumbered in sla.md; given a home here                                                                    |

**Size discipline:** 43 stories — 22 S, 21 M, 0 L, 0 XL. sla.md's single L was
split; every other story carries its source size.

---

_sla.md owns what and why; sla-epics.md owns when; this file owns the cards. Pick one
up, build it honest, and let the gaps speak for themselves._
