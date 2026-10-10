import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const config = await compileModules(`export * from './shared/service/config';`);
const contracts = await compileModules(`export * from './shared/service/contracts';`);

test('service config defaults are the Stage 0 frozen decisions (sla.md §9)', () => {
  assert.equal(config.serviceSampleSeconds(), 30);
  assert.equal(config.serviceTickToleranceSeconds(), 10);
  assert.equal(config.serviceTouchRadiusMetres(), 40);
  assert.equal(config.serviceDwellDedupeSeconds(), 120);
  assert.equal(config.serviceBackToBackSeconds(), 45);
  assert.equal(config.serviceFreshDrynessRatio(), 0.5);
  assert.equal(config.serviceVoidDrynessRatio(), 2);
  assert.equal(config.serviceVoidAbsoluteMinutes(), 15);
  assert.equal(config.serviceHistoryHours(), 36);
  assert.equal(config.serviceBaselineMinTouches(), 3);
  assert.equal(config.serviceResidualMinSamples(), 3);
  assert.equal(config.serviceWaitShrinkPrior(), 4);
  assert.equal(config.serviceRecorderMode(), 'always');
  assert.equal(config.serviceRecorderMode('demand-warm'), 'demand-warm');
});

test('overrides are accepted from Wrangler-shaped env values; garbage falls back', () => {
  assert.equal(config.serviceSampleSeconds('45'), 45);
  assert.equal(config.serviceSampleSeconds(45), 45);
  assert.equal(config.serviceSampleSeconds('not-a-number'), 30);
  assert.equal(config.serviceVoidAbsoluteMinutes('19'), 19);
  assert.equal(config.serviceRecorderMode('bogus'), 'always');
  assert.equal(config.serviceRecorderMode(null), 'always');
});

test('out-of-range values fall back to the safe default (the liveUpdateSeconds pattern)', () => {
  assert.equal(config.serviceSampleSeconds('1'), 30);
  assert.equal(config.serviceSampleSeconds('999'), 30);
  assert.equal(config.serviceHistoryHours('1'), 36);
  assert.equal(config.serviceHistoryHours('10000'), 36);
  assert.equal(config.serviceTouchRadiusMetres('0'), 40);
  assert.equal(config.serviceVoidDrynessRatio('99'), 2);
  assert.equal(config.serviceDwellDedupeSeconds('0'), 120);
  assert.equal(config.serviceBackToBackSeconds('0'), 45);
  assert.equal(config.serviceBaselineMinTouches('1'), 3);
  assert.equal(config.serviceWaitShrinkPrior('-3'), 4);
  // Boundary values are in range and accepted, not rejected.
  assert.equal(config.serviceSampleSeconds('5'), 5);
  assert.equal(config.serviceSampleSeconds('60'), 60);
  assert.equal(config.serviceHistoryHours('24'), 24);
});

test('serviceConfig(env) assembles one validated object from env vars', () => {
  const whole = config.serviceConfig({
    SERVICE_SAMPLE_SECONDS: '30',
    SERVICE_TOUCH_RADIUS_METRES: '35',
    SERVICE_VOID_DRYNESS_RATIO: '2.5',
    SERVICE_RECORDER_MODE: 'always',
  });
  assert.equal(whole.sampleSeconds, 30);
  assert.equal(whole.touchRadiusMetres, 35);
  assert.equal(whole.voidDrynessRatio, 2.5);
  assert.equal(whole.recorderMode, 'always');
  // Unset fields fall back to defaults.
  assert.equal(whole.dwellDedupeSeconds, 120);
  // Missing env entirely is fine.
  assert.equal(config.serviceConfig().historyHours, 36);
});

test('window and bucket are design invariants: 5 divides 30, folds land on boundaries', () => {
  assert.equal(config.SERVICE_WINDOW_SECONDS % config.SERVICE_BUCKET_SECONDS, 0);
  assert.equal(config.SERVICE_WINDOW_SECONDS / config.SERVICE_BUCKET_SECONDS, 6);
});

test('contracts expose the five states and the voidOverlay flag name', () => {
  assert.deepEqual(contracts.SERVICE_STATES, [
    'fresh',
    'due',
    'void',
    'unmonitored',
    'collecting',
  ]);
  assert.equal(contracts.VOID_OVERLAY_FLAG, 'voidOverlay');
});
