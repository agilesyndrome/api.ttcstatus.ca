# lite.ttcstatus.ca — a text-only status board, served like it's 1989

Status: **proposal v3.** Supersedes v2. Owner decisions locked: the host is
`lite.ttcstatus.ca`; Files, The Grapevine, splash theatrics, doors and the
goodbye screen are gone. v3 changes: the homepage's first block is a **diggable
stop lookup** (route number → cross-street letter → pick from five), and the
old bulletins page is gone — a feed-health page exists only to show **closures
observed by the live feed**.

## 0. What you actually wanted from a transit BBS in the 80s

The two interfaces with a forty-year service record are the station departure
sheet and the dial-a-bus phone menu. This board is both:

1. **Let me dig to my stop in three moves.** Route number, first letter of the
   cross street, pick from five. The phone lines had this figured out decades
   ago; the board copies them. It is the homepage's first block.
2. **Tell me what is broken right now, ranked.** Nobody pages through 3 000
   stop entries on a modem; the worst ten come first.
3. **Tell me how long since a car actually came** — observed, not promised.
4. **When the feed is blind, say so.** A blank with a timestamp beats a fake
   number (the recorder's honesty ladder already agrees: a blind spot is never
   a void).
5. **When cars stop coming through an arm, say that too** — as an observation.
   The feed carries no official advisories, so the board never invents them.
6. **Keep it cheap to serve and cheap to read.** Plain text, small pages, no
   session, no pictures.

Target renderers: **Lynx**, w3m, `curl | less`. Non-goals: JavaScript, CSS,
images, cookies, geolocation.

## 1. Design principles

1. **The dig comes first, the sheet second.** A rider arrived for _their_ stop;
   the lookup tree opens the homepage. The city-wide worst-first sheet follows
   for everyone else's situational awareness.
2. **Every number maps to a contract field.** The display vocabulary is
   `shared/service/contracts.ts`'s `StopServiceState`; the only "rendering act"
   is bucketing a continuous value into a word, the same way the map's legend
   does.
3. **79 columns, US-ASCII, HTML 3.2.** `<pre>` boards, one link per menu line.
   Not nostalgia — the constraint is what keeps pages small for the very
   clients this board exists for.
4. **Ranking honesty.** Only watched, real-data stops rank. `unmonitored`
   (feed blind spot) and `collecting` (insufficient history) stops never appear
   in a worst-performers list; blind spots are counted, not scored.
5. **No stale rankings.** An outage tick (`{ states: [], outage }`) renders the
   outage board — blank rankings plus a `since` timestamp — never a re-ranking
   of last-good data presented as current.
6. **The board informs; it never advises** — service-colour v3 doctrine. No
   alternate-route verdicts, no walk hints, no inference disclosure, and no
   invented closure causes: an observation window, stated plainly.
7. **No location, ever.** The board asks for a route number and a cross street,
   never coordinates; the fetch layer reuses the `hasLocationQuery` tripwire
   from `shared/http/api-queries.ts` so `?lat=` is rejected even by accident.
8. **Guests only.** No sessions, no cookies, no logon. Session-gated surfaces
   (`/api/v1/service/wave`, `/api/v1/sla/report`) stay off the board.

## 2. The pre-render pipeline

The ranking is the expensive part — ~3 k active directional stops per tick —
so it happens **once per refresh, not per request**.

- **Cadence:** a 1-minute cron on the existing API worker (the `scheduled`
  entrypoint already handles the SLA rollup cron; this adds one more arm).
  It reads the latest published stops tick document from the live R2 bucket —
  the 30 s grid of `shared/live/config.ts`, same as every other client — and
  renders at most ~90 s behind the field. If that ever needs to be 30 s, the
  same render function is invoked from the recorder's publish path after each
  tick publication; publish-side either way, never per-request.
- **Source data:** `live/t/<tickId>/service-stops.json` (and the vehicles tick
  document where a screen needs it). Internal R2 binding, not HTTP to the live
  host; never the recorder in memory; never GTFS.
