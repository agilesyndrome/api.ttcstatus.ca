# Physical turnback audit — 2026-10-04

Car 4536 exposed a gap in the scheduled-shape map: at 12:54 EDT its
reported position was `43.65190505981445, -79.39038848876953`, on the
McCaul Loop site, approximately 198 metres from the nearest mapped rail.
The next report at 12:55:01 retained the same coordinates and zero speed.
The first observation is preserved in `data/fixtures/car-4536-mccaul.json`.
The feed does not identify the reason for the stop.

The `snake-v1.4.1` generator adds physical overlays for these audited turnbacks:

| Location                       | Addition                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| McCaul                         | Loop and both connecting tracks between Queen, Dundas and College, including mapped junction curves |
| Wolseley                       | Loop connecting back to Bathurst                                                                    |
| College (Lansdowne/Dundas)     | Turnback connection between Dundas and College                                                      |
| Woodbine (Queen/Kingston Road) | Loop and its inner track/connection                                                                 |
| Sunnyside                      | Loop south of the Queensway                                                                         |
| Fleet                          | Loop and both additional mapped connections                                                         |
| Oakwood                        | Loop and St. Clair junction connections                                                             |
| Coxwell–Queen                  | Loop, Queen junction curves and connecting tracks north to Gerrard                                  |
| Kipling                        | Loop and Lake Shore junction connections                                                            |

Earlscourt was also checked: its loop is already represented by scheduled
geometry in the local map (within approximately 10 metres of the OSM ways),
so no duplicate overlay was added. Existing physical overlays for Gunns,
Long Branch, Humber and Bingham remain in place. This is a targeted audit of
turnback gaps, not a complete survey of every yard, switch or terminal platform.

## Sources and interpretation

Physical corridors were checked against the TTC Streetcar Overhead Operations
network in [Exhibit 2, page 71 of the City audit](https://www.toronto.ca/legdocs/mmis/2023/au/bgrd/backgroundfile-241155.pdf).
Coordinates were retrieved from the OpenStreetMap API on 2026-10-04. Each
overlay in `workers/map-generator/src/source/physical-tracks.json` records the
specific OSM way ID, retrieval date, source and licence. Coordinates retain
the mapped way vertices; the existing graph generator applies its usual
12-metre node tolerance. © OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright).

These overlays describe physical rail, not current passenger service or
permitted directional switch movements. They carry `scheduledService: false`
and do not add scheduled route patterns or stops. Audited endpoint hints attach
to nearby scheduled corridors within the existing 45-metre limit. Other
connections use shared source vertices and the existing graph tolerance.

## Verification

`tests/map/physical-loops.test.mjs` rebuilds an older immutable map fixture and
checks that the saved 4536 observation matches McCaul Loop within 15 metres,
each added track is reachable from the surface network, source coordinates
remain within 25 metres of their generated edges, and all nine turnbacks have
a local cycle. The captured local rail-map rebuild puts 4536 about 7.7 metres
from its matched loop edge, without changing the 100-metre matching threshold.

The overlays are bundled into generation and local previews. An already
published map artifact needs regeneration and deployment to acquire them;
changing the source alone does not update that artifact.
