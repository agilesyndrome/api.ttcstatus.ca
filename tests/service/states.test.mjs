import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { drynessAndState } = await compileModules(
  `export * from './shared/service/wait-metrics'; export * from './shared/service/config';`,
);
const config = await compileModules(`export * from './shared/service/config';`);
const defaults = config.serviceConfig();

const inputs = (overrides = {}) => ({
  minutesSince: 10,
  medianHeadwayOwnSeconds: 600,
  currentlyObservable: true,
  touchCount: 3,
  baselineTouches: defaults.baselineMinTouches,
  ...overrides,
});

test('E2S4: night service calms itself — 14 minutes against a 15-minute baseline is due', () => {
  const { dryness, state } = drynessAndState(
    inputs({ minutesSince: 14, medianHeadwayOwnSeconds: 900 }),
    defaults,
  );
  assert.equal(state, 'due');
  assert.ok(Math.abs(dryness - (14 * 60) / 900) < 1e-9);
});

test('E2S4: the absolute backstop catches what self-normalization would hide', () => {
  // r = 1.6 < 2 — but 16 minutes is egregious regardless of this stop's habits.
  const { state } = drynessAndState(
    inputs({ minutesSince: 16, medianHeadwayOwnSeconds: 600 }),
    defaults,
  );
  assert.equal(state, 'void');
});

test('E2S4: the ratio axis flags a stop whose own median says it is way overdue', () => {
  // r = 21 against a 30-second median: the void a bunched pair leaves behind.
  const { dryness, state } = drynessAndState(
    inputs({ minutesSince: 10.5, medianHeadwayOwnSeconds: 30 }),
    defaults,
  );
  assert.equal(state, 'void');
  assert.equal(dryness, 21);
});

test('E2S4: fresh/due/void boundaries come from config and are exact', () => {
  const at = (minutes, medianSeconds) =>
    drynessAndState(
      inputs({ minutesSince: minutes, medianHeadwayOwnSeconds: medianSeconds }),
      defaults,
    ).state;
  assert.equal(at(2, 600), 'fresh'); // r = 0.2 < 0.5
  assert.equal(at(5, 600), 'due'); // r = 0.5 — not below the fresh boundary
  assert.equal(at(12, 400), 'due'); // r = 1.8 < 2 AND 12 < 15 — calm on both axes
  assert.equal(at(19.9, 600), 'void'); // r = 1.99 < 2, but 19.9 min ≥ 15 absolute
});

test('E2S4: void on the ratio axis below the absolute backstop', () => {
  const { state } = drynessAndState(
    inputs({ minutesSince: 10.5, medianHeadwayOwnSeconds: 300 }),
    defaults,
  );
  // r = 2.1 ≥ 2 with only 10.5 absolute minutes — unusual for here.
  assert.equal(state, 'void');
});

test('E2S4: unmonitored beats everything — never fabricate a void', () => {
  const { state, dryness } = drynessAndState(
    inputs({
      currentlyObservable: false,
      minutesSince: 100,
      medianHeadwayOwnSeconds: 30,
    }),
    defaults,
  );
  assert.equal(state, 'unmonitored');
  assert.equal(dryness, null);
});

test('E2S4: collecting when there is no honest baseline', () => {
  assert.equal(drynessAndState(inputs({ touchCount: 2 }), defaults).state, 'collecting');
  assert.equal(
    drynessAndState(inputs({ touchCount: 3, medianHeadwayOwnSeconds: null }), defaults)
      .state,
    'collecting',
  );
});

test('E2S4: thresholds are configuration, never folklore', () => {
  const tuned = config.serviceConfig({
    SERVICE_VOID_DRYNESS_RATIO: '3',
    SERVICE_FRESH_DRYNESS_RATIO: '0.9',
  });
  // r = 2.1: void at defaults, due with a calmer threshold set.
  assert.equal(
    drynessAndState(
      inputs({ minutesSince: 10.5, medianHeadwayOwnSeconds: 300 }),
      defaults,
    ).state,
    'void',
  );
  assert.equal(
    drynessAndState(inputs({ minutesSince: 10.5, medianHeadwayOwnSeconds: 300 }), tuned)
      .state,
    'due',
  );
  // r = 0.85: due at defaults (0.5 boundary), fresh with the raised 0.9 boundary.
  assert.equal(
    drynessAndState(inputs({ minutesSince: 8.5, medianHeadwayOwnSeconds: 600 }), tuned)
      .state,
    'fresh',
  );
});
