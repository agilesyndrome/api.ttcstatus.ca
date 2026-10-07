import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// Compile the actual Worker geometry rather than maintain a second layout
// implementation for local previewing. This module only lays out a local map
// bundle; production generation stays in the map-generator Worker.
const compiled = await build({
  stdin: {
    contents:
      'export { layoutStreetcarMap } from "./workers/map-generator/src/topology/schematic"; export { projectToLocalMetres } from "./shared/map/geometry";',
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { layoutStreetcarMap, projectToLocalMetres } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

/** Lay out a local map bundle for the vite preview middleware and map tests. */
export async function previewMap(input = 'data/fixtures/streetcarmap.json', output) {
  const seed = JSON.parse(await readFile(resolve(input), 'utf8'));
  // Rebuild even an existing schematic from its retained source geometry so
  // previewing an older published graph does not bypass the current fixes.
  let toMetres;
  if (seed.paths.every((p) => Array.isArray(p.sourcePoints))) {
    toMetres = (p) => p;
  } else {
    // v1.0.1 did not retain its affine display transform. For that legacy
    // fixture ONLY, recover it from the two audited Ossington endpoints.
    // Rounded display pixels introduce sub-metre error; this is a preview,
    // not a substitute for regenerating production from canonical D1 data.
    const overlay = seed.infrastructure.find((p) => p.id === 'ossington-college-dundas');
    if (
      !overlay ||
      overlay.points.length !== 2 ||
      seed.generatorVersion !== 'snake-v1.0.1'
    ) {
      throw new Error(
        'Legacy preview requires the v1.0.1 audited Ossington overlay. Regenerate other maps from canonical source data.',
      );
    }
    const a = projectToLocalMetres([43.64935, -79.42072]);
    const b = projectToLocalMetres([43.65436, -79.42275]);
    const [pa, pb] = overlay.points;
    const scale = -(pb[1] - pa[1]) / (b[1] - a[1]);
    if (!(scale > 0) || Math.abs(pb[0] - pa[0] - (b[0] - a[0]) * scale) > 0.2) {
      throw new Error(
        'Legacy map does not match the expected geographic display transform.',
      );
    }
    toMetres = ([x, y]) => [a[0] + (x - pa[0]) / scale, a[1] - (y - pa[1]) / scale];
    seed.previewSource = {
      generatorVersion: seed.generatorVersion,
      note: 'Local preview reconstructed from rounded v1.0.1 pixels using audited Ossington anchors. Production generation uses canonical D1 coordinates.',
    };
  }
  for (const path of [...seed.paths, ...seed.infrastructure])
    path.points = path.sourcePoints ?? path.points.map(toMetres);
  for (const stop of seed.stops)
    [stop.x, stop.y] = stop.sourcePoint ?? toMetres([stop.x, stop.y]);
  const map = layoutStreetcarMap(seed);
  if (output) {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, JSON.stringify(map) + '\n');
  }
  return map;
}
