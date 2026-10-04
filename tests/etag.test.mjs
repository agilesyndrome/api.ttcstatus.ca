import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['workers/shared/etag.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { ifNoneMatchMatches } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

test('If-None-Match compares strong and weak validators in either direction', () => {
  for (const current of ['"fleet"', 'W/"fleet"']) {
    for (const header of ['"fleet"', 'W/"fleet"', ' "older", W/"fleet" ', '*', ', , W/"fleet",']) {
      assert.equal(ifNoneMatchMatches(header, current), true, `${header} against ${current}`);
    }
    for (const header of [undefined, null, '', ', ,', 'W/"different"', '"FLEET"', 'fleet', 'w/"fleet"', '"fleet" junk', '* , "fleet"', '"fleet", malformed']) {
      assert.equal(ifNoneMatchMatches(header, current), false, `${header} against ${current}`);
    }
  }
  assert.equal(ifNoneMatchMatches('*', null), false);
  assert.equal(ifNoneMatchMatches('"fleet"', 'invalid'), false);
});

test('quoted commas remain part of the opaque validator', () => {
  assert.equal(ifNoneMatchMatches('"older", W/"fleet,v2"', '"fleet,v2"'), true);
  assert.equal(ifNoneMatchMatches('"fleet,v2"', '"fleet"'), false);
  assert.equal(ifNoneMatchMatches('"older,fleet"', '"fleet"'), false);
});
