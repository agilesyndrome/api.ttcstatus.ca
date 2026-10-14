# lite.ttcstatus.ca — a text-only status board, served like it's 1989

Status: **proposal v2.** Supersedes the BBS-flavoured v1. Owner decisions locked
since v1: the host is `lite.ttcstatus.ca`; Files and The Grapevine are dropped;
the splash theatrics, doors and goodbye screen are dropped with them. What
remains is the part that was ever worth building: **a pre-rendered, worst-first
service board over text protocols.**

## 0. What you actually wanted from a transit BBS in the 80s

Not doors, not ANSI art, not caller lists. The real product was the station
departure sheet, and a good board operator ran it with four rules:

1. **Tell me what is broken right now, ranked.** Nobody wants to page through
   3 000 stop entries on a modem; they want the ten worst things first.
2. **Tell me how long since a car actually came** — observed, not promised.
3. **When your feed is blind, say so.** A blank with a timestamp beats a fake
   number. (The recorder already agrees: the honesty ladder in
   `workers/api/src/service/stops-tick-doc.ts` — a blind spot is never a void.)
4. **Keep it cheap to serve and cheap to read.** Plain text, small pages, no
   session, no pictures.

lite.ttcstatus.ca is those four rules over HTTP/HTML 3.2, rendered for Lynx,
w3m, and `curl`. Everything it displays is broadcast data that already exists.

Target renderers: **Lynx**, w3m, `curl | less`. Non-goals: JavaScript, CSS,
images, cookies, geolocation.

## 1. Design principles

1. **The homepage is the product.** One pre-rendered document, refreshed with
   the field, worst performers up front. Everything else links from it.
2. **Every number maps to a contract field.** No derived vibes, no invented
   scores. The display vocabulary is `shared/service/contracts.ts`'s
   `StopServiceState`; the only "rendering act" is bucketing a continuous value
   into a word, the same way the map's legend does.
3. **79 columns, US-ASCII, HTML 3.2.** `<pre>` boards, one link per menu line.
   Not nostalgia — the constraint is what keeps pages small for the very
   clients this board exists for.
4. **Ranking honesty.** Only watched, real-data stops rank. `unmonitored`
   (feed blind spot) and `collecting` (insufficient history) stops never appear
   in a worst-performers list; blind spots are counted, not scored.
5. **No stale rankings.** If the latest tick is an outage document
   (`{ states: [], outage }`), the homepage publishes as the outage board —
   blank rankings plus a `since` timestamp — never a re-ranking of last-good
   data presented as current.
6. **The board informs; it never advises** — service-colour v3 doctrine holds
   here too. No alternate-route verdicts, no walk hints, no inference disclosure.
7. **No location, ever.** The board asks for a stop number, never coordinates;
   the fetch layer reuses the `hasLocationQuery` tripwire from
   `shared/http/api-queries.ts` so `?lat=` is rejected even by accident.
8. **Guests only.** No sessions, no cookies, no logon. The session-gated
   surfaces (`/api/v1/service/wave`, `/api/v1/sla/report`) stay off the board.

## 2. The pre-render pipeline

The ranking is the expensive part — ~3 k active directional stops per tick —
so it happens **once per refresh, not per request**. That is what makes the
board cheap enough to serve to a modem over and over.

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
- **Publication:** rendered pages are written to the R2 bucket behind
  `lite.ttcstatus.ca` as immutable objects named by tick (`lite/t/<tickId>/…`)
  with a pointer object for the current one — the same immutable-artifact +
  pointer pattern the tick documents already use. A request resolves the
  pointer, so a partially-written refresh is never half-served. ETag is the
  tick id; a 30–60 s browser TTL means a caller refreshing harder than the
  board refreshes gets identical cached bytes.
- **Outage and blind handling:** an outage tick renders the outage board
  (§4.1). Per-stop `unmonitored` states render in their own counted section,
  never in the rankings.

This is the same architectural posture as the outage-doc publish and the SLA
hourly folds: expensive folds happen at publication, request paths only read
materialized artifacts. The board is one more fold of one more artifact.

## 3. Field mapping (the whole display vocabulary)

| Board label     | Contract field (`StopServiceState`) | Notes |
| --------------- | ----------------------------------- | ----- |
| State           | `state`                             | `fresh` / `due` / `void` displayed; `unmonitored` / `collecting` counted, never ranked |
| Since           | `minutesSince`                      | Elapsed since last observed touch — the absolute axis |
| Typical gap     | `medianHeadwayOwnSeconds`           | Delivered baseline; an approximation by contract, stated without a caveat paragraph, as the map does |
| Now             | `dryness`                           | r = elapsed / delivered-own-headway; the self-relative axis |
| Residual wait   | `expectedWaitSeconds`               | R(e) for a rider already waiting; omitted when null (no honest estimate) |
| Bunching        | `irregularity` (CV²)                | Bucketed to `calm` / `uneasy` / `high` — a rendering act, like the legend |
| Routes          | `routeIds`                          | Context and grouping only |
| Watched         | `coverage.unmonitoredSeconds`       | Blind-spot accounting |

