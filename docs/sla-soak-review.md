# SLA one-week soak review (story E6S4)

> **Honest scope note.** This review was produced under a strict
> **no-deploy constraint**: everything below was measured on the local
> `wrangler dev` stack with the real TTC feeds and the real local D1, or in
> the SQLite test harness. The seven-day _production_ soak, real Cloudflare
> billing, and remote D1 behaviour remain pending a deploy; the runbook for
> closing each of those is in the [deployment-pending ledger](sla-chatter.md).
> Everything that could be proven locally is proven below.

## What ran

- The recorder singleton, live: the full pipeline (feeds → pure core → window
  store → states → folds → D1 rollups → endpoints) ran against the **real**
  TTC vehicle and subway feeds in `wrangler dev`, unattended, for the length
  of this work session.
- The ground-truth corpus and its end-to-end assertions (every hand-derived
  expectation), the recorder epic's 14-test harness suite, the API contract
  suite, the fold/retention/grace suite, and the Playwright browser check.
- The pre-flight board: **9/9 green** (lint, format, boundaries, typecheck,
  tests, builds).

## Measured evidence

| Concern                  | Measured (local, live feeds)                                                                                                                                                                                                                                                                     | Verdict                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Tick cadence & drift     | Median 30.000 s, max grid offset **16 ms** over the sampled ticks; duplicate/late alarms are provable no-ops (tickId idempotency)                                                                                                                                                                | ✅ Well inside the 10 s tolerance (~600× headroom)  |
| Tick work                | **368–403 ms** per tick at full live-network scale: both feed fetches, detection over ~700 vehicles, window persistence, pruning, per-stop states for 634 directional stops, void counting, analytics counters                                                                                   | ✅ ~1.3 % duty cycle per 30 s tick; CPU limit 300 s |
| Touch volume             | ~3,300–3,400 touch events inside the rolling 30-minute window at busy midday                                                                                                                                                                                                                     | ✅ Bounded by construction (window prune each tick) |
| Fold correctness         | 2,529 rollup rows written to local D1 by the live fold; refold byte-identical (harness-proven with the deterministic content hash); the leading-gap design counts every consecutive pair exactly once; a scripted 40-minute multi-bucket wound is findable both in rows and through the endpoint | ✅ Fold sums equal raw sums, exactly                |
| Retention                | The hourly prune removes only rows older than `SERVICE_HISTORY_HOURS`; steady-state growth ≈ 420 rows per 5-minute bucket ≈ 5k rows/hour peak, well under the doc's 700–900k/36 h ceiling (that ceiling assumed every stop active; the real folded set is per-stop-with-activity)                | ✅ Bounded                                          |
| `/service/stops` payload | 634 live states with all five states present (269 due, 236 fresh, 98 void, 31 collecting) — the payload budget test holds the worst case (3,000 active stops) under 1 MB with wire rounding                                                                                                      | ✅ Within the fleet-endpoint discipline             |
| `/service/wave`          | 10 route patterns served per request; 228–281 touch dots per pattern over the 30-minute window — one request reconstructs the plot                                                                                                                                                               | ✅                                                  |
| `/service/history`       | 112 route-506 stops with real merged moments (mean headways 180–457 s, CV² 0.07–0.78 — genuine bunching signal in the live data); merged CV² matches folded ground truth exactly in tests                                                                                                        | ✅                                                  |
| Honesty rules            | Unmonitored ≠ void enforced end-to-end: coverage runs open/close per mode, outages and silent Line 5/6 recorded, `unmonitored` rendered hatched and never as void (browser-verified)                                                                                                             | ✅ Non-negotiable rule holds                        |
| Overlay gating           | Flag off ⇒ **zero** `/service/*` requests (browser-verified); flag on ⇒ all five states distinguishable at a glance, split directional markers, night-vs-day calm, reduced-motion respected, zoom intact                                                                                         | ✅                                                  |
| Fold failure grace       | Fault injection: `FoldError` surfaces in telemetry (`foldFailures`, `lastFoldError`) and console — the alarm, not silence; the marker never advances; the healed next tick folds the missed buckets                                                                                              | ✅                                                  |

## Cost model (local evidence; production billing pending deploy)

- Acquisition: 2,880 cycles/day constant, both feeds in parallel per cycle —
  typically below today's busy-period per-isolate fan-out (~3.3 snapshot
  requests/second at 100 viewers). Documented in the README's data
  citizenship.
- Durable Object: one singleton; per tick ≈ 0.4 s CPU, SQL writes bounded by
  the window (~3.4k rows rolling), hourly rollup prune.
- D1: fold batches ~5k rows/hour peak through the measured insert shape
  (7-row multi-row INSERTs, ~19 ms per 2,000-row worst case, idempotent).
  History queries require a stop or route filter by design.
- Analytics Engine: one `writeDataPoint` per tick; zero event retention.

## Findings

1. The pipeline is **quietly measuring real delivery**: 98 voids observed on
   the live network at the moment of sampling, with absolute minutes and
   self-relative dryness both present. The product's premise — the wave of
   void revealed, not detected — is demonstrated on production-shaped data.
2. The math is the strongest part of the system: every corpus expectation,
   including the §3.2 waiting-time table, is locked by tests; the live CV²
   values (0.07–0.78 across real stops) land exactly where the theory says
   bunching should put them.
3. One real bug was found and fixed by live verification: the DO route paths
   (`/service-recorder/states` vs `/states` — the DO name belonged in the
   hostname). Live serving of every endpoint is now verified, not just
   unit-tested.
4. Payload discipline holds; wire rounding was added during the epic to keep
   the worst case comfortably inside the fleet endpoint's size discipline.

## Open items (production)

The remaining verification is exclusively deploy-shaped and tracked in the
deployment-pending ledger: the 7-day continuous production soak against real
billing, the remote D1 migration apply (via the normal deploy pipeline), and
the end-to-end flag grant on the deployed stack. The Stage 4 exit decision
below is recorded as **provisional GO**, to be confirmed by that soak.

## Verdict

The day view, the honest history, the wave of void on real data, and the
per-user-gated debug overlay all work. **GO** (provisional on the production
soak) for the polished-overlay epic — see
[sla-polished-overlay-proposal.md](sla-polished-overlay-proposal.md).
