# SLA — the service TTC actually delivers

**Delivered Level-of-service Analytics.** The file is named `sla.md` with a straight
face and a raised eyebrow: a conventional SLA is a promise. We track no promises here.
Every number in this system is something a streetcar or a train **actually did** —
touched a boarding point, left a gap, arrived back-to-back with its neighbour. When a
rider stands at a stop and feels let down, this system is the measurement of that
feeling. When the service is beautiful, it shows that too.

> We don't detect bunches. We don't read timetables. We watch what arrives, do honest
> math on it, and let the gaps speak for themselves. The wave of void is not a feature
> we build; it is a phenomenon we reveal.

Status: planning document, v2. No implementation has started. This document is
structured as epics with stories so it can be lifted directly into a tracker.

---

## 1. The one-sentence product

Record, every 30 seconds for a rolling 30 minutes, whether each streetcar or train
actually **touched** each boarding point; fold that record into compact statistics every
5 minutes and keep them for a rolling 36 hours; and render what that delivery *feels
like* — wait time, dryness, the traveling wave of unserviced time — directly on the map,
for now as a deliberately ugly, per-user-gated debug overlay.

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| **Touch** | A vehicle was observed serving a boarding point: a streetcar matched to the track within a small radius of a directional stop, or a subway train whose next-station prediction aged past a station. Touches are events with timestamps; everything else in this system is derived from them. |
| **Headway** | Time between consecutive touches at one directional stop. The atom of all our statistics. |
| **Window** | The rolling 30 minutes of raw touch events. Nothing older survives at 30-second resolution, by design. |
| **Rollup** | A 5-minute bucket of mergeable statistics per directional stop, kept for a rolling 36 hours. |
| **Delivered baseline** | A stop's *own* recent headway statistics (from the window, stabilized by rollups). Not a schedule. Not a promise. Just: "this is how they've been running here." |
| **Dryness** | How long since the last touch, measured against the stop's delivered baseline. 0 = just serviced. 1 = "as long as they usually make me wait." ≥2 = void territory. |
| **Void** | A gap in service at a stop, big relative to its own baseline and/or in absolute minutes. A bunched pair manufactures a void behind itself. |
| **Wave of void** | The moving region of dryness a bunched pair drags along a corridor. Not detected — *emergent* from the dryness field over the ordered stops of a route. |
| **Back-to-back** | Two touches at the same stop within ~45 seconds (including two distinct vehicles in one 30-second sample). We display this count. We never use it as a detector; the headway is simply ~0 and the math does the rest. |
| **Coverage** | What fraction of recent time the feeds were actually observable. A feed outage is **unmonitored time, never a void.** The single most important honesty rule in the system. |
| **Unmonitored** | State shown when the feeds couldn't see the stop (outage, no Line 5/6 reports, etc.). Rendered distinctly from every serviced/dry state. |
| **Overlay** | The map rendering. v0 is intentionally ugly and gated per user via a feature flag; the polished overlay is a future epic and the real product home. |

## 3. The mathematical heart

One idea carries the whole product, and it is 90 years old. Everything else is
bookkeeping and honesty.

### 3.1 A stop's world is a point process

To a rider standing at a stop, the transit system is not routes or schedules — it is a
stream of instants: *a car came; a car came; nothing; nothing; nothing; two cars came at
once.* Formally, a **renewal process**: events (touches) with random inter-arrival times
(headways). Every quantity we display — wait, dryness, void, the wave — is a functional
of this process, computed per **directional** stop (see §3.8).

This framing is why we never need a "bunch detector." Bunching is not a binary event;
it is a change in the *shape* of the headway distribution. Shape is measurable with
three numbers per stop: the mean, the variance, and the maximum.

### 3.2 The waiting-time paradox is the product

A rider arriving at a random moment lands inside a gap. Long gaps occupy more of the
timeline, so the rider is *disproportionately likely to be standing in a long one* —
length-biased sampling, the classic **inspection paradox**. The expected wait for a
random arrival is not half the average headway; it is:

```
E[W] = E[H²] / (2·E[H]) = (H̄ / 2) · (1 + CV²)
```

where `H̄` is the mean headway and `CV² = Var(H)/E[H]²` is the squared coefficient of
variation. `CV²` is the **bunching tax**: evenness makes it 0, bunching inflates it.

