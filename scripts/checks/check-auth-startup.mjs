import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await installAccountFixture(context);
  await context.route('**/api/v1/map/ttcstatus*', (route) =>
    route.fulfill({ json: map }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  let releaseConfig;
  const heldConfig = new Promise((resolve) => {
    releaseConfig = resolve;
  });
  const slowConfig = async (route) => {
    await heldConfig;
    return route.fallback();
  };
  await context.route('**/api/v1/auth/config', slowConfig);
  await page.goto(origin);
  await page.locator('#map').waitFor();
  assert.equal(await page.locator('.track-work').count(), 0);
  const configResponse = page.waitForResponse(
    (response) => response.url().includes('/api/v1/auth/config') && response.ok(),
  );
  releaseConfig();
  await configResponse;
  await context.unroute('**/api/v1/auth/config', slowConfig);

  const maintenance = (route) =>
    route.fulfill({ json: { enabled: false, publishableKey: null } });
  await context.route('**/api/v1/auth/config', maintenance);
  await page.goto(origin);
  await page
    .getByRole('heading', {
      name: 'Please wait while we perform track maintenance',
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator('#map').count(), 0);
  await context.unroute('**/api/v1/auth/config', maintenance);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('#map').waitFor();

  for (const failure of ['http', 'network', 'invalid']) {
    const failConfig = (route) => {
      if (failure === 'network') return route.abort('failed');
      return route.fulfill({
        status: failure === 'http' ? 503 : 200,
        json: failure === 'invalid' ? { enabled: true, publishableKey: 123 } : {},
      });
    };
    await context.route('**/api/v1/auth/config', failConfig);
    await page.goto(origin);
    await page.locator('#map').waitFor();
    assert.equal(await page.locator('.track-work').count(), 0, failure);
    await page.goto(origin + '/profile');
    await page.getByText('Accounts unavailable', { exact: true }).first().waitFor();
    await context.unroute('**/api/v1/auth/config', failConfig);
    await page.getByRole('button', { name: 'Retry accounts' }).first().click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).first().waitFor();
  }

  assert.deepEqual(errors, []);
  console.log(
    'Auth startup passed: progressive public map, explicit maintenance, and account-only failure recovery.',
  );
} finally {
  await browser.close();
}
