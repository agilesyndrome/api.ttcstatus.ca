# Service colour proposal v2 — gradient legend, mode-owned colour, chevrons, inferred gaps

Status: **proposal — no code written yet.** This doc supersedes the v1 critique's
defaults where the owner has decided (legend = gradient bar; never collapse twin
streams; smooth over small no-data stretches; opt-in colourblind modes saved to
the user profile). Source of the review: three 8:53–8:54 screenshots of the
Roncesvalles–Queen–King, College–Dufferin and Dundas–Gladstone corners against
`web/ui/features/service/wave-field.ts`.

---

## 0. The diagnosis, restated in one line

The map runs two colour languages at once — route identity (501 Queen red
`#cf3f48`, 504 King orange `#de762c`, 506 Carlton green `#4c8662`, from
`shared/map/palette.ts`) and service health (`STATE_COLORS` green/amber/red/grey
in `wave-field.ts`) — while painting a continuous sRGB gradient whose midpoints
(olive, salmon, maroon) appear nowhere in the 4-swatch legend.

## 1. Design principles (unchanged from the codebase's own ethics)

1. **One owner of hue per mode.** Colour confusion is resolved by *mode*, not by
   repainting one system to dodge the other.
2. **Colour is never the only channel** — direction gets chevrons, severity gets
   a position on a labelled scale, "inferred" gets translucency.
3. **The rider's question is the metric** — the ramp means minutes, and the
   legend speaks minutes.
4. **Paint may smooth, data never lies** — stop-state machines and SLA math are
   untouched by any inference (§5).
5. **Accessibility is opt-in, not separate** — colourblind palettes are a first
   class setting, saved to the profile, applied everywhere the ramp appears.

## 2. Mode model — who owns colour where (decisions #2, #3)

The three-way control already exists (`ExplorePanel.tsx`: `off / vehicles /
service`; persisted in `default-view.ts`). Colour ownership becomes mode-dependent:

| Mode (`live` + `serviceOverlay`) | Track base | Streams/pills | Legend |
| --- | --- | --- | --- |
| **Service** (`live ✓, overlay ✓`) | Neutral hairline casing (grey) — route colours step back | Service ramp owns hue; route identity = **numbered pills along the corridor** (like street-name labels) | Gradient bar + minutes ticks (§3) |
| **Vehicles only** (`live ✓, overlay ✗`) | Route colours own the tracks — today's classic transit-map look | Vehicle markers in route colour; **chevrons in route colour** show travel direction (§4); route pills optional (redundant) | Route colour key (the classic map legend) |
| **Map only** (`live ✗`) | Route colours own the tracks | Nothing live | Route colour key |

- In Service mode the pills carry the route number + a small route-colour chip,
  so identity survives without flooding the canvas with red/green/orange lines.
- The legend **always swaps with the mode** — never show the service gradient in
  vehicles-only mode. This single rule kills the "is that red Queen or a gap?"
  ambiguity by construction, not by tuning.
- Subway handling is unchanged (`E7S7`): subway tracks never join the service
  field; in Service mode they keep route colours with pills, which now *reads*
  as "no service verdict here" rather than colliding with the ramp.

