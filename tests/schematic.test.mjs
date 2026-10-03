import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { previewMap } from "../scripts/preview-map.mjs";

const compiled = await build({ stdin: {
  contents: 'export * from "./workers/map-generator/src/schematic"; export * from "./workers/map-generator/src/build-map"; export * from "./workers/map-generator/src/debug-render"; export { projectToLocalMetres } from "./workers/map-generator/src/geometry";',
  resolveDir: process.cwd(), loader: "ts",
}, bundle: true, write: false, platform: "node", format: "esm" });
const { layoutStreetcarMap, renderDebugMapSvg, buildStreetcarMapBundle, projectToLocalMetres } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const seed = paths => ({ display: { width: 1600, height: 1100 },
  paths: paths.map((points, i) => ({ id: `p${i}`, routeIds: [`r${i}`], points })), infrastructure: [], stops: [] });

test("a geometric crossing alone does not invent a playable junction", () => {
  const map = layoutStreetcarMap(seed([[[-200,0],[200,0]], [[0,-200],[0,200]]]));
  assert.equal(map.graph.edges.length, 2);
  assert.equal(map.graph.nodes.length, 4);
  assert.ok(map.graph.nodes.every(n => n.edgeIds.length === 1));
});

test("source junctions split shared track and reverse paths reuse the edges", () => {
  const input = seed([[[-200,0],[200,0]], [[200,0],[-200,0]], [[0,-200],[0,0]]]);
  input.infrastructure = [{ id: "diversion", name: "Diversion", points: [[-200,0],[-200,-200]] }];
  const map = layoutStreetcarMap(input);
  assert.equal(map.graph.edges.length, 4);
  const intersection = map.graph.nodes.find(n => n.sourcePoint[0] === 0 && n.sourcePoint[1] === 0);
  assert.equal(intersection.edgeIds.length, 3);
  assert.deepEqual(map.paths[0].edgeRefs.map(s => s.edgeId), map.paths[1].edgeRefs.map(s => s.edgeId).reverse());
  assert.ok(map.paths[1].edgeRefs.every(s => s.direction === -1));
  assert.equal(map.infrastructure[0].edgeRefs.length, 1);
  assert.equal(map.graph.edges.filter(e => e.infrastructureIds.length).length, 1);
});

test("a terminal loop retains its complete cycle", () => {
  const map = layoutStreetcarMap(seed([[[0,0],[100,0],[100,100],[0,100],[0,0]]]));
  assert.equal(map.graph.nodes.length, 4);
  assert.equal(map.graph.edges.length, 4);
  assert.ok(map.graph.nodes.every(n => n.edgeIds.length === 2));
  assert.deepEqual(map.paths[0].points.at(0), map.paths[0].points.at(-1));
});

test("distance mapping retains warp slope changes and puts stops on the displayed rail", () => {
  const input = seed([[[-9000,0],[9000,0]]]);
  input.stops = [{ id: "stop", name: "Middle", routeIds: ["r0"], x: 2500, y: 0 }];
  const map = layoutStreetcarMap(input);
  const edge = map.graph.edges[0];
  assert.ok(edge.points.length > 2);
  assert.equal(edge.points.length, edge.sourceDistances.length);
  assert.equal(edge.sourceDistances.at(-1), edge.lengthMetres);
  const stop = map.stops[0];
  const distance = stop.distanceAlongMetres;
  const i = edge.sourceDistances.findIndex(d => d >= distance);
  const t = (distance - edge.sourceDistances[i-1]) / (edge.sourceDistances[i] - edge.sourceDistances[i-1]);
  for (const axis of [0,1]) {
    const p = edge.points[i-1][axis] + t * (edge.points[i][axis] - edge.points[i-1][axis]);
    assert.ok(Math.abs(p - (axis ? stop.y : stop.x)) < 0.02);
  }
});

test("layout is deterministic when source path order changes", () => {
  const input = seed([[[-200,0],[200,0]], [[0,-200],[0,0]]]);
  assert.deepEqual(layoutStreetcarMap(input).graph, layoutStreetcarMap({ ...input, paths: [...input.paths].reverse() }).graph);
});

test("north arrow follows geographic north after rotation and unequal display scaling", () => {
  const map = layoutStreetcarMap(seed([[[0,0],[0,100],[1000,100]]]));
  const [a,b] = map.paths[0].points;
  const angle = Math.atan2(b[1]-a[1], b[0]-a[0]) * 180 / Math.PI;
  assert.ok(Math.abs(map.context.north.angle - angle) < 0.01);
  assert.ok(angle > -90 && angle < 0);
});

