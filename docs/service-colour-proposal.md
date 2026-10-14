# Service colour proposal v3 — gradient legend, mode-owned colour, chevrons, invisible smoothing

Status: **proposal — no code written yet.** Supersedes v2. Decisions locked by the
owner since v2: the legend is a gradient bar; colour ownership switches by map
mode; chevrons are the direction system (and the only motion channel); small
no-data stretches are smoothed over **invisibly and silently** — no inferred-value
showcase, no soft styling, no caveats, no mention of inference on any user-facing
surface (the inferences are minor; the map just reads as one continuous field);
and the map never *computes advice* (no walk-hints,
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

1. **One owner of hue per mode.** Colour confusion is resolved by *mode*, not by
   repainting one system to dodge the other.
2. **The map informs; it never advises.** No computed walk-hints, no alternate-
   route verdicts, no card lectures. The paint itself must make "the green
   relief is two blocks west" and "the crossing street is doing better" visible
   enough to infer at a glance.
3. **Colour is never the only channel** — direction gets chevrons, severity gets
   a position on a labelled scale, lightness ranks even in greyscale.
4. **The rider's question is the metric** — the legend speaks minutes for *their*
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

| Mode (`live` + `serviceOverlay`) | Track base | Streams/pills | Legend |
| --- | --- | --- | --- |
| **Service** (`live ✓, overlay ✓`) | Neutral hairline casing (grey) — route colours step back | Service ramp owns hue; route identity = **numbered pills along the corridor** (like street-name labels) | Gradient bar + minute rows (§3) |
| **Vehicles only** (`live ✓, overlay ✗`) | Route colours own the tracks — the classic transit-map look | Vehicle markers in route colour; **chevrons in route colour** show travel direction (§4); route pills optional (redundant) | Route colour key (§2.1) |
| **Map only** (`live ✗`) | Route colours own the tracks | Nothing live | Route colour key |

- In Service mode the pills carry the route number + a small route-colour chip,
  so identity survives without flooding the canvas with red/green/orange lines.
- The legend **always swaps with the mode** — never show the service gradient in
  vehicles-only mode. This single rule kills the "is that red Queen or a gap?"
  ambiguity by construction, not by tuning.
- **Unmonitored corridors in Service mode** (edges with no anchored stops) paint
  a **dotted-neutral casing** — visible, obviously-not-data, and never
  re-importing route colour (which would undo Service mode's hue monopoly).
- Subway handling is unchanged (`E7S7`): subway tracks never join the service
  field; in Service mode they keep route colours with pills, which now *reads*
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
  runtime OKLCH mixing is too costly; the *look* is the contract.
- **Far-end compression fixed:** the bar samples dryness 0 → 2.5 and ends in a
  **"≥ 2× the usual" break notation**, so the most severe state gets real legend
  space instead of the current 2→3.5 sliver. The maroon deepening clamp in
  `drynessColor` stays (severity keeps deepening on the map); the bar simply
  labels everything past 2× as "beyond."
- **Rider minutes without lying (the v2 contradiction resolved):** the axis is
  self-relative dryness, so *one* minute tick would be wrong for most routes.
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
flow-dash animation dies**: chevrons *are* the motion channel (one animated
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
   between bounding *visible* anchors (or edge end).
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
   bridging can never *create* a void between healthy stops — and we never
   *accuse* a long blind stretch of a gap either.
6. **Cross-edge bridging ships in Phase 5, not phase 2:** the grey seams in the
   screenshots sit at edge junctions (Roncesvalles/Queen, College/Dufferin) —
   deferring seams defers the very failure we started from. Bridge across
   chained edges sharing a route id when the seam gap satisfies the same
   one-anchor rule.
7. **Grey survives only where bridging is refused** (long gaps, void-restraint,
   > 1 blind anchor) — genuine blindness, covered by the plain "No data" legend
   entry (§3). A bridged stretch is never labelled, dimmed, dashed or worded as
   inferred.

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

**Bug-level find:** `TrackService` paints *only* the selected route's edges when
a route is selected — destroying the corner comparison (Queen vs King at their
crossing), which is exactly the decision riders make.

**Fix:** in Service mode with a route selected, **non-selected corridors paint
at low emphasis (greyscale) instead of disappearing**. The rider sees their
route's vivid field *and* the muted context — "the crossing street is flowing
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

Contrast is *designed in* during the ramp/chevron phases and *verified* in a
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

| Phase | Work | Files |
| --- | --- | --- |
| 1 | Palette module: OKLCH ramp, theme + colourMode aware; stale-paint signature fix; `?? 0` coercion removed | `wave-field.ts`, `tokens.css`, new `shared/map/field-palette.ts` |
| 2 | Gradient-bar legend: generated gradient, break notation, route-calibrated minute rows, config-driven anchors, quantised tap-to-highlight | `HomeWorkspace.tsx`, `workspace-polish.css`, new `LegendBar.tsx` |
| 3 | Chevron system: sole motion channel (dash-flow removed), screen-space sizing, density strategy, fronts, termini, trails, caps | `TrackService.tsx`, `service.css`, `wave-field.ts` |
| 4 | Mode-owned colour: neutral casing in Service mode, dotted-neutral for unmonitored corridors, route pills, route colour key, greyscale non-selected corridors | `TrackLayer.tsx`, `TransitMap.tsx`, `ExplorePanel.tsx`, new `RoutePills.tsx`, new route-key legend |
| 5 | Invisible bridging: one-anchor count rule + 600 m backstop, 150 m void-adjacent cap, cross-edge seam bridging, config knobs | `wave-field.ts`, `shared/service/config.ts`, `TrackService.tsx` |
| 6 | Label offsets/scrim + pill collision pass | `TransitMap.tsx`, label styles |
| 7 | Contrast audit (both themes, all modes) + palette tweaks; zoom-adaptive widths finalized | palette module, tokens |
| 8 | Colourblind setting UI + local pref + DB migration + API + first-sync rule | `SettingsPage.tsx`, new `ColourVisionSettings.tsx`, `usePreferences`, `migrations/0010_user_colour_mode.sql`, `workers/api/src/accounts/profiles.ts`, accounts routes |
| 9 | Fixture scenes, i18n sweep, analytics, hallway test, docs | `tests/service/wave-field.test.mjs`, new fixture stories, `shared/i18n/locales/en-CA/messages.json`, README/CODEMAP |

Rollout: phases 1–3 ship behind the existing overlay config switch; the colour
setting is inert (default `standard`) until phase 8. Each phase is independently
shippable; nothing changes behaviour in vehicles/map-only modes except the
legend swap and (in vehicles mode) chevrons replacing nothing — they add
direction where none existed.

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
