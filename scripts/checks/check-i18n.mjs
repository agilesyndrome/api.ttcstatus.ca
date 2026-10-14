import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const errors = [];
async function chooseLanguage(page, label) {
  await page
    .locator('.language-settings .segmented-control')
    .getByRole('button', { name: label, exact: true })
    .click();
}
async function prepare(context) {
  await installAccountFixture(context);
  await context.route('**/api/v1/map/ttcstatus*', (route) =>
    route.fulfill({ json: map }),
  );
  await context.route('**/live/t/*/vehicles.json', (route) =>
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
  await page.getByRole('tab', { name: 'Explorer', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'fr-CA');
  assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
  await page.getByRole('button', { name: 'Compris', exact: true }).click();
  await page.getByRole('link', { name: 'Paramètres de langue' }).click();
  await chooseLanguage(page, 'English');
  await page.getByRole('heading', { name: 'Language', exact: true }).waitFor();
  await page.reload();
  assert.equal(
    await page
      .locator('.language-settings .segmented-control button[aria-pressed="true"]')
      .textContent(),
    'English',
  );
  assert.equal(await page.locator('html').getAttribute('lang'), 'en-CA');

  const mapPage = await context.newPage();
  await mapPage.goto(origin);
  // Zoom with the map's own wheel gesture (the explorer has no zoom overlay),
  // so the camera-preservation assertion below is meaningful.
  await mapPage.locator('#map').hover();
  await mapPage.mouse.wheel(0, -240);
  await mapPage.waitForTimeout(250);
  const viewBox = await mapPage.locator('#map').getAttribute('viewBox');
  await mapPage.getByRole('searchbox').fill('Queen');
  await chooseLanguage(page, 'Français');
  // The map tools re-render in French; the overnight layer label proves it.
  await mapPage.getByRole('checkbox', { name: 'Inclure les lignes de nuit' }).waitFor();
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
  await chooseLanguage(page, 'Auto');
  assert.equal(await page.evaluate(() => localStorage.getItem('ttc.language')), null);
  assert.equal(await page.locator('html').getAttribute('lang'), 'fr-CA');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      value: ['de-DE', 'en-GB'],
    });
    window.dispatchEvent(new Event('languagechange'));
  });
  await page.getByRole('heading', { name: 'Langue', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseLanguage(page, 'Français');
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
  await page.getByLabel('Langue', { exact: true }).selectOption('en-CA');
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
  await fallbackPage.getByRole('heading', { name: 'Language', exact: true }).waitFor();
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
  await chooseLanguage(blockedPage, 'Français');
  // With storage blocked the preference cannot persist, but the choice still
  // applies to the session: the page renders in French without the removed
  // browser-storage warnings.
  await blockedPage.getByRole('heading', { name: 'Langue', exact: true }).waitFor();
  assert.equal(await blockedPage.locator('html').getAttribute('lang'), 'fr-CA');
  await blocked.close();
  assert.deepEqual(errors, []);
  console.log(
    'Internationalization passed: detection, fallback, reload, reset, cross-tab changes, state preservation, mobile profile, unavailable storage.',
  );
} finally {
  await browser.close();
}
