# Shared schematic map contract

`snake-v1.2.0` keeps schema version 1 and the existing `routes`, `patterns`,
`paths`, `stops`, and `infrastructure` fields. It adds a shared corridor graph
and source/display correspondence. Existing renderers can still draw `points`.

| Field                                                    | Use                                                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graph.nodes[].id`, `edgeIds`                            | Build the game's node map and adjacency lists. IDs are deterministic for identical source data, not guaranteed across feed versions.                                                    |
| `graph.edges[].a`, `b`                                   | Endpoints of one reusable corridor segment.                                                                                                                                             |
| `graph.edges[].points`                                   | Display polyline, ordered from `a` to `b`.                                                                                                                                              |
| `graph.edges[].lengthMetres`                             | Advance the simulation in actual source metres. Display pixels are not metres.                                                                                                          |
| `graph.edges[].sourcePoints`                             | Simplified canonical coordinates in local east/north metres, using `display.reference`. Raw GTFS shapes remain in D1.                                                                   |
| `graph.edges[].sourceDistances`                          | Source distance at each display vertex, including the warp's slope changes.                                                                                                             |
| `graph.edges[].routeIds`, `pathIds`, `infrastructureIds` | Service and infrastructure membership. One edge can carry multiple routes.                                                                                                              |
| `paths[].edgeRefs`                                       | Ordered `{ edgeId, direction }` traversal of the path. `1` means a→b; `-1` means b→a. Patterns still identify their `pathId`.                                                           |
| `graph.observedTurns`                                    | Directed edge transitions observed in source shapes. Absence does not prove a physical turn is impossible.                                                                              |
| `stops[].edgeId`, `distanceAlongMetres`, `edgeFraction`  | Optional position on a corridor. Stops over 100 metres from any matching-route corridor remain unattached.                                                                              |
| `stops[].sourcePoint`                                    | Original geographic cluster position before display track attachment.                                                                                                                   |
| `context`                                                | Approximate street/terminal labels, shoreline and north direction. Decorative; never use it to add tracks or switches.                                                                  |
| `excludedServices`                                       | Explicit replacement-bus patterns excluded from rail paths, stops and graph; original IDs and headsigns retained for auditing. Route IDs alone do not distinguish replacement buses.    |
| `paths[].gtfsSourcePoints`                               | Original projected GTFS vertices when a coarse scheduled path has been aligned to audited Queens Quay rail. `sourcePoints` and graph lengths then follow the mapped physical alignment. |
| `context.shorelineSource`                                | City of Toronto mainland shoreline attribution, retrieval date and simplification note. The shoreline follows the rail display transform, including warp breakpoints.                   |

To draw a vehicle at source distance `d` from edge endpoint `a`, find successive
entries `sourceDistances[i] <= d <= sourceDistances[i+1]`. Interpolate between
`points[i]` and `points[i+1]` using
`(d - sourceDistances[i]) / (sourceDistances[i+1] - sourceDistances[i])`.
For reverse traversal, use `lengthMetres - d`. This also puts snapped stops
exactly on the displayed rail. Calculate speeds and consist spacing in metres;
map historical tail samples to the display through the same correspondence.

For route missions, resolve each pattern's path and follow its directed edge
references rather than assuming every connected edge carries the mission route.
The graph describes an undirected corridor centreline. Directional virtual rails,
synthetic turnbacks, fictional closures and pickups remain game responsibilities.

The graph conservatively merges source vertices within 12 metres and splits
segments at nearby source vertices. It does not connect arbitrary line crossings.
This is an inferred graph, not a surveyed track/switch model: grade separation,
missing physical track, short loops below the snapping tolerance and unobserved
turn permissions require further infrastructure auditing. The bundled physical
Bathurst/Vaughan overlays connect St Clair to the main network. Their audited
endpoints can attach to matching scheduled corridors within 45 metres; unrelated
crossings do not gain switches. Other overlays restore rail absent during bus
substitutions, including Long Branch, western St Clair and Bingham. These physical
edges can be used for free-roam play but do not imply scheduled passenger service.
Games must still respect components in other feeds rather than invent connectors.

The local preview of the old fixture reconstructs approximate source coordinates
from rounded display pixels and records that limitation in `previewSource`.
Production uses canonical source data. Source simplification and a 12-metre
snapping tolerance mean this correspondence is unsuitable for survey precision.

The xplore game's engine in `web/ui/features/snake/engine.ts` builds adjacency from the
bundle's real edge endpoints, advances in source metres and draws on the same
`TransitMap` as the explorer. Route missions resolve pattern `pathId` values to
ordered directed `paths[].edgeRefs`. Stops retain their edge attachment for
next-stop guidance. Manual turnouts override route guidance, and degree-two
geometry nodes do not consume a queued switch.

The explorer remains the sole owner of the live vehicle poller. Opening the game
enables that poller even when the explorer's live layer is off; closing returns
to the layer preference. Arcade couples each fresh, matched vehicle identity
once per run and grows the consist. Purist keeps one car, is governed to 50 km/h,
and ends on contact with a fresh matched vehicle. Stale and off-track reports
remain visible but cannot become pickups or collision hazards. There are no
fictional replacement pickups when the feed is unavailable. The displayed cars
retain the explorer's snapshot cadence; no independent game feed or invented
vehicle motion is added.

The game supplies directional virtual rails offset 3.2 metres from the
centreline and smooth same-edge terminal turnback connectors. The head and
following cars travel through the connector in measured metres; reversal does
not teleport the train between rails. Named terminal sizes follow the classic
game's Union/station/loop/carhouse distinctions. These are simulation conventions,
not surveyed track or dispatch permissions. Collision bodies follow connected
track segments in source metres, including bends and switches, rather than
straight tangent capsules. Both live-car and self-collisions require overlap on
the same directed graph edge. The opposite rail stays separate through loops
and return trips; entering your own occupied rail still ends an arcade run.
Trail samples retain their edge, direction and source distance so the rear
follows the switches actually taken. High-speed movement is sampled in steps
of at most three metres.
Closed graph edges continue in their current direction. Signed mission terminal
departures reverse the ordered path even when extra branches are present.

An amber ring marks the next fork. The green path and arrow show the train's
actual departure, dashed for automatic routing and solid for a manual selection.
Switch labels name the branch direction and service or infrastructure. Preview,
next-stop guidance and movement use the same routing and mission rejoin rules.
Automatic free-play routing prefers service continuity and avoids yard/diversion
tracks; explicit switches override it. Left/right select the outermost available
branch and straight selects the smallest turn, including curved-only forks.
Warnings use the original 4.5-second lookahead bounded to 230–1400 metres.

The original acceleration/braking rates are 34/58 km/h per second in purist and
360/420 in arcade. Both held pedals combine; released pedals retain speed.
Governors remain 50/2000 km/h. Keyboard and pointer holds highlight the same
pedals and release on cancellation, lost capture or blur. A two-finger pinch
beginning anywhere in the cockpit releases the pedals and zooms only the map,
without throwing a switch or resizing the controls. The game pauses when the
page is hidden or loses focus. See [the driving review](./snake-driving-review.md)
for the comparison with the classic implementation and regression coverage.

The original `N()`/`E()` game is archived unchanged at
`public/snake/v1/game.js`, with its HTML asset links and PWA manifest scoped to
`/snake/v1/`. Its classic modes, missions, fictional events, multipliers, sound,
cookie checkpoints, controls and original map remain playable there. The
integrated game uses separate `ttc:snake:v2:*` local storage preferences and
scores, so it does not interpret classic cookie positions as shared-map edges.