## 4. The screens

### 4.1 Homepage — the sheet (`/`)

Pre-rendered every minute from the latest tick. Worst stops first, worst arms
second, blind-spot accounting third. Nothing else outranks this content.

```
 TTC SERVICE BOARD                                     Fri Oct 16 08:41:29 2026
 from field tick 09832 (08:41:00) -- refreshes every 60 s
=============================================================================

 WORST STOPS -- elapsed vs delivered headway, watched data only
-----------------------------------------------------------------------------
  stop   corridor                 since  typical  now    residual  state
  1485   501 QUEEN EB at JOHN      14m     6m      2.3x    11m     VOID
  9032   506 CARLTON WB at SPAD    11m     4m      2.7x     8m     DUE
  2077   52 LAWRENCE WB at KIP      9m     3m      3.0x     9m     DUE
  6410   36 NWB SSE EB at KEELE     8m    10m      0.8x     2m     DUE
  ...
  [1] full worst-stops board (50)     [2] stop 1485   [3] stop 9032 ...

 WORST ARMS -- share of watched stops due or void
-----------------------------------------------------------------------------
  arm                        watched  due+void  worst residual  median now
  501 QUEEN EB                   41      9           11m          1.8x
  52 LAWRENCE WB                 37      7            9m          1.5x
  506 CARLTON WB                 29      5            8m          1.4x
  ...
  [4] full arms board             [5] arm: 501 QUEEN EB

 UNWATCHED -- feed blind spots, counted not ranked
-----------------------------------------------------------------------------
  6 stops unmonitored > 10m:  2 on 52 LAWRENCE, 2 on 36 NWB SSE, ...

=============================================================================
  [B] bulletins (feed health)   [S] stop lookup   [R] route index
  lite v1.0 | no cookies | no location | data is observed, not promised
=============================================================================
```

Rank definition, fixed and boring on purpose:

- **Stops:** among `due` and `void` states with non-null `dryness`, rank by
  `dryness` descending; tie-break `irregularity`, then `minutesSince`.
  `fresh` never ranks; `void` (no car for the whole window) outranks any `due`
  by definition of its dryness growing unbounded, but is displayed with its
  state so a rider knows the difference between "late car" and "no car".
- **Arms:** group by `routeIds` + direction; an arm's rank is the share of its
  watched stops in `due`/`void`, tie-broken by the arm's median `dryness` and
  worst `expectedWaitSeconds`.
- **Blind spots:** `unmonitored` stops are summed per arm and listed as counts.
  They are deliberately excluded from both rankings — a camera outage on
  Queen is not Queen's service getting worse.

### 4.2 The outage board

Published when the tick document carries `outage`. The honest blank:

```
 TTC SERVICE BOARD                                     Fri Oct 16 08:41:29 2026
=============================================================================

 FIELD UNAVAILABLE SINCE 08:32:00

 The recorder could not assemble the service field for tick 09832.
 Rankings are withheld rather than re-computed from stale data.

 Last good field: tick 09820 (08:31:00)

=============================================================================
  [B] bulletins   [S] stop lookup
=============================================================================
```

### 4.3 Stop board (`/stop/<id>`)

Rendered on demand from the same published tick document (plus the stop's
`service/history` for the 30-minute strip) with a short edge TTL. One stop, all
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
  [1] refresh   [2] arm: 501 QUEEN EB   [3] another stop   [M] the sheet
=============================================================================
```

- The strip is the recorded observation matrix, one char per minute, oldest
  first — the text twin of the web UI's 5-minute slivers.
- The `unmonitored` variant of this board states the blind spot with the
  coverage `since` instead of guessing numbers.

### 4.4 Arm board (`/arm/<route>/<dir>`)

The corridor view folded from the same tick — every stop on the arm in pattern
order, worst at top. This is the "where along Queen is it broken" page.

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
  [1] stop boards   [2] the sheet   [3] arm index
=============================================================================
```

### 4.5 Bulletins (`/bulletins`)

Feed health, plain: deployed version, network version, tick publication
latency, outage history for the day, blind-spot summary. This replaces v1's
"system board" — it is the operator's page, not decoration. Pre-rendered with
the sheet, so it is itself a record of the pipeline's health.

