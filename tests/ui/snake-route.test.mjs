import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { LATEST_SNAKE_VERSION, isClassicSnakePath, snakeVersionForPath } =
  await compileModules("export * from './web/ui/snake-route.ts';");

test('Snake app paths resolve to v2 while classic paths stay outside the app', () => {
  assert.equal(LATEST_SNAKE_VERSION, 2);
  assert.equal(snakeVersionForPath('/snake'), 2);
  assert.equal(snakeVersionForPath('/snake/'), 2);
  assert.equal(snakeVersionForPath('/snake/v2'), 2);
  assert.equal(snakeVersionForPath('/snake/v2/'), 2);
  assert.equal(snakeVersionForPath('/snake/v2/anything'), 2);
  assert.equal(snakeVersionForPath('/snake/v1'), undefined);
  assert.equal(snakeVersionForPath('/snake/v1/'), undefined);
  assert.equal(snakeVersionForPath('/snake/v1/game.js'), undefined);
  assert.equal(snakeVersionForPath('/snake/v3'), 2);
  assert.equal(snakeVersionForPath('/'), undefined);
  assert.equal(isClassicSnakePath('/snake/v1'), true);
  assert.equal(isClassicSnakePath('/snake/v1/'), true);
  assert.equal(isClassicSnakePath('/snake/v2'), false);
});
