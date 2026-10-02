# TTC Status API Architecture Notes

This document captures the architecture and map-generation lessons learned while reviewing the existing `snakettc` game, TTC GTFS / GTFS-Realtime sources, and experimenting with a reusable schematic Toronto streetcar map.

This is intentionally an architecture and planning document only. No implementation is prescribed here.

## Product model

`api.ttcstatus.ca` should be the shared transit-data and map engine for both:

- **ttcstatus.ca** — an accurate live transit view showing real routes, stops, vehicles, service state, and eventually buses and subway.
- **Streetcar Snake** — a whimsical game mode built on the same network model and rendering primitives, with fictional gameplay layered on top.

The game should eventually contain almost no TTC-specific geography or schedule knowledge of its own.

The reusable asset is not a static map image. It is a **topologically correct Toronto transit graph with a generated schematic projection**.

## Three kinds of truth

The API should keep three distinct concepts separate.

### Scheduled truth

GTFS answers:

> What service is supposed to exist?

Use it for:

- routes
- trips
- patterns
- stop sequences
- scheduled service
- service calendars
- headsigns
- route types
- GTFS shapes

### Physical truth

GTFS shapes are not a complete inventory of TTC track infrastructure.

Physical truth should combine:

- GTFS-derived geometry
- verified infrastructure that may not currently carry scheduled service
- diversion track
- non-revenue track
- terminal loops
- yards / carhouse connections where useful

The Ossington streetcar track is the key example: physical track can matter to TTCstatus and Snake even when no regular GTFS trip currently uses it.

### Live truth

GTFS-Realtime answers:

> What is actually happening right now?

Use it for:

- live vehicle positions
- trip updates
- alerts
- scheduled and unscheduled vehicles where available
- vehicles on diversion
- out-of-service / deadheading vehicles where the source exposes them

Static and live data should be separate pipelines.

## Source feeds

### Static GTFS

Static GTFS should be the canonical source for scheduled transit structure.

The TTC feed includes the concepts we need:

- `routes.txt`
- `trips.txt`
- `stops.txt`
- `stop_times.txt`
- `shapes.txt`
- service calendars / exceptions
- direction and headsign information where published

The nightly/static ingestion process should preserve the source identifiers and relationships rather than flattening everything into frontend-only geometry.

### GTFS-Realtime

GTFS-RT should overlay the static network rather than replace it.

The live layer should join vehicles to:

- trip
- route
- direction
- canonical shape / track edge
- current distance along that edge
- projected display position

## Static sync cadence

The Worker can check the static GTFS feed nightly.

A nightly check does **not** imply destructively rebuilding the network every night. The Worker should:

1. Fetch the current feed.
2. Fingerprint / version it.
3. Skip expensive processing if the feed is unchanged.
4. Parse and validate a changed feed.
5. Build a candidate canonical network.
6. Merge known physical-infrastructure overlays.
7. Generate schematic geometry.
8. Run topology and regression validation.
9. Publish the new network version only after it passes validation.

Keep the previous good version available if an import fails.

## Canonical transit model

Do not model a route as one giant polyline.

A useful conceptual hierarchy is:

- route
- route pattern
- trip
- physical corridor / track edge
- graph node
- stop
- display stop cluster
- canonical geometry
- schematic geometry

### Route patterns

A route can have branches, short turns, terminal variants, diversions, and different ordered stop sets.

Generate stable pattern objects from trips that share substantially equivalent:

- ordered stops
- direction
- shape / corridor sequence
- terminals

This will matter even more once buses are added.

### Shared physical corridors

Multiple trips and routes frequently share the same physical track.

The physical graph should represent that corridor once.

Routes, patterns, and trips should reference the corridor rather than each owning duplicate nearly-identical polylines.

This lets us answer questions such as:

> Which services use this piece of track?

without geometric guesswork.

## Physical infrastructure overlay

GTFS is service truth, not complete rail truth.

