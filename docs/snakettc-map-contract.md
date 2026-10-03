# Shared schematic map contract

`snake-v1.2.0` keeps schema version 1 and the existing `routes`, `patterns`,
`paths`, `stops`, and `infrastructure` fields. It adds a shared corridor graph
and source/display correspondence. Existing renderers can still draw `points`.

| Field | Use |
| --- | --- |
| `graph.nodes[].id`, `edgeIds` | Build the game's node map and adjacency lists. IDs are deterministic for identical source data, not guaranteed across feed versions. |
| `graph.edges[].a`, `b` | Endpoints of one reusable corridor segment. |
| `graph.edges[].points` | Display polyline, ordered from `a` to `b`. |
| `graph.edges[].lengthMetres` | Advance the simulation in actual source metres. Display pixels are not metres. |
| `graph.edges[].sourcePoints` | Simplified canonical coordinates in local east/north metres, using `display.reference`. Raw GTFS shapes remain in D1. |
| `graph.edges[].sourceDistances` | Source distance at each display vertex, including the warp's slope changes. |
| `graph.edges[].routeIds`, `pathIds`, `infrastructureIds` | Service and infrastructure membership. One edge can carry multiple routes. |
| `paths[].edgeRefs` | Ordered `{ edgeId, direction }` traversal of the path. `1` means a→b; `-1` means b→a. Patterns still identify their `pathId`. |
| `graph.observedTurns` | Directed edge transitions observed in source shapes. Absence does not prove a physical turn is impossible. |
| `stops[].edgeId`, `distanceAlongMetres`, `edgeFraction` | Optional position on a corridor. Stops over 100 metres from any matching-route corridor remain unattached. |
| `stops[].sourcePoint` | Original geographic cluster position before display track attachment. |
| `context` | Approximate street/terminal labels, shoreline and north direction. Decorative; never use it to add tracks or switches. |
| `excludedServices` | Explicit replacement-bus patterns excluded from rail paths, stops and graph; original IDs and headsigns retained for auditing. Route IDs alone do not distinguish replacement buses. |
| `paths[].gtfsSourcePoints` | Original projected GTFS vertices when a coarse scheduled path has been aligned to audited Queens Quay rail. `sourcePoints` and graph lengths then follow the mapped physical alignment. |
| `context.shorelineSource` | City of Toronto mainland shoreline attribution, retrieval date and simplification note. The shoreline follows the rail display transform, including warp breakpoints. |

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

SnakeTTC's existing `N()`/`E()` map in `public/game.js` does not load this contract.
Its adapter should create its node/edge/adjacency collections from the bundle,
use metre distances for movement, and convert poses through the mapping above.
Existing cookie checkpoints containing the old hard-coded edge IDs require
migration or invalidation when the game adopts this map.
