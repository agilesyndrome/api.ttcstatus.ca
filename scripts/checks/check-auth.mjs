import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  const { journals } = await installAccountFixture(context);
  await context.route('**/api/v1/map/streetcar?format=schematic-v1', (route) =>
    route.fulfill({ json: map }),
  );
  await context.route('**/api/v1/vehicles/streetcar', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        fetchedAt: new Date().toISOString(),
        feedTimestamp: new Date().toISOString(),
        source: 'auth-test',
        attribution: 'Fixture',
        invalidPositions: 0,
        vehicles: [],
      },
    }),
  );
  const page = await context.newPage();
  for (const failure of ['disabled', 'http', 'network', 'invalid']) {
    let failed = false;
    const configFailure = (route) => {
      if (failed) return route.fallback();
      failed = true;
      if (failure === 'network') return route.abort('failed');
      return route.fulfill({
        status: failure === 'http' ? 503 : 200,
        json:
          failure === 'disabled'
            ? { enabled: false, publishableKey: null }
            : { enabled: true, publishableKey: 123 },
      });
    };
    await context.route('**/api/v1/auth/config', configFailure);
    await page.goto(origin);
    await page.locator('#map').waitFor();
    if (failure === 'disabled') {
      await page
        .getByRole('complementary', { name: 'Independent site notice' })
        .waitFor();
      await page.getByRole('button', { name: 'Got it', exact: true }).click();
    } else {
      assert.equal(await page.locator('.affiliation-notice').count(), 0);
    }
    await page.getByText('Accounts unavailable', { exact: true }).waitFor();
    if (failure === 'disabled') {
      for (const width of [320, 390, 900, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `unavailable accounts do not overflow at ${width}`,
        );
      }
    }
    await page.getByRole('tab', { name: 'Journal', exact: true }).click();
    await page.getByRole('heading', { name: 'Make it your journal.' }).waitFor();
    assert.ok(!(await page.locator('body').innerText()).includes('coming soon'));
    await page.getByRole('button', { name: 'Retry accounts', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).first().waitFor();
    await context.unroute('**/api/v1/auth/config', configFailure);
  }
  await page.goto(origin);
  await page.locator('#map').waitFor();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sign up', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Journal', exact: true }).click();
  await page.getByRole('heading', { name: 'Make it your journal.' }).waitFor();
  assert.equal(await page.locator('.journal-entry').count(), 0);
  for (const width of [320, 390, 900, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `no overflow at ${width}`,
    );
    await page.screenshot({ path: `/tmp/ttc-auth-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page
    .getByText('Your journal is saved to your account.', { exact: true })
    .waitFor();
  await page.getByLabel('Streetcar number', { exact: true }).fill('4500');
  await page.getByLabel('Private note (optional)').fill('Spotted on King');
  await page.getByRole('button', { name: 'Add car to journal', exact: true }).click();
  const added = page.getByRole('article', { name: 'Collected car 4500', exact: true });
  await added.getByText('Spotted on King', { exact: true }).waitFor();
  await added.getByRole('button', { name: 'Mark ridden' }).click();
  await page
    .getByText('Your journal is saved to your account.', { exact: true })
    .waitFor();
  assert.equal(
    journals.get('user_a').entries.find((e) => e.vehicleId === '4500').status,
    'ridden',
  );
  await added.getByRole('button', { name: 'Edit note' }).click();
  await added.getByLabel('Note for car 4500').fill('A quiet ride');
  await context.route('**/api/v1/me/journal', (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'test-failure' } });
  });
  await added.getByRole('button', { name: 'Save note' }).click();
  await page.getByText('Your last change has not been saved.', { exact: true }).waitFor();
  assert.equal(await added.getByLabel('Note for car 4500').inputValue(), 'A quiet ride');
  assert.equal(
    journals.get('user_a').entries.find((e) => e.vehicleId === '4500').note,
    'Spotted on King',
  );
  await context.unroute('**/api/v1/me/journal');
  await added.getByRole('button', { name: 'Save note' }).click();
  await page
    .getByText('Your journal is saved to your account.', { exact: true })
    .waitFor();
  await page.reload();
  await page.getByRole('tab', { name: 'Journal', exact: true }).click();
  await added.getByText('A quiet ride', { exact: true }).waitFor();
  assert.ok((await added.innerText()).includes('Ridden'));
  await added.getByRole('button', { name: 'Remove', exact: true }).click();
  await added.getByRole('button', { name: 'Confirm removal' }).click();
  await page
    .getByText('Your journal is saved to your account.', { exact: true })
    .waitFor();
  assert.equal(journals.get('user_a').entries.length, 1);
  await page.evaluate(() => {
    window.__testUser = 'user_b';
    window.dispatchEvent(new Event('fixture-account'));
  });
  await page.getByText('Your first catch is waiting.', { exact: false }).waitFor();
  assert.equal(
    await page.locator('.journal-entry').count(),
    0,
    'switching accounts hides previous entries',
  );
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Make it your journal.' }).waitFor();
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await page
    .getByText('Your journal is saved to your account.', { exact: true })
    .waitFor();
  assert.equal(await page.locator('.journal-entry').count(), 1);
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Show my profile and earned badges publicly').isChecked(),
    false,
  );
  await page.getByLabel('Username', { exact: true }).fill('collector');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByText('Profile saved.', { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('link', { name: 'View your public badges', exact: false })
      .count(),
    0,
  );
  await page.getByLabel('Show my profile and earned badges publicly').check();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page
    .getByRole('link', { name: 'View your public badges', exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole('link', { name: 'View your public badges', exact: false })
      .getAttribute('href'),
    '/u/collector#badges',
  );
  await page.getByLabel('Show my profile and earned badges publicly').uncheck();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByText('Profile saved.', { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('link', { name: 'View your public badges', exact: false })
      .count(),
    0,
  );
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Make it your journal.' }).waitFor();
  assert.equal(await page.getByLabel('Username', { exact: true }).count(), 0);

  await context.route('**/api/v1/profiles/collector', (route) =>
    route.fulfill({
      json: {
        username: 'collector',
        badges: [
          { name: 'First catch', icon: '✦', description: 'Add your first streetcar.' },
        ],
      },
    }),
  );
  await page.goto(origin + '/u/collector#badges');
  await page.getByRole('heading', { name: '@collector', exact: true }).waitFor();
  await page.getByText('First catch', { exact: true }).waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('Private earlier note'));
  await page.goto(origin + '/u/private#badges');
  await page
    .getByText('This profile is private or does not exist.', { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Auth UI passed with an isolated Clerk fixture: configuration failures and recovery, public map, sign-in/sign-up controls, protected Journal, explicit legacy import, account switching/sign-out, private profile defaults, badge sharing settings, public/private profile views and 320–1440px layouts.',
  );
  await context.close();
} finally {
  await browser.close();
}