- **The lookup tree is nearly free.** The route → cross-street-letter → stop
  tree derives from the published `StopDirectory` artifact, which changes only
  per network version — so the letter indexes are rendered and published once
  per import, not per tick. The per-tick render remains: homepage sheet,
  closures, outage board.
- **Publication:** rendered pages are written to the R2 bucket behind
  `lite.ttcstatus.ca` as immutable objects named by tick (`lite/t/<tickId>/…`,
  `lite/v/<networkVersion>/…`) with pointer objects for the current one — the
  same immutable-artifact + pointer pattern the tick documents already use. A
  request resolves the pointer, so a partially-written refresh is never
  half-served. ETags are the tick id / network version; a 30–60 s browser TTL
  means a caller refreshing harder than the board refreshes gets identical
  cached bytes.
- **Outage and blind handling:** an outage tick renders the outage board
  (§4.4). Per-stop `unmonitored` states render in their own counted section,
  never in the rankings or the closures list.

This is the same architectural posture as the outage-doc publish and the SLA
hourly folds: expensive folds happen at publication, request paths only read
materialized artifacts.

## 3. Field mapping (the whole display vocabulary)

| Board label    | Contract field (`StopServiceState`) | Notes                                                                                                |
| -------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| State          | `state`                             | `fresh` / `due` / `void` displayed; `unmonitored` / `collecting` counted, never ranked               |
| Since          | `minutesSince`                      | Elapsed since last observed touch — the absolute axis                                                |
| Typical gap    | `medianHeadwayOwnSeconds`           | Delivered baseline; an approximation by contract, stated without a caveat paragraph, as the map does |
| Now            | `dryness`                           | r = elapsed / delivered-own-headway; the self-relative axis                                          |
| Residual wait  | `expectedWaitSeconds`               | R(e) for a rider already waiting; omitted when null (no honest estimate)                             |
| Bunching       | `irregularity` (CV²)                | Bucketed to `calm` / `uneasy` / `high` — a rendering act, like the legend                            |
| Routes         | `routeIds`                          | Context and grouping only                                                                            |
| Watched        | `coverage.unmonitoredSeconds`       | Blind-spot accounting                                                                                |
| Cross street   | `StopDirectory` stop name           | The `AT <street>` token's first letter indexes the dig tree; directory is static per network version |
| Closure window | derived                             | Contiguous `void` span across _all watched_ stops of an arm — see §4.7                               |

## 4. The screens

### 4.1 Homepage — the dig, then the sheet (`/`)

Pre-rendered every minute from the latest tick. The lookup block is the first
content after the header — priority by position, not decoration. When the feed
observes closures, they rank immediately below the lookup; otherwise the
section is absent entirely (there is no bulletins page to hide it in).

```
 TTC SERVICE BOARD                                     Fri Oct 16 08:41:29 2026
 from field tick 09832 (08:41:00) -- refreshes every 60 s
=============================================================================

 FIND YOUR STOP
-----------------------------------------------------------------------------
   Route number: [____]

   Then: first letter of the nearest cross street, then pick your stop
   from a list of five.   Or dig by hand: [1] route index

 CLOSURES -- no service observed
-----------------------------------------------------------------------------
   501 QUEEN EB (KING - RIVER): no car through any of 12 watched stops
   since 08:05 (36 min).   [2] details

 WORST STOPS -- elapsed vs delivered headway, watched data only
-----------------------------------------------------------------------------
   stop   corridor                 since  typical  now    residual  state
   1485   501 QUEEN EB at JOHN      14m     6m      2.3x    11m     VOID
   9032   506 CARLTON WB at SPAD    11m     4m      2.7x     8m     DUE
   2077   52 LAWRENCE WB at KIP      9m     3m      3.0x     9m     DUE
   ...
   [3] full worst-stops board (50)

 WORST ARMS -- share of watched stops due or void
-----------------------------------------------------------------------------
   arm                        watched  due+void  worst residual  median now
   501 QUEEN EB                   41      9           11m          1.8x
   52 LAWRENCE WB                 37      7            9m          1.5x
   ...
   [4] full arms board

 UNWATCHED -- feed blind spots, counted not ranked
-----------------------------------------------------------------------------
   6 stops unmonitored > 10m:  2 on 52 LAWRENCE, 2 on 36 NWB SSE, ...

=============================================================================
   [S] stop lookup   [R] route index   [C] closures
   lite v1.0 | no cookies | no location | data is observed, not promised
=============================================================================
```

