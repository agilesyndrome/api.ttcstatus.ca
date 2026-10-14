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
- [ ] All service-state colours resolve through `fieldPalette(theme, colourMode)`; hardcoded `STATE_COLORS` hexes are gone from components.
- [ ] `drynessColor` mixes in OKLCH with monotone lightness (greyscale still ranks severity; no muddy olive midpoints).
- [ ] Flipping theme or colour mode repaints the field — no stale gradients.
- [ ] A null-dryness anchor no longer silently paints as "fresh".
- [ ] `tests/service/wave-field.test.mjs` updated and green.

Stories:
- [ ] **1.1 Create `shared/map/field-palette.ts` (S)** — pure module mapping `FieldState` → hex for light/dark themes; return today's values unchanged; unit tests for all five states × two themes.
- [ ] **1.2 Wire `wave-field.ts` + `TrackService.tsx` to the palette (S)** — replace `STATE_COLORS` and inline hexes; expect zero visual change (screenshot check against a fixture).
- [ ] **1.3 Wire cards, marker and legend dots to the palette (S)** — `StopCard.tsx`, `SelectedStopCard.tsx`, `SelectedStopMarker.tsx`, and the legend dots in `HomeWorkspace.tsx`.
- [ ] **1.4 OKLCH mix helper (M)** — implement OKLCH mixing (or a precomputed perceptual anchor table) in the palette module; tests assert lightness is monotone along the ramp and midpoints stay vivid.
- [ ] **1.5 Point `drynessColor` at the OKLCH helper (S)** — replace the sRGB `mix`; keep `drynessColor(0|1|2|null)` anchor mappings pinned by tests.
- [ ] **1.6 Theme + colourMode into the repaint gate (S)** — add both to the `painted` memo inputs in `TrackService.tsx` (or the signature); test: switching theme changes painted output.
- [ ] **1.7 Kill the `?? 0` coercion (S)** — in `sampleAt`, a null-dryness non-blind anchor paints blind (grey) for now; Epic 5.7 upgrades it to a bridge participant; pin with a test.

### Epic 2 — Gradient-bar legend (Phase 2)

The legend is a bar generated from the paint itself, speaking rider minutes
honestly, with quantised tap-to-highlight.

Acceptance criteria:
- [ ] The bar's gradient is generated from `drynessColor` (0 → 2.5 + "≥ 2×" break notation).
- [ ] Word anchors and minute rows derive from `serviceConfig()` / boundary math — zero hardcoded copy.
- [ ] When a route is selected, the legend renders only that route's minute row.
- [ ] Tap-to-highlight dims via a CSS `data-state` switch (never per-node opacity); events fire.
- [ ] All legend copy is i18n keys.

Stories:
- [ ] **2.1 `LegendBar` gradient + break (S)** — new `LegendBar.tsx`: sample `drynessColor` into a CSS linear-gradient ending in the "≥ 2× the usual" break label; Storybook story.
- [ ] **2.2 Config-driven word anchors (S)** — render "just went / longer than usual / a real gap" from `serviceConfig()` thresholds; test that tuning an env var moves the words.
- [ ] **2.3 Two-row minute ruler (M)** — helper converts the ramp boundaries to minutes for exemplar headways (3-min and 12-min routes); tests, then render beneath the bar.
- [ ] **2.4 Route-selected single row (S)** — use the selected route's median headway for one personalized row; fall back to two rows with no selection.
- [ ] **2.5 Tap-to-highlight (M)** — press position → nearest bucket; dim non-matching segments via `data-state` CSS switch; release/second tap clears; fire `legend-highlight` / `legend-row-select`.
- [ ] **2.6 Swap the legend in `HomeWorkspace.tsx` (S)** — replace the 4-dot legend with `LegendBar` including the plain "No data" grey entry; delete the old markup; i18n keys for all new copy.

### Epic 3 — Chevron direction system (Phase 3)

