# Proposal: the polished overlay epic (story E6S6 — the Stage 4 hand-off)

The Stage 4 close. The debug overlay proved the pipeline; this is the
proposal for the real product home: **the wave of void as a first-class map
experience.**

## What the soak taught us

- The data layer is done and trustworthy. Live verification measured 98 real
  voids on the network at sampling time, with both truth axes (absolute
  minutes, self-relative dryness) present per stop, and merged history whose
  moments reconcile exactly.
- Riders will feel what the math shows: the live CV² spread (0.07–0.78 across
  route-506 stops) is precisely the bunching tax the waiting-time paradox
  predicts. The story a polished overlay tells is already sitting in
  `/api/v1/service/*`, marked experimental.
- The deliberately ugly debug layer (`VoidOverlay`, replay, sparkline,
  per-user gated) is scaffolding to be replaced, not iterated on — every hour
  saved on it is an hour earned for the real thing.

## Scope of the polished epic (proposed)

1. **The live overlay as design, not debug** — the five states rendered as a
   coherent visual language (the hatched-unmonitored-never-void rule stays
   non-negotiable), split-direction treatment, absolute-minutes labels with
   typographic care, and reduced-motion as a first-class mode.
2. **The wave of void, animated honestly** — the dryness field sweeping
   through a corridor as a light-touch animation, driven by the existing
   wave data; scrubbing the replay stays manual-under-reduced-motion.
3. **Stop "today so far"** as a polished micro-chart, with the gamma-approx
   quantiles kept clearly labelled as approximations.
4. **Progressive rollout** on the existing `feature_flags` backbone — the
   same `npm run feature:enable` flow, extended to percentage cohorts when
   needed.

Explicitly deferred (same discipline as Stage 2–4): mobile ergonomics beyond
the existing responsive panel, and any bunching _detector_ — permanently
(§9).

## sla.md §11 future hooks — which earned their place

| Hook                                                                             | Verdict                                                                                                                                                                                                                                  | Evidence |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **The promise lens** (promised vs delivered comparison)                          | **In.** Purely additive: delivered baselines are proven; layering scheduled headways on top is a lens, not a foundation change. The corpus and API leave clean seams for it.                                                             |
| **Bunching instability, measured** (gap growth along the corridor)               | **In — it's one query.** Rollups already store ordered, mergeable moments; regressing gap width against distance-along-route costs one history query and gives the PhD-flavoured flex a real number to stand on.                         |
| **Wave velocity** (cross-correlating dryness peaks)                              | **Later.** Cheap to compute from rollups, but needs the polished corridor view first to mean anything visually. Revisit after the overlay ships.                                                                                         |
| **Tier 3** (weeks of summaries)                                                  | **Out for now.** A deliberate product decision when the day view has users, per the repo's history principle.                                                                                                                            |
| **Recorder as the single global poller** (replacing demand-driven isolate polls) | **Not yet.** Post-soak decision per the stages doc; the soak numbers here (2,880 constant cycles/day, ~0.4 s CPU/tick) make it plausible, but it changes the vehicles endpoint's failure story and should wait for production telemetry. |

## Go/no-go

**GO** — recorded 2026-10-09, provisional on the production soak items in
the deployment-pending ledger (7-day continuous soak, remote migrations,
end-to-end flag grant on the deployed stack). Everything decidable without a
deploy has been decided on evidence.

_Every number in this system is something a vehicle actually did. The
polished overlay's only job is to make sure the map feels what the rider
felt._
