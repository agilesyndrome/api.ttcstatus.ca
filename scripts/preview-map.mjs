import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeMapViewer } from "./build-viewer.mjs";

// Compile the actual Worker geometry and renderer, rather than maintain a
// second layout implementation just for local previewing.
const compiled = await build({ stdin: {
  contents: 'export { layoutStreetcarMap } from "./workers/map-generator/src/schematic"; export { renderDebugMapSvg } from "./workers/map-generator/src/debug-render"; export { projectToLocalMetres } from "./workers/map-generator/src/geometry";',
  resolveDir: process.cwd(), loader: "ts",
}, bundle: true, write: false, platform: "node", format: "esm" });
const { layoutStreetcarMap, renderDebugMapSvg, projectToLocalMetres } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
export async function previewMap(input = "streetcarmap.json", output = "streetcar-schematic.json", svg = "streetcar-debug.svg", html = resolve(dirname(svg),"streetcar-debug.html")) {
  if ([output,svg,html].some(path => resolve(input) === resolve(path))) {
    throw new Error("Use separate output files to preserve the input map.");
  }
  const seed = JSON.parse(await readFile(input, "utf8"));
  // Rebuild even an existing schematic from its retained source geometry so
  // downloading an older published graph does not bypass the current fixes.
  let toMetres;
  if (seed.paths.every(p => Array.isArray(p.sourcePoints))) {
    toMetres = p => p;
  } else {
    // v1.0.1 did not retain its affine display transform. For that legacy
    // fixture ONLY, recover it from the two audited Ossington endpoints.
    // Rounded display pixels introduce sub-metre error; this is a preview,
    // not a substitute for regenerating production from canonical D1 data.
    const overlay = seed.infrastructure.find(p => p.id === "ossington-college-dundas");
    if (!overlay || overlay.points.length !== 2 || seed.generatorVersion !== "snake-v1.0.1") {
      throw new Error("Legacy preview requires the v1.0.1 audited Ossington overlay. Regenerate other maps from canonical source data.");
    }
    const a = projectToLocalMetres([43.64935, -79.42072]);
    const b = projectToLocalMetres([43.65436, -79.42275]);
    const [pa, pb] = overlay.points;
    const scale = -(pb[1] - pa[1]) / (b[1] - a[1]);
    if (!(scale > 0) || Math.abs((pb[0] - pa[0]) - (b[0] - a[0]) * scale) > 0.2) {
      throw new Error("Legacy map does not match the expected geographic display transform.");
    }
    toMetres = ([x, y]) => [a[0] + (x - pa[0]) / scale, a[1] - (y - pa[1]) / scale];
    seed.previewSource = { generatorVersion: seed.generatorVersion, note: "Local preview reconstructed from rounded v1.0.1 pixels using audited Ossington anchors. Production generation uses canonical D1 coordinates." };
  }
  for (const path of [...seed.paths, ...seed.infrastructure]) path.points = path.sourcePoints ?? path.points.map(toMetres);
  for (const stop of seed.stops) [stop.x, stop.y] = stop.sourcePoint ?? toMetres([stop.x, stop.y]);
  const map = layoutStreetcarMap(seed);
  await writeFile(output, JSON.stringify(map) + "\n");
  await writeFile(svg, renderDebugMapSvg(map));
  await writeMapViewer(map,html);
  return map;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = process.argv[2] ?? "streetcarmap.json";
  const output = process.argv[3] ?? "streetcar-schematic.json";
  const svg = process.argv[4] ?? "streetcar-debug.svg";
  const html = process.argv[5] ?? "public/map/index.html";
  const map = await previewMap(input, output, svg, html);
  console.log(`Wrote ${svg}, ${output}, and ${html}: ${map.graph.nodes.length} nodes, ${map.graph.edges.length} shared edges, ${map.stops.length} stops.`);
}
