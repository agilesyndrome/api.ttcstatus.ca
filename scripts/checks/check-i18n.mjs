import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const errors = [];
async function prepare(context) {
  await context.route('**/api/v1/auth/config', (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await context.route('**/api/v1/map/streetcar?format=schematic-v1', (route) =>
    route.fulfill({ json: map }),
  );
  await context.route('**/api/v1/vehicles/streetcar', (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
}
try {
  const context = await browser.newContext({ locale: 'fr-FR' });
  await prepare(context);
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Suivez les rails de la ville.' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'fr-CA');
  assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
  await page.getByRole('button', { name: 'Compris', exact: true }).click();
  await page.getByRole('link', { name: 'Paramètres de langue' }).click();
  await page.getByLabel('Langue', { exact: true }).selectOption('en-CA');
  await page.getByRole('heading', { name: 'Browser profile' }).waitFor();
  await page.reload();
  assert.equal(await page.getByLabel('Language', { exact: true }).inputValue(), 'en-CA');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en-CA');

  const mapPage = await context.newPage();
  await mapPage.goto(origin);
  await mapPage.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await mapPage.waitForTimeout(250);
  const viewBox = await mapPage.locator('#map').getAttribute('viewBox');
  await mapPage.getByRole('searchbox').fill('Queen');
  await page.getByLabel('Language', { exact: true }).selectOption('fr-CA');
  await mapPage.getByRole('button', { name: 'Ajuster la carte', exact: true }).waitFor();
  assert.equal(
    await mapPage.getByRole('searchbox').inputValue(),
    'Queen',
    'switching preserves form state',
  );
  assert.equal(
    await mapPage.locator('#map').getAttribute('viewBox'),
    viewBox,
    'switching preserves camera',
  );
  await page.getByLabel('Langue', { exact: true }).selectOption('browser');
  assert.equal(await page.evaluate(() => localStorage.getItem('ttc.language')), null);
  assert.equal(await page.locator('html').getAttribute('lang'), 'fr-CA');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      value: ['de-DE', 'en-GB'],
    });
    window.dispatchEvent(new Event('languagechange'));
  });
  await page.getByRole('heading', { name: 'Browser profile' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Language', { exact: true }).selectOption('fr-CA');
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'French profile fits mobile',
  );
  await mapPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await mapPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'French map fits mobile',
  );
  await mapPage.screenshot({ path: '/tmp/ttc-french-mobile.png' });
  const staticPage = await context.newPage();
  await staticPage.route('**/standalone-map-test', async (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: await readFile('dist/map/index.html', 'utf8'),
    }),
  );
  await staticPage.goto(`${origin}/standalone-map-test`);
  await staticPage
    .getByRole('button', { name: 'Ajuster la carte', exact: true })
    .waitFor();
  await staticPage
    .getByRole('heading', { name: 'Suivez les rails de la ville.' })
    .waitFor();
  await page.getByLabel('Langue', { exact: true }).selectOption('en-CA');
  await staticPage.getByRole('button', { name: 'Fit map', exact: true }).waitFor();
  await staticPage.getByRole('heading', { name: 'Follow the city’s tracks.' }).waitFor();
  await context.close();

  const unsupported = await browser.newContext({ locale: 'ja-JP' });
  await prepare(unsupported);
  await unsupported.addInitScript(() => {
    try {
      localStorage.setItem('ttc.language', 'invalid');
    } catch {
      /* Initial blank documents may disallow storage. */
    }
  });
  const fallbackPage = await unsupported.newPage();
  await fallbackPage.goto(`${origin}/profile`);
  await fallbackPage.getByRole('heading', { name: 'Browser profile' }).waitFor();
  assert.equal(await fallbackPage.locator('html').getAttribute('lang'), 'en-CA');
  await unsupported.close();

  const blocked = await browser.newContext({ locale: 'en-CA' });
  await prepare(blocked);
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(`${origin}/profile`);
  await blockedPage.getByLabel('Language', { exact: true }).selectOption('fr-CA');
  await blockedPage
    .getByText(
      'Le stockage du navigateur est indisponible. Votre choix de langue sera conservé pour cet onglet seulement.',
    )
    .waitFor();
  assert.equal(await blockedPage.locator('html').getAttribute('lang'), 'fr-CA');
  await blocked.close();
  assert.deepEqual(errors, []);
  console.log(
    'Internationalization passed: detection, fallback, reload, reset, cross-tab changes, state preservation, mobile profile, unavailable storage.',
  );
} finally {
  await browser.close();
}
