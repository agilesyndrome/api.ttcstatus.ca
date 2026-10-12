import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { appServiceWorker } from '../../scripts/build/service-worker.mjs';

test('offline app shell caches only the build assets and never intercepts account or transit APIs', () => {
  const handlers = new Map();
  const self = {
    location: { origin: 'https://ttcstatus.ca' },
    addEventListener: (name, handler) => handlers.set(name, handler),
  };
  const code = appServiceWorker([
    'assets/main-one.js',
    'assets/styles.css',
    'snake/v1/game.js',
    '_headers',
  ]);
  assert.ok(code.includes('/assets/main-one.js'));
  assert.ok(!code.includes('snake/v1/game.js'));
  assert.notEqual(code, appServiceWorker(['assets/main-two.js', 'assets/styles.css']));
  vm.runInNewContext(code, { self, URL });
  const fetch = handlers.get('fetch');
  for (const path of [
    '/api/v1/me/stops',
    '/api/v1/map/ttcstatus',
    '/api/v1/auth/config',
    '/snake/v1',
  ]) {
    let intercepted = false;
    fetch({
      request: { method: 'GET', mode: 'navigate', url: `https://ttcstatus.ca${path}` },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, path);
  }
});
