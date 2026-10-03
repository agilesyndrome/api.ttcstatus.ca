import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const model = await build({ entryPoints:["web/map/model.ts"],bundle:true,write:false,platform:"node",format:"esm" });
const { buildViewerData } = await import(`data:text/javascript;base64,${Buffer.from(model.outputFiles[0].text).toString("base64")}`);

export async function renderMapViewer(map) {
  const [template,css,client] = await Promise.all([
    readFile("web/map/index.html","utf8"),readFile("web/map/viewer.css","utf8"),
    build({entryPoints:["web/map/viewer.ts"],bundle:true,write:false,platform:"browser",format:"iife",target:"es2022",minify:true}),
  ]);
  // JSON is data, not markup. Escape script delimiters even in untrusted stop
  // names, and replace each template token in a single pass (no nested tokens).
  const payload = JSON.stringify(buildViewerData(map)).replaceAll("<","\\u003c").replaceAll("&","\\u0026")
    .replaceAll("\u2028","\\u2028").replaceAll("\u2029","\\u2029");
  const values = { VIEWER_CSS:css, VIEWER_DATA:payload, VIEWER_JS:client.outputFiles[0].text.replaceAll("</script","<\\/script") };
  return template.replace(/\/\* (VIEWER_CSS|VIEWER_DATA|VIEWER_JS) \*\//g,(_,name) => values[name]);
}

export async function writeMapViewer(map,output) {
  const html = await renderMapViewer(map);
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,html);
  return html;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = process.argv[2] ?? "streetcar-schematic.json", output = process.argv[3] ?? "public/map/index.html";
  if (resolve(input) === resolve(output)) throw new Error("Use a separate output file to preserve the input map");
  await writeMapViewer(JSON.parse(await readFile(input,"utf8")),output);
  console.log(`Wrote static interactive map to ${output}`);
}