test("production builder emits a graph, source geometry and unchanged source IDs", () => {
  const data = { version: { id: 1, source_url: "fixture", fetched_at: "fixture" },
    routes: [{ route_id: "501", short_name: "501", long_name: "Queen", route_type: 0, color: "ED1C24", text_color: "FFFFFF" }],
    shapes: [{ shape_id: "shape", points_json: JSON.stringify([[43.65,-79.40],[43.655,-79.38]]) }],
    patterns: [{ pattern_id: "pattern", route_id: "501", shape_id: "shape", direction_id: 0, headsign: "East", trip_count: 1 }],
    stops: [{ stop_id: "stop", name: "Stop", lat: 43.65, lon: -79.40, wheelchair_boarding: 1 }],
    patternStops: [{ pattern_id: "pattern", stop_id: "stop", stop_sequence: 1 }], overlays: [] };
  const map = buildStreetcarMapBundle(data, "Attribution");
  assert.equal(map.paths[0].shapeId, "shape");
  assert.equal(map.patterns[0].pathId, map.paths[0].id);
  assert.equal(map.stops[0].stopIds[0], "stop");
  assert.ok(map.stops[0].edgeId);
  assert.equal(map.graph.edges[0].sourcePoints.length, 2);
});

test("replacement buses cannot create rail, junctions, or bus-only stops", () => {
  const input = seed([[[0,0],[200,0]], [[0,0],[0,5000]]]);
  input.paths[0].routeIds = ["r0", "r1"];
  input.patterns = [
    { id: "rail", pathId: "p0", routeId: "r0", headsign: "Regular streetcar", stopIds: ["rail-stop"] },
    { id: "bus", pathId: "p1", routeId: "r0", headsign: "Replacement Bus towards Station", stopIds: ["bus-stop"] },
    { id: "shared-bus", pathId: "p0", routeId: "r1", headsign: "Shuttle Bus", stopIds: ["bus-stop"] },
  ];
  input.stops = [
    { id: "rail", name: "Rail stop", x: 100, y: 0, routeIds: ["r0"], stopIds: ["rail-stop"] },
    { id: "bus", name: "Bus stop", x: 0, y: 5000, routeIds: ["r0"], stopIds: ["bus-stop"] },
  ];
  const map = layoutStreetcarMap(input);
  assert.deepEqual(map.paths.map(p => p.id), ["p0"]);
  assert.deepEqual(map.paths[0].routeIds, ["r0"]);
  assert.deepEqual(map.patterns.map(p => p.id), ["rail"]);
  assert.deepEqual(map.stops.map(s => s.id), ["rail"]);
  assert.equal(map.graph.edges.length, 1);
  assert.equal(map.excludedServices.length, 2);
});

test("audited Queens Quay bends replace coarse chords in both directions and retain GTFS", () => {
  const points = [[43.637743,-79.3911302],[43.6398808,-79.380331]].map(projectToLocalMetres);
  const input = seed([points, points.toReversed(), [[0,0],[200,0]]]);
  input.routes = ["501","511","512","509"].map(id => ({ id, shortName: id }));
  for (const path of input.paths) path.routeIds = ["509"];
  const map = layoutStreetcarMap(input);
  assert.deepEqual(map.paths[0].gtfsSourcePoints, points);
  assert.ok(map.paths[0].sourcePoints.length > points.length);
  assert.deepEqual(map.paths[0].sourcePoints, map.paths[1].sourcePoints.toReversed());
  assert.deepEqual(map.paths[2].sourcePoints, input.paths[2].points);
  assert.equal(map.paths[2].gtfsSourcePoints, undefined);
});

test("renderer labels geography and escapes untrusted text", () => {
  const map = layoutStreetcarMap(seed([[[0,0],[200,0]]]));
  map.context.labels = [{ text: '<script>&"', kind: "street", angle: 0, point: [500,500] }];
  const svg = renderDebugMapSvg(map);
  assert.ok(svg.includes("&lt;script&gt;&amp;&quot;"));
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("LAKE ONTARIO"));
  assert.throws(() => renderDebugMapSvg({ display: { width: -1, height: 100 } }));
});