Rank definition, fixed and boring on purpose:

- **Stops:** among `due` and `void` states with non-null `dryness`, rank by
  `dryness` descending; tie-break `irregularity`, then `minutesSince`.
  `fresh` never ranks; `void` outranks any `due` by its unbounded dryness but
  carries its state label so a rider knows "late car" from "no car".
- **Arms:** group by `routeIds` + direction; an arm's rank is the share of its
  watched stops in `due`/`void`, tie-broken by median `dryness` and worst
  `expectedWaitSeconds`.
- **Blind spots:** `unmonitored` stops are summed per arm and listed as counts,
  deliberately excluded from rankings — a camera outage on Queen is not
  Queen's service getting worse.

### 4.2 The dig — route page (`/r/<route>`)

Static per network version (it is the `StopDirectory` wearing menus). Letters
present the cross streets that actually exist on the route, with counts.

```
 ROUTE 501 QUEEN                                       Fri Oct 16 08:41:29 2026
=============================================================================
 Pick the FIRST LETTER of the nearest cross street.

   Eastbound (toward KING):
     [A]3  [B]1  [D]2  [J]2  [K]4  [L]1  [P]3  [S]5  [U]2  [Y]1

   Westbound (toward DUNDAS):
     [B]2  [D]3  [J]1  [K]4  [L]2  [O]1  [R]2  [S]6  [T]2  [Y]1

=============================================================================
   [1] both directions on one arm board   [2] route index   [M] the sheet
=============================================================================
```

### 4.3 The dig — cross-street page (`/r/<route>/<letter>`)

Rendered on demand (it merges the static directory slice with the live tick
slice) and cached 30–60 s. Five stops per page, numbered — the pick — with
their live state inline, because seeing which of the five is already broken is
half the reason to dig at all. The states make this a per-tick page, but a
cheap one: one route-letter slice of two artifacts.

```
 501 QUEEN EB - cross streets starting with J          Fri Oct 16 08:41:29 2026
=============================================================================
 Pick your stop:

   [1] QUEEN ST W AT JOHN ST        DUE   since 14m   r 2.3x
   [2] QUEEN ST W AT JARVIS ST      FRESH since  2m
   [3] QUEEN ST W AT JAMES ST       FRESH since  4m
   [4] QUEEN ST E AT JARVIS AV      VOID  since 31m
   [5] QUEEN ST E AT JEFFERY AV     DUE   since  7m   r 1.2x

   [6] more J stops

=============================================================================
   [L] another letter   [R] route 501 again   [M] the sheet
=============================================================================
```

### 4.4 The outage board

Published when the tick document carries `outage`. The honest blank:

```
 TTC SERVICE BOARD                                     Fri Oct 16 08:41:29 2026
=============================================================================

 FIELD UNAVAILABLE SINCE 08:32:00

 The recorder could not assemble the service field for tick 09832.
 Rankings are withheld rather than re-computed from stale data.

 Last good field: tick 09820 (08:31:00)

=============================================================================
   [S] stop lookup
=============================================================================
```

### 4.5 Stop board (`/stop/<id>`)

Rendered on demand from the published tick document (plus the stop's
`service/history` for the 30-minute strip), short edge TTL. One stop, all
directions, the rider's actual question answered in numbers.

