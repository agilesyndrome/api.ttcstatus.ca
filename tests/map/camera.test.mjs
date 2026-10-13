import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const {
  fitCamera,
  landingCamera,
  baseStopName,
  saveableView,
  defaultViewCamera,
  readDefaultView,
  hasDefaultView,
  writeDefaultView,
  clearDefaultView,
} = await compileModules(`
  export * from './shared/map/camera';
  export * from './shared/map/model';
  export * from './web/ui/features/map/default-view';
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

// --- The device's saved default view (browser cookie, never the profile) ---

const network = { x: 0, y: 0, width: 1510, height: 870 };
const phoneAspect = 390 / 844;
const view = (cx, cy, width) => ({
  x: cx - width / 2,
  y: cy - width / phoneAspect / 2,
  width,
  height: width / phoneAspect,
});

test('a saveable view reduces to its centre and zoom, and refuses nonsense', () => {
  assert.deepEqual(saveableView(view(700, 500, 600), network), {
    cx: 700,
    cy: 500,
    width: 600,
  });
  // Off the network entirely: not a view of this map.
  assert.equal(saveableView(view(5000, 5000, 600), network), undefined);
  // NaN or non-positive sizes from a corrupt document: refused.
  assert.equal(
    saveableView({ x: NaN, y: 0, width: 600, height: 700 }, network),
    undefined,
  );
  assert.equal(saveableView({ x: 700, y: 0, width: 0, height: 700 }, network), undefined);
});

test('a saved view reconstitutes at the current aspect, keeping centre and zoom', () => {
  const camera = defaultViewCamera(
    { cx: 700, cy: 500, width: 600 },
    network,
    phoneAspect,
  );
  assert.ok(camera);
  assert.equal(camera.width, 600);
  assert.ok(Math.abs(camera.x + camera.width / 2 - 700) < 1e-9, 'centre holds');
  assert.ok(Math.abs(camera.width / camera.height - phoneAspect) < 1e-9, 'aspect holds');
  // Zoomed out past the whole-network fit: clamped back to the fit.
  const far = defaultViewCamera(
    { cx: 700, cy: 500, width: 99_999 },
    network,
    phoneAspect,
  );
  assert.equal(far?.width, fitCamera(network, phoneAspect).width);
  // Slightly drifting bounds clamp instead of rejecting.
  const drift = defaultViewCamera(
    { cx: 1600, cy: -50, width: 600 },
    network,
    phoneAspect,
  );
  assert.ok(drift && drift.x + drift.width / 2 <= 1600);
  // Garbage never yields a camera.
  assert.equal(
    defaultViewCamera({ cx: NaN, cy: 0, width: 600 }, network, phoneAspect),
    undefined,
  );
});

test('the default view rides a browser cookie and survives round trips', () => {
  const jar = [];
  globalThis.document = {
    get cookie() {
      return jar.join('; ');
    },
    set cookie(value) {
      jar.push(value);
    },
  };
  try {
    // No cookie yet.
    assert.equal(readDefaultView(), undefined);
    assert.equal(hasDefaultView(), false);

    writeDefaultView(view(700, 500, 600), network);
    const stored = decodeURIComponent(
      jar[0].match(/ttc:default-view:v1=([^;]*)/)?.[1] ?? '',
    );
    assert.deepEqual(JSON.parse(stored), { cx: 700, cy: 500, width: 600 });
    assert.match(jar[0], /max-age=31536000/);
    assert.match(jar[0], /SameSite=Lax/);
    assert.deepEqual(readDefaultView(), { cx: 700, cy: 500, width: 600 });
    assert.equal(hasDefaultView(), true);

    // A corrupt cookie degrades to "no default", never a broken camera.
    jar.length = 0;
    globalThis.document = {
      get cookie() {
        return 'ttc:default-view:v1=%7B%22cx%22%3A%22junk%22%7D';
      },
      set cookie(value) {
        jar.push(value);
      },
    };
    assert.equal(readDefaultView(), undefined);
    assert.equal(hasDefaultView(), false);

    // Clearing expires the cookie.
    jar.length = 0;
    clearDefaultView();
    assert.match(jar[0], /max-age=0/);
  } finally {
    delete globalThis.document;
  }
});