test("Toronto preview preserves every route traversal and the Ossington junctions", async () => {
  const map = JSON.parse(await readFile("streetcar-schematic.json", "utf8"));
  const edges = new Map(map.graph.edges.map(e => [e.id, e]));
  const nodes = new Map(map.graph.nodes.map(n => [n.id, n]));
  for (const path of [...map.paths, ...map.infrastructure]) {
    let end;
    for (const step of path.edgeRefs) {
      const edge = edges.get(step.edgeId);
      const start = step.direction === 1 ? edge.a : edge.b;
      if (end) assert.equal(start, end, path.id);
      end = step.direction === 1 ? edge.b : edge.a;
      assert.ok(edge.lengthMetres > 0);
      assert.ok(edge.points.every(p => p.every(Number.isFinite)));
    }
  }
  assert.ok(map.stops.every(s => edges.has(s.edgeId)));
  const overlay = map.infrastructure.find(p => p.id === "ossington-college-dundas");
  const edge = edges.get(overlay.edgeRefs[0].edgeId);
  assert.ok(nodes.get(edge.a).edgeIds.length >= 3);
  assert.ok(nodes.get(edge.b).edgeIds.length >= 3);
  assert.ok(Buffer.byteLength(JSON.stringify(map)) < 2_000_000);
});

test("Toronto physical graph connects St Clair, Long Branch and Bingham to downtown", async () => {
  const map = JSON.parse(await readFile("streetcar-schematic.json", "utf8"));
  const nodes = new Map(map.graph.nodes.map(n => [n.id, n]));
  const edges = new Map(map.graph.edges.map(e => [e.id, e]));
  const start = map.graph.edges.find(e => e.routeIds.includes("509")).a;
  const reachable = new Set([start]), pending = [start];
  while (pending.length) {
    const id = pending.pop();
    for (const edgeId of nodes.get(id).edgeIds) {
      const edge = edges.get(edgeId), next = edge.a === id ? edge.b : edge.a;
      if (!reachable.has(next)) { reachable.add(next); pending.push(next); }
    }
  }
  assert.equal(reachable.size, nodes.size, "every physical corridor must be reachable");
  for (const id of ["bathurst-bloor-stclair", "longbranch-physical-loop", "gunns-physical-loop", "bingham-physical-loop"]) {
    const track = map.infrastructure.find(p => p.id === id);
    assert.ok(track?.edgeRefs.length, id);
    assert.equal(track.scheduledService, false);
  }
  const physical = map.infrastructure.find(p => p.id === "bathurst-bloor-stclair");
  assert.ok(physical.edgeRefs.some(ref => !edges.get(ref.edgeId).routeIds.length), "physical connection must not invent passenger service");
  for (const pattern of map.excludedServices) {
    assert.ok(!map.patterns.some(p => p.id === pattern.id));
    assert.ok(!map.paths.some(p => p.patternIds?.includes(pattern.id)), pattern.pathId);
  }
});

test("Toronto rail vertices and entire segments remain outside Lake Ontario", async () => {
  const map = JSON.parse(await readFile("streetcar-schematic.json", "utf8"));
  const shore = map.context.shoreline, { width, height } = map.display;
  const polygon = [...shore, [width+200, shore.at(-1)[1]], [width+200,height+200], [-200,height+200], [-200,shore[0][1]]];
  const wet = ([x,y]) => {
    let inside = false;
    for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const [ax,ay] = polygon[i], [bx,by] = polygon[j];
      if ((ay>y)!==(by>y) && x<(bx-ax)*(y-ay)/(by-ay)+ax) inside = !inside;
    }
    return inside;
  };
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const intersects = (a,b,c,d) => cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0;
  for (const edge of map.graph.edges) {
    for (const point of edge.points) assert.ok(!wet(point), `${edge.id} vertex in lake`);
    for (let i=1;i<edge.points.length;i++) {
      for (let j=1;j<polygon.length;j++) {
        assert.ok(!intersects(edge.points[i-1],edge.points[i],polygon[j-1],polygon[j]), `${edge.id} crosses shoreline`);
      }
    }
  }
});

test("preview rebuilds an older schematic from retained source geometry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ttc-map-preview-"));
  try {
    const expected = JSON.parse(await readFile("streetcar-schematic.json", "utf8"));
    const stale = structuredClone(expected);
    stale.generatorVersion = "snake-v1.1.0";
    stale.graph.nodes[0].x = -99999;
    stale.context.shoreline = [[0,0],[1600,0]];
    const input = join(directory, "input.json"), output = join(directory, "output.json");
    await writeFile(input, JSON.stringify(stale));
    await previewMap(input, output, join(directory,"map.svg"));
    const rebuilt = JSON.parse(await readFile(output, "utf8"));
    assert.equal(rebuilt.generatorVersion, "snake-v1.3.0");
    assert.deepEqual(rebuilt.graph, expected.graph);
    assert.deepEqual(rebuilt.context.shoreline, expected.context.shoreline);
    assert.deepEqual(rebuilt.excludedServices, expected.excludedServices);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
