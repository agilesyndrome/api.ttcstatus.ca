# Service colour proposal v3 — gradient legend, mode-owned colour, chevrons, invisible smoothing

Status: **proposal — no code written yet.** Supersedes v2. Decisions locked by the
owner since v2: the legend is a gradient bar; colour ownership switches by map
mode; chevrons are the direction system (and the only motion channel); small
no-data stretches are smoothed over **invisibly and silently** — no inferred-value
showcase, no soft styling, no caveats, no mention of inference on any user-facing
surface (the inferences are minor; the map just reads as one continuous field);
and the map never _computes advice_ (no walk-hints,
no "take the other route" verdicts) — the map's own paint must let riders infer
relief and compare corridors themselves. Source of the review: three 8:53–8:54
screenshots of the Roncesvalles–Queen–King, College–Dufferin and Dundas–Gladstone
corners against `web/ui/features/service/wave-field.ts`.

---

## 0. The diagnosis, restated in one line

The map runs two colour languages at once — route identity (501 Queen red
`#cf3f48`, 504 King orange `#de762c`, 506 Carlton green `#4c8662`, from
`shared/map/palette.ts`) and service health (`STATE_COLORS` green/amber/red/grey
in `wave-field.ts`) — while painting a continuous sRGB gradient whose midpoints
(olive, salmon, maroon) appear nowhere in the 4-swatch legend.

## 1. Design principles

1. **One owner of hue per mode.** Colour confusion is resolved by _mode_, not by
   repainting one system to dodge the other.
2. **The map informs; it never advises.** No computed walk-hints, no alternate-
   route verdicts, no card lectures. The paint itself must make "the green
   relief is two blocks west" and "the crossing street is doing better" visible
   enough to infer at a glance.
3. **Colour is never the only channel** — direction gets chevrons, severity gets
   a position on a labelled scale, lightness ranks even in greyscale.
4. **The rider's question is the metric** — the legend speaks minutes for _their_
   route's rhythm; the paint stays self-relative so frequent and infrequent
   corridors stay comparable and honest.
5. **Smoothing is a rendering act, not a data claim.** Paint may interpolate
   between real measurements over bounded spans; stop-state machines, cards and
   SLA math are never touched.
6. **Accessibility is opt-in, not separate** — colourblind palettes are a first
   class setting, saved to the profile, applied everywhere the ramp appears.

## 2. Mode model — who owns colour where

The three-way control already exists (`ExplorePanel.tsx`: `off / vehicles /
service`; persisted in `default-view.ts`). Colour ownership becomes mode-dependent:

| Mode (`live` + `serviceOverlay`)        | Track base                                                  | Streams/pills                                                                                                              | Legend                   |
| --------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Service** (`live ✓, overlay ✓`)       | Neutral hairline casing (grey) — route colours step back    | Service ramp owns hue; route identity = **numbered pills along the corridor** (like street-name labels)                    | Single gradient bar (§3) |
| **Vehicles only** (`live ✓, overlay ✗`) | Route colours own the tracks — the classic transit-map look | Vehicle markers in route colour; **chevrons in route colour** show travel direction (§4); route pills optional (redundant) | Route colour key (§2.1)  |
| **Map only** (`live ✗`)                 | Route colours own the tracks                                | Nothing live                                                                                                               | Route colour key         |

- In Service mode the pills carry the route number + a small route-colour chip,
  so identity survives without flooding the canvas with red/green/orange lines.
- The legend **always swaps with the mode** — never show the service gradient in
  vehicles-only mode. This single rule kills the "is that red Queen or a gap?"
  ambiguity by construction, not by tuning.
