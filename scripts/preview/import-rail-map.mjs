import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Reuse a downloaded official Complete GTFS ZIP; never fetch on preview requests.
const zip = process.argv[2];
if (!zip) throw new Error('Usage: npm run map:import -- /path/to/completegtfs.zip');
const directory = '.wrangler/preview';
await mkdir(directory, { recursive: true });
const compiled = await build({
  stdin: {
    contents: `export { parseStreetcarGtfs } from './workers/shared/gtfs/parser';
export { buildStreetcarMapBundle } from './workers/map-generator/src/layout/build-map';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const modulePath = resolve(directory, 'rail-import.mjs');
await writeFile(modulePath, compiled.outputFiles[0].text);
const { parseStreetcarGtfs, buildStreetcarMapBundle } = await import(
  pathToFileURL(modulePath)
);
const parsed = await parseStreetcarGtfs({
  stream(name) {
    const child = spawn('unzip', ['-p', resolve(zip), name], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.on('error', (error) => child.stdout.destroy(error));
    child.on('close', (code) => {
      if (code) child.stdout.destroy(new Error(`unzip exited ${code}`));
    });
    return Readable.toWeb(child.stdout);
  },
});
const required = ['1', '2', '4', '5', '6'];
if (required.some((number) => !parsed.routes.some((route) => route.shortName === number)))
  throw new Error('Complete GTFS must contain Lines 1, 2, 4, 5 and 6');
const bundle = buildStreetcarMapBundle(
  {
    version: {
      id: 0,
      source_url: 'https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/',
      fetched_at: new Date().toISOString(),
      imported_at: new Date().toISOString(),
    },
    routes: parsed.routes.map((r) => ({
      route_id: r.routeId,
      short_name: r.shortName,
      long_name: r.longName,
      route_type: r.routeType,
      color: r.color,
      text_color: r.textColor,
    })),
    patterns: parsed.patterns.map((p) => ({
      pattern_id: p.patternId,
      route_id: p.routeId,
      direction_id: p.directionId,
      shape_id: p.shapeId,
      headsign: p.headsign,
      trip_count: p.tripCount,
    })),
    shapes: parsed.shapes.map((s) => ({
      shape_id: s.shapeId,
      points_json: JSON.stringify(s.points),
    })),
    stops: parsed.stops.map((s) => ({
      stop_id: s.stopId,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      location_type: s.locationType,
      parent_station: s.parentStation,
      wheelchair_boarding: s.wheelchairBoarding,
    })),
    patternStops: parsed.patternStops.map((s) => ({
      pattern_id: s.patternId,
      stop_id: s.stopId,
      stop_sequence: s.sequence,
    })),
    overlays: [],
  },
  'Contains information licensed under the Open Government Licence – Toronto',
);
await writeFile(resolve(directory, 'rail-map.json'), JSON.stringify(bundle));
console.log(
  `Imported ${parsed.routes.length} rail routes; preview map: ${directory}/rail-map.json`,
);
