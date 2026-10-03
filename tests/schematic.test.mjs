import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const compiled = await build({ stdin: {
  contents: 'export * from "./workers/map-generator/src/schematic"; export * from "./workers/map-generator/src/build-map"; export * from "./workers/map-generator/src/debug-render";',
  resolveDir: process.cwd(), loader: "ts",
}, bundle: true, write: false, platform: "node", format: "esm" });
const { layoutStreetcarMap, renderDebugMapSvg, buildStreetcarMapBundle } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
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
