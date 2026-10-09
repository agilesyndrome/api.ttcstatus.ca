# SLA delivery stages

Companion to [docs/sla.md](sla.md), which owns the *what* and the *why* (product, math,
architecture, epics and stories). This document owns the *when* and the *in-what-order*:
Stage 0 through Stage 4, each a deployable, demonstrable unit with a hard exit gate.
Story numbers refer to sla.md §5.

> One stage never waits on polish from the previous one. The debug overlay is
> feature-gated per user, so "shipped" never means "visible to everyone."

## The stage map

| Stage | Name | Contains | Shippable outcome |
| --- | --- | --- | --- |
| 0 | Foundations & decisions | contracts, config, flags backbone, migrations, spikes, corpus, plumbing | Interfaces every epic needs; `npm run feature:enable` works against production |
| 1 | The tape deck & the math | Epics 1 + 2 in parallel | Recorder deployed and quietly soaking live data; math library proven on the corpus |
| 2 | First light | Epic 3 + overlay v0 + replay | Named users watch the wave of void on real data, on the map |
| 3 | The long memory | Epic 4 + stop sparkline | 36 hours of exactly-mergeable delivered-service history |
| 4 | Soak & hand-off | Epic 6 remainder | Soak review published; go/no-go for the future polished-overlay epic |

Epic 6 is distributed by design: its analytics counters ship with the recorder
(Stage 1), its browser tests with the overlay (Stage 2), its docs continuously, and its
soak review closes Stage 4.

---

## Stage 0 — Foundations & decisions

Everything here is boring on purpose. No behaviour, no UI beyond the flag gate; the
goal is that when Stage 1 starts, every interface it needs already exists.

### 0A · Contracts and frozen decisions

- `shared/service/contracts.ts` — pure types: `TouchEvent`, `CoverageInterval`,
  `RollupRow`, `StopServiceState`. The vocabulary every later story cites. The §3.2
  waiting-time table in sla.md becomes its first consumer.
- `shared/service/config.ts` — validated defaults (`SERVICE_SAMPLE_SECONDS=30`, touch
  radius, dwell-dedupe window, back-to-back threshold, void thresholds,
  `SERVICE_HISTORY_HOURS=36`), mirroring the `shared/live/config.ts` pattern. Forces
  the remaining open decisions — recorder mode (`always` vs `demand-warm`) and
  threshold values — to be made now, on paper, where they are cheap.

**Exit gate:** the open decisions are recorded in sla.md's decisions log; types
compile with clean import-boundary checks.

### 0B · Feature-flag backbone

