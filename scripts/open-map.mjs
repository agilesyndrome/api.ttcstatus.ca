import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

await access("streetcar-debug.svg");
const preview = resolve("streetcar-debug.html");
// Open an HTML wrapper so the native opener selects a browser even when SVGs
// are associated with an image viewer or editor.
await writeFile(preview, `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Toronto streetcars — map debug</title>
<style>body { margin: 0; background: #f7f5ed; } iframe { display: block; border: 0; width: 100%; height: 100vh; }</style>
<iframe src="streetcar-debug.svg" title="Toronto streetcar map"></iframe>
</html>
`);

const url = pathToFileURL(preview).href;
const opener = process.env.MAP_OPEN ?? (process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open");
const args = process.platform === "win32" && !process.env.MAP_OPEN ? ["url.dll,FileProtocolHandler", url] : [url];
const result = spawnSync(opener, args, { stdio: "inherit" });
if (result.error || result.status !== 0) {
  console.error(`Could not open the browser: ${result.error?.message ?? `opener exited with ${result.status}`}. Preview saved at ${url}`);
  process.exitCode = 1;
} else {
  console.log(`Opened ${url}`);
}