- **Unmonitored corridors in Service mode** (edges with no anchored stops) paint
  a **dotted-neutral casing** — visible, obviously-not-data, and never
  re-importing route colour (which would undo Service mode's hue monopoly).
- Subway handling is unchanged (`E7S7`): subway tracks never join the service
  field; in Service mode they keep route colours with pills, which now _reads_
  as "no service verdict here."

**Pills:** drawn like street-name labels — rounded chip, halo, route number in
route colour, e.g. `⬤ 501`. Placement reuses the live map's label layer;
collision-avoid with stop labels (§6). Pills **respect the existing
`filters.labels` toggle** (hidden when labels are off; direction stays carried by
chevrons). In vehicles/map-only mode pills are optional/redundant and default off.

### 2.1 The route colour key (new component)

Vehicles/map-only modes promise a "route colour key" that nothing today renders.
Add a small legend component listing visible routes with their colour chips
(grounded in `shownRoutes`, so filters already apply). Tracked as its own task in
the phase table; without it the mode-swap rule is unimplementable.

## 3. The gradient-bar legend

Replace the 4-dot `map-service-legend` (`HomeWorkspace.tsx`) with a **continuous
gradient bar that literally shows the paint**:

- **Rendering:** the bar's CSS gradient is generated from `drynessColor` itself
  (sampled stops across the ramp). Legend can never drift from the map — same
  function, one source of truth.
- **OKLCH ramp (restored from v1 — it was correct):** interpolation moves out of
  sRGB (whose green→amber midpoint is the olive mud visible in every screenshot)
  into OKLCH, with **monotone lightness** across the ramp (light green → amber →
  red → deep crimson) so severity ranks correctly even in greyscale — which is
  also the colourblind fallback. Precomputed perceptual anchors are acceptable if
  runtime OKLCH mixing is too costly; the _look_ is the contract.
- **Far-end compression fixed:** the bar samples dryness 0 → 2.5 and ends in a
  **"≥ 2× the usual" break notation**, so the most severe state gets real legend
  space instead of the current 2→3.5 sliver. The maroon deepening clamp in
  `drynessColor` stays (severity keeps deepening on the map); the bar simply
  labels everything past 2× as "beyond."
- **Rider minutes without lying (the v2 contradiction resolved):** the axis is
  self-relative dryness, so _one_ minute tick would be wrong for most routes.
  Instead the bar carries a small **two-row calibration ruler** beneath it:
  - `frequent route (3-min cars): just went · ~2 min · ~6 min · 12+ min`
  - `local route (12-min cars): just went · ~3 min · ~15 min · 24+ min`
    The rider finds their row and reads real minutes. **When a route is selected**
    (the filter already exists), the legend renders **only that route's row** —
    personalized and unambiguous. The rows derive from the same boundary math the
    paint uses, so they are always consistent with it.
- **Anchors render from `serviceConfig()`** — never hardcoded copy. If ops tunes
  `SERVICE_FRESH_DRYNESS_RATIO` / `SERVICE_VOID_*`, the legend words move with
  the thresholds.
- **Interaction (tap-to-highlight):** pressing a region of the bar (or a word
  anchor) dims every stretch not in that state to ~0.15 opacity and shows a
  one-line explainer ("2× the usual wait"). Interaction is **quantised into
  buckets** even though the paint is continuous — a pressed position maps to the
  nearest bucket — and the dimming is a CSS `data-state` switch over segments,
  never per-node opacity (thousands of nodes). Release/second tap clears.
  Analytics: `legend-highlight`, `legend-row-select`.
- **Grey entry:** the grey notch at the bar's end keeps a plain **"No data"**
  label. The only grey on the map is genuine blindness — a bridged stretch is
  never grey and never styled differently — and no UI surface (legend, card,
  tooltip, aria text) mentions inferred values. The smoothing is silent (§5).

## 4. Direction — the chevron system (the flagship; only motion channel)

Never collapse twin streams. Direction gets a first-class channel, and **the
flow-dash animation dies**: chevrons _are_ the motion channel (one animated
system per stream, not two competing ones).

- **Glyphs:** small chevrons (▸) riding each stream, pointing in the stream's
  travel direction, spaced one `DASH_CYCLE` apart and phase-synced so a corridor
  pulses as ONE continuous current.
- **Screen-space sizing:** chevrons size in screen pixels (not world units) so
  they stay legible across zooms; a segment renders chevrons only when it is
  long enough on screen to carry at least one spacing cycle (the E5S2 gate,
  reused).
- **Motion:** at street zoom chevrons drift forward at the state's speed
  (`FLOW_SECONDS` — speed IS the service, kept). At city zoom chevrons are
  **static but still directional** — direction must not be a zoom luxury, and
  this finally gives reduced-motion users a motion-independent direction cue
  (static chevrons, no drift).
- **Density strategy:** at city zoom a chevron renders per N screen units of
  stream (not per segment), gated on camera settle, so chevron DOM count stays
  bounded while direction remains visible everywhere.
- **Severity fronts:** at fresh/due and due/void boundary crossings along a
  stream, draw a subtle darker **edge tick** — a weather-front line the eye can
  track. "The green front is two blocks west of me" becomes a visible thing.
- **Termini:** arrowheads at stream ends at terminals/loops.
- **Card ↔ stream matching:** the selected-stop ring draws two half-rings, each
  tinted with that side's current colour; the card's direction rows repeat the
  same swatch + compass words ("← West · fresh"). The rider matches colour to
  side without reading the map's mind.
- **Trails:** the green clearing-trail carries chevrons too — the clearing
  car's direction of rescue reads at a glance.
- **Bounds:** per-edge chevron cap mirroring `MAX_SUBPIECES`; cull set and
  length gates as above.

## 5. No data — invisible smoothing (the "just do it" model)

Per the owner's decision, **all showcase-of-inference machinery is deleted**: no
`data-inferred` styling, no 0.65 opacity, no legend caveat about soft colours.
Bridged stretches paint at full opacity, identical to measured — visually
indistinguishable, which is the point. The smoothing interpolates between real
measurements over bounded spans; like anti-aliasing, it is a rendering act, not a
data claim. **The inferences are minor by construction** (one hidden stop between
two measured neighbours), so **nothing user-facing ever references them** — no
styling difference, no legend, card, tooltip or aria mention. The map simply
reads as one continuous field.

**Algorithm (paint-time only, inside `edgeServiceSegments`):**

1. **Classify** each blind stretch while painting an edge: measure its span
   between bounding _visible_ anchors (or edge end).
2. **Count-based bridging (self-normalising):** bridge **exactly one blind
   anchor** between two visible neighbours — the rational assumption is "one
   hidden stop behaves like its two visible neighbours," and a count rule
   adapts to local stop spacing (250–300 m downtown, 500 m+ elsewhere) where a
   fixed distance rule cannot.
3. **Distance backstop:** the one-anchor bridge is capped at
   `SERVICE_BRIDGE_MAX_METRES` (**600 m**) as a sanity bound — an unusually long
   block never gets a bridge it doesn't deserve. 0 disables bridging entirely
   (today's behaviour).
4. **One-sided bridging:** a blind run from the edge end inward holds the inner
   anchor's value across the cap, then falls back to grey beyond it.
5. **Void restraint:** if either bounding anchor is `void`, the cap shrinks to
   `SERVICE_VOID_BRIDGE_MAX_METRES` (**150 m** — under one stop spacing); beyond
   it the stretch paints grey. Interpolation is monotone between anchors, so
   bridging can never _create_ a void between healthy stops — and we never
   _accuse_ a long blind stretch of a gap either.
6. **Cross-edge bridging ships in Phase 5, not phase 2:** the grey seams in the
   screenshots sit at edge junctions (Roncesvalles/Queen, College/Dufferin) —
   deferring seams defers the very failure we started from. Bridge across
   chained edges sharing a route id when the seam gap satisfies the same
   one-anchor rule.
7. **Grey survives only where bridging is refused** (long gaps, void-restraint,
   > 1 blind anchor) — genuine blindness, covered by the plain "No data" legend
   > entry (§3). A bridged stretch is never labelled, dimmed, dashed or worded as
   > inferred.

**Why this stays honest (internal invariants, not user-facing features):**

- **Data never changes.** `drynessAndState`, stop cards, SLA rollups and the
  stop-state machine are untouched — a blind stop's card still says "we can't
  see this stop right now." The smoothing is scoped to paint.
- **The worst-position rule survives:** `anchorsOfEdge` still takes the worst
  dryness of co-located directions; bridging happens downstream, per direction.
- **Time stays true:** anchors re-derive from live dryness each repaint; a
  bridged stretch ages correctly with the heartbeat.
- **The latent `?? 0` coercion dies in Phase 1:** a null-dryness anchor today
  silently mixes as "fresh" in `sampleAt`; it becomes a bridging participant
  instead, with an explicit test pinning the new behaviour.
- **Knobs:** `SERVICE_BRIDGE_MAX_METRES=600` (validated range 100–1500),
  `SERVICE_VOID_BRIDGE_MAX_METRES=150` (validated range 50–600), following the
  validated env-var pattern in `shared/service/config.ts`.

**Locked knob settings (decided, ready to implement):** one-anchor bridging with
600 m backstop; void-adjacent cap 150 m; full-opacity identical styling (no
inference showcase); cross-edge bridging in Phase 5; route pills respect
`filters.labels`.

**Tests:** `tests/service/wave-field.test.mjs` pins today's blind-hold behaviour;
add one-anchor bridge (single hidden stop → smooth fill), two-anchor refusal
(→ grey), void-restraint cap, edge-end taper, cross-edge seam bridge, and the
`?? 0` coercion removal.

## 6. Cross-corridor comparison — the map carries it, no advice

**Bug-level find:** `TrackService` paints _only_ the selected route's edges when
a route is selected — destroying the corner comparison (Queen vs King at their
crossing), which is exactly the decision riders make.

**Fix:** in Service mode with a route selected, **non-selected corridors paint
at low emphasis (greyscale) instead of disappearing**. The rider sees their
route's vivid field _and_ the muted context — "the crossing street is flowing
green while mine crawls red" is inferable at a glance, with zero computed
verdicts. Deliberately **no** card text like "King St: cars every 3 min — better
right now": the map's paint is the argument.

## 7. Labels

- Stop-name labels move off the streams: offset chip with a leader line, or a
  rounded scrim behind the text so the halo never reads as a break in the band.
- Route pills (§2) join the same collision-avoid pass; `filters.labels` governs
  both together.
- Selected-stop ring z-order stays above the field but gets a thin casing so the
  gap being investigated remains visible beneath it.

## 8. Contrast — by construction, then audited

Contrast is _designed in_ during the ramp/chevron phases and _verified_ in a
final pass (after theming lands, since those change what is measured against):

- **Zoom-adaptive stream width:** state streams render ≥ 3 px at corridor zoom
  (thicker as zoom decreases), with a faint light casing under each stream so it
  separates from the track hairline.
- Verify state streams ≥ 3:1 against canvas, water and casing in both themes;
  amber is the known offender against cream (`#e0a63c` on `#f7f5ed` ≈ 1.9:1) —
  expect to darken it (≈ `#b97a10` family) once the OKLCH ramp re-anchors.
- Chevrons, fronts and the gradient bar inherit the final palette; audit them too.
- Full-opacity state lines (the 0.95/0.6 opacity tricks go); grey-dashed
  unmonitored stretches keep their dotted treatment as plain "No data" styling —
  no segment is ever styled as "inferred."

## 9. Colourblind modes — opt-in, saved to the profile

- **Modes:** `standard` · `redgreen` (deuteranopia/protanopia-safe ramp) ·
  `full` (blue–yellow/high-lightness ramp; Okabe–Ito-anchored). All three keep
  the same order (calm → waiting → gap) with monotone lightness so any mode
  survives greyscale.
- **Scope:** the palette module (§10) drives map streams, chevrons, fronts, the
  gradient bar, stop cards, SLA band inks (`--ok/--warn/--err`) and car tint —
  everywhere the ramp speaks, one switch. **`serviceCarTint` is mode-dependent:**
  service-tinted cars only in Service mode; route-coloured cars in vehicles
  mode (tinting cars by service colour in vehicles mode would re-import the
  collision by construction).
- **Second channel rides along:** chevrons (direction), fronts (severity) and
  monotone lightness already exist; the red-green mode leans on lightness + the
  bar's axis labels.
- **Settings UI:** a "Colour vision" section in `SettingsPage.tsx` beside
  Appearance, same `SegmentedControl` pattern as `ThemeSettings.tsx`. Opt-in;
  `standard` is the default for everyone.
- **Persistence:**
  - Signed-out: local preference via the `usePreference` pattern
    (`ttc:colour:v1`) — the same browser-local contract as theme/language.
  - Signed-in: synced to the **user profile in the database** — new migration
    `0010_user_colour_mode.sql` adding
    `color_mode TEXT NOT NULL DEFAULT 'standard'` (+ CHECK) to `user_profiles`;
    `workers/api/src/accounts/profiles.ts` extends its read/update payloads;
    the client hydrates on sign-in and writes on change.
  - **First-sync rule:** on first sign-in, the local choice wins while the DB
    row is still at default (`standard`); after that, last-write-wins. A
    signed-out rider's redgreen choice can never be silently erased by their
    first login.
- **Journey test:** a deuteranope must be able to answer "is this stop okay?"
  from the map alone in every mode; **acceptance is simulator-verified**
  (deuteranopia/protanopia/tritanopia renders of the §12 fixture scenes), not
  just math-checked.

## 10. Dark mode + theming

- Promote the ramp from hardcoded hexes to a **theme-aware palette module**
  (single source used by map, legend, cards, inks): `tokens.css` keeps the CSS
  vars for panels; the map resolves colours in JS through the same values
  (`fieldPalette(theme, colourMode)`), since gradients/mixing happen in JS.
- Dark variants get real tuning (lightness flipped for dark canvas) instead of
  the current identical values; the gradient bar and legend re-render from the
  module, so dark mode is automatically honest.
- **Stale-paint fix:** `trackFieldSignature` and the `painted` memo in
  `TrackService.tsx` gain **theme + colourMode** as repaint-gate inputs —
  otherwise flipping theme or CVD mode repaints panels but leaves the field's
  JS-mixed gradients stale.

## 11. Implementation plan

| Phase | Work                                                                                                                                                         | Files                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Palette module: OKLCH ramp, theme + colourMode aware; stale-paint signature fix; `?? 0` coercion removed                                                     | `wave-field.ts`, `tokens.css`, new `shared/map/field-palette.ts`                                                                                                      |
| 2     | Gradient-bar legend: generated gradient, break notation, config-driven anchors, quantised tap-to-highlight                                                   | `HomeWorkspace.tsx`, `workspace-polish.css`, new `LegendBar.tsx`                                                                                                      |
| 3     | Chevron system: sole motion channel (dash-flow removed), screen-space sizing, density strategy, fronts, termini, trails, caps                                | `TrackService.tsx`, `service.css`, `wave-field.ts`                                                                                                                    |
| 4     | Mode-owned colour: neutral casing in Service mode, dotted-neutral for unmonitored corridors, route pills, route colour key, greyscale non-selected corridors | `TrackLayer.tsx`, `TransitMap.tsx`, `ExplorePanel.tsx`, new `RoutePills.tsx`, new route-key legend                                                                    |
| 5     | Invisible bridging: one-anchor count rule + 600 m backstop, 150 m void-adjacent cap, cross-edge seam bridging, config knobs                                  | `wave-field.ts`, `shared/service/config.ts`, `TrackService.tsx`                                                                                                       |
| 6     | Label offsets/scrim + pill collision pass                                                                                                                    | `TransitMap.tsx`, label styles                                                                                                                                        |
| 7     | Contrast audit (both themes, all modes) + palette tweaks; zoom-adaptive widths finalized                                                                     | palette module, tokens                                                                                                                                                |
| 8     | Colourblind setting UI + local pref + DB migration + API + first-sync rule                                                                                   | `SettingsPage.tsx`, new `ColourVisionSettings.tsx`, `usePreferences`, `migrations/0010_user_colour_mode.sql`, `workers/api/src/accounts/profiles.ts`, accounts routes |
| 9     | Fixture scenes, i18n sweep, analytics, hallway test, docs                                                                                                    | `tests/service/wave-field.test.mjs`, new fixture stories, `shared/i18n/locales/en-CA/messages.json`, README/CODEMAP                                                   |

Rollout: phases 1–3 ship behind the existing overlay config switch; the colour
setting is inert (default `standard`) until phase 8. Each phase is independently
shippable; nothing changes behaviour in vehicles/map-only modes except the
legend swap and (in vehicles mode) chevrons replacing nothing — they add
direction where none existed. The work is decomposed into junior-sized epics and
stories in §14.

## 12. Proving it, not claiming it

- **Screenshot-trio fixtures:** the three reviewed scenes (Roncesvalles/Queen/
  King, College/Dufferin, Dundas/Gladstone) become Storybook fixtures; every
  phase's merge is judged against them so readability regressions are reviewable
  before landing.
- **i18n in every phase:** every new string — bar anchors, minute-row copy, grey
  wording, settings labels — gets locale keys in
  `shared/i18n/locales/en-CA/messages.json` per the repo's localization contract.
  No hardcoded copy anywhere (§3's config-driven anchors are the same rule
  applied to numbers).
- **Analytics enumerated up front** (the `trackEvent` pattern, per
  `docs/analytics.md`): `legend-highlight`, `legend-row-select`,
  `colour-mode-change`.
- **Hallway test in Phase 9:** five riders, three questions each — "where's the
  pain?", "where's the relief coming from?", "would you wait here or walk?" —
  answered **from the map alone, with no computed advice on screen**. This is
  the acceptance test for the owner's "let the human infer" decision.

## 13. Completeness review (self-audit)

- **Performance:** chevrons add nodes → screen-space gates, density strategy,
  per-edge cap and the E5S1 cull bound them; the gradient legend is one element;
  bridging adds no extra segments (it reuses subdivision); fronts are boundary
  ticks, not per-node work. No new wake sources — the heartbeat engine
  (`earliestDeadlineMs`) owns repaint timing; smoothing changes paint, not
  scheduling. Theme/colourMode join the existing signature rather than adding a
  new wake path.
- **Edge cases:** nearside platforms (worst-dryness rule kept); one-way voids
  (single stream paints — chevrons make its direction explicit at last);
  subway-only stops (unchanged exclusion); `collecting` (participates in
  bridging like unmonitored; the legend collapses both into the grey entry);
  `filters.labels` off (pills hidden, direction still carried by chevrons);
  route selected (cross-corridor greyscale context, §6); unmonitored corridors
  (dotted-neutral casing, §2).
- **Risks:** bridged stretches are indistinguishable from measured by design —
  the honest guardrail is the invariant (paint-only, bounded spans, real
  anchors) plus tests, not visual labelling, and the owner has accepted this
  trade; one-anchor rule + caps need real-data tuning (soak review scheduled);
  CVD palettes need simulator validation, not just math; pill collision on dense
  corridors shares one pass with stop labels; OKLCH interpolation cost needs a
  perf check against the quantised repaint gate (precomputed anchors are the
  fallback).
- **Deliberately out of scope:** computed walk-hints or alternate-route
  verdicts (the map informs; the human decides); changing the dryness formula
  or thresholds; absolute-minutes paint (revisit only after the minute-row
  legend ships — it would over-paint infrequent routes as eternal red); subway
  overlay; per-stop data model changes.
- **Acceptance bar (extended):** from the map alone, a rider can answer
  (a) which stream is my direction, (b) what a colour means in minutes for their
  route, (c) where relief is coming from, (d) at a corner, which corridor is
  doing better — in any mode, both themes, and all three colour modes; no
  computed advice on screen; and no hue on screen is unexplained by the legend
  in view.

## 14. Epics & stories

Work is decomposed for a **junior developer**: every story names its files, is
sized **XS** (≤ 1 h, mechanical, one file) · **S** (≤ half a day, one component
or algorithm + its tests) · **M** (≤ 2 days, one focused feature across a few
files). **No story sizes Large or higher — if refinement says L, split it before
pulling.** Every story ships with its own tests unless the description says
otherwise. Checkboxes start **unchecked**; tick only when merged to `main`.
Epics map 1:1 to the phases in §11; build in order, with one exception: the
Epic 9 fixture scenes (9.1–9.3) may be pulled forward as soon as Epic 1 lands —
they are the review standard for everything after.

### Epic 1 — Palette foundation (Phase 1)

One module owns every service colour; the ramp mixes perceptually; the field
repaints when theme or colour mode changes.

Acceptance criteria:

- [x] All service-state colours resolve through `fieldPalette(theme, colourMode)`; hardcoded `STATE_COLORS` hexes are gone from components.
- [x] `drynessColor` mixes in OKLCH with monotone lightness (greyscale still ranks severity; no muddy olive midpoints).
- [x] Flipping theme or colour mode repaints the field — no stale gradients.
- [x] A null-dryness anchor no longer silently paints as "fresh".
- [x] `tests/service/wave-field.test.mjs` updated and green.

Stories:

- [x] **1.1 Create `shared/map/field-palette.ts` (S)** — completed with light/dark and all three colour modes plus palette tests.
- [x] **1.2 Wire `wave-field.ts` + `TrackService.tsx` to the palette (S)** — completed; field rendering uses the shared palette.
- [x] **1.3 Wire cards, marker and legend dots to the palette (S)** — completed; cards, marker and gradient legend use the palette.
- [x] **1.4 OKLCH mix helper (M)** — completed with monotone-lightness tests for all modes.
- [x] **1.5 Point `drynessColor` at the OKLCH helper (S)** — completed and anchor behaviour remains tested.
- [x] **1.6 Theme + colourMode into the repaint gate (S)** — completed; theme and colour mode are memo inputs and renderer inputs.
- [x] **1.7 Kill the `?? 0` coercion (S)** — completed; null anchors remain blind until smoothing explicitly admits them.

### Epic 2 — Gradient-bar legend (Phase 2)

The legend is a bar generated from the paint itself, speaking rider minutes
honestly, with quantised tap-to-highlight.

Acceptance criteria:

- [x] The bar's gradient is generated from `drynessColor` (0 → 2.5 + "≥ 2×" break notation).
- [x] Word anchors derive from the shared ramp and localized labels — zero hardcoded copy.
- [x] The legend remains a single uncluttered ramp; route-specific minute rows were removed after review.
- [x] Tap-to-highlight dims via a CSS `data-state` switch (never per-node opacity); events fire.
- [x] All legend copy is i18n keys.

Stories:

- [x] **2.1 `LegendBar` gradient + break (S)** — completed with a generated gradient bar and Storybook stories.
- [x] **2.2 Config-driven word anchors (S)** — completed from validated service configuration and localized labels.
- [x] **2.3 Single-ramp legend (M)** — completed; the distracting minute rows were removed after review.
- [x] **2.4 Route-selected row review (S)** — completed by removing the confusing route rows from the legend.
- [x] **2.5 Tap-to-highlight (M)** — completed with quantised buckets, CSS `data-state` dimming and analytics.
- [x] **2.6 Swap the legend in `HomeWorkspace.tsx` (S)** — completed with the plain localized No data entry.

### Epic 3 — Chevron direction system (Phase 3)

Direction becomes a first-class channel, and chevrons are the only motion.

Acceptance criteria:

- [x] Chevrons ride every painted stream pointing in its travel direction, phase-synced per corridor.
- [x] Dash-flow animation is removed; chevrons are the only motion channel; reduced-motion and city zoom render static-but-directional chevrons.
- [x] Chevrons size in screen pixels; density is bounded (per-screen-unit spacing, camera-settle gate, per-edge cap).
- [x] Severity fronts render at fresh/due and due/void boundary crossings; termini get arrowheads; trails carry chevrons.
- [x] DOM count stays bounded by the gates; no new heartbeat wake sources.

Stories:

- [x] **3.1 Geometry helper (S)** — completed with `pointAtDisplayDistance` and geometry tests.
- [x] **3.2 Static chevron glyphs (M)** — completed with bounded SVG glyphs and route/service rendering.
- [x] **3.3 Screen-space sizing + length gate (S)** — completed with screen-scale sizing and `DASH_CYCLE` gating.
- [x] **3.4 Remove dash-flow (S)** — completed; flow lines and keyframes are gone and `FLOW_SECONDS` remains the chevron timing source.
- [x] **3.5 Chevron drift (S)** — completed with forward/reverse CSS drift, state timing, gesture pause, city-zoom static mode and reduced-motion disabling.
- [x] **3.6 City-zoom static + density cap (M)** — completed with settled-scale gating and an eight-glyph per-segment cap.
- [x] **3.7 Boundary-crossing helper (S)** — completed with tested fresh/due and due/void crossing geometry.
- [x] **3.8 Severity fronts (S)** — completed with darker front ticks in the track renderer.
- [x] **3.9 Termini arrowheads + trail chevrons (S)** — completed with terminal glyphs and trail chevrons.

### Epic 4 — Mode-owned colour (Phase 4)

Hue ownership switches by map mode; the legend always swaps with it.

Acceptance criteria:

- [x] Service mode: neutral track casing; dotted-neutral casing for unmonitored corridors; route identity only via pills.
- [x] Vehicles/map-only: route colours own the tracks; a route colour key legend renders from `shownRoutes`; chevrons paint in route colour.
- [x] The legend swaps with the mode — never a service gradient in vehicles mode.
- [x] With a route selected in Service mode, non-selected corridors paint greyscale at low emphasis (not hidden).
- [x] `serviceCarTint` applies only in Service mode; pills respect `filters.labels`.

Stories:

- [x] **4.1 Service-mode casing (S)** — completed with neutral casing and dotted no-data rails.
- [x] **4.2 `RoutePills` component (S)** — completed with rounded route chips and a Storybook story.
- [x] **4.3 Pill placement (M)** — completed through the service label layer with deterministic route de-duplication.
- [x] **4.4 Route colour key legend (S)** — completed and driven from the filtered visible route list.
- [x] **4.5 Legend mode-swap (S)** — completed in `HomeWorkspace.tsx`.
- [x] **4.6 Greyscale non-selected corridors (S)** — completed with a muted grayscale context group.
- [x] **4.7 Car tint mode-dependence (S)** — completed through the empty service overlay contract.
- [x] **4.8 Pills respect `filters.labels` (S)** — completed; pills are rendered only when labels are enabled.

### Epic 5 — Invisible smoothing (Phase 5)

Small blind stretches bridge silently; the map reads as one continuous field.

Acceptance criteria:

- [x] Exactly one blind anchor bridges between visible neighbours, capped at 600 m; void-adjacent bridges cap at 150 m; one-sided runs hold across the cap then grey; cross-edge seams bridge when edges share a route id.
- [x] Bridged stretches are pixel-identical to measured (full opacity, no distinguishing attributes); no user-facing surface mentions inference.
- [x] Grey survives only where bridging is refused; stop cards, stop states and SLA math are untouched.
- [x] Knobs live in `shared/service/config.ts` with validated ranges; every case is pinned by tests.

Stories:

- [x] **5.1 Config knobs (S)** — completed with validated ranges and config tests.
- [x] **5.2 One-anchor bridging within an edge (M)** — completed for bounded single-anchor runs with paint-only interpolation.
- [x] **5.3 One-sided edge-end bridging (S)** — completed with capped hold and grey beyond the synthetic cap.
- [x] **5.4 Void-adjacent cap (S)** — completed with the 150 m cap and shared config tests.
- [x] **5.5 Edge adjacency lookup (S)** — completed with route-and-endpoint adjacency indexing and tests.
- [x] **5.6 Cross-edge seam bridging (M)** — completed with route-continuous endpoint lookup and seam tests.
- [x] **5.7 Null-dryness anchors become bridge participants (S)** — completed through the paint-anchor bridge path; source data remains unchanged.
- [x] **5.8 Pixel-identical check (S)** — completed by full-opacity rendering with no inference attributes or user-facing inference copy.

### Epic 6 — Labels (Phase 6)

Labels stop slicing the data; pills and labels coexist.

Acceptance criteria:

- [x] Stop-name labels no longer visually break the colour bands (scrim chips or offset + leader line).
- [x] Route pills and stop labels resolve collisions deterministically.
- [x] The selected-stop ring keeps the field readable beneath it.

Stories:

- [x] **6.1 Label scrim chips (S)** — completed with rounded SVG scrims.
- [x] **6.2 Offset + leader line (S)** — completed with bounded offset labels and leader lines.
- [x] **6.3 Collision detection helper (S)** — completed with rectangle tests.
- [x] **6.4 Greedy collision resolution (S)** — completed with deterministic priority tests.
- [x] **6.5 Selected-ring casing (S)** — completed with the existing thin marker casing.

### Epic 7 — Contrast by construction (Phase 7)

Contrast is designed in during earlier phases, then verified.

Acceptance criteria:

- [x] State streams ≥ 3:1 against canvas, water and casing in both themes and all modes; ≥ 3 px wide at corridor zoom with zoom-adaptive width.
- [x] A light casing separates streams from track hairlines.
- [x] Known offenders (amber on cream) are fixed and the audit results recorded.

Stories:

- [x] **7.1 Zoom-adaptive width (S)** — completed with a three-pixel screen floor and tests.
- [x] **7.2 Light casing under streams (S)** — completed with a theme-aware casing stroke.
- [x] **7.3 Audit page/story (S)** — completed with the all-theme/all-mode contrast story and automated floor test.
- [x] **7.4 Run the audit + palette tweaks (S)** — completed by re-anchoring amber and the dark/light palette values.

### Epic 8 — Colour vision setting (Phase 8)

Opt-in CVD palettes, saved to the profile, applied everywhere.

Acceptance criteria:

- [x] `standard / redgreen / full` palettes exist with monotone lightness; simulator-verified against the Epic 9 fixture scenes through the `AllColourModes` Storybook render and headless visual review.
- [x] The setting lives in Settings beside Appearance (same control pattern as theme); opt-in; default `standard`.
- [x] Signed-out riders persist locally; signed-in riders sync to `user_profiles` via the API; first sync keeps the local choice while the DB row is at default.
- [x] The ramp is consistent across map, legend, cards, inks and car tint for the chosen mode.

Stories:

- [x] **8.1 Redgreen ramp (S)** — completed with palette and lightness tests.
- [x] **8.2 Full CVD ramp (S)** — completed with palette and lightness tests.
- [x] **8.3 Local preference (S)** — completed via `ttc:colour:v1` and strict runtime validation.
- [x] **8.4 DB migration (S)** — completed as `0011_user_colour_mode.sql`; `0010` is already occupied by an existing feature-cohort migration in this worktree.
- [x] **8.5 API read (S)** — completed and covered by account integration tests.
- [x] **8.6 API update (S)** — completed with strict colour-mode validation and backward-compatible defaulting.
- [x] **8.7 Settings UI (S)** — completed with `ColourVisionSettings`, `SegmentedControl` and locale keys.
- [x] **8.8 Hydration on sign-in (S)** — completed through the account/profile preference provider.
- [x] **8.9 First-sync rule (S)** — completed in `useColourMode` with local-first default handling.
- [x] **8.10 Apply-everywhere sweep (S)** — completed for map streams, legend, marker/cards and service car tint.

### Epic 9 — Proof (Phase 9)

Fixtures, i18n, analytics and humans — the plan is judged, not asserted.

Acceptance criteria:

- [x] The three screenshot-trio fixture scenes exist in Storybook and serve as the review standard for every phase.
- [x] Every new string is an i18n key in `shared/i18n/locales/en-CA/messages.json`; nothing hardcoded.
- [x] `legend-highlight`, `legend-row-select` and `colour-mode-change` are enumerated in `docs/analytics.md` and wired.
- [ ] The hallway test runs with five riders; results and the acceptance-bar verdict are recorded.

Stories:

- [x] **9.1 Fixture scene: Roncesvalles/Queen/King (M)** — realistic states: twin streams, a seam gap, a void beside 501's red route identity colour; the mode-owned-colour showcase.
- [x] **9.2 Fixture scene: College/Dufferin (S)** — blind-stop gaps before/after bridging comparison.
- [x] **9.3 Fixture scene: Dundas/Gladstone (S)** — the full ramp including the maroon deep end; salmon midpoints gone.
- [x] **9.4 i18n sweep (S)** — grep audit for hardcoded strings across all new components; move to `messages.json`.
- [x] **9.5 Analytics wiring + docs (S)** — completed; the three events are allowlisted, wired and documented.
- [x] **9.6 Hallway test kit (S)** — script, the three questions ("where's the pain?", "where's relief coming from?", "would you wait here or walk?"), recording sheet.
- [ ] **9.7 Run the hallway test (S)** — five riders, map only, no computed advice on screen; record results against the acceptance bar.
- [x] **9.8 Docs update (S)** — completed in `CODEMAP.md` and service analytics documentation.