Maintain a small first-party infrastructure overlay for verified track absent from scheduled GTFS.

A physical segment should be able to carry metadata such as:

- `revenue`
- `diversion`
- `non_revenue`
- `yard`
- `terminal`
- `scheduled_service: true/false`
- source / provenance
- verification date
- confidence
- endpoint anchors into the canonical graph

### Ossington

Ossington is the current poster child for this requirement.

If no active GTFS trip contains the segment, it must still be represented as real infrastructure.

It should be a normal graph edge, not a frontend hack.

A live out-of-service streetcar located there should still be map-matchable to that physical edge even when it cannot be associated with active scheduled service.

## Canonical geometry vs display geometry

Always retain two geometries.

### Canonical geometry

The original geographic network.

Use it for:

- accurate spatial relationships
- GPS map matching
- stop locations
- route / trip shape relationships
- distance calculations
- debugging
- provenance

### Schematic geometry

A generated, visually simplified "Snake-style" map.

It may:

- straighten long corridors
- smooth curves
- exaggerate terminal loops
- separate visually crowded corridors
- simplify unnecessary shape vertices
- use preferred orientations

It must **not**:

- change connectivity
- remove meaningful bends
- change branch ordering
- invent junctions
- lose physical track
- swap terminal relationships

The Roncesvalles / King error demonstrated why this separation matters: a prettier line is wrong if simplification removes a real north-south track relationship.

## Geometry processing pipeline

The high-level pipeline should be:

`GTFS LineStrings → canonical planar track graph → topology enrichment → infrastructure overlay merge → protected-anchor simplification → constrained schematic layout → curve smoothing → linear-reference mapping → display geometry`

Keep correspondence between stages.

## Project into metres before geometry work

Do not perform geometry algorithms directly in WGS84 latitude / longitude degrees.

Convert Toronto coordinates into a local planar coordinate system first.

Geometry operations that should happen in metres include:

- distance
- snap tolerances
- clustering
- point-to-edge projection
- simplification
- segment length
- arc length
- curve radius
- offset rails
- nearest-track matching

Convert back to WGS84 only when geographic API output requires it.

## Build topology before simplification

Topology is more important than the exact source polyline.

Before simplifying, identify and protect:

- terminals
- route junctions
- track junctions
- meaningful route turns
- corridor intersections
- infrastructure overlay endpoints
- major anchor stops
- terminal loops

Once a point is a protected topological node, schematic simplification must not delete it or move it through another node.

## Split shapes into reusable edges

Do not keep an entire GTFS trip shape as one graph edge.

Split shapes at meaningful topology anchors.

For example:

- Roncesvalles / Queen → Roncesvalles / Dundas
- Dundas / Roncesvalles → next major junction
- Queen / Spadina → Queen / Bathurst

This gives us reusable corridor segments that multiple patterns can share.

## Merge geometrically equivalent GTFS shapes

GTFS often contains many trip shapes that are nearly identical.

Detect and canonicalize shared geometry instead of storing every trip's path as independent physical track.

Useful signals include:

- spatial proximity
- ordered anchor sequence
- common stop sequence
- similar bearings
- shared endpoints
- overlapping line length

The physical graph should be substantially smaller than the raw set of trip shapes.

## Protected-anchor hierarchy

Not all source points deserve equal preservation.

A useful hierarchy is:

1. terminal
2. physical junction
3. route turn / branch
4. major intersection or anchor stop
5. ordinary stop
6. raw shape point

The first several classes should carry effectively infinite or very high simplification weight.

Raw shape points can disappear freely when they add no structural information.

## Turn detection

Do not detect meaningful turns from a single source vertex.

A real route turn may be expressed as several small GTFS bends.

Calculate heading change over a window or cumulative arc length.

Protect locations where cumulative direction change crosses a meaningful threshold.

This is exactly the kind of protection needed to keep the Roncesvalles / King geometry recognizable.

## Topological snapping

