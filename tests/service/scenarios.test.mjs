import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const {
  SCENARIOS,
  WORKED_EXAMPLE,
  scenarioById,
  headwaysForStop,
  stopServiceState,
  serviceStatesAt,
  renewalWaitSeconds,
  cvSquared,
  moments,
  residualWaitSeconds,
  serviceConfig,
} = await compileModules(
  `export * from './shared/service/wait-metrics';
   export * from './shared/service/fixtures';
   export * from './shared/service/config';`,
);

const config = serviceConfig();
const approx = (actual, expected, epsilon = 1e-9) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to equal ${expected} within ${epsilon}`,
  );
const stateFor = (scenario, stopId) =>
  stopServiceState(
    stopId,
    scenario.touches.filter((touch) => touch.stopId === stopId),
    scenario.coverage,
    { windowStart: scenario.windowStart, at: scenario.at, config },
  );

test('E2S8: the §3.2 worked example is green, verbatim', () => {
  assert.equal(
    renewalWaitSeconds([...WORKED_EXAMPLE.even.headwaySeconds]),
    WORKED_EXAMPLE.even.expectedWaitSeconds,
  );
  assert.equal(
    renewalWaitSeconds([...WORKED_EXAMPLE.bunched.headwaySeconds]),
    WORKED_EXAMPLE.bunched.expectedWaitSeconds,
  );
  assert.equal(
    cvSquared(moments([...WORKED_EXAMPLE.even.headwaySeconds])),
    WORKED_EXAMPLE.even.cv2,
  );
  assert.equal(
    cvSquared(moments([...WORKED_EXAMPLE.bunched.headwaySeconds])),
    WORKED_EXAMPLE.bunched.cv2,
  );
});

for (const scenario of SCENARIOS) {
  test(`E2S8 corpus · ${scenario.id}: ${scenario.description}`, () => {
    // Deterministic: the same scenario yields byte-identical states twice.
    const options = { windowStart: scenario.windowStart, at: scenario.at, config };
    const first = serviceStatesAt(scenario.touches, scenario.coverage, options);
    const second = serviceStatesAt(scenario.touches, scenario.coverage, options);
    assert.deepEqual([...second.entries()], [...first.entries()]);

    for (const [stopId, expected] of Object.entries(scenario.expectations)) {
      const touches = scenario.touches.filter((touch) => touch.stopId === stopId);
      const sample = headwaysForStop(
        touches,
        scenario.coverage,
        scenario.windowStart,
        scenario.at,
      );
      assert.deepEqual(
        sample.headways,
        expected.headways,
        `${scenario.id}/${stopId} headways`,
      );
      assert.equal(
        sample.censoredCount,
        expected.censoredHeadwayCount,
        `${scenario.id}/${stopId} censored`,
      );
      assert.equal(
        sample.touchCount,
        expected.touchCount,
        `${scenario.id}/${stopId} touches`,
      );
      assert.equal(
        sample.coverage.observableSeconds,
        expected.coverageObservableSeconds,
        `${scenario.id}/${stopId} observable seconds`,
      );
      assert.equal(
        sample.coverage.unmonitoredSeconds,
        expected.unmonitoredSeconds,
        `${scenario.id}/${stopId} unmonitored seconds`,
      );
      for (const residualSample of expected.residualWaitSamples ?? []) {
        approx(
          residualWaitSeconds(
            sample.headways,
            residualSample.e,
            config.residualMinSamples,
          ),
          residualSample.expect,
        );
      }

      const state = stateFor(scenario, stopId);
      approx(state.minutesSince, expected.minutesSince);
      assert.equal(state.state, expected.state, `${scenario.id}/${stopId} state`);
      if (expected.medianHeadwayOwnSeconds === null) {
        assert.equal(
          state.medianHeadwayOwnSeconds,
          null,
          `${scenario.id}/${stopId} median`,
        );
      } else {
        approx(state.medianHeadwayOwnSeconds, expected.medianHeadwayOwnSeconds);
      }
      if (expected.irregularity === null) {
        assert.equal(state.irregularity, null, `${scenario.id}/${stopId} irregularity`);
      } else {
        approx(state.irregularity, expected.irregularity, 1e-12);
      }
      if (expected.dryness === null) {
        assert.equal(state.dryness, null, `${scenario.id}/${stopId} dryness`);
      } else {
        approx(state.dryness, expected.dryness, 1e-12);
      }
      assert.equal(
        state.backToBack,
        expected.backToBack,
        `${scenario.id}/${stopId} back-to-back`,
      );
      if (expected.expectedWaitApprox) {
        assert.ok(
          state.expectedWaitSeconds !== null && state.expectedWaitSeconds > 0,
          `${scenario.id}/${stopId} expected an approximate positive estimate`,
        );
      } else if (expected.expectedWaitSeconds === null) {
        assert.equal(
          state.expectedWaitSeconds,
          null,
          `${scenario.id}/${stopId} expectedWait`,
        );
      } else {
        approx(state.expectedWaitSeconds, expected.expectedWaitSeconds);
      }
      // The assembly and the per-stop path must agree.
      assert.deepEqual(state, first.get(stopId));
    }
  });
}

test('E2S8: coverage badges tell the unmonitored truth', () => {
  const silent = stateFor(scenarioById('outage-live'), 'st_silent');
  assert.equal(silent.coverage.kind, 'no-reports');
  assert.equal(silent.coverage.unmonitoredSeconds, 1500);
  assert.ok(silent.coverage.since !== null);
  const recovered = stateFor(scenarioById('outage'), 'st_outage');
  assert.equal(recovered.coverage.kind, 'observable');
  assert.equal(recovered.coverage.unmonitoredSeconds, 300);
});

test('E2S8: the one-way void is visible as exactly that — direction survives end-to-end', () => {
  const scenario = scenarioById('one-way-void');
  const states = serviceStatesAt(scenario.touches, scenario.coverage, {
    windowStart: scenario.windowStart,
    at: scenario.at,
    config,
  });
  assert.equal(states.get('st_void_1').directionId, 0);
  assert.equal(states.get('st_void_1').state, 'void');
  assert.equal(states.get('st_void_1_w').directionId, 1);
  assert.equal(states.get('st_void_1_w').state, 'fresh');
  // A void can live in one direction while the other runs beautifully.
  assert.equal(states.get('st_void_2').state, 'void');
});

test('E2S8: the bunching tax is visible in the window, not just in the table', () => {
  const scenario = scenarioById('waiting-paradox');
  const states = serviceStatesAt(scenario.touches, scenario.coverage, {
    windowStart: scenario.windowStart,
    at: scenario.at,
    config,
  });
  const even = states.get('st_even');
  const bunched = states.get('st_bunched');
  assert.equal(even.irregularity, 0);
  approx(bunched.irregularity, 288 / 169, 1e-12);
  assert.equal(bunched.backToBack, 2);
  assert.equal(bunched.state, 'void');
  assert.equal(even.state, 'fresh');
});
