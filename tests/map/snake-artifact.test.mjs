import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: `export { buildViewerData } from './shared/map/model';
export { buildSnakeMap } from './shared/map/game-map';
export { mapToGps, pointAlongEdge } from './shared/map/projection';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const { buildViewerData, buildSnakeMap, mapToGps, pointAlongEdge } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const original = buildViewerData(
  JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8')),
);
const { data } = buildSnakeMap(original);

// Source-space position of a display point, through the shared transform.
const local = (point) => {
  const gps = mapToGps(point, original.geographicTransform);
  const p = original.geographicTransform.projection;
  return [
    (gps.longitude - p.longitude) * p.metresPerLongitudeDegree,
    (gps.latitude - p.latitude) * p.metresPerLatitudeDegree,
  ];
};
const metres = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('the published snake board is a complete viewer payload, not a generator source', () => {
  // The client discriminates on `graph`: sources are re-derived, viewer payloads
  // are consumed as served. A snake artifact must never look like a source.
  assert.equal('graph' in data, false);
  for (const key of [
    'features',
    'routes',
    'edges',
    'infrastructure',
    'bounds',
    'geographicTransform',
  ])
    assert.ok(data[key] !== undefined, `viewer payload is missing ${key}`);
  // Serialized exactly like the artifact store will publish it.
  const published = JSON.parse(JSON.stringify(data));
  assert.ok(published.edges.length > 0);
  assert.ok(published.edges.length < original.edges.length);
  assert.ok(published.features.length > 0);
  assert.ok(published.routes.length > 0);
});

test('the published board keeps every mission drivable and every feature attached', () => {
  const edges = new Set(data.edges.map((edge) => edge.id));
  let emptyPaths = 0;
  for (const path of data.paths ?? []) {
    // Tail-trimmed variants may legitimately end with no rails left on the
    // board; any rails they do reference must still exist.
    if (!path.edgeRefs.length) emptyPaths++;
    for (const ref of path.edgeRefs)
      assert.ok(edges.has(ref.edgeId), `path ${path.id} references a missing edge`);
  }
  assert.ok(emptyPaths < (data.paths?.length ?? 1));
  for (const feature of data.features) {
    if (feature.edgeId !== undefined)
      assert.ok(edges.has(feature.edgeId), `${feature.id} attached to a missing edge`);
    assert.ok(Number.isFinite(feature.point[0]) && Number.isFinite(feature.point[1]));
  }
  // Stops keep their boarding identities so live vehicles still match routes.
  assert.ok(data.features.some((feature) => feature.stopIds?.length));
  assert.equal(data.routes.length, original.routes.length);
});

test('edge lengths stay true: display knot-splitting never inflates source distance', () => {
  // A board edge is warped per segment with extra vertices at the compression
  // knots; its source distances must still add up to the real polyline length.
  for (const edge of data.edges) {
    let length = 0;
    for (let i = 1; i < edge.sourcePoints.length; i++)
      length += metres(edge.sourcePoints[i - 1], edge.sourcePoints[i]);
    assert.ok(
      Math.abs(edge.lengthMetres - length) < 0.5,
      `${edge.id}: lengthMetres ${edge.lengthMetres.toFixed(1)} vs polyline ${length.toFixed(1)}`,
    );
    assert.equal(edge.points.length, edge.sourceDistances.length);
  }
});

test('anchors and rendered points agree, so features and cars never slide along the board', () => {
  for (const feature of data.features) {
    if (!feature.edgeId || feature.distanceAlongMetres === undefined) continue;
    const edge = data.edges.find((e) => e.id === feature.edgeId);
    if (!edge) continue;
    const anchored = pointAlongEdge(edge, feature.distanceAlongMetres).point;
    assert.ok(
      metres(local(feature.point), local(anchored)) < 1,
      `${feature.name}: rendered point is not its along-distance position`,
    );
  }
});

test('board features stay where Toronto put them, and terminals sit at turnback endpoints', () => {
  const before = new Map(original.features.map((feature) => [feature.id, feature]));
  let worst = 0,
    worstName = '';
  for (const feature of data.features) {
    const source = before.get(feature.id);
    if (!source) continue;
    const moved = metres(local(source.point), local(feature.point));
    if (moved > worst) {
      worst = moved;
      worstName = feature.name;
    }
  }
  // Simplified corridors may round corners and loops merge, but nothing moves
  // far: the historical Spadina/St Clair label teleports were kilometres.
  assert.ok(worst < 450, `${worstName} moved ${worst.toFixed(0)}m from the schematic`);
  for (const terminal of data.features.filter((f) => f.kind === 'terminal')) {
    if (!terminal.edgeId) continue;
    const edge = data.edges.find((e) => e.id === terminal.edgeId);
    assert.ok(
      terminal.distanceAlongMetres === 0 ||
        Math.abs(terminal.distanceAlongMetres - edge.lengthMetres) < 0.01,
      `${terminal.name} is not anchored at a turnback endpoint`,
    );
  }
});