| Scenario | Cars/hour | Headways | `H̄` | `CV²` | E[W] |
| --- | --- | --- | --- | --- | --- |
| Evenly spaced | 6 | 10, 10, 10, 10 | 10 min | 0 | **5.0 min** |
| Two cars bunched | 6 | 1, 19, 1, 19 | 10 min | 0.81 | **9.05 min** |

Same streetcars per hour. Same *average* headway. **81% longer average wait**, purely
from variance. This one worked example — which appears verbatim as a unit test — is the
pitch, the business case, and the reason the mean alone is never enough. The bunched
route is not "slower" in any capacity sense; it is worse *only* in distribution, and the
rider feels the distribution, not the capacity.

The corollary we lean on everywhere: **we never have to detect the pair.** We measure
the gap structure it leaves behind at each stop, and the pain it causes is
mathematically unavoidable.

### 3.3 What a rider standing there right now should expect: the residual wait

`E[W]` is the long-run average. A rider who has *already waited* `e` minutes wants
`R(e)`, the **mean residual life**:

```
R(e) = E[(H − e) | H > e] = Σᵢ (hᵢ − e)⁺ / #{hᵢ > e}
```

estimated from the stop's recent headways, smoothed by a gamma fit (method of moments)
when samples are thin. Under perfectly even service, waiting doesn't help you — the
next car is coming exactly on schedule (`R(e)` counts down to 0). Under bunched
service, a long elapsed wait means you are probably standing *inside* the void the pair
left behind, and `R(e)` *grows*. That inversion — "the longer you've waited, the longer
you'll still wait" — is the felt experience of a wave of void passing through a stop,
and it is exactly what `R(e)` quantifies. This is the number the overlay shows live.

### 3.4 The void, on two axes

We deliberately measure delivery against **the stop's own baseline**, not against any
promise. Two axes, both always visible:

1. **Self-relative dryness** `r = e / H̄_own` — elapsed since last touch, in units of
   this stop's own delivered median headway. Night service calms itself automatically:
   a stop genuinely running every 15 minutes at 2 a.m. has `r = 1` at 15 minutes, not
   a screaming void. Morning/night expectations are answered by the data, not by a
   lookup table. The Blue Night 3xx route numbers matter here only for identity and
   labelling — the 306 and the 506 are different routes in the touch stream, so the
   day/night hand-off never contaminates a stop's statistics.
2. **Absolute minutes** `e` — always present in labels and details. The backstop: a
   route that is a disaster *all day* would otherwise normalize its own pain away. The
   self-relative scale says "unusual for here"; the absolute scale says "yes, and it was
   19 minutes." Both truths, always.

A stop is in **void** state when `r` crosses ~2 **or** the absolute gap is egregious
(thresholds are configuration, tuned from real data, never hard-coded folklore).

### 3.5 Back-to-back: the marker we show but never detect with

Consecutive touches at a stop under ~45 seconds — including two distinct vehicles
observed within radius in the *same* 30-second sample (`h ≈ 0`) — are counted and
displayed as **serviced back-to-back**. This is descriptive, correlative colour for the
replay view: "here is where the pair passed through." It is never an input to any
decision. The moment it becomes a detector, we inherit every fragility of threshold
magic; as a pure display of the point process, it inherits none.

### 3.6 Honesty constraints: censoring, quantization, coverage

The math is only as good as its admission of ignorance. Three constraints, embraced:

