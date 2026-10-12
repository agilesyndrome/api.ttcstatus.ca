import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve('dist');
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
// Serve the built shell, including its real service worker, rather than Vite dev modules.
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  try {
    if (path === '/api/v1/auth/config') {
      response.setHeader('content-type', 'application/json');
      response.end('{"enabled":false}');
      return;
    }
    if (path.startsWith('/api/')) {
      response.writeHead(503);
      response.end('{}');
      return;
    }
    const filename =
      path.startsWith('/assets/') || path === '/sw.js'
        ? resolve(directory, `.${path}`)
        : resolve(directory, 'index.html');
    if (!filename.startsWith(`${directory}/`)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader(
      'content-type',
      filename.endsWith('.js')
        ? 'application/javascript'
        : filename.endsWith('.css')
          ? 'text/css'
          : 'text/html',
    );
    response.end(await readFile(filename));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const errors = [];
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  await context.route('**/api/v1/map/ttcstatus', (route) =>
    route.fulfill({ json: map, headers: { etag: '"offline-map"' } }),
  );
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('#map').waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, {
          once: true,
        }),
      );
  });
  await page.waitForTimeout(200);
  await context.setOffline(true);
  await page.reload();
  await page.locator('#map').waitFor();
  await page.getByText(/Offline — showing the saved map/).waitFor();
  await page.getByRole('button', { name: 'Open menu', exact: true }).tap();
  await page.getByRole('link', { name: 'Settings', exact: true }).tap();
  await page.getByRole('heading', { name: 'Browser profile', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Browser profile', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Built offline shell passed: cold offline map reload, cached geometry, lazy Settings navigation and direct offline Settings reload.',
  );
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