```
 BULLETINS -- feed health                              Fri Oct 16 08:41:29 2026
=============================================================================

 FIELD
   latest tick ........... 09832 (08:41:00)   age 29 s, publishing normally
   outage today .......... 1 -- 07:58:00 to 08:03:30 (4m 30s)
   blind spots now ....... 6 stops unmonitored > 10m

 SOFTWARE
   lite render ........... v1.0 (2026.10.14)
   network version ....... N-2026.10.14
   api version ........... 2026.10.14.2

 PUBLICATION
   sheet rendered at ..... 08:41:31 from tick 09832
   render cost ........... 1.9 s for 3012 stops
   last 12 renders ....... 60 s apart, no misses

=============================================================================
  [1] the sheet   [2] stop lookup   [M] menu
=============================================================================
```

The "last 12 renders" line is the board auditing itself — the publication
history is the one place the pipeline's own health is user-facing.

## 5. URL scheme

| URL                    | Screen         | Render        |
| ---------------------- | -------------- | ------------- |
| `/`                    | The sheet      | Pre-rendered per tick |
| `/stop/<stopId>`       | Stop board     | On demand, cached |
| `/arm/<route>/<dir>`   | Arm board      | On demand, cached |
| `/bulletins`           | Feed health    | Pre-rendered with the sheet |

The single form on the sheet is the stop-number lookup (`GET /stop?n=<number>`
→ 301 to the stop board). Search is navigation, not a session; there is
nowhere else for state to live and nothing wants it.

## 6. Implementation — within the bounds of what we can do quickly

Deliberately **not** a new worker or a new repo application. The smallest
change that respects the architecture:

```
workers/api/src/lite/
  publish.ts      cron arm: latest tick docs -> render -> publish (R2)
  render/         PURE: tick documents -> HTML 3.2 strings
    sheet.ts      homepage ranking + outage board
    stop.ts       stop board
    arm.ts        arm board
    text.ts       escaping, column layout, the 79-column assert
```

- One new cron arm in `workers/api/src/index.ts`'s existing `scheduled`
  handler, beside the SLA rollup. The R2 bucket/host for `lite.` is one
  wrangler binding plus one routes entry, mirroring how `live.ttcstatus.ca`
  was attached.
- `render/` imports no I/O and no browser code — the same purity split
  `npm run check:boundaries` already enforces. Publish-side touches only
  published artifacts, so the no-fallback doctrine ("the live tick path is the
  only transport") is untouched: nothing here reads the recorder per request.
- No new dependencies. The renderer is a few hundred lines of string building
  with one HTML-escaping function; a 1989 client's dependency budget is zero,
  so the server's matches.
- On-demand pages (stop, arm) are rendered at the edge from the published tick
  document and cached 30–60 s; their cost is one R2 read plus slicing ~3 k
  rows to one route — cheap enough to skip pre-rendering every stop page.

## 7. Tests

`tests/lite/`:

1. **ASCII purity** — every rendered byte in `0x20..0x7E` plus `\n`.
2. **79 columns** — max line length across every screen.
3. **Ranking determinism** — same tick document → byte-identical sheet;
   ties broken exactly as §4.1 specifies.
4. **Ranking honesty** — `unmonitored`/`collecting`/`fresh` stops never appear
   in a ranking; outage docs render the outage board; blind spots are counted
   per arm, not scored.
5. **No location** — the fetch layer rejects `lat`/`lon` tripwires via
   `hasLocationQuery`; rendering accepts no coordinate inputs at all.
6. **One form** — exactly one `<form>` system-wide, `method="get"`.
7. **Golden screens** — snapshot the sheet (fresh + outage variants) and one
   stop board.

## 8. Deliberately unbuilt

- **Session surfaces** (`/service/wave`, SLA report): would need the "access
  code" bearer-token-in-a-form pattern; a real design question, parked.
- **ANSI/telnet gateway**: the render core with a colour sink.
- **Gopher**: the URL scheme is already hierarchical menus; the architecture is
  gopher-compatible the day anyone cares.

## 9. Why this earns its keep

The users a text board serves best — screen readers, feature phones, serial
terminals, satellite links, `curl` during an outage — are the users the rich
map serves worst by construction. The no-location doctrine means the board
never asks for GPS it cannot receive; publish-side pre-rendering means the
edge serves a Lynx caller as cheaply as a React caller; and the worst-first
homepage is not a novelty — it is the departure sheet, the one transit text
interface with a forty-year service record. Everything it needs already exists
as published, location-free broadcast artifacts. The work is one fold, one
cron arm, and a CI gate that keeps it in 79 columns.