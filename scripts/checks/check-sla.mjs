import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// The /sla page's browser check (docs/sla-stories.md Epic 8, E8S5): run
// against `npm run dev:viewer`. The report is intercepted with the preview
// fixture — deterministic, zero workers, zero D1, zero live feed. Covers the
// USA-status anatomy: banner, tick strips in every band, the weekly grain's
// wider boxes, the expandable stop detail, the filter, and the load-time
// discipline (zero /sla requests when the page is not opened).
const origin = process.env.UI_URL ?? 'http://127.0.0.1:4173';

// The fixture the preview middleware serves (its builder is the same one the
// unit suites exercise through the real banding math).
const report = await (await fetch(`${origin}/api/v1/sla/report`)).json();
const stops506 = await (await fetch(`${origin}/api/v1/sla/report?route=506`)).json();
assert.equal(report.schemaVersion, 1);
assert.ok(report.routes.length >= 3, 'the fixture report needs at least three routes');
assert.ok((stops506.stops ?? []).length >= 3, 'the fixture detail needs stops');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
try {
  // ——— 1. Not on the page: zero /sla requests, ever. ———
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    let slaRequests = 0;
    await context.route('**/api/v1/sla/**', (route) => {
      slaRequests += 1;
      return route.fulfill({ json: report });
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    assert.equal(slaRequests, 0, 'the map page must not touch the SLA report');
    await context.close();
  }

  // ——— 2. The page: banner, strips, grain, expand, filter. ———
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    let routeRequests = 0;
    await context.route('**/api/v1/sla/report*', (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('route')) routeRequests += 1;
      return route.fulfill({
        json: url.searchParams.get('route') ? stops506 : report,
      });
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    await page.goto(`${origin}/sla`, { waitUntil: 'networkidle' });

    // Title and banner.
    assert.match(await page.title(), /SLA/);
    const headline = await page.locator('.sla-banner__headline').innerText();
    assert.match(headline, /met the SLA/);
    await page.locator('.sla-banner__metric').waitFor();

    // The beta warning is on the page, ahead of the report.
    const betaWarning = await page.locator('.sla-beta-warning').innerText();
    assert.match(betaWarning, /Beta/i);
    assert.match(betaWarning, /may not be accurate/i);

    // Route rows: every fixture route, in numeric order.
    const numbers = await page.locator('.sla-route__number').allInnerTexts();
    assert.deepEqual(
      numbers,
      report.routes.map((route) => route.number),
    );

    // The published schedule line states the TTC's own promise, per calendar
    // class — weekends and holidays visible in the rendering itself. Classes
    // that publish identical bands share one label group ("Saturday / Sunday").
    const published = await page
      .locator('.sla-route[data-route="506"] .sla-route__published')
      .innerText();
    assert.match(published, /Weekday( \/ [A-Za-z]+)*: every \d+ min/);
    assert.match(published, /Saturday( \/ [A-Za-z]+)*: every \d+ min/);
    assert.match(published, /Holiday: every \d+ min/);

    // Daily strips: exactly the recorded segments, one box each, with an
    // accessible label for every box.
    for (const route of report.routes) {
      const count = await page
        .locator(`.sla-route[data-route="${route.routeId}"] .sla-tick`)
        .count();
      assert.equal(count, route.days.length, `${route.routeId} day strip length`);
    }
    const labels = await page
      .locator('.sla-route[data-route="506"] .sla-tick')
      .evaluateAll((ticks) => ticks.map((tick) => tick.getAttribute('aria-label')));
    assert.ok(labels.length > 0);
    assert.ok(labels.every((label) => label && label.length > 4));

    // Every band is distinguishable on the 501's mixed record: green, yellow,
    // red, and honestly-hollow no-data boxes all present.
    const mixed = '.sla-route[data-route="501"]';
    assert.ok((await page.locator(`${mixed} .sla-tick--met`).count()) >= 1);
    assert.ok((await page.locator(`${mixed} .sla-tick--degraded`).count()) >= 1);
    assert.ok((await page.locator(`${mixed} .sla-tick--missed`).count()) >= 1);
    assert.ok((await page.locator(`${mixed} .sla-tick--no-data`).count()) >= 1);
    // Today's partial box is marked.
    assert.ok((await page.locator(`${mixed} .sla-tick--partial`).count()) >= 1);

    // The weekly grain: wider boxes, fewer of them.
    await page.getByRole('button', { name: 'Weekly' }).click();
    await page.locator('.sla-strip__row--week').first().waitFor();
    const weekTicks = await page
      .locator(`.sla-route[data-route="506"] .sla-tick`)
      .count();
    const week506 = report.routes.find((route) => route.routeId === '506');
    assert.equal(weekTicks, week506.weeks.length);
    const dayWidth = await page
      .locator('.sla-route[data-route="501"] .sla-strip__row:not(.sla-strip__row--week)')
      .count();
    assert.equal(dayWidth, 0, 'daily strips must be gone after the toggle');

    // Back to daily for the expand case.
    await page.getByRole('button', { name: 'Daily' }).click();
    await page
      .locator('.sla-route[data-route="506"] .sla-strip__row:not(.sla-strip__row--week)')
      .first()
      .waitFor();

    // Expand the 506: its directional stops with their own strips.
    await page.locator('.sla-route[data-route="506"] .sla-route__toggle').click();
    await page.locator('.sla-route[data-route="506"] .sla-stop').first().waitFor();
    const stopRows = await page.locator('.sla-route[data-route="506"] .sla-stop').count();
    assert.equal(stopRows, stops506.stops.length);
    assert.ok(routeRequests >= 1, 'the expand fetches the route detail once');
    const stopName = await page
      .locator('.sla-route[data-route="506"] .sla-stop__name')
      .first()
      .innerText();
    assert.equal(stopName, stops506.stops[0].name);

    // The filter narrows routes live; nothing matches is honest.
    await page.locator('#sla-filter').fill('506');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.sla-route').count(), 1);
    assert.equal(
      await page.locator('.sla-route[data-route="506"]').count(),
      1,
      'the 506 survives its own filter',
    );
    // Stop-name filtering rides the expanded detail: a needle matching the
    // route's loaded stops keeps the row and narrows the stop list.
    await page.locator('#sla-filter').fill('stop 3');
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator('.sla-route[data-route="506"]').count(),
      1,
      'a stop-name needle keeps the expanded route visible',
    );
    const narrowedStops = await page
      .locator('.sla-route[data-route="506"] .sla-stop')
      .count();
    assert.equal(
      narrowedStops,
      stops506.stops.filter((stop) =>
        `${stop.name} ${stop.headsign}`.toLowerCase().includes('stop 3'),
      ).length,
      'the stop rows narrow to the needle',
    );
    await page.locator('#sla-filter').fill('zzz-no-such-route');
    await page.waitForTimeout(200);
    await page.locator('.sla-empty').waitFor();
    assert.equal(await page.locator('.sla-route').count(), 0);
    await page.locator('#sla-filter').fill('');

    // Methodology is on the page (the honesty footnote).
    const methodology = await page.locator('.sla-methodology summary').innerText();
    assert.match(methodology, /read this/);

    assert.deepEqual(consoleErrors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log('check-sla: PASS');