Direction becomes a first-class channel, and chevrons are the only motion.

Acceptance criteria:
- [ ] Chevrons ride every painted stream pointing in its travel direction, phase-synced per corridor.
- [ ] Dash-flow animation is removed; chevrons are the only motion channel; reduced-motion and city zoom render static-but-directional chevrons.
- [ ] Chevrons size in screen pixels; density is bounded (per-screen-unit spacing, camera-settle gate, per-edge cap).
- [ ] Severity fronts render at fresh/due and due/void boundary crossings; termini get arrowheads; trails carry chevrons.
- [ ] DOM count stays bounded by the gates; no new heartbeat wake sources.

Stories:
- [ ] **3.1 Geometry helper (S)** — point + angle at a display distance along a segment (reuse the cumulative-distance cache); tests.
- [ ] **3.2 Static chevron glyphs (M)** — render glyphs at `DASH_CYCLE` spacing, phase-synced, `aria-hidden`; Storybook story.
- [ ] **3.3 Screen-space sizing + length gate (S)** — px sizing independent of zoom; render only where the segment carries one spacing cycle on screen (reuse the E5S2 gate).
- [ ] **3.4 Remove dash-flow (S)** — delete the flow lines and keyframes from `TrackService.tsx` / `service.css`; keep `FLOW_SECONDS` as chevron-speed data.
- [ ] **3.5 Chevron drift (S)** — fwd/rev drift at the state's speed at street zoom; static under `prefers-reduced-motion` (extend the existing CSS gate).
- [ ] **3.6 City-zoom static + density cap (M)** — chevron per N screen units at low zoom, gated on camera settle; per-edge cap mirroring `MAX_SUBPIECES`; perf test asserts the DOM bound.
- [ ] **3.7 Boundary-crossing helper (S)** — find fresh/due and due/void crossings along a segment; tests.
- [ ] **3.8 Severity fronts (S)** — darker edge tick at each crossing; story.
- [ ] **3.9 Termini arrowheads + trail chevrons (S)** — arrowheads at terminals/loops; the clearing-trail carries chevrons.

### Epic 4 — Mode-owned colour (Phase 4)

Hue ownership switches by map mode; the legend always swaps with it.

Acceptance criteria:
- [ ] Service mode: neutral track casing; dotted-neutral casing for unmonitored corridors; route identity only via pills.
- [ ] Vehicles/map-only: route colours own the tracks; a route colour key legend renders from `shownRoutes`; chevrons paint in route colour.
- [ ] The legend swaps with the mode — never a service gradient in vehicles mode.
- [ ] With a route selected in Service mode, non-selected corridors paint greyscale at low emphasis (not hidden).
- [ ] `serviceCarTint` applies only in Service mode; pills respect `filters.labels`.

Stories:
- [ ] **4.1 Service-mode casing (S)** — `TrackLayer.tsx`: neutral grey hairline casing when the overlay is on; dotted-neutral variant for edges with no anchors; tests/story.
- [ ] **4.2 `RoutePills` component (S)** — rounded chip (colour dot + route number) with styles and story; props: route, position.
- [ ] **4.3 Pill placement (M)** — place pills along corridors in Service mode via the label layer with basic spacing; fine collision work is Epic 6.
- [ ] **4.4 Route colour key legend (S)** — component listing visible routes' colour chips, driven by `shownRoutes` so filters apply.
- [ ] **4.5 Legend mode-swap (S)** — `HomeWorkspace.tsx` renders `LegendBar` only in Service mode, the route key otherwise.
- [ ] **4.6 Greyscale non-selected corridors (S)** — in Service mode with `selectedRoute`, non-selected edges paint low-emphasis greyscale instead of disappearing; story shows the Queen/King corner.
- [ ] **4.7 Car tint mode-dependence (S)** — `serviceCarTint` only when the overlay is on.
- [ ] **4.8 Pills respect `filters.labels` (S)** — hide pills when labels are off; direction stays with chevrons.

