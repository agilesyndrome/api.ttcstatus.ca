import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run against npm run storybook. Storybook executes each story's play function.
const origin = process.env.STORYBOOK_URL ?? 'http://127.0.0.1:6006';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const index = await (await fetch(`${origin}/index.json`)).json();
  const stories = Object.values(index.entries).filter(entry => entry.type === 'story');
  for (const story of stories) {
    await page.goto(`${origin}/iframe.html?id=${story.id}&viewMode=story`);
    await page.waitForFunction(() => ['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase));
    const result = await page.evaluate(() => {
      const render = window.__STORYBOOK_PREVIEW__.currentRender;
      return { phase: render.phase, body: document.body.innerText };
    });
    assert.equal(result.phase, 'finished', story.id);
    assert.ok(!(await page.locator('.sb-errordisplay').isVisible()), `${story.id}: ${result.body}`);
  }
  assert.deepEqual(errors, []);
  console.log(`Storybook passed: ${stories.length} component stories, including search/filter/legend play functions; no browser errors.`);
} finally { await browser.close(); }
