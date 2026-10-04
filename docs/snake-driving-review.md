# Streetcar Snake driving review

Compared the integrated engine and cockpit against `../snakettc/public/game.js`
and its untouched archive at `public/snake/v1/game.js`. The shared-map version
uses generated source coordinates, ordered service paths and the explorer's live
streetcar reports. It preserves the following driving details.

| Classic implementation                       | Integrated behavior                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chooseNextEdge`, `routeContinuityBonus`     | A manual switch wins at a real fork. Automatic driving follows the signed mission path, then corridor continuity and heading. Route suffixes share their base; shared daytime/overnight corridors also count. Yards and unscheduled spurs receive penalties, but remain manually selectable. Same-edge reversals are reserved for dead ends and signed turnbacks. |
| `selectSwitchByIntent`                       | Left picks the outermost left branch, right the outermost right, straight the smallest absolute turn. This works even when all available branches bend the same way. Queued commands survive single-exit geometry nodes and are consumed once at the fork.                                                                                                        |
| `getUpcomingSwitch`, `drawSwitchPreview`     | Lookahead is `clamp(speed / 3.6 × 4.5, 230, 1400)` metres. An amber ring identifies the fork; a green departure path and arrow show its chosen branch. The original highlighted manual departures; the new version also shows automatic guidance as dashed green. Choice labels include services or infrastructure.                                               |
| `handleNodeArrival`, `addTerminalTurnaround` | A mission signs its return along the reversed ordered path before a multi-branch terminal can send it down a spur. Terminal arrivals add an arcade car and leave purist at one. Union uses size 18, the named Spadina/Main/Broadview/St Clair stations 15, other stations 14, loops 12 and carhouses/default endpoints 10.                                        |
| `addTrailSample`, `pointOnTrail`             | Cars follow the actual historical path at 30.2 m body length plus 1.5 m coupler spacing. Centres interpolate by travelled distance. Cars without sufficient trail history are not drawn as phantom obstacles.                                                                                                                                                     |
| `updateSpeed`                                | Purist starts at 50 and is capped at 50 km/h; arcade starts at 180 and is capped at 2000. Acceleration/braking are 34/58 and 360/420 km/h per second respectively. Both pedals combine, braking can reach zero, accelerator restarts the car, and release retains the current speed.                                                                              |
| Keyboard and pedal handlers                  | Arrow keys, Space, Q/E/R, +/=, −/_, and P remain supported. Pointer and keyboard holds highlight the same pedals. Pointer cancellation, lost capture, pause and focus loss clear holds. Physical key codes avoid a stuck accelerator if Shift is released before +.                                                                                               |
| Global touch zoom                            | Pinches can begin on the map, HUD, switches or pedals. They release held controls and zoom the map while keeping the cockpit fixed. Single-finger swipes steer; pinches do not steer or disable following. Native gesture events are prevented during play.                                                                                                       |

The integrated game deliberately improves two classic implementation details.
The classic head reversed immediately while inserting a radial arc into its
trail. Here, a smooth connector consumes simulation distance and time, so both
head and tail visibly traverse the turnback without a rail-to-rail jump. These
connectors are game geometry, not surveyed track. Real closed edges continue as
laps without a synthetic reversal; disconnected crossings do not become joints.

Classic collision detection used overlapping geometric capsules, a five-car
self-collision exclusion, frame confirmation and 105.7 metres of turnback grace.
On the generated graph, tangent capsules falsely hit the parallel return rail
around bends. The new bodies trace connected directional rail spans, including
their actual incoming switch. An opposite rail or disconnected geometric
crossing cannot kill the train. The 105.7 m exit grace remains, followed by real
collision detection on an occupied rail. Fresh live vehicles are food in arcade
and collision hazards in purist; there are no fictional replacement pickups.

`tests/snake/snake.test.mjs` covers pedal rates, coasting, simultaneous inputs, curved
forks, route suffix/overnight continuity, yard selection, queued commands through
geometry nodes, mission rejoins, next-stop/preview consistency, measured terminal
movement, car spacing, closed edges, tight bends and switch body occupancy. Nine
production missions complete both terminal departures with 30-car trains at
180 and 2000 km/h, then continue beyond the turnback grace period.

`scripts/checks/check-snake.mjs` uses a deterministic fork for selected-branch labels,
green preview changes, next-stop changes, Q/E/R, pedal feedback and Shift release.
Phone browser checks cover swipe steering and pinches beginning on the map and
pedals, including pedal release, fixed HUD sizing and preserved switch choice.
Other checks cover the shared map/feed, both modes, pause, focus restoration and
the playable classic archive. Fictional events, multipliers, classic checkpoints
and the complete original map remain available at `/snake/v1/`.