### Epic 5 — Invisible smoothing (Phase 5)

Small blind stretches bridge silently; the map reads as one continuous field.

Acceptance criteria:
- [ ] Exactly one blind anchor bridges between visible neighbours, capped at 600 m; void-adjacent bridges cap at 150 m; one-sided runs hold across the cap then grey; cross-edge seams bridge when edges share a route id.
- [ ] Bridged stretches are pixel-identical to measured (full opacity, no distinguishing attributes); no user-facing surface mentions inference.
- [ ] Grey survives only where bridging is refused; stop cards, stop states and SLA math are untouched.
- [ ] Knobs live in `shared/service/config.ts` with validated ranges; every case is pinned by tests.

Stories:
- [ ] **5.1 Config knobs (S)** — `SERVICE_BRIDGE_MAX_METRES=600` (range 100–1500) and `SERVICE_VOID_BRIDGE_MAX_METRES=150` (range 50–600) following the validated env-var pattern; tests.
- [ ] **5.2 One-anchor bridging within an edge (M)** — classify blind stretches in `edgeServiceSegments`; bridge exactly one blind anchor subject to the backstop; tests per case.
- [ ] **5.3 One-sided edge-end bridging (S)** — hold the inner anchor's value across the cap, grey beyond; tests.
- [ ] **5.4 Void-adjacent cap (S)** — shrink to 150 m when either bounding anchor is void; tests (never create a void, never accuse a long blind stretch).
- [ ] **5.5 Edge adjacency lookup (S)** — map edge → neighbouring edges sharing a route id; tests.
- [ ] **5.6 Cross-edge seam bridging (M)** — apply the one-anchor rule across seams; tests including a Roncesvalles/Queen-like junction case.
- [ ] **5.7 Null-dryness anchors become bridge participants (S)** — upgrade Epic 1.7's interim blind painting to bridging; test pins it.
- [ ] **5.8 Pixel-identical check (S)** — assert no styling/attribute difference between bridged and measured segments; remove any interim markers; grep-verify no "inferred" copy ships.

### Epic 6 — Labels (Phase 6)

Labels stop slicing the data; pills and labels coexist.

Acceptance criteria:
- [ ] Stop-name labels no longer visually break the colour bands (scrim chips or offset + leader line).
- [ ] Route pills and stop labels resolve collisions deterministically.
- [ ] The selected-stop ring keeps the field readable beneath it.

Stories:
- [ ] **6.1 Label scrim chips (S)** — rounded background behind stop-label text so the band reads continuous beneath it.
- [ ] **6.2 Offset + leader line (S)** — move labels off the streams with a leader line, staying in bounds.
- [ ] **6.3 Collision detection helper (S)** — rectangle overlap for labels/pills; tests.
- [ ] **6.4 Greedy collision resolution (S)** — offset or hide on overlap in a deterministic order; tests.
- [ ] **6.5 Selected-ring casing (S)** — thin casing on the selection ring so the investigated gap stays visible.

### Epic 7 — Contrast by construction (Phase 7)

Contrast is designed in during earlier phases, then verified.

Acceptance criteria:
- [ ] State streams ≥ 3:1 against canvas, water and casing in both themes and all modes; ≥ 3 px wide at corridor zoom with zoom-adaptive width.
- [ ] A light casing separates streams from track hairlines.
- [ ] Known offenders (amber on cream) are fixed and the audit results recorded.

Stories:
- [ ] **7.1 Zoom-adaptive width (S)** — stream width as a function of scale with a ≥ 3 px floor; tests.
- [ ] **7.2 Light casing under streams (S)** — subtle casing stroke beneath each stream for separation.
- [ ] **7.3 Audit page/story (S)** — render every state over canvas, water and casing in both themes for measurement.
- [ ] **7.4 Run the audit + palette tweaks (S)** — darken amber (≈ `#b97a10` family) and any other failures; record results.

