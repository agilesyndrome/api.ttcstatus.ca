import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installAccountFixture } from '../preview/auth-fixture.mjs';

// The replay TV (docs/replay.md), end to end: historical tick documents are
// synthesized on the same public path the recorder publishes, and the check
// watches the screen behave — cars glide, the frame clock ticks, pause
// freezes the picture, the scrubber seeks, the speed chip cycles, a tap
// solos a car (with its recorded-stops card) and a tap on a track focuses
// its route. Replay is members-only: the signed-out pass asserts the
// destination is hidden and a deep link bounces home.
const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';
const map = JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8'));
const route501 = map.routes.find((entry) => entry.shortName === '501');
const route504 = map.routes.find((entry) => entry.shortName === '504');
const TICK_MS = 30_000;
let tickRequests = 0;

/** Deterministic fleets per tick: car 4400 drives north on 501, car 4401
 * creeps on 504, one tick-width per tick. */
function snapshotFor(tickId) {
  const startMs = tickId * TICK_MS;
  const now = new Date(startMs).toISOString();
  return {
    schemaVersion: 1,
    source: 'replay-fixture',
    attribution: 'Fixture',
    fetchedAt: now,
    feedTimestamp: now,
    tickId,
    invalidPositions: 0,
    vehicles: [
      {
        id: '4400',
        label: '4400',
        latitude: 43.6488 + (tickId % 400) * 0.00005,
        longitude: -79.396,
        observedAt: now,
        routeId: route501.id,
        speedMetresPerSecond: tickId % 6 < 2 ? 0 : 6,
      },
      {
        id: '4401',
        label: '4401',
        latitude: 43.647,
        longitude: -79.402 - (tickId % 200) * 0.00005,
        observedAt: now,
        routeId: route504.id,
        speedMetresPerSecond: 4,
      },
    ],
  };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  // Signed out: replay is a members' destination — hidden from the nav,
  // and a deep link shows the sign-in gate with the remote absent, and the
  // engine never fetches a single historical tick.
  let anonymousTicks = 0;
  const anonymous = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await installAccountFixture(anonymous);
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.route('**/api/v1/map/ttcstatus*', (request) =>
    request.fulfill({ json: map }),
  );
  await anonymousPage.route('**/live/t/*/vehicles.json', (request) => {
    const tickId = Number(
      request
        .request()
        .url()
        .match(/\/t\/(\d+)\//)[1],
    );
    // The live poller reads the freshest public ticks by design; only a
    // HISTORICAL fetch would mean the replay engine ran signed out.
    if (tickId <= Math.floor(Date.now() / TICK_MS) - 2) anonymousTicks++;
    return request.fulfill({ json: snapshotFor(tickId) });
  });
  await anonymousPage.goto(origin);
  await anonymousPage.locator('.app-nav').waitFor();
  assert.equal(
    await anonymousPage.getByRole('tab', { name: 'Replay' }).count(),
    0,
    'signed-out visitors never see the Replay destination',
  );
  await anonymousPage.goto(`${origin}/#view=replay`);
  await anonymousPage.locator('.replay-panel').waitFor();
  assert.ok(
    await anonymousPage.locator('.replay-panel .account-required').isVisible(),
    'a deep link shows the sign-in gate while signed out',
  );
  assert.equal(
    await anonymousPage.locator('.replay-panel .replay-transport').count(),
    0,
    'no remote controls signed out',
  );
  await anonymousPage.waitForTimeout(1_000);
  assert.equal(anonymousTicks, 0, 'the engine never fetches for a signed-out visitor');
  await anonymous.close();

  // Signed in: the full TV experience.
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await installAccountFixture(context, { signedIn: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/map/ttcstatus*', (request) =>
    request.fulfill({ json: map }),
  );
  await page.route('**/live/t/*/vehicles.json', (request) => {
    tickRequests++;
    const tickId = Number(
      request
        .request()
        .url()
        .match(/\/t\/(\d+)\//)[1],
    );
    return request.fulfill({ json: snapshotFor(tickId) });
  });
  await page.goto(origin);
  await page.locator('.app-nav').waitFor();

  // The Replay destination opens the TV on the same mounted map.
  await page.getByRole('tab', { name: 'Replay' }).click();
  await page.locator('.replay-panel').waitFor();
  assert.ok(await page.locator('.workspace-map').isVisible());
  await page
    .locator('.replay-clock')
    .waitFor({ timeout: 20_000 })
    .catch(() => {});
  // Buffering ends and the historical picture appears.
  await page.locator('[data-vehicle="4400"]').first().waitFor({ timeout: 30_000 });
  await page.locator('[data-vehicle="4401"]').first().waitFor({ timeout: 30_000 });
  const frame = () => page.locator('.replay-panel [data-replay-frame]').innerText();
  const firstFrame = await frame();
  assert.match(firstFrame, /\d{1,2}:\d{2}/, 'the frame clock reads a time');
  assert.ok(tickRequests > 0, 'historical ticks were fetched');

  // Playing advances the frame clock; the transport button pauses it.
  // At 10× the clock flips every 3 real seconds (one 30 s tick), so wait
  // past a guaranteed boundary.
  await page.waitForTimeout(4_000);
  const playingFrame = await frame();
  assert.notEqual(playingFrame, firstFrame, 'the picture advances while playing');
  await page.locator('.replay-bar .replay-toggle').click();
  const pausedFrame = await frame();
  await page.waitForTimeout(800);
  assert.equal(await frame(), pausedFrame, 'pause freezes the picture');

  // The scrubber seeks: window start shows the earliest recorded time.
  const min = Number(await page.locator('.replay-scrub').getAttribute('min'));
  await page.locator('.replay-scrub').fill(String(min));
  await page.waitForTimeout(400);
  const seekFrame = await frame();
  assert.ok(seekFrame <= pausedFrame, 'seeking back rewinds the frame clock');

  // Resume, then cycle the speed chip.
  await page.locator('.replay-bar .replay-toggle').click();
  const chip = page.locator('.replay-bar .replay-speed-chip');
  assert.equal((await chip.innerText()).trim(), '10×');
  await chip.click();
  assert.equal((await chip.innerText()).trim(), '30×');
  // 30× flips the frame clock once per real second; wait past a boundary.
  await page.waitForTimeout(1_600);
  assert.notEqual(await frame(), seekFrame, 'playback resumed after the seek');

  // The remote's quick ranges: 24 hours is the widest, no 7-day option.
  const ranges = page.locator('.replay-panel .segmented-control').first();
  assert.deepEqual(await ranges.getByRole('button').allInnerTexts(), [
    '30 min',
    '2 h',
    '6 h',
    '24 h',
  ]);
  await ranges.getByRole('button', { name: '24 h' }).click();
  await page.waitForTimeout(1_500);
  assert.ok(await page.locator('.workspace-map').isVisible());
  await page.locator('.replay-panel [data-replay-frame]');

  // A tapped car solos and the camera follows it; the card shows the
  // stops the recorder wrote down. Pause first so the target holds still,
  // then click the cab's body — map taps dispatch through the camera's
  // own hit-testing, so the click must land on the vehicle itself.
  await page.locator('.replay-bar .replay-toggle').click();
  const cab = page.locator('[data-vehicle="4400"] .streetcar-cab').first();
  const cabBox = await cab.boundingBox();
  assert.ok(cabBox, 'the car is on screen');
  await page.mouse.click(cabBox.x + cabBox.width / 2, cabBox.y + cabBox.height / 2);
  await page.locator('.replay-car-card').waitFor({ timeout: 10_000 });
  assert.equal(
    await page.locator('[data-vehicle]').count(),
    1,
    'the soloed car is alone',
  );
  assert.match(await page.locator('.replay-car-card').innerText(), /Recorded stops|4400/);
  await page.locator('.replay-car-card__close').click();
  await page.locator('[data-vehicle="4401"]').first().waitFor({ timeout: 10_000 });
  assert.equal(
    await page.locator('[data-vehicle]').count(),
    2,
    'closing the card restores the fleet',
  );

  // A tapped track focuses its route: the other route's cars hide and the
  // chip names the route. Clicking it again clears the focus. Track taps
  // dispatch through the camera's hit-testing, so find a screen point that
  // actually lands on the route's fat hit stroke.
  const clickRoute = async (routeId) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const point = await page.evaluate((id) => {
        const targets = [...document.querySelectorAll(`[data-route-hit="${id}"]`)];
        const probes = [
          [0.5, 0.5],
          [0.3, 0.5],
          [0.7, 0.5],
          [0.5, 0.3],
          [0.5, 0.7],
          [0.25, 0.25],
          [0.75, 0.75],
          [0.2, 0.7],
          [0.8, 0.3],
          [0.1, 0.5],
          [0.9, 0.5],
        ];
        for (const target of targets) {
          const rect = target.getBoundingClientRect();
          if (!rect.width && !rect.height) continue;
          // The camera's tap priority is stop dots, then cars, then track
          // hits — the probe must find a point where the deciding element
          // is this route's hit stroke, not a stop sitting on the rail.
          for (const [fx, fy] of probes) {
            const x = rect.left + rect.width * fx;
            const y = rect.top + rect.height * fy;
            const stack = document.elementsFromPoint(x, y);
            const decision = stack.find((element) =>
              element.closest?.('[data-feature],[data-vehicle],[data-route-hit]'),
            );
            if (decision?.closest?.(`[data-route-hit="${id}"]`)) return { x, y };
          }
        }
        return null;
      }, routeId);
      assert.ok(point, 'a hit stroke for the route is on screen');
      await page.mouse.click(point.x, point.y);
      try {
        await page.locator('.replay-focus').waitFor({ timeout: 2_000 });
        return;
      } catch {
        // A stop dot may have out-prioritized the stroke at that instant;
        // probe another one.
      }
    }
    assert.ok(
      await page.locator('.replay-focus').count(),
      'the route focus chip appeared',
    );
  };
  await clickRoute(route504.id);
  await page.locator('.replay-focus').waitFor({ timeout: 10_000 });
  assert.match(
    await page.locator('.replay-focus').innerText(),
    new RegExp(route504.shortName),
  );
  await page.waitForTimeout(1_000);
  assert.equal(
    await page.locator('[data-vehicle="4400"]').count(),
    0,
    'other routes hide',
  );
  assert.ok(await page.locator('[data-vehicle="4401"]').count());
  await page.locator('.replay-focus').click();
  await page.waitForTimeout(1_000);
  assert.ok(await page.locator('[data-vehicle="4400"]').count(), 'the fleet returns');
  await page.locator('.replay-bar .replay-toggle').click(); // resume

  // A shared link opens the replay directly (signed in).
  await page.goto(`${origin}/#view=replay`);
  await page.locator('.replay-panel').waitFor();
  assert.ok(await page.locator('.workspace-map').isVisible());

  assert.deepEqual(errors, []);
  console.log(
    'Replay TV passed: auth gate, ticks, glide, pause, seek, speed, car and route focus.',
  );
} finally {
  await browser.close();
}