GTFS shapes representing the same physical junction may differ by a few metres.

Cluster candidate graph nodes within a conservative tolerance before schematic generation.

However:

**geometric proximity alone must never create track connectivity.**

## Crossing is not junction

Two LineStrings intersecting does not prove that vehicles can switch between them.

Likewise, two physical tracks may connect even when GTFS vertices do not coincide exactly.

Junction inference should use a combination of:

- trip / shape continuity
- ordered stop relationships
- infrastructure knowledge
- spatial tolerance
- route continuity
- known TTC track connections

Never turn every geometric crossing into a graph node.

## Schematic generation

The schematic should be generated from the canonical graph, not directly from raw GTFS shapes.

A schematic optimizer may encourage:

- fewer unnecessary bends
- straighter corridors
- preferred orientations
- balanced spacing
- readable junctions
- larger terminal loops
- lower label collision

But topology constraints are hard constraints.

## Preferred orientations

Do not blindly force the network into a generic 0° / 45° / 90° octilinear system.

Toronto has strong corridor structure.

Examples:

- Queen / King / Dundas / College naturally favour east-west
- Bathurst / Spadina / Broadview favour north-south
- Roncesvalles requires distinct geometry
- Kingston Road naturally wants a diagonal
- waterfront geometry benefits from a deliberate schematic treatment

Preferred headings can be corridor-specific.

## Simplification

Douglas-Peucker, Visvalingam-Whyatt, or a similar line simplifier may be appropriate for unimportant intermediate geometry.

However simplification must be topology-aware.

Do not use arbitrary goals such as:

> reduce every route to 20 points

A topology-preserving simplifier should never remove:

- protected graph nodes
- terminals
- route branches
- meaningful turns
- infrastructure connections

## Preserve route ordering

Each route pattern should retain an ordered sequence of major anchors.

The generated schematic must preserve that order.

Examples of things that should fail validation:

- a stop appearing on the wrong side of a junction
- a branch crossing another branch and changing sequence
- Roncesvalles no longer connecting into King correctly
- Dundas West no longer having a path to Broadview
- a terminal moving onto the wrong route branch

## Arc-length / linear referencing

Every canonical edge should have an arc-length coordinate `s`.

Stops and vehicles should be represented by:

- edge ID
- distance along edge `s`
- direction where applicable

Do the same for schematic edges.

Maintain a mapping conceptually equivalent to:

- source edge ID
- source `s0`
- source `s1`
- display edge ID
- display `s0`
- display `s1`

Then a vehicle at 63% of the canonical segment can be placed at the corresponding location on the schematic segment.

## Never map live GPS directly to the pretty map

Correct live rendering should be:

1. receive GPS position
2. map-match against canonical physical geometry
3. determine edge + distance-along-edge
4. transform that position to the associated schematic edge
5. render the vehicle there

This keeps vehicles glued to tracks even when the display geometry is intentionally distorted.

## Vehicle map matching

Nearest-line distance alone is insufficient, especially downtown.

Candidate scoring should consider:

- perpendicular distance to track
- vehicle bearing
- GTFS trip
- GTFS route
- direction
- previous matched edge
- graph adjacency / continuity
- current pattern

A vehicle near Queen / King / Spadina should not jump tracks merely because another schematic or canonical edge is a few metres closer.

## Temporal continuity

Vehicle matching should be stateful.

A live vehicle should strongly prefer:

- its previous edge
- an adjacent edge reachable from the previous edge
- an edge consistent with its route / trip / bearing

This prevents noisy GPS fixes from teleporting cars between nearby parallel corridors.

## Out-of-service vehicles

A realtime vehicle may not belong to a normal scheduled trip.

The live model should allow:

- scheduled
- unscheduled
- diversion
- deadhead
- out of service
- unknown

where the source provides enough information or where map matching makes the state useful.

An out-of-service car on Ossington should still appear on the physical network if the realtime feed exposes it.