### Epic 8 — Colour vision setting (Phase 8)

Opt-in CVD palettes, saved to the profile, applied everywhere.

Acceptance criteria:
- [ ] `standard / redgreen / full` palettes exist with monotone lightness; simulator-verified against the Epic 9 fixture scenes.
- [ ] The setting lives in Settings beside Appearance (same control pattern as theme); opt-in; default `standard`.
- [ ] Signed-out riders persist locally; signed-in riders sync to `user_profiles` via the API; first sync keeps the local choice while the DB row is at default.
- [ ] The ramp is consistent across map, legend, cards, inks and car tint for the chosen mode.

Stories:
- [ ] **8.1 Redgreen ramp (S)** — implement the provided Okabe–Ito-anchored values in the palette module; lightness-monotonicity tests. (Palette values are a design input, not a junior decision.)
- [ ] **8.2 Full CVD ramp (S)** — same for the blue–yellow/high-lightness values.
- [ ] **8.3 Local preference (S)** — `ttc:colour:v1` via `usePreferences` with strict validation.
- [ ] **8.4 DB migration `0010_user_colour_mode.sql` (S)** — add `color_mode TEXT NOT NULL DEFAULT 'standard'` (+ CHECK) to `user_profiles`; apply locally via the Makefile flow.
- [ ] **8.5 API read (S)** — `workers/api/src/accounts/profiles.ts` returns `color_mode` in the profile payload; test.
- [ ] **8.6 API update (S)** — accept and validate `color_mode` writes; test.
- [ ] **8.7 Settings UI (S)** — new `ColourVisionSettings.tsx` beside `ThemeSettings.tsx`, `SegmentedControl`, i18n keys, story.
- [ ] **8.8 Hydration on sign-in (S)** — client reads the profile value and applies it once hydrated.
- [ ] **8.9 First-sync rule (S)** — local wins while the DB row is `standard`; last-write-wins after; tests.
- [ ] **8.10 Apply-everywhere sweep (S)** — route `colourMode` through map, legend, cards, inks and car tint; checklist test per surface.

### Epic 9 — Proof (Phase 9)

Fixtures, i18n, analytics and humans — the plan is judged, not asserted.

Acceptance criteria:
- [ ] The three screenshot-trio fixture scenes exist in Storybook and serve as the review standard for every phase.
- [ ] Every new string is an i18n key in `shared/i18n/locales/en-CA/messages.json`; nothing hardcoded.
- [ ] `legend-highlight`, `legend-row-select` and `colour-mode-change` are enumerated in `docs/analytics.md` and wired.
- [ ] The hallway test runs with five riders; results and the acceptance-bar verdict are recorded.

Stories:
- [ ] **9.1 Fixture scene: Roncesvalles/Queen/King (M)** — realistic states: twin streams, a seam gap, a void beside 501's red route identity colour; the mode-owned-colour showcase.
- [ ] **9.2 Fixture scene: College/Dufferin (S)** — blind-stop gaps before/after bridging comparison.
- [ ] **9.3 Fixture scene: Dundas/Gladstone (S)** — the full ramp including the maroon deep end; salmon midpoints gone.
- [ ] **9.4 i18n sweep (S)** — grep audit for hardcoded strings across all new components; move to `messages.json`.
- [ ] **9.5 Analytics wiring + docs (S)** — wire the three events; document them in `docs/analytics.md`.
- [ ] **9.6 Hallway test kit (S)** — script, the three questions ("where's the pain?", "where's relief coming from?", "would you wait here or walk?"), recording sheet.
- [ ] **9.7 Run the hallway test (S)** — five riders, map only, no computed advice on screen; record results against the acceptance bar.
- [ ] **9.8 Docs update (S)** — README/CODEMAP entries for the palette module, legend, chevrons and smoothing.
