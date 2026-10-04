import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const preview = resolve('dist/streetcar-debug.html');
// The page embeds its data, CSS and JavaScript, so the same viewer works from
// file://, the local preview, or a static host. Live status additionally needs
// the public API (file previews) or the same-origin vehicle endpoint (HTTP).
await writeFile(preview, await readFile('dist/map/index.html', 'utf8'));

const url = pathToFileURL(preview).href;
const opener =
  process.env.MAP_OPEN ??
  (process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'rundll32'
      : 'xdg-open');
const args =
  process.platform === 'win32' && !process.env.MAP_OPEN
    ? ['url.dll,FileProtocolHandler', url]
    : [url];
const result = spawnSync(opener, args, { stdio: 'inherit' });
if (result.error || result.status !== 0) {
  console.error(
    `Could not open the browser: ${result.error?.message ?? `opener exited with ${result.status}`}. Preview saved at ${url}`,
  );
  process.exitCode = 1;
} else {
  console.log(`Opened ${url}`);
}
