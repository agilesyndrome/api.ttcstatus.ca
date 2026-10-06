import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { LATEST_SNAKE_VERSION, snakeVersionForPath } = await compileModules(
  "export * from './web/ui/snake-route.ts';",
);

test('Snake has stable v2 and non-redirecting latest aliases', () => {
  assert.equal(LATEST_SNAKE_VERSION, 2);
  assert.equal(snakeVersionForPath('/snake'), 2);
  assert.equal(snakeVersionForPath('/snake/'), 2);
  assert.equal(snakeVersionForPath('/snake/v2'), 2);
  assert.equal(snakeVersionForPath('/snake/v2/'), 2);
  assert.equal(snakeVersionForPath('/snake/v1'), undefined);
  assert.equal(snakeVersionForPath('/snake/v3'), undefined);
  assert.equal(snakeVersionForPath('/'), undefined);
});