- **Window censoring.** The first headway in a 30-minute window is left-censored (we
  didn't see the touch before the window opened) and the current ongoing gap is
  right-censored (it's still growing). Censored gaps are excluded from the moment
  sums — silently including them would *understate* voids at the worst moment — but
  they count toward coverage.
- **30-second quantization.** Touches are interval-censored by the sampling cadence:
  we know the touch happened within a ~30-second bracket. Sub-30-second headways are
  unresolvable, which is fine — "back-to-back" *is* sub-minute behaviour, and the same-
  sample dual-touch case pins it at `h ≈ 0`. For ordinary headways the quantization
  bias is negligible; we document it rather than pretend it away.
- **Coverage.** Feed outages, missing Line 5/6 subway reports, decoder failures — all
  recorded as coverage intervals. **Unmonitored time is never rendered as a void.** A
  stop the system couldn't see shows "unmonitored", hatched and apologetic. This rule
  is non-negotiable: one fabricated void destroys the credibility of every real one.

### 3.7 Mergeable rollups: moments, not medians

When a 5-minute bucket ages out of the window, we must compress it into one small row
that can still tell the truth a day later. Medians don't merge (the median of medians is
a lie); **moments do, exactly**. Each rollup stores per directional stop:

```
n, Σh, Σh²   →  exact H̄ and CV² for any merged span of buckets
maxGap       →  the worst wound in the bucket (the void's signature)
firstTouchAt, lastTouchAt  →  cross-bucket gap reconstruction (see below)
backToBack   →  count of sub-45-second services
distinctVehicles, routeIds  →  richness without rows (3xx night routes stay visible)
coverageBits →  was the feed even watching?
```

Because `n, Σh, Σh²` are additive, any hour, morning, or full 36 hours of history can be
merged **exactly** — the day-level `CV²` is not an estimate of a summary, it *is* the
summary. Quantiles (p90 and friends) come from a moment-matched gamma approximation,
clearly labelled as an approximation. Cross-bucket voids are reconstructed as
`next bucket's firstTouchAt − this bucket's lastTouchAt`, so a 25-minute wound spanning
six buckets is still findable at rollup resolution.

*The mean preserves capacity, the median hides the tails, and variance remembers
everything. We keep all three.*

### 3.8 Directionality is a first-class dimension

A void can live in one direction while the other runs beautifully — the eastbound cars
bunched into a void while westbound service glides past. GTFS already gives every
boarding point a **directional stop ID** (opposite-direction records are separate
stops), so:

- Touch events, window statistics, rollup rows, and API states are **all keyed by
  directional stop ID.** The split survives end-to-end with no extra machinery.
- Disambiguation matters at assignment time: opposite-direction stops can sit within
  the touch radius of one GPS fix (nearside platforms across an intersection). We
  assign direction from the matched track direction (`matchGpsToTrack` returns ±1
  along the edge), corroborated by the trip's route/pattern; a fix is never credited
  to the wrong direction's stop when direction is confident. Subway direction follows
  the reported station sequence order, the same rule the live map already uses.
- The overlay renders the two directions distinctly (v0: split markers) so a
  one-way void is visible as exactly that.

### 3.9 The wave of void, defined precisely

Along the ordered stops of a route pattern, define the **dryness field**
`rᵢ(t) = elapsed-since-last-touch at stop i / H̄_own,i`. A bunched pair travelling the
corridor drags a ridge in this field behind it: consecutive stops rise through
*fresh → due → void* in sequence as the gap reaches them. Rendered over time, that ridge
**is** the wave of void — no detection step, no clustering, no threshold magic; a
space-time diagram of touch dots shows back-to-back clusters and the empty wedge
sweeping between them as pure geometry. The live overlay shows the field as it hits
each stop; the replay shows the wedge it left. The wave's speed is the pair's speed;
its lifetime is the gap's lifetime; its width is the headway the pair swallowed.

---

## 4. Architecture

### 4.1 The retention pyramid

```
Tier 1 (hot)   raw touch events · 30 s sampling · rolling 30 min · Durable Object
               → live overlay, residual wait, wave replay, fresh statistics

Tier 2 (warm)  5-minute rollups, one row per directional stop · rolling 36 h · D1
               → self-baselines, day view, "today so far", honest history

Tier 3 (cold)  hourly/daily per-route summaries · weeks · FUTURE, out of scope
```

Design properties: 5 divides 30, so every 5 minutes exactly one bucket has fully aged
out of the window — the fold is a natural, idempotent boundary event. 36 hours (not 24)
means a full day of history survives an overnight breakage: **if we ship a folding bug
at 2 a.m., yesterday is still intact when we wake up.** Nothing persists beyond 36
hours — long-term patterns go through aggregate counters, not event storage, honouring
the repo's principle that history is a deliberate product decision, never an accident.

### 4.2 Components and where they live

| Component | Home | Responsibility |
| --- | --- | --- |
| Service contracts | `shared/service/contracts.ts` | Touch event, coverage interval, rollup row, stop-state DTOs — the single vocabulary for worker, tests, and UI |
| The math | `shared/service/wait-metrics.ts` | Pure statistics: censoring-aware headways, renewal wait, residual wait, dryness, states, back-to-back, moment merging. No I/O, ever. |
| Recorder core | `workers/api/src/service/recorder-core.ts` | Pure state machine: (snapshot, state) → (touches, coverage updates, folds, state). Fully unit-testable without a DO runtime. |
| Recorder DO | `workers/api/src/service/service-recorder.ts` | Thin shell: singleton Durable Object, 30 s alarms, calls the core, persists to DO SQL storage, writes folds to D1, prunes. |
| Acquisition reuse | `workers/api/src/realtime/realtime.ts` | `fetchRailSnapshot()` already fetches surface GPS + subway trip updates together and was explicitly written for "a scheduled or stateful Worker to reuse." Untouched. |
| Touch matching | `shared/map/projection.ts` | `matchGpsToTrack()` — GPS → edge + distance-along-edge + direction, with route/bearing/previous-edge hints. Untouched. |
| HTTP | `workers/api/src/service/responses.ts` + `http/router.ts` | `/api/v1/service/*` endpoints with the vehicles-endpoint conventions: ETag/304, `X-Live-*` cadence headers, CORS. |
| Feature flags | `scripts/operations/feature-flags.ts`, D1 table, `/api/v1/me/features` | Per-user gate for the debug overlay; managed by npm command. |
| Overlay | `web/ui/features/service/` | `VoidOverlay.tsx`, `useServiceFeed.ts`, `useFeatureFlags.ts` — the ugly-on-purpose debug layer. |
| Migration | `migrations/0005_service_rollups.sql` | Rollup table, feature-flag table, indexes. |

### 4.3 Data model

```ts
// shared/service/contracts.ts
interface TouchEvent {
  t: number;                 // epoch ms, interval-censored to the 30 s sample
  stopId: string;            // DIRECTIONAL GTFS stop id — directionality lives here
  directionId: 0 | 1;
  mode: 'streetcar' | 'subway';
  vehicleId: string;          // Flexity number or namespaced subway train id
  routeId: string;            // '506' or '306' — day and night stay distinct
  ambiguous?: boolean;       // direction assignment was low-confidence (diagnostic)
}

interface CoverageInterval {
  from: number; to: number;
  mode: 'streetcar' | 'subway';
  kind: 'observable' | 'outage' | 'no-reports';   // e.g. silent Line 5/6
}

interface RollupRow {                 // one directional stop, one 5-minute bucket
  bucketStart: number;                // epoch ms, floored to 300 s
  stopId: string;
  n: number;                          // touches
  headwaySum: number; headwaySumSq: number;   // mergeable moments
  maxGapSeconds: number;              // worst intra-bucket wound
  firstTouchAt: number | null; lastTouchAt: number | null;
  backToBack: number;                 // sub-45 s services
  distinctVehicles: number;
  routeIds: string[];                 // compact; 3xx visible for night labelling
  coverageBits: number;               // was the feed watching this bucket?
}
```

### 4.4 The recorder loop (singleton DO, every 30 seconds)

```
alarm(tick)
 ├─ fetchRailSnapshot()            both feeds in parallel; failure → coverage interval
 ├─ streetcar touches             match each fresh fix → edge ± direction → stops in radius
 ├─ subway touches                train's first-upcoming station advanced X→Y ⇒ touch(X)
 ├─ dwell dedupe                   (vehicle, stop) within ~2 min = one service, not five
 ├─ persist to DO SQL             window rows + coverage rows
 ├─ prune                          events older than 30 min
 ├─ every 5 min: fold              age-complete buckets → one idempotent D1 batch
 └─ hourly: prune rollups          older than 36 h
```

Subway touch semantics: predictions are not GPS. A touch for station X is emitted when
a train's first upcoming station advances past X, timestamped at
`max(X.arrivalAt, train.observedAt)`; idempotent per (train, station); skipped and
cancelled stations are already excluded by the decoder; a train first seen mid-route
never gets fabricated touches for stations it passed before first sight. Silent
Line 5/6 feeds are coverage gaps, not evidence of anything.

Recorder modes: `always` (default — the entire point is measuring delivery nobody is
watching) vs `demand-warm` (arm on first viewer, keep warm N minutes) — controlled by
configuration, decided before Epic 1 ships.

### 4.5 Fold and retention mechanics

- **Exactly-once folding.** `bucketId = floor(t / 300 s)`; a bucket folds when its end
  is fully older than the 30-minute window. The fold is a deterministic content hash
  written with `INSERT OR REPLACE`, so a DO restart that re-derives a bucket from
  surviving raw rows produces the identical row — idempotency by construction, and the
  DO SQL window store (not memory) means an isolate eviction doesn't hole the window.
- **36-hour rolling retention.** `SERVICE_HISTORY_HOURS = 36`, pruned hourly by the
  recorder itself (no new cron; it's already always on). Roughly 700–900k rows steady
  state — comfortable for D1 with `(bucketStart)` and `(stopId, bucketStart)` indexes.
- **Time.** Everything internal is epoch milliseconds (UTC); any "day" rendering uses
  `America/Toronto`.

### 4.6 Failure and honesty semantics

1. **Feed down** → coverage interval `outage`; affected stops render *unmonitored*.
2. **Feed up, no reports** (silent Line 5/6) → `no-reports`; same unmonitored handling,
   distinct diagnostic.
3. **Stale observations** (>2 min old, the existing fleet rule) never generate touches.
4. **Terminal layovers** don't count as five services (dwell dedupe).
5. **New/changed network version** → stop IDs are GTFS-stable; statistics and rollups
   survive version flips; genuinely new stops show *collecting* until 3+ touches exist.
6. **Never fabricate.** The system's credibility rests on unmonitored ≠ unserviced.

### 4.7 Feature flags: the per-user debug overlay

The polished overlay is the future product; the debug overlay is scaffolding, and
scaffolding shouldn't ship to everyone. Flags are keyed by Clerk-verified account
email, following the `map:tag` precedent for operator CLIs:

```bash
npm run feature:enable  voidOverlay drew@easleyowl.com
npm run feature:disable voidOverlay drew@easleyowl.com
npm run feature:list
```

`scripts/operations/feature-flags.ts` writes to the `feature_flags` D1 table through a
remote D1 binding. `GET /api/v1/me/features` (Clerk-authenticated, the existing
`/api/v1/me/*` machinery) returns the caller's enabled flags; a `useFeatureFlags` hook
gates the overlay. Signed-out users and everyone else see nothing. When the polished
overlay epic arrives, the same backbone gates progressive rollout.

---

## 5. Epics and stories

Sizes: **S** ≤ a day, **M** a few days, **L** a week-ish. Story order within an epic is
dependency order. Epics 1 + 2 in parallel once contracts (1.1) land; 3 and 4 follow;
5 can start as soon as 3.1 exists (the overlay can develop against fixtures).

### Epic 1 — The Recorder: a rolling 30-minute record of delivered service

**Outcome:** a singleton Durable Object samples both feeds every 30 seconds and
maintains a direction-aware, coverage-honest touch log with 30-minute retention.

| # | Story | Size |
| --- | --- | --- |
| 1.1 | Contracts + DO scaffold. Add `shared/service/contracts.ts`; `ServiceRecorder` DO class + wrangler binding; 30 s alarm loop calling `fetchRailSnapshot()`; tick telemetry (last tick, duration, upstream status) surfaced in auth'd `/api/v1/feed/status`. **Done when:** the alarm ticks every 30 s ± tolerance with zero viewers; duplicate ticks after eviction are idempotent; upstream failures are recorded, never fabricated. | M |
| 1.2 | Network bootstrap in the DO. Load the active version's directional stops (IDs, coordinates, route membership, pattern order) and edges into DO storage; reload on version change. **Done when:** a nightly version flip mid-window loses no touches for unchanged stop IDs; cold start completes within a bounded tick count. | M |
| 1.3 | Streetcar touch detection. Per fresh observation: `matchGpsToTrack` with previous-edge continuity; touch when within `SERVICE_TOUCH_RADIUS_METRES` (~40 m, config) of a directional stop served by the vehicle's route; direction from matched edge ± trip corroboration; low-confidence assignments flagged `ambiguous`; same-sample multi-vehicle touches recorded at `h ≈ 0`; dwell dedupe. **Done when:** a fixture with nearside opposite-direction platforms never credits the wrong direction; layover at a terminal counts once. | L |
| 1.4 | Subway touch detection. Prediction-aging touches per §4.4; idempotent per (train, station); sequence-based direction; no fabricated pre-sight or skipped stations; silent Line 5/6 becomes `no-reports` coverage. **Done when:** flapping predictions don't double-count; a feed restart mid-route produces no phantom touches. | M |
| 1.5 | Window store + pruning. DO SQL persistence for touches and coverage intervals; prune older than 30 min. **Done when:** isolate eviction/redeploy preserves the window; per-tick pruning work stays bounded. | M |
| 1.6 | Recorder-core purity + test harness. All of 1.3–1.5 logic lives in the pure state machine; DO shell stays thin. **Done when:** the SQLite-harness test suite exercises direction assignment, dwell dedupe, subway aging, and coverage transitions without a DO runtime. | M |
| 1.7 | Ops + data citizenship. README *Data citizenship* update (constant 2,880 upstream polls/day, typically below today's busy-period per-isolate fan-out); recorder mode configuration decided and documented. | S |

### Epic 2 — The Math: one pure, exhaustively-tested statistics module

**Outcome:** every number the system shows is computed by one shared, pure module that
server, tests, and UI agree on.

| # | Story | Size |
| --- | --- | --- |
| 2.1 | Headway extraction with censoring. Direction-scoped; window-edge and ongoing-gap censoring per §3.6. **Done when:** known sequences produce known headway sets; censored gaps are excluded from moments but counted in coverage. | S |
| 2.2 | Renewal wait `E[W] = Σh²/2Σh`, with small-sample shrinkage toward the stop's delivered baseline. **Done when:** clockwork service yields `E[W] = H̄/2`; the doc's §3.2 table (10/10 vs 1/19) reproduces exactly as a unit test. | M |
| 2.3 | Conditional residual `R(e)` — empirical estimator with gamma-MoM smoothing for thin data. **Done when:** even service counts down toward 0; bunched data makes `R(e)` grow with elapsed time; thin data shrinks smoothly instead of thrashing. | M |
| 2.4 | Two-axis dryness + states. `r = e/H̄_own` plus absolute minutes; states `fresh / due / void / unmonitored / collecting`; thresholds in config. **Done when:** a legit night-service fixture stays calm; an all-day-disaster fixture still shows its absolute minutes; coverage gaps render *unmonitored*, never void. | M |
| 2.5 | Back-to-back marker. Sub-45 s count including same-sample dual touches; descriptive display only. **Done when:** a scripted bunch fixture yields the expected counts at the expected stops. | S |
| 2.6 | Self-baseline sourcing. Window moments when rich enough; merged rollup moments (Epic 4) as the stabilizer; *collecting* below 3 touches. **Done when:** baseline selection is deterministic and covered by tests at each tier boundary. | S |
| 2.7 | Moment merging for rollups. Exact merge of `n, Σh, Σh²` across buckets; gamma-approx quantiles labelled as approximations; cross-bucket gap reconstruction. **Done when:** a folded day's merged `CV²` equals the value computed from raw events in a fixture, to the epsilon the doc promises (exactly, for moments). | M |
| 2.8 | Ground-truth scenario corpus. Deterministic fixtures: clockwork, single bunch, one-directional void, terminal dwell, night service, feed outage. **Done when:** each fixture's expected outputs are asserted end-to-end; the corpus doubles as overlay development data. | M |

### Epic 3 — The Service API: live delivered-service state

**Outcome:** public, cached, CORS-friendly endpoints serving live state and wave data
with the fleet-endpoint conventions.

| # | Story | Size |
| --- | --- | --- |
| 3.1 | `GET /api/v1/service/stops`. Per directional stop: `lastTouchAt`, `minutesSince`, `medianHeadwayOwn`, `irregularity (CV²)`, `expectedWait R(e)`, `dryness r`, `state`, coverage badge; `?routes=` filter; ETag/304 per tick; edge cache ~15 s; `X-Live-*` headers. **Done when:** payload contract tests pass; a 30 s tick changes ETags; budgets (~3 k stops) stay within the fleet endpoint's size discipline. | M |
| 3.2 | `GET /api/v1/service/wave`. Delta-encoded windowed touch lists powering the replay/debug views. **Done when:** one request reconstructs the full 30-minute space-time plot for a route; ETag caching verified. | S |
| 3.3 | Contract + budget tests mirroring the vehicles-endpoint suite, including 304/ETag and filter behaviour. | S |

### Epic 4 — Rollups and history: 36 hours of mergeable truth

**Outcome:** every touch that leaves the window survives as exactly-mergeable 5-minute
statistics for a rolling 36 hours.

| # | Story | Size |
| --- | --- | --- |
| 4.1 | Fold mechanics. On each 5-minute boundary, fold age-complete buckets into D1 idempotently (deterministic hash, `INSERT OR REPLACE`); coverage bits included. **Done when:** refolding after a DO restart produces byte-identical rows; folding failures alarm without data loss (raw rows still within 30 min… see 4.5). | M |
| 4.2 | Rollup storage + retention. `migrations/0005_service_rollups.sql`: rollup table with `(bucketStart)` and `(stopId, bucketStart)` indexes; 36-hour rolling prune on the recorder's hourly tick; `SERVICE_HISTORY_HOURS` config. **Done when:** steady-state row count and prune cost stay bounded; a day of history is queryable after 36 h of continuous operation. | M |
| 4.3 | `GET /api/v1/service/history`. Merged-moment summaries per stop or route over any sub-window of the 36 h (`?stop=`, `?routes=`, `?from=`); cache 1–5 min. **Done when:** merged `CV²` from this endpoint matches the fixture ground truth exactly. | M |
| 4.4 | History tests. Fold sums equal raw sums; cross-bucket max-gap reconstruction finds a scripted multi-bucket wound; retention prunes only expired rows. | S |
| 4.5 | Fold-failure grace. If D1 writes fail, raw rows age out per policy but the failure is loudly visible in diagnostics; the 36-hour window means yesterday survives an overnight fold bug (the reason this number is 36). **Done when:** a fault-injection test shows the alarm, not silence. | S |

### Epic 5 — The Void Overlay: debug-first, feature-gated

**Outcome:** the map proves the pipeline. Ugly is a feature: this is scaffolding for the
future polished overlay, gated to named users.

| # | Story | Size |
| --- | --- | --- |
| 5.1 | Feature-flag backbone. `feature_flags` table + migration; `scripts/operations/feature-flags.ts` CLI (`feature:enable / disable / list` via remote D1 binding); `GET /api/v1/me/features`; client `useFeatureFlags` hook. **Done when:** `npm run feature:enable voidOverlay drew@easleyowl.com` makes the overlay appear for that signed-in account only; signed-out and other users see nothing; flag listing shows who has what. | M |
| 5.2 | Debug overlay v0. With `voidOverlay` enabled: per-stop directional dryness rendering (split markers for the two directions), absolute-minutes labels, back-to-back badges, hatched *unmonitored* styling distinct from void, minimal legend. **Done when:** all five states are distinguishable at a glance; reduced-motion respected; no measurable pan/zoom regression with the layer on. | M |
| 5.3 | Space-time replay (debug panel). Route-scoped touch-dot diagram from `/service/wave` with a scrubber: back-to-back clusters and the empty wedge — the wave of void as pure geometry. **Done when:** the scripted bunch fixture renders the wedge; scrubbing is smooth on the 30-minute window. | M |
| 5.4 | Stop "today so far" sparkline (debug). From `/service/history`: per-bucket touches/gaps for the selected stop's directions. **Done when:** the 36-hour window renders coherently across the 5-minute grain. | S |

Explicitly **not** in this epic: polish, animation artistry, mobile ergonomics. The
polished overlay is its own future epic; every hour saved here is an hour earned there.

### Epic 6 — Hardening, observability, rollout

| # | Story | Size |
| --- | --- | --- |
| 6.1 | Analytics Engine aggregates. Per-tick counters (touches by mode, coverage minutes, void-minutes observed, upstream status) into the existing `ttcstatus_metrics` dataset — long-term trends with zero event retention. | S |
| 6.2 | Docs. README public-API entries, data-citizenship numbers, CODEMAP rows, links to this document; `/service/*` marked experimental-until-overlay-polished. | S |
| 6.3 | Browser tests. Fixture-intercepted `test:service` covering overlay states, flag gating, night vs day, unmonitored vs void, using the Epic 2 corpus as fixtures. | M |
| 6.4 | One-week soak review. Cost, tick health, fold correctness and payload sizes reviewed against the day view before any polish epic starts. | S |

---

## 6. Testing strategy in one paragraph

The math module is tested like a math library: every formula in §3 has a fixture whose
expected value is derived by hand (the §3.2 table *is* a test). The recorder core is a
pure state machine exercised through the existing SQLite test harness — no DO runtime
needed to test direction assignment, dwell dedupe, subway aging, or coverage. The
ground-truth corpus (2.8) is deterministic, so the overlay, API, and history endpoints
are all tested against the same known scenario — a scripted bunch on a corridor with a
one-directional void — and every layer must agree with every other layer about what
happened. The DO shell is deliberately thin enough that its untested surface is
plumbing only. Browser tests intercept the API with the same fixtures; nothing in the
test stack ever needs the live TTC feed.

## 7. Data citizenship and cost

The recorder polls both upstream feeds once every 30 seconds — 2,880 acquisition cycles
per day, constant, replacing today's per-isolate demand polls during busy periods (100
viewers already drive ~3.3 snapshot requests/second through shared caches). Off-peak it
is new but trivial and constant traffic to the public Open Data feeds, attributed
exactly as everything else in this repo. Storage: raw events live 30 minutes; rollups
are one small D1 row per directional stop per 5 minutes with 36-hour retention; nothing
else persists. The Workers Paid plan (already required for the nightly import) covers
the Durable Object; the singleton's alarm, storage, and D1 batch costs are bounded and
reviewed in 6.4.

## 8. Rollout

1. Epics 1–2 land behind no user-visible surface; diagnostics verify against the live
   map by eye.
2. Epic 3 endpoints ship public but marked experimental.
3. Epic 5.1–5.2 gates the debug overlay to named accounts (`npm run feature:enable
   voidOverlay drew@easleyowl.com`).
4. Epic 4 completes the 36-hour history.
5. The soak review (6.4) is the gate to the future polished-overlay epic.

## 9. Decisions log

| Decision | Choice | Rationale |
| --- | --- | --- |
| Promises vs delivery | **Measure only delivery** | TTC's expectations are deliberately excluded. We show what arrived. (A "promised vs delivered" comparison can return later as a lens on top of this data — it is additive, not foundational.) |
| Raw retention | 30 s samples, rolling 30 min | The brief; the live/rescale window the overlay and replay need. |
| Rollup grain | **Per directional stop**, 5 minutes | Directionality must survive (a void can be one-way); per-stop rows keep the schema flat. |
| Rollup retention | **36 hours rolling** | Grace: a full day of history survives an overnight breakage of our own making. |
| Rollup statistics | Moments (`n, Σh, Σh²`) + maxGap + coverage | Mergeable *exactly*; medians don't merge; variance is the bunching signal. |
| Night/day handling | Self-relative baselines, not schedules | The data calms night service itself; 3xx routes stay distinct identities. Blue Night numbers are labelling, not expectations. |
| Bunch detection | **None, permanently** | The waiting-time paradox converts bunching into measurable wait inflation without a detector to tune or fool. |
| Recorder | Singleton Durable Object, 30 s alarms, DO SQL storage | Cron bottoms out at 1 minute; the singleton is the one global poller; SQL survives eviction. |
| Overlay v0 | Ugly, per-user feature-gated, on-map | The map is the product's home; polish is a future epic; scaffolding shouldn't ship to everyone. |
| Coverage rule | Unmonitored ≠ unserviced, always | One fabricated void destroys the credibility of every real one. |

## 10. Non-goals

- No schedule ingestion, no `stop_times`/calendar parsing, no promise metrics.
- No arrival *predictions* — we measure the past, we do not forecast.
- No bunch classifier, now or ever (see §9).
- No persistence beyond 36 hours (Tier 3 is a future decision, not a hidden default).
- No polished UI in this release — the debug overlay exists to prove the pipeline.
- No changes to the snake game, the map generator, or the static sync pipeline.

## 11. Future hooks (explicitly not now, but the math is already pointing at them)

- **The promise lens.** With delivered baselines in hand, overlaying actual scheduled
  headways becomes a comparison layer — "promised vs delivered" — built entirely on
  this foundation.
- **Wave velocity.** Cross-correlating dryness peaks across a route's ordered stops
  estimates how fast a void propagates — the wave's speed and lifetime as measured
  quantities, still without detecting anything.
- **Bunching instability, measured.** The classic theory says a pair's gap *grows* along
  a corridor (forward instability: the lead car collects passengers, slows, gets
  caught). Our rollups support regressing gap width against distance-along-route — an
  empirical estimate of the instability growth rate for a real transit system, from
  delivery data alone. This is the PhD-flavoured flex; it costs one query over rollups
  we already store.
- **Tier 3.** Hourly/daily per-route summaries for week-over-week storytelling.
- **The polished overlay.** The real product home: the wave of void as a first-class
  map experience, built on data this release will have proven.

---

*Every number in this system is something a vehicle actually did. The math's job is
to make sure the map feels what the rider felt.*
