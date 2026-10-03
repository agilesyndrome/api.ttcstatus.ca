import { createServer } from "node:http";
import { build } from "esbuild";
import { previewMap } from "./preview-map.mjs";
import { renderMapViewer } from "./build-viewer.mjs";

// Use the real acquisition/decoder and map builder without D1 or credentials.
// This server is only for local preview; production uses the API Worker.
const compiled = await build({ entryPoints: ["workers/api/src/realtime.ts"], bundle: true,
  write: false, platform: "node", format: "esm", packages: "external" });
// Keep package imports resolvable relative to this repository rather than a data URL.
const { mkdir, writeFile } = await import("node:fs/promises");
await mkdir(".wrangler/preview", { recursive: true });
await writeFile(".wrangler/preview/realtime.mjs", compiled.outputFiles[0].text);
const { fetchVehicleSnapshot, DEFAULT_VEHICLE_FEED_URL, SNAPSHOT_CACHE_SECONDS } = await import("../.wrangler/preview/realtime.mjs");
const map = await previewMap();
const html = await renderMapViewer(map);
let cached, expiresAt = 0, pending;

async function snapshot() {
  if (cached && Date.now() < expiresAt) return cached;
  // Concurrent page loads share one upstream acquisition.
  pending ??= fetchVehicleSnapshot(DEFAULT_VEHICLE_FEED_URL, "Contains information licensed under the Open Government Licence - Toronto")
    .then(value => { cached = value; expiresAt = Date.now() + SNAPSHOT_CACHE_SECONDS * 1000; return value; })
    .finally(() => { pending = undefined; });
  return pending;
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (request.method === "GET" && ["/", "/map", "/map/"].includes(path)) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html); return;
  }
  if (request.method === "GET" && path === "/v1/vehicles/streetcar") {
    try {
      const value = await snapshot();
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value));
    } catch (error) {
      console.error("Live preview snapshot failed", error);
      response.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify({ error: "vehicles-unavailable" }));
    }
    return;
  }
  response.writeHead(404); response.end("Not found");
});
const port = Number(process.env.PORT ?? 4173);
server.listen(port, "127.0.0.1", () => console.log(`Streetcar map with live snapshot: http://127.0.0.1:${port}/map/`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