- Spike: confirm Clerk session claims expose email server-side in
  `workers/api/src/accounts/`; if not, key flags by Clerk user ID and let the CLI
  accept either (emails churn; user IDs don't). One hour of reading; it decides the
  table's primary key.
- Migration `0005_feature_flags.sql` — `feature_flags(flag, subject, granted_at,
  granted_by)`. Ships early: deploys auto-apply migrations and a failed migration halts
  the deploy, so schema-first is already house style.
- CLI: `scripts/operations/feature-flags.ts` + `npm run feature:enable|disable|list`
  via remote D1 binding, `map:tag` as the template.
- `GET /api/v1/me/features` — Clerk-authenticated, `no-store`, CORS; the caller's
  enabled flags; empty for everyone else. **The only new public endpoint in the
  entire preface.**
- Client `useFeatureFlags` hook — fetch once per session; nothing consumes it yet,
  which is the point.

**Exit gate:** `npm run feature:enable voidOverlay drew@easleyowl.com` works
end-to-end on a deployed stack; a second account sees nothing.

### 0C · Storage prep and two cheap spikes

- Migration `0006_service_rollups.sql` — the rollup table (sla.md §4.3) with
  `(bucketStart)` and `(stopId, bucketStart)` indexes, shipped before Epic 4 needs it.
  No existing table changes anywhere in this feature.
- Spike: the fold write. Verify D1 parameter/batch limits with a load script; a
  worst-case 5-minute fold is ~1–2k rows, so pick the insert shape now (chunked
  multi-row `INSERT` vs statement batches) and measure. Prevents Epic 4's most likely
  redesign.
- Spike: alarm precision. A hello-world Durable Object alarm at 30 s in the `make dev`
  stack; agree on the drift tolerance telemetry will measure, and validate that tick
  idempotency (`tickId = floor(now / 30 s)`) makes jitter harmless.

### 0D · Ground-truth corpus and preview adapter

- Author the fixture corpus (sla.md story 2.8 pulled forward): scripted deterministic
  scenarios — clockwork service, single bunch, one-directional void, terminal dwell,
  night service, feed outage — with hand-derived expectations, including the §3.2
  table. Every later layer (recorder tests, API tests, overlay dev, browser
  intercepts) develops against this same data.
- Preview fixture adapter in `scripts/preview/`: serve
  `/api/v1/service/stops|wave|history` from the corpus during `npm run dev:viewer`, so
  overlay development starts on day one with zero workers, zero DO, zero live feed.

**Exit gate:** a human can see the corpus rendered through the future overlay
locally with no backend running.

### 0E · Binding and env plumbing, then a green board

- `workers/api/wrangler.jsonc`: the repo's first `durable_objects` binding + the
  `SERVICE_*` vars; extend `Env` in `workers/api/src/env.ts` to match. Unused config is
  fine; missing config at Stage-1 time is not.
- Full `./pre-flight`, baselines recorded — the board flags drift and we are about to
  add a lot of code.

---

## Stage 1 — The tape deck & the math (Epics 1 + 2, parallel tracks)

Two tracks with no interdependencies, converging on the corpus:

**Track A — Recorder (Epic 1):** 1.1 DO scaffold → 1.2 network bootstrap → 1.3
streetcar touches → 1.4 subway touches → 1.5 window store → 1.6 core purity → 1.7 ops
& data citizenship. Epic 6's analytics counters (6.1) ship here, so ticks are counted
from the first one.

**Track B — Math (Epic 2):** 2.1 censoring-aware headways → 2.2 renewal wait →
2.3 residual wait → 2.4 two-axis dryness & states → 2.5 back-to-back marker → 2.6
self-baseline (window-only for now; upgraded to rollup moments in Stage 3) → 2.7
moment merging → 2.8 corpus assertions. 2.8's fixtures already exist from Stage 0D;
this track is pure library work against them.

**Entry:** Stage 0 exit gate.

**Exit gate:**

- the recorder is **deployed and quietly soaking** — live touches accumulating while
  nobody can see them, which is exactly how we want it (real data waiting for
  Stage 2, and fold machinery proven before history matters);
- ≥ 48 hours of continuous 30-second ticks with healthy telemetry in the auth'd
  `/api/v1/feed/status` (a full 36-hour history window survives one restart);
- the math library is green against the corpus, including the §3.2 worked example
  reproduced exactly.

**Ships:** nothing public. Internal telemetry and a proven library — the quiet stage
that makes the loud ones safe.

---

## Stage 2 — First light (Epic 3 + overlay v0 + replay)

The first user-visible moment of the product.

- 3.1 `GET /api/v1/service/stops` — live from the recorder's window, ETag/304 per
  tick, `?routes=` filter, fleet-endpoint conventions.
- 3.2 `GET /api/v1/service/wave` — delta-encoded windowed touch lists.
- 3.3 contract + payload budget tests.
- 5.2 debug overlay v0 — per-stop directional dryness, absolute-minutes labels,
  back-to-back badges, hatched *unmonitored* styling distinct from void; flag-gated.
- 5.3 space-time replay panel — the touch-dot diagram with scrubber: back-to-back
  clusters and the empty wedge, the wave of void as pure geometry.
- 6.3 browser tests (fixture-intercepted `test:service`) and 6.2's README/API entries
  with `/service/*` marked experimental.

**Entry:** Stage 1 exit gate.

**Exit gate:** a named account watches live dryness and the replay on production
data with the flag enabled; all five states distinguishable at a glance; no measurable
pan/zoom regression; pre-flight green.

**Ships:** the demo. `npm run feature:enable voidOverlay <you>` and the map stops
promising and starts remembering.

---

## Stage 3 — The long memory (Epic 4 + sparkline)

- 4.1 fold mechanics (idempotent 5-minute boundary folds, deterministic hash,
  `INSERT OR REPLACE`).
- 4.2 rollup storage + 36-hour rolling retention, pruned hourly by the recorder.
- 4.3 `GET /api/v1/service/history` — merged-moment summaries over any sub-window;
  merged `CV²` must match fixture ground truth exactly.
- 4.4 history tests; 4.5 fold-failure grace (raw ages out per policy, the failure is
  loud, yesterday survives an overnight fold bug — the reason the number is 36).
- 5.4 stop "today so far" sparkline from history.
- 2.6 upgrade: self-baselines now stabilize on real rollup moments.

**Entry:** Stage 2 exit gate (fold machinery could be built any time after Stage 1,
but history only becomes interesting once the live surface proves touch quality).

**Exit gate:** 36 hours of continuous history queryable in production; refold after a
DO restart produces byte-identical rows; a multi-bucket wound scripted in fixtures is
found via cross-bucket reconstruction.

**Ships:** the day view and honest history; a stop's delivered baseline stops
forgetting itself every 30 minutes.

---

## Stage 4 — Soak & hand-off (Epic 6 remainder)

- 6.4 one-week soak: cost, tick health, fold correctness, payload sizes, drift
  telemetry — reviewed against the day view before any polish starts.
- 6.2 docs finalized: CODEMAP rows, data-citizenship numbers, this document and
  sla.md reconciled with reality.
- The hand-off: a written proposal for the polished-overlay epic (the real product
  home), informed by soak learnings — including which of sla.md §11's future hooks
  (promise lens, wave velocity, instability growth rate) earned their place.

**Entry:** Stage 3 exit gate.

**Exit gate:** soak review published; go/no-go recorded for the polished overlay.
Explicitly out of scope here: polish, animation artistry, mobile ergonomics — every
hour saved is an hour earned there.

---

## Stage / epic matrix

| Epic | Stage 0 | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
| --- | --- | --- | --- | --- | --- |
| 1 Recorder | plumbing (0E) | 1.1–1.7 | — | — | — |
| 2 Math | contracts, corpus (0A, 0D) | 2.1–2.8 | — | 2.6 upgrade | — |
| 3 Service API | fixture adapter (0D) | — | 3.1–3.3 | — | — |
| 4 Rollups | migration, fold spike (0C) | — | — | 4.1–4.5 | — |
| 5 Overlay | flags, corpus, adapter (0B, 0D) | — | 5.2, 5.3 | 5.4 | polish-epic proposal |
| 6 Hardening | green board (0E) | 6.1 | 6.2, 6.3 | 6.2 | 6.2, 6.4 |

## Parallelism

- Stage 1's Track A (recorder) and Track B (math) are two people's worth of work with
  no shared files until the DO shell reads the library.
- Overlay development begins in Stage 0D against fixtures — a third track that stays
  independent until Stage 2 integration. The preview adapter is what buys that
  independence.
- Critical path: 0A → 0C → 1A → 2 → 3 → 4. The corpus (0D) is off the critical path
  but blocks the overlay track, so it lands early regardless.

## Kill switches and safety

- The overlay is per-user flag-gated from its first line of code; worst case is a
  disabled flag, never a visible regression for the public.
- `/service/*` endpoints are additive and marked experimental; nothing existing
  routes through them.
- The recorder is an isolated Durable Object: its failure modes are its own. The
  vehicles endpoint, the map, the importer and the snake game never depend on it
  (the optional later unification — recorder as the single global poller — is a
  post-soak decision, not a Stage 1–4 dependency).
- Folding failures are loud but non-destructive (4.5); retention is bounded by
  construction (30 minutes raw, 36 hours rolled, nothing else persists).

---

*Stage 0 makes the interfaces; Stage 1 makes them true; Stage 2 makes them visible;
Stage 3 makes them remember; Stage 4 decides what they deserve to become.*