```
 STOP 1485 - QUEEN ST W AT JOHN ST                     Fri Oct 16 08:41:29 2026
=============================================================================

  Eastbound (501 toward KING)                      Westbound (501 toward DUNDA)
  ---------------------------                      ----------------------------
  State  ........ DUE                              State  ........ FRESH
  Since  ........ 14 min                           Since  ........  3 min
  Typical gap ... 6 min                            Typical gap ... 5 min
  Now (r) ....... 2.3x                             Now (r) ....... 0.6x
  Residual wait . 11 min                           Residual wait .  4 min
  Bunching ...... uneasy                           Bunching ...... calm

  Last 30 min:  ..###.####.##..###.#.##.####..##   .##.####.##..#.#.#####.####

=============================================================================
   [1] refresh   [2] arm: 501 QUEEN EB   [3] dig from route 501   [M] the sheet
=============================================================================
```

- The strip is the recorded observation matrix, one char per minute, oldest
  first — the text twin of the web UI's 5-minute slivers.
- The `unmonitored` variant states the blind spot with the coverage `since`
  instead of guessing numbers.

### 4.6 Arm board (`/arm/<route>/<dir>`)

The corridor view folded from the same tick — every stop on the arm in pattern
order, worst at top. This is "where along Queen is it broken".

```
 ARM 501 QUEEN EB - toward KING                       Fri Oct 16 08:41:29 2026
=============================================================================
   stop   name                     since  typical  now   state
   1485   QUEEN ST W AT JOHN ST     14m     6m     2.3x  VOID
   1501   QUEEN ST W AT SPADINA     12m     6m     2.0x  DUE
   1520   QUEEN ST W AT BATHURST     8m     6m     1.3x  DUE
   1544   QUEEN ST W AT UNIVERSITY   2m     6m     0.3x  FRESH
   ...
   6 stops of 41 watched are due or void. 2 unmonitored stops not listed.
=============================================================================
   [1] stop boards   [2] the sheet   [3] route index
=============================================================================
```

### 4.7 Closures — observed, not announced (`/closures`)