## Stop geometry

Snap GTFS stops to canonical physical edges once.

Persist:

- source stop ID
- canonical coordinates
- matched edge ID
- distance along edge `s`
- direction / platform relationship where available

Generate schematic stop positions from this relationship.

Do not independently snap stops to the pretty map in every client.

## Display stop clusters

GTFS may have separate stop records for opposite directions or platforms at nearly the same geographic location.

Keep the real stop records in canonical data.

Optionally generate a `display_stop_cluster` representing multiple real stops as one map marker.

The existing Snake implementation demonstrated the usefulness of collapsing near-identical directional/platform points for the game UI.

## Track rendering

Shared physical track should be rendered once geometrically.

Route membership belongs in metadata.

This allows one edge to represent:

- several scheduled routes
- limited service
- diversion usage
- infrastructure-only track

without stacking identical SVG / Canvas paths.

## Terminal loops

Loops and turnbacks should be explicit graph geometry rather than dead-end points where practical.

The display geometry may exaggerate them for readability.

This matters for:

- live vehicle continuity
- directional rendering
- terminal behaviour
- Snake gameplay
- future animation

## Centreline vs directional rails

The canonical and overview schematic network can usually store one physical corridor centreline.

Directional / paired rails may be generated for detailed rendering or game physics.

Do not duplicate the whole canonical network merely to represent two visual directions.

## Offset geometry

If Snake or a zoomed map needs separate directional rails:

1. simplify the centreline first
2. generate perpendicular offsets afterward
3. use bounded miter limits
4. prefer rounded or bevel joins at acute corners

Offsetting raw GTFS shapes first is likely to create ugly self-intersections and unstable geometry.

## Curve smoothing

Curve smoothing should happen near the end of the pipeline.

After the graph, anchors, and simplified line segments are fixed, replace ugly corners with bounded-radius arcs or Bézier transitions.

Never smooth through a graph junction.

A useful radius constraint is conceptually:

`radius <= fraction × min(previous_segment_length, next_segment_length)`

This prevents a decorative curve from swallowing the next junction.

## Schematic optimization objective

A schematic optimizer can score candidate layouts with penalties for:

- moving protected anchors too far
- changing anchor order
- changing connectivity
- introducing false crossings
- removing meaningful crossings / junctions
- excessive bends
- very short display segments
- deviation from preferred headings
- label collisions
- inconsistent corridor spacing
- route overlaps that become unreadable

Topology changes should be treated as invalid rather than merely expensive.

## Multi-resolution geometry

The API should eventually support multiple levels of detail.

For example:

- overview
- normal
- detailed

The overview network may need only a modest number of vertices.

A detailed Snake view around Union or a terminal may need much richer geometry.

All levels should reference the same canonical graph.

## Labels are not geometry

Do not bake text positions into track LineStrings.

Generate separate label anchors / hints such as:

- preferred anchor
- orientation
- priority
- allowed offset
- collision group

The frontend can then lay out labels responsively without changing track topology.

## Geometry validation

Before publishing a new generated network version, run automated structural tests.

### Connectivity tests

Assert expected paths exist, for example:

- Dundas West → Roncesvalles → King
- Dundas West → Dundas → Broadview
- High Park → College / Carlton / Gerrard → Main Street
- Gunns Loop → St Clair
- Exhibition → Queens Quay → Union
- Kingston Road → Bingham
- Ossington diversion segment → its known physical junctions

### Topology metrics

Compare the candidate graph with the previous known-good network:

- connected component count
- protected node count
- terminal degree
- junction count
- route-anchor ordering
- shared-corridor relationships
- newly introduced crossings
- removed crossings
- unexpectedly moved anchors

### Geometry change thresholds

Flag large unexplained changes in:

- shape length
- bounding box
- terminal coordinates
- route endpoints
- number of pattern variants
- stop-to-edge snap distance

These are review signals, not necessarily hard failures.

## GTFS coverage-gap detection

