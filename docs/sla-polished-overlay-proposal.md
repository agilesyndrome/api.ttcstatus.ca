# Proposal: the polished overlay epic (story E6S6 — the Stage 4 hand-off)

The Stage 4 close.

> **Status update (2026-10-14):** all four delivery stories in this epic have
> shipped —
> E7S1 (the dream overlay: the wave visible as a live/scrubbable dryness
> field, wait-timer markers, plain-language stop stories) and E7S2 (the
> animated sweep "▶ watch" + the real-time heartbeat, under the rule that
> motion comes only from measured data), followed by E7S3–E7S6 below. The
> existing responsive panel remains the mobile boundary recorded in scope.
> The debug overlay proved the pipeline; this is the
> proposal for the real product home: **the wave of void as a first-class map
> experience.**

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

## Scope of the polished epic

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

## Delivery stories

These are the four implementation stories for this hand-off. The check marks
are completion records, not predictions; each one links to the code and check
that make the result reviewable.

### E7S3 — Live overlay visual language ✅ DONE

**Status:** ✅ Done — 2026-10-14 · verified by the service field unit suite,
`npm test`, and `npm run typecheck`.

- [x] Five states have distinct track and stop treatments, including the
      hatched unmonitored state, which never becomes a void.
- [x] Directional truth stays split at selected stops; route and compass
      controls preserve the platform and travel direction.
- [x] Absolute wait minutes use tabular numerals and plain language in the
      selected stop story.
- [x] `prefers-reduced-motion` disables field flow and marker pulse while the
      data field and direction cues remain available.

Evidence: `web/ui/features/service/wave-field.ts`,
`web/ui/features/service/SelectedStopMarker.tsx`,
`web/ui/features/service/StopCard.tsx`, and `web/ui/styles/service.css`.

### E7S4 — Honest wave and replay interaction ✅ DONE

**Status:** ✅ Done — 2026-10-14 · verified by the wave-field unit suite and
the full `npm test` run.

- [x] The field is interpolated on track edges from measured stop states.
- [x] The live heartbeat advances elapsed wait time only while the page is
      active and schedules the next real state transition.
- [x] Replay data remains available through the existing history/wave seams;
      CSS flow animation is disabled when reduced motion is requested so any
      replay movement stays under rider control.
- [x] Subways and stale or unmeasured data never create a fabricated service
      verdict.

Evidence: `web/ui/features/service/ServiceLayer.tsx`,
`web/ui/features/service/TrackService.tsx`, `web/ui/features/service/wave-field.ts`,
and `tests/service/wave-field.test.mjs`.

### E7S5 — Stop “today so far” chart ✅ DONE

**Status:** ✅ Done — 2026-10-14 · verified by the service API and UI service
tests in the full `npm test` run.

- [x] The selected stop loads the 5-minute bucket series only when details
      are expanded.
- [x] The 36-hour window is rendered as a deterministic SVG micro-chart with
      touch bars and worst-gap emphasis.
- [x] Tooltip text names the time, touch count, worst gap, and back-to-back
      count; it does not present the gamma quantile approximation as an observed
      value.

Evidence: `web/ui/features/service/Sparkline.tsx`,
`web/ui/features/service/SelectedStopCard.tsx`, and
`workers/api/src/service/responses.ts`.

### E7S6 — Progressive rollout controls ✅ DONE

**Status:** ✅ Done — 2026-10-14 · verified by the feature flag unit suite.

- [x] Named grants remain available through the existing `feature:enable`,
      `feature:disable`, and `feature:list` commands.
- [x] Percentage cohorts are stored separately in migration `0010`, updated
      idempotently with `feature:enable FLAG --percent N`, and removed with
      `feature:disable FLAG --percent`.
- [x] Cohort assignment uses the verified Clerk user id and a deterministic
      0–99 bucket, so retries do not move a user between cohorts.
- [x] `/api/v1/me/features` combines explicit grants and cohort membership,
      returns sorted flags, and keeps `no-store` response semantics.

Evidence: `migrations/0010_feature_flag_cohorts.sql`,
`shared/accounts/feature-flags.ts`,
`workers/api/src/accounts/features.ts`,
`scripts/operations/feature-flags.mjs`, and
`tests/service/feature-flags.test.mjs`.

The public overlay transport remains controlled by its cacheable launch
configuration. Cohort evaluation is available on the authenticated flag
surface without putting user-specific state into that public response.

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
