import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { previewMap } from '../../scripts/preview/preview-map.mjs';

const compiled = await build({
  stdin: {
    contents:
      'export { buildViewerData } from "./shared/map/model"; export { projectSnapshot } from "./shared/map/live-status"; export { projectToLocalMetres, nearestOnSegment } from "./shared/map/geometry";',
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { buildViewerData, projectSnapshot, projectToLocalMetres, nearestOnSegment } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
const tracks = JSON.parse(
  await readFile('workers/map-generator/src/source/physical-tracks.json', 'utf8'),
).filter((track) => track.verifiedAt === '2026-10-04');
const loops = [
  'mccaul-loop',
  'wolseley-physical-9457366',
  'college-physical-680559068',
  'woodbine-physical-9454851',
  'sunnyside-physical-9454815',
  'fleet-physical-9457376',
  'oakwood-physical-530115852',
  'coxwell-physical-23733144',
  'kipling-physical-9454782',
];
let dir, map;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ttc-physical-loops-'));
  // Rebuild an immutable older fixture: additions must work without a GTFS update.
  map = await previewMap(
    'data/fixtures/streetcar-schematic.json',
    join(dir, 'map.json'),
    join(dir, 'map.svg'),
    join(dir, 'index.html'),
  );
});
after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('car 4536 at McCaul matches physical rail without inventing scheduled service', async () => {
  const snapshot = JSON.parse(
    await readFile('data/fixtures/car-4536-mccaul.json', 'utf8'),
  );
  const now = Date.parse(snapshot.fetchedAt);
  const oldMap = JSON.parse(
    await readFile('data/fixtures/streetcar-schematic.json', 'utf8'),
  );
  assert.equal(
    projectSnapshot(buildViewerData(oldMap), snapshot, now)[0].match,
    undefined,
  );
  const car = projectSnapshot(buildViewerData(map), snapshot, now)[0];
  assert.ok(car.match, 'the captured car must no longer be off mapped track');
  assert.ok(car.match.distanceFromTrackMetres < 15);
  assert.equal(car.stale, false);
  const edge = map.graph.edges.find((edge) => edge.id === car.match.edgeId);
  assert.ok(edge.infrastructureIds.includes('mccaul-loop'));
  assert.deepEqual(edge.routeIds, [], 'a 501 observation is not scheduled loop service');
});

test('every audited addition connects to the surface graph and retains its geometry', () => {
  assert.ok(tracks.length > loops.length);
  const edges = new Map(map.graph.edges.map((edge) => [edge.id, edge]));
  const nodes = new Map(map.graph.nodes.map((node) => [node.id, node]));
  const start = map.graph.edges.find((edge) => edge.routeIds.includes('501')).a;
  const reachable = new Set([start]),
    pending = [start];
  while (pending.length) {
    const id = pending.pop();
    for (const edgeId of nodes.get(id).edgeIds) {
      const edge = edges.get(edgeId),
        next = edge.a === id ? edge.b : edge.a;
      if (!reachable.has(next)) {
        reachable.add(next);
        pending.push(next);
      }
    }
  }
  for (const track of tracks) {
    const overlay = map.infrastructure.find((path) => path.id === track.id);
    assert.ok(overlay?.edgeRefs.length, track.id);
    assert.equal(overlay.scheduledService, false);
    const rail = overlay.edgeRefs.map((ref) => edges.get(ref.edgeId));
    assert.ok(
      rail.every((edge) => reachable.has(edge.a) && reachable.has(edge.b)),
      track.id,
    );
    for (const point of track.points) {
      const local = projectToLocalMetres(point);
      const distance = Math.min(
        ...rail.flatMap((edge) =>
          edge.sourcePoints
            .slice(1)
            .map((end, i) => nearestOnSegment(local, edge.sourcePoints[i], end).distance),
        ),
      );
      assert.ok(distance < 25, `${track.id}: source geometry displaced ${distance}m`);
    }
  }
});

test('turnback loops retain a local cycle instead of becoming disconnected stubs', () => {
  for (const id of loops) {
    const path = map.infrastructure.find((path) => path.id === id);
    // Include the street junction closing triangular loops (College, Woodbine).
    const min = [0, 1].map(
      (axis) => Math.min(...path.sourcePoints.map((p) => p[axis])) - 120,
    );
    const max = [0, 1].map(
      (axis) => Math.max(...path.sourcePoints.map((p) => p[axis])) + 120,
    );
    const nodes = map.graph.nodes.filter((node) =>
      node.sourcePoint.every((value, axis) => value >= min[axis] && value <= max[axis]),
    );
    const parent = new Map(nodes.map((node) => [node.id, node.id]));
    const root = (id) => {
      while (parent.get(id) !== id) id = parent.get(id);
      return id;
    };
    let cycles = 0;
    for (const edge of map.graph.edges.filter(
      (edge) => parent.has(edge.a) && parent.has(edge.b),
    )) {
      const a = root(edge.a),
        b = root(edge.b);
      if (a === b) cycles++;
      else parent.set(a, b);
    }
    assert.ok(cycles > 0, `${id}: missing local return path`);
  }
});