The importer should explicitly report physical-network segments not represented by scheduled GTFS.

This prevents useful infrastructure from silently disappearing.

Examples can be categorized as:

- expected / known non-service track
- temporary service gap
- possible feed regression
- manual review required

Ossington should appear as an intentional known physical-only segment, not an accidental orphan.

## Deterministic generation

The same inputs should generate the same schematic coordinates.

A network version should be determined by:

- static GTFS version / fingerprint
- infrastructure overlay version
- geometry-generator version

No random layout decisions should affect production output unless they use a fixed deterministic seed.

Determinism helps:

- CDN caching
- visual regression
- screenshots
- animation
- debugging
- stable client state

## Version metadata

Every generated map bundle should identify at least:

- GTFS/source version
- infrastructure overlay version
- geometry version
- generator version
- generated timestamp
- canonical coordinate reference
- previous network version

This lets us distinguish:

> TTC changed the network

from:

> our geometry algorithm changed.

## D1 role

D1 is well suited to the durable network model and version metadata.

Static-ish records include:

- routes
- patterns
- trips / selected trip metadata
- stops
- stop clusters
- graph nodes
- graph edges
- infrastructure overrides
- source shape references
- schematic edge mappings
- network versions

The current live vehicle snapshot does not need to be treated like static network data.

Historical live tracking should be a deliberate product decision rather than an accidental side effect of serving realtime positions.

## API shape

Exact routes are not final, but useful conceptual resources include:

- network metadata
- routes
- route patterns
- stops
- physical track / infrastructure
- schematic map bundle
- live vehicles
- live route state
- live stop state
- alerts

A purpose-built map bundle should allow TTCstatus and Snake to load the same world representation without parsing GTFS themselves.

## Caching

Static network bundles are highly cacheable.

Use:

- network-versioned resources
- ETags
- CDN caching
- immutable resources where appropriate

Realtime vehicle data should have a much shorter lifetime and independent cache strategy.

## Frontend responsibility

The frontends should not:

- parse raw GTFS
- know TTC feed quirks
- maintain their own route geometry
- manually snap stops
- independently invent physical track
- map-match vehicle GPS
- hard-code route terminal pairs that already exist in canonical data

They should consume the shared API model and render it.

## Snake responsibility

Snake should eventually be:

**real world layer**

- network
- tracks
- stops
- junctions
- route patterns
- terminal topology

plus:

**game layer**

- player train
- collision geometry
- pickups
- multiplier zones
- fictional closures
- speed modes
- consist / tail
- scoring
- death
- missions

This keeps the delightful nonsense out of the transit-data model while allowing both products to share the expensive, difficult map work.

## Key lessons from the prototype exercise

- GTFS is service truth, not complete physical-track truth.
- Static GTFS and GTFS-RT solve different problems and should remain separate pipelines.
- The API needs an explicit physical-infrastructure overlay.
- Ossington demonstrates why non-scheduled track must be represented.
- Out-of-service vehicles are useful live state and should not automatically disappear.
- Simplification must preserve topology before it preserves aesthetics.
- Roncesvalles demonstrated that a visually plausible schematic can still be structurally wrong.
- Canonical and schematic geometries must both be retained.
- Every schematic edge needs a reversible relationship to canonical geometry.
- Stops and vehicles should use distance-along-edge / linear referencing.
- Map matching should use trip, route, bearing, graph continuity, and distance—not nearest-line distance alone.
- Terminal loops and physical junctions are first-class geometry.
- Shared track should be modeled once and referenced by routes.
- Generated geometry needs regression tests.
- The final map should be deterministic and versioned.
- The same map bundle should power TTCstatus and Streetcar Snake.

## Design principle

The API should let us draw Toronto with transit-map liberties **without lying about how Toronto's transit network connects**.

That means preserving the math and topology underneath even when the frontend chooses to make the map prettier, cleaner, smoother, or delightfully game-like.