The live feed carries no advisories, so the board publishes the one closure
signal it honestly has: **no service observed**. An arm qualifies when every
watched stop on it has been `void` — no car through — continuously for ≥ 30
minutes, within a service day in which the arm already had observed touches
(so a route's scheduled overnight gap never reads as a closure). The page
exists only when there is something to show; when no arm qualifies, the
pointer is not published and the homepage omits the section. Causes are never
stated: the board reports the window, never the why.

```
 CLOSURES -- observed by the feed, not announced       Fri Oct 16 08:41:29 2026
=============================================================================

   501 QUEEN EB (KING - RIVER)
     No car through any of 12 watched stops since 08:05:00 (36 min).
     Earlier today: 14 cars through this arm, last observed 08:04:59.

   52 LAWRENCE WB (KIPLING - MARTIN GROVE)
     No car through any of 9 watched stops since 08:09:00 (32 min).

=============================================================================
   The board states observations, never causes.
   [1] arm: 501 QUEEN EB   [2] arm: 52 LAWRENCE WB   [M] the sheet
=============================================================================
```

## 5. URL scheme

| URL                   | Screen              | Render                                                    |
| --------------------- | ------------------- | --------------------------------------------------------- |
| `/`                   | Dig + sheet         | Pre-rendered per tick                                     |
| `/r/<route>`          | Dig: letter index   | Pre-rendered per network version                          |
| `/r/<route>/<letter>` | Dig: pick from five | On demand, cached (live states)                           |
| `/stop/<stopId>`      | Stop board          | On demand, cached                                         |
| `/arm/<route>/<dir>`  | Arm board           | On demand, cached                                         |
| `/closures`           | Observed closures   | Pre-rendered per tick, pointer exists only when non-empty |

The single form on the homepage is the route-number lookup (`GET
/r?route=<number>` → 301 to `/r/<route>`). Every later dig step is a link, so
the whole tree is traversable with number keys — the phone-menu flow, one
keystroke per level. Search is navigation, not a session; there is nowhere
else for state to live and nothing wants it.

## 6. Implementation — within the bounds of what we can do quickly

Deliberately **not** a new worker or a new repo application. The smallest
change that respects the architecture:

```
workers/api/src/lite/
  publish.ts      cron arm: latest tick docs -> render -> publish (R2)
  render/         PURE: tick documents + directory -> HTML 3.2 strings
    sheet.ts      homepage ranking, closures, outage board
    dig.ts        letter index (per network version) + pick-from-five pages
    stop.ts       stop board
    arm.ts        arm board
    text.ts       escaping, column layout, the 79-column assert
```

- One new cron arm in `workers/api/src/index.ts`'s existing `scheduled`
  handler, beside the SLA rollup. The R2 bucket/host for `lite.` is one
  wrangler binding plus one routes entry, mirroring how `live.ttcstatus.ca`
  was attached.
- **Cross-street indexing** parses the `AT <street>` token out of published
  stop names (`QUEEN ST W AT JOHN ST` → `J`). Good enough for a dig tree; a
  rider who cannot find their street by letter still has the arm board one
  level away.
- **Closure derivation** is a fold over the tick document's states: an arm
  qualifies when all watched stops are `void` with `lastTouchAt` at least 30
  minutes old and the arm had observed touches earlier in the service day.
  Pure, testable, and honest — it says "no car observed", never "closed".
- `render/` imports no I/O and no browser code — the same purity split
  `npm run check:boundaries` already enforces. Publish-side touches only
  published artifacts, so the no-fallback doctrine ("the live tick path is the
  only transport") is untouched: nothing here reads the recorder per request.
- No new dependencies. The renderer is a few hundred lines of string building
  with one HTML-escaping function; a 1989 client's dependency budget is zero,
  so the server's matches.
- On-demand pages (pick-from-five, stop, arm) are rendered at the edge from
  the published tick document and cached 30–60 s; their cost is one R2 read
  plus slicing ~3 k rows to one route-letter or one route — cheap enough to
  skip pre-rendering thousands of pages per tick.

## 7. Tests

`tests/lite/`:

1. **ASCII purity** — every rendered byte in `0x20..0x7E` plus `\n`.
2. **79 columns** — max line length across every screen.
3. **Ranking determinism** — same tick document → byte-identical sheet; ties
   broken exactly as §4.1 specifies.
4. **Ranking honesty** — `unmonitored`/`collecting`/`fresh` stops never appear
   in a ranking; outage docs render the outage board; blind spots are counted
   per arm, not scored.
5. **Dig tree** — letter indexes are deterministic per network version and
   contain only letters the route actually serves; pick-from-five pages show
   at most five stops plus the `[6] more` affordance; every numbered link
   resolves to a real stop in the directory slice.
6. **Closure honesty** — the 30-minute `void`-across-watched-stops rule and
   the earlier-touches guard are asserted; an overnight-scheduled gap does not
   produce a closure; `unmonitored` stops never contribute; the page pointer
   is absent when no arm qualifies.
7. **No location** — the fetch layer rejects `lat`/`lon` tripwires via
   `hasLocationQuery`; rendering accepts no coordinate inputs at all.
8. **One form** — exactly one `<form>` system-wide, `method="get"`.
9. **Golden screens** — snapshot the homepage (fresh, outage, and with/without
   closures) and one stop board.

## 8. Deliberately unbuilt

- **Session surfaces** (`/service/wave`, SLA report): would need the "access
  code" bearer-token-in-a-form pattern; a real design question, parked.
- **Touch-tone parity**: emitting the dig tree as an actual IVR menu over a
  telephony gateway is left as the joke it deserves to remain.
- **ANSI/telnet gateway**: the render core with a colour sink.
- **Gopher**: the URL scheme is already hierarchical menus; the architecture is
  gopher-compatible the day anyone cares.

## 9. Why this earns its keep

The users a text board serves best — screen readers, feature phones, serial
terminals, satellite links, `curl` during an outage — are the users the rich
map serves worst by construction. The no-location doctrine means the board
never asks for GPS it cannot receive; publish-side pre-rendering means the
edge serves a Lynx caller as cheaply as a React caller; the dig is the phone
menu and the sheet is the departure board — the two transit text interfaces
with a forty-year service record, both built from published, location-free
broadcast artifacts that already exist. The work is one fold, one cron arm,
and a CI gate that keeps it in 79 columns.
