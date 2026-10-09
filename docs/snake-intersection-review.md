# Streetcar Snake intersection review

Every switch on the derived snake board was audited for driver awareness and
playable track design. `scripts/checks/check-snake-intersections.mjs`
(`npm run test:snake:intersections`) walks all 90 switch approaches of the
fixture-derived board and enforces the contract below on every build.

## The contract

1. **Short branch names.** A switch button names its place in one or two
   words: "Ossington", "Bathurst", "Humber Loop", "501 Queen". The explorer's
   descriptive infrastructure sentences ("Bathurst physical connection to St
   Clair", "Simple game access to TTC barns") never reach the cockpit:
   `buildSnakeMap` shortens every infrastructure name for the game board
   (`shortGameName`), and barn spurs get a per-barn word ("Roncesvalles",
   "Russell") instead of a shared generated sentence.
2. **The label always matches the wheel.** Turns are classified from the
   map-space heading change the driver actually sees: ≥168° is a u-turn, ≥24.1°
   left or right, otherwise straight. The audit verifies every label against
   its measured angle — [Left] turns left on screen, every time.
3. **Left on the left, straight in the center, right on the right.** Choices
   are sorted by angle, so the button row mirrors the fork on the map.
   Coincident duplicate rails of one corridor (the same track represented by
   two source edges) used to render identical twin branches — "two lefts",
   "two spaces", or a bogus four-way turnout. The engine now merges twins
   (same angle within 2.5° and a shared route) into a single choice, keeping
   the richer label and all routes. Distinct spurs like a yard lead at the
   same angle stay separately clickable.
4. **Never four options.** Every switch offers at most left, straight and
   right. U-turns are last-resort answers that no longer appear while a real
   branch exists, and the twin merge above removes four-way turnout
   artifacts. The audit asserts zero four-option switches.
5. **Names carry a word and a number.** Scheduled branches read
   "[Left] 501 Queen" (number first); subway branches read like platform
   signage, "Line 2" (order swapped). Night routes (301, 310, …) never
   appear — their daytime number already names the same track.

## Fixes made in this review

- `shared/map/game-map.ts`: `shortGameName` shortens infrastructure names on
  the game board only (the explorer bundle keeps its descriptive sentences);
  barn access edges carry per-barn infrastructure ids named after the barn.
- `web/ui/features/snake/engine.ts`: `switchLabel` takes the final place
  string; `branchPlace` builds it from short infrastructure words and daytime
  route numbers/names; `buildChoices` merges coincident twin branches and
  suppresses u-turns at real forks; hazard banners and pace-car labels skip
  night routes; yard-route scoring also reads infrastructure ids because the
  shortened names no longer contain the word "barns".
- `scripts/checks/check-snake-intersections.mjs`: the audit above is now a
  permanent check wired as `npm run test:snake:intersections`.

## Remaining informational findings

Six approaches have genuine same-side forks — two real branches that share a
turn label but diverge by 26° or more on screen (for example a hard left onto
504 King at -146° beside a slight left onto 501 Queen at -55°). Each has a
distinct button and a distinct on-screen direction, so driver awareness
holds; whether to simplify those junctions is a track-data decision, printed
by the check for follow-up:

- node:196 — 505 Dundas and 504 King splitting gradually (both read straight)
- node:29 — 504 King hard left beside 501 Queen slight left
- Roncesvalles barn entry — 501/508 Queen and 504 King rights into the carhouse
- node:252 / node:304 — the Ossington diversion track beside 505 Dundas
- node:171 — 501/508 Queen and 504 King after the corridor merge

The fixture board carries no subway routes, so the "Line 2 towards Vaughan"
platform-signage format (destination text) is implemented up to "Line N";
adding the towards-destination requires branch-destination data the map does
not yet publish.
