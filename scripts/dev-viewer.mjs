import { createServer } from "node:http";
import { build } from "esbuild";
import { previewMap } from "./preview-map.mjs";
import { renderMapViewer } from "./build-viewer.mjs";

// Use the real acquisition/decoder and map builder without D1 or credentials.
// This server is only for local preview; production uses the API Worker.
const compiled = await build({ stdin: { contents: `
  export { DEFAULT_VEHICLE_FEED_URL } from "./workers/api/src/realtime";
  export { VehicleSnapshotCache } from "./workers/api/src/vehicle-snapshot-cache";
  export { liveUpdateSeconds } from "./workers/shared/live-config";`, resolveDir: process.cwd(), loader: "ts" }, bundle: true,
  write: false, platform: "node", format: "esm", packages: "external" });
// Keep package imports resolvable relative to this repository rather than a data URL.
const { mkdir, writeFile } = await import("node:fs/promises");
await mkdir(".wrangler/preview", { recursive: true });
await writeFile(".wrangler/preview/realtime.mjs", compiled.outputFiles[0].text);
const { VehicleSnapshotCache, DEFAULT_VEHICLE_FEED_URL, liveUpdateSeconds } = await import("../.wrangler/preview/realtime.mjs");
const map = await previewMap();
const html = await renderMapViewer(map);
const updateSeconds = liveUpdateSeconds(process.env.REALTIME_UPDATE_SECONDS);
const snapshots = new VehicleSnapshotCache(DEFAULT_VEHICLE_FEED_URL,
  "Contains information licensed under the Open Government Licence - Toronto", updateSeconds);

const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (request.method === "GET" && ["/", "/map", "/map/"].includes(path)) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html); return;
  }
  if (request.method === "GET" && path === "/api/v1/vehicles/streetcar") {
    try {
      const value = await snapshots.get();
      const headers = { "content-type": "application/json", "cache-control": "no-store", etag: value.etag,
        "x-live-update-seconds": String(updateSeconds), "x-live-next-update-at": new Date(value.nextUpdateAt).toISOString() };
      if (request.headers["if-none-match"] === value.etag) { response.writeHead(304, headers); response.end(); }
      else { response.writeHead(200, headers); response.end(JSON.stringify(value.snapshot)); }
    } catch (error) {
      console.error("Live preview snapshot failed", error);
      response.writeHead(503, { "content-type": "application/json", "cache-control": "no-store",
        "x-live-update-seconds": String(updateSeconds), "retry-after": String(updateSeconds) }); response.end(JSON.stringify({ error: "vehicles-unavailable" }));
    }
    return;
  }
  response.writeHead(404); response.end("Not found");
});
const port = Number(process.env.PORT ?? 4173);
server.listen(port, "127.0.0.1", () => console.log(`Streetcar map with ${updateSeconds}s live updates: http://127.0.0.1:${port}/map/`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