**Pills (decision #2):** drawn like street-name labels — rounded chip, halo,
route number in route colour, e.g. `⬤ 501`. Placement reuses the live map's
label layer; respect the existing `filters.labels` toggle; collision-avoid with
stop labels (§6). In vehicles/map-only mode, pills become optional/redundant and
default off (the route colours already carry identity — "adds depth and
interest" is the mode's own look).

## 3. The gradient-bar legend (decision #1, #6, #10)

Replace the 4-dot `map-service-legend` (`HomeWorkspace.tsx`) with a **continuous
gradient bar that literally shows the paint**:

- **Rendering:** the bar's CSS gradient is generated from `drynessColor` itself
  (sample ~24 stops across dryness 0 → 3.5). Legend can never drift from the map
  — same function, one source of truth.
- **Axis labels (rider minutes, decision #6):** the ramp quantity stays
  self-relative dryness (fair across frequent and infrequent routes), but the
  bar is annotated with the rider translation: `just went · waiting longer than
  usual · a real gap (2× usual · 15+ min)`. The stop card already computes
  `expectedWaitSeconds`; its headline leads with minutes (decision #6's spirit —
  a continuous scale, not buckets).
- **The deep end (decision #10):** maroon (> 2× usual) is simply the bar's far
  end, ticked `15+ min`. No separate explanation needed; the clamp
  `(dryness − 2) / 1.5` stays.
- **Interaction (decision #12):** press/tap a position on the bar (or a word
  anchor) → all stretches not in that state dim to ~0.15 opacity; a one-line
  explainer appears ("2× the usual wait — plan another way"). Release/second tap
  clears. Analytics: `legend-highlight` events.
- **Grey notch (decision #5 side-effect):** a small dotted-grey notch at the bar's
  end labelled "no live data (soft = inferred)" survives only as long as
  unbridged gaps exist (§5).

## 4. Direction — the chevron system (decision #4)

Never collapse twin streams. Instead, direction gets a first-class channel.

- **Glyphs:** small chevrons (▸) riding each stream, pointing in the stream's
  travel direction. Implementation mirrors the flow-dash gate: chevrons render
  only where the segment is long enough on screen to carry one cycle
  (`DASH_CYCLE`-spaced, phase-synced to the existing dash phase so a corridor
  pulses as one current).
- **Motion:** at street zoom chevrons drift forward in the travel direction at
  the state's speed (`FLOW_SECONDS` — speed IS the service, kept); at city zoom
  chevrons are **static but still directional** (unlike flow dashes, they never
  vanish — direction must not be a zoom luxury). Reduced-motion: static
  chevrons, no drift — which finally gives a motion-independent direction cue.
- **Termini:** arrowheads at stream ends at terminals/loops.
- **Card ↔ stream matching:** the selected-stop ring draws two half-rings, each
  tinted with that side's current colour, and the card's direction rows repeat
  the same swatch + compass words ("← West · fresh"). The rider matches colour
  to side without reading the map's mind.
- **Trails:** the green clearing-trail carries chevrons too, so the clearing
  car's direction of rescue reads at a glance.
- **Bounds:** chevron DOM count is gated by `visibleEdges` culling + the
  same-length gate as flows; a per-edge chevron cap mirrors `MAX_SUBPIECES`.

## 5. No data — smooth the curve, guess carefully (decision #5 — detailed)

Today: blind stretches paint grey-dashed, and `sampleAt` holds the nearest
visible neighbour through them. One-sided gaps at edge ends already inherit the
neighbour's value; a fully-blind stretch reads as broken (the grey dashes in the
screenshots). Also latent: a non-blind anchor with `dryness === null` is coerced
to `0` (fresh) in `sampleAt`'s mixing (`?? 0`) — an accidental, undocumented
guess. The plan replaces both with one explicit, bounded inference model:

**Algorithm (paint-time only):**

1. **Classify** each blind stretch while painting an edge: measure its span in
   metres between bounding *visible* anchors (or edge end).
2. **Micro-gap bridging:** if the span ≤ `SERVICE_BRIDGE_MAX_METRES`
   (**default 600 m** — bridges exactly one blind stop at typical downtown
   surface spacing of ~250–300 m, where a single hidden stop spans ~500–600 m
   between its visible neighbours; two consecutive blind stops span ~750 m+ and
   stay grey), fill with the existing smoothstep interpolation between the
   bounding anchors. Result: a continuous gradient, no grey, no visible seam.
3. **One-sided bridging:** a blind run from the edge end inward holds the inner
   anchor's value across the same cap, then falls back to grey-dashed beyond it
   (unknown drifts into the distance; we don't guess the whole suburb).
4. **Void restraint:** if either bounding anchor is `void`, bridging uses a
   shorter cap, `SERVICE_VOID_BRIDGE_MAX_METRES` (**default 150 m** — less than
   one stop spacing, so beyond a single short block a void-adjacent blind
   stretch paints grey); interpolation is monotone between anchors so bridging
   can never *create* a void between two healthy stops — but we also refuse to
   *accuse* a long blind stretch of a gap.
5. **Inferred styling:** bridged stretches paint the state colour at **0.65
   opacity** — a fixed style constant (not an env knob), chosen to read clearly
   softer than the 0.95 measured lines at 2–3 px stream width — with
   `data-inferred="true"` on the segment. Legend: "soft colour = inferred
   through a small blind spot." The eye learns measured vs inferred
   without a second hue.
6. **Cross-edge boundaries:** bridging stays per-edge in v1 (a gap at an edge
   seam does not leak into the neighbour corridor). Phase 2 may bridge across
   junction vertices when both edges share a route id.

**Why this is honest:**

- **Data never changes.** `drynessAndState`, stop cards, SLA rollups and the
  stop-state machine are untouched — a blind stop's card still says "we can't
  see this stop right now." Inference is a *paint smoothing*, scoped to
  `edgeServiceSegments`, never a state fabrication.
- **The worst-position rule survives:** `anchorsOfEdge` still takes the worst
  dryness of co-located directions; bridging happens downstream, per direction.
- **Time stays true:** anchors re-derive from live dryness each repaint; an
  inferred stretch ages correctly with the heartbeat.
- **Escape hatches:** both knobs follow the validated env-var pattern in
  `shared/service/config.ts` (`SERVICE_BRIDGE_MAX_METRES=600`,
  `SERVICE_VOID_BRIDGE_MAX_METRES=150`); 0 disables bridging entirely, restoring
  today's behaviour. Suggested validated ranges: 100–1500 m and 50–600 m.

**Locked knob settings (decided, ready to implement):** bridge cap 600 m,
void-restraint cap 150 m, inferred opacity 0.65 (style constant), and route
pills respect the existing `filters.labels` toggle (hidden when labels are off,
direction still carried by chevrons).
- **Tests:** `tests/service/wave-field.test.mjs` asserts the current
  blind-hold behaviour; the bridging cases are added alongside (small gap →
  smooth fill; long gap → grey; void-restraint cap; edge-end taper), and the
  `?? 0` coercion gets an explicit test that it's gone (a null-dryness anchor
  now participates in bridging instead of silently meaning "fresh").

## 6. Labels (decision #9)

- Stop-name labels move off the streams: offset chip with a leader line, or a
  rounded scrim behind the text so the halo never reads as a break in the band.
- Route pills (§2) join the same collision-avoid pass; `filters.labels` governs
  both together.
- Selected-stop ring z-order stays above the field but gets a thin casing so the
  gap being investigated remains visible beneath it.

## 7. Contrast — a final pass, not a first pass (decision #7)

Scheduled **after** the ramp redesign + chevrons + theming land, since those
change what contrast is measured against:

- Verify state streams ≥ 3:1 against canvas, water and the neutral track casing,
  in both themes, at stream width (~2–3 px on mobile); thicken lines as zoom
  decreases if needed.
- Amber is the known offender against cream (`#e0a63c` on `#f7f5ed` ≈ 1.9:1) —
  expect to darken it (≈ `#b97a10` family) once the ramp re-anchors.
- The flow dashes and chevrons inherit the final palette; audit them too.
- Full-opacity state lines (drop the 0.95/0.6 tricks) unless the audit says
  otherwise; "inferred" keeps its translucency as deliberate styling.

## 8. Colourblind modes — opt-in, saved to the profile (decision #8)

- **Modes:** `standard` · `redgreen` (deuteranopia/protanopia-safe ramp) ·
  `full` (blue–yellow/high-lightness ramp; Okabe–Ito-anchored). All three keep
  the same order (calm → waiting → gap) with lightness monotonicity so any mode
  survives greyscale.
- **Scope:** the palette module (§11) drives map streams, chevrons, the gradient
  bar, stop cards, SLA band inks (`--ok/--warn/--err`) and car tint — everywhere
  the ramp speaks, one switch.
- **Second channel rides along:** chevrons (direction) and inferred-translucency
  already exist; the red-green mode leans on lightness + the bar's axis labels.
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
    the client hydrates on sign-in and writes on change (conflict rule: last
    write wins; local value is the fallback until hydration lands).
- **Journey test:** a deuteranope must be able to answer "is this stop okay?"
  from the map alone in every mode; documented as the acceptance bar.

## 9. Dark mode + theming (decision #11)

- Promote the ramp from hardcoded hexes to a **theme-aware palette module**
  (single source used by map, legend, cards, inks): `tokens.css` keeps the CSS
  vars for panels; the map resolves colours in JS through the same values
  (`fieldPalette(theme, colourMode)`), since gradients/mixing happen in JS.
- Dark variants get real tuning (lightness flipped for dark canvas) instead of
  the current identical values; the gradient bar and legend re-render from the
  module, so dark mode is automatically honest.

## 10. Implementation plan

| Phase | Work | Files |
| --- | --- | --- |
| 1 | Palette module: theme + colourMode aware ramp; `?? 0` coercion removed | `wave-field.ts`, `tokens.css`, new `shared/map/field-palette.ts` |
| 2 | Gradient-bar legend + tap-to-highlight + mode-swapping legend | `HomeWorkspace.tsx`, `workspace-polish.css`, new `LegendBar.tsx` |
| 3 | Chevron system (glyphs, phase-sync, termini, trails, caps) | `TrackService.tsx`, `service.css`, `wave-field.ts` |
| 4 | Mode-owned colour: neutral casing in Service mode; route pills; vehicles/map-only unchanged look | `TrackLayer.tsx`, `TransitMap.tsx`, `ExplorePanel.tsx`, new `RoutePills.tsx` |
| 5 | No-data bridging + inferred styling + config knobs | `wave-field.ts`, `shared/service/config.ts`, `TrackService.tsx` |
| 6 | Label offsets/scrim | `TransitMap.tsx`, label styles |
| 7 | Contrast audit (both themes, all modes) + palette tweaks | palette module, tokens |
| 8 | Colourblind setting UI + local pref + DB migration + API | `SettingsPage.tsx`, new `ColourVisionSettings.tsx`, `usePreferences`, `migrations/0010_user_colour_mode.sql`, `workers/api/src/accounts/profiles.ts`, accounts routes |
| 9 | Tests, stories, docs | `tests/service/wave-field.test.mjs`, `*.stories.tsx`, README/CODEMAP |

Rollout: phases 1–3 ship behind the existing overlay config switch; the colour
setting is inert (default `standard`) until phase 8. Each phase is independently
shippable; nothing changes behaviour in vehicles/map-only modes except the
legend swap.

## 11. Completeness review (self-audit)

- **Performance:** chevrons add nodes → gated by the E5S1/E5S2 cull + length
  gates and a per-edge cap; gradient legend is one element; bridging adds no
  extra segments (it reuses subdivision). No new wake sources — the heartbeat
  engine (`earliestDeadlineMs`) already owns repaint timing; bridging changes
  paint, not scheduling.
- **Edge cases:** nearside platforms (worst-dryness rule kept); one-way voids
  (single stream paints — chevrons make its direction explicit at last);
  subway-only stops (unchanged exclusion); `collecting` (participates in
  bridging like unmonitored; legend collapses both into the grey notch);
  `filters.labels` off (pills hidden, direction still carried by chevrons).
- **Risks:** inferred stretches could be misread as measured — mitigated by
  translucency + legend note; void-restraint cap needs real-data tuning (config
  knobs + soak review scheduled); CVD palettes need in-situ validation with a
  simulator, not just math; pill collision on dense corridors (shared with stop
  labels, one pass).
- **Deliberately out of scope:** changing the dryness formula or thresholds;
  subway overlay; per-stop data model changes; a "minutes-ramp" alternative
  painting mode (revisit after the minutes-labelled legend ships — the gradient
  bar makes this a legend-only change if we ever want it).
- **Acceptance bar:** from the map alone, a rider can answer (a) which stream is
  my direction, (b) what this colour means in minutes, (c) which stretches are
  measured vs inferred — in any mode, both themes, and all three colour modes;
  and no hue on screen is unexplained by the legend in view.
