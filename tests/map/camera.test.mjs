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
  writeDefaultViewTools,
  clearDefaultView,
  hydrateDefaultView,
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

// --- The device's saved default view (device storage, never the profile) ---

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

// A localStorage stub shaped like the real store: getItem returns null for
// missing keys, setItem stores strings, removeItem deletes. The previous
// property descriptor is restored afterwards so sibling tests are untouched.
function installStorage(store) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  };
}

test('the default view rides device storage and survives round trips', () => {
  const store = new Map();
  const restore = installStorage(store);
  try {
    // Nothing saved yet.
    assert.equal(readDefaultView(), undefined);
    assert.equal(hasDefaultView(), false);

    writeDefaultView(view(700, 500, 600), undefined, network);
    assert.deepEqual(JSON.parse(store.get('ttc:default-view:v1')), {
      cx: 700,
      cy: 500,
      width: 600,
    });
    const read = readDefaultView();
    assert.deepEqual(read?.view, { cx: 700, cy: 500, width: 600 });
    assert.equal(read?.tools, undefined);
    assert.equal(hasDefaultView(), true);

    // A corrupt stored value degrades to "no default", never a broken camera.
    store.set('ttc:default-view:v1', JSON.stringify({ cx: 'junk' }));
    assert.equal(readDefaultView(), undefined);
    assert.equal(hasDefaultView(), false);

    // Clearing removes the stored view.
    clearDefaultView();
    assert.equal(store.has('ttc:default-view:v1'), false);
    assert.equal(hasDefaultView(), false);
  } finally {
    restore();
  }
});

test('a saved default carries the map tools, and tools update in place', () => {
  const store = new Map();
  const restore = installStorage(store);
  try {
    // Tools without a saved view cannot exist: nothing to attach them to.
    writeDefaultViewTools({
      streetcar: true,
      subway: true,
      live: true,
      serviceOverlay: false,
    });
    assert.equal(store.size, 0);

    writeDefaultView(
      view(700, 500, 600),
      { streetcar: false, subway: true, live: false, serviceOverlay: true },
      network,
    );
    let read = readDefaultView();
    assert.deepEqual(read?.view, { cx: 700, cy: 500, width: 600 });
    assert.deepEqual(read?.tools, {
      streetcar: false,
      subway: true,
      live: false,
      serviceOverlay: true,
    });

    // Rewriting tools keeps the saved camera exactly as it was.
    writeDefaultViewTools({
      streetcar: true,
      subway: false,
      live: true,
      serviceOverlay: false,
    });
    read = readDefaultView();
    assert.deepEqual(read?.view, { cx: 700, cy: 500, width: 600 });
    assert.deepEqual(read?.tools, {
      streetcar: true,
      subway: false,
      live: true,
      serviceOverlay: false,
    });

    // Malformed tools are dropped whole, never half-applied.
    store.set(
      'ttc:default-view:v1',
      JSON.stringify({ cx: 1, cy: 2, width: 3, tools: { streetcar: 'yes' } }),
    );
    read = readDefaultView();
    assert.deepEqual(read?.view, { cx: 1, cy: 2, width: 3 });
    assert.equal(read?.tools, undefined);
  } finally {
    restore();
  }
});

test('blocked storage degrades to a session without a saved view', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Blocked', 'SecurityError');
    },
  });
  try {
    writeDefaultView(view(700, 500, 600), undefined, network);
    assert.equal(readDefaultView(), undefined);
    assert.equal(hasDefaultView(), false);
    // Every write path tolerates the blocked store without throwing.
    writeDefaultViewTools({
      streetcar: true,
      subway: true,
      live: true,
      serviceOverlay: false,
    });
    clearDefaultView();
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('hydration returns the stored view, and nothing when the store is empty', async () => {
  const store = new Map();
  const restore = installStorage(store);
  try {
    // No stored view: hydration answers "none" instead of throwing.
    assert.equal(await hydrateDefaultView(), undefined);

    store.set('ttc:default-view:v1', JSON.stringify({ cx: 7, cy: 5, width: 60 }));
    const view = await hydrateDefaultView();
    assert.deepEqual(view?.view, { cx: 7, cy: 5, width: 60 });
    assert.equal(view?.tools, undefined);
  } finally {
    restore();
  }
});

test('the legacy cookie migrates into device storage and the cookie is deleted', () => {
  const store = new Map();
  const restore = installStorage(store);
  const jar = [];
  const deletions = [];
  // A browser-shaped cookie jar: the getter returns name=value pairs only,
  // and an expired empty pair deletes the cookie.
  globalThis.document = {
    get cookie() {
      return jar.join('; ');
    },
    set cookie(value) {
      const pair = value.split(';')[0];
      if (pair.endsWith('=')) {
        // An expired empty pair deletes the named cookie.
        deletions.push(pair);
        const name = pair.slice(0, -1);
        const index = jar.findIndex((entry) => entry.startsWith(`${name}=`));
        if (index >= 0) jar.splice(index, 1);
        return;
      }
      const name = pair.slice(0, pair.indexOf('='));
      const index = jar.findIndex((entry) => entry.startsWith(`${name}=`));
      if (index >= 0) jar[index] = pair;
      else jar.push(pair);
    },
  };
  try {
    jar.push(
      `ttc:default-view:v1=${encodeURIComponent(
        JSON.stringify({ cx: 700, cy: 500, width: 600 }),
      )}`,
    );

    // The first read migrates: the same payload lands in device storage and
    // the cookie is expired, so the camera can never ride a request again.
    const read = readDefaultView();
    assert.deepEqual(read?.view, { cx: 700, cy: 500, width: 600 });
    assert.deepEqual(JSON.parse(store.get('ttc:default-view:v1')), {
      cx: 700,
      cy: 500,
      width: 600,
    });
    assert.equal(jar.length, 0, 'the legacy cookie is deleted after migration');
    assert.equal(deletions.length, 1);

    // Later reads come from storage alone: removing the jar changes nothing.
    const again = readDefaultView();
    assert.deepEqual(again?.view, { cx: 700, cy: 500, width: 600 });

    // A corrupt legacy cookie is still cleaned up, reading as no default.
    store.clear();
    jar.push('ttc:default-view:v1=%7B%22cx%22%3A%22junk%22%7D');
    assert.equal(readDefaultView(), undefined);
    assert.equal(jar.length, 0, 'even a junk cookie is deleted after migration');
  } finally {
    delete globalThis.document;
    restore();
  }
});
