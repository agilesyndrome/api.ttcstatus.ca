import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { fitCamera, landingCamera, baseStopName } = await compileModules(`
  export * from './shared/map/camera';
  export * from './shared/map/model';
`);

// A wide network like the TTC schematic: the fit strands it on portrait screens.
const bounds = { x: 0, y: 0, width: 1510, height: 870 };
const downtown = Array.from({ length: 40 }, (_, i) => [
  700 + (i % 10) * 12,
  640 + Math.floor(i / 10) * 18,
]);
const uptown = [
  [200, 120],
  [1300, 140],
  [300, 300],
  [1200, 320],
];

test('portrait screens land on a zoomed core view instead of a collapsed fit', () => {
  const aspect = 390 / 844;
  const fit = fitCamera(bounds, aspect);
  const landing = landingCamera(bounds, [...downtown, ...uptown], aspect);
  assert.ok(landing.width < fit.width, 'lands closer than the plain fit');
  // The network occupies about 65% of the screen height after re-landing.
  assert.ok(
    Math.abs(bounds.height / landing.height - 0.65) < 0.01,
    `occupied ${bounds.height / landing.height}`,
  );
  // The camera keeps the viewport aspect, like every other camera here.
  assert.ok(Math.abs(landing.width / landing.height - aspect) < 1e-9);
});

test('the landing view centres on where stops cluster, not the bounds middle', () => {
  const aspect = 390 / 844;
  const landing = landingCamera(bounds, [...downtown, ...uptown], aspect);
  const centerY = landing.y + landing.height / 2;
  assert.ok(
    centerY > bounds.height / 2,
    `centred at ${centerY}, past the ${bounds.height / 2} midpoint into the dense south`,
  );
});

test('landscape viewports keep the plain fit as the landing camera', () => {
  const aspect = 1440 / 900;
  assert.deepEqual(
    landingCamera(bounds, [...downtown, ...uptown], aspect),
    fitCamera(bounds, aspect),
  );
});

test('very tall viewports cap the landing zoom instead of tunnelling into the map', () => {
  const aspect = 200 / 1000;
  const fit = fitCamera(bounds, aspect);
  const landing = landingCamera(bounds, [...downtown, ...uptown], aspect);
  assert.ok(Math.abs(fit.width / landing.width - 4) < 1e-9);
});

test('an empty feature list falls back to the plain fit', () => {
  const aspect = 390 / 844;
  assert.deepEqual(landingCamera(bounds, [], aspect), fitCamera(bounds, aspect));
});

test('overview names drop directional platform qualifiers only', () => {
  assert.equal(baseStopName('Keele Station - Westbound Platform'), 'Keele Station');
  assert.equal(
    baseStopName('Humber College Station - Subway Platform'),
    'Humber College Station',
  );
  assert.equal(
    baseStopName(
      'Finch Station - Northbound Platform Towards Vaughan Metropolitan Centre',
    ),
    'Finch Station',
  );
  // Station qualifiers are the wayfinding words on surface stops: keep them.
  assert.equal(
    baseStopName('Dundas St West at University Ave - St Patrick Station'),
    'Dundas St West at University Ave - St Patrick Station',
  );
  assert.equal(
    baseStopName('Union Station Streetcar Platform'),
    'Union Station Streetcar Platform',
  );
  assert.equal(baseStopName('Queen St West at John St'), 'Queen St West at John St');
});
