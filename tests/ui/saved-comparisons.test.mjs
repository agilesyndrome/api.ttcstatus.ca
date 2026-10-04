import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { comparisonKey, saveComparison, validSavedComparisons } = await compileModules(
  `export * from './web/ui/features/comparison/saved-comparisons';`,
);
const entry = (name, fromId = 'from', toId = 'to', overnight = false) => ({
  name,
  fromId,
  toId,
  overnight,
});

test('saved comparisons validate bounded names, unique directed endpoints and overnight state', () => {
  assert.equal(validSavedComparisons([]), true);
  assert.equal(validSavedComparisons([entry('Morning')]), true);
  for (const value of [
    null,
    [entry('')],
    [entry('x'.repeat(61))],
    [entry('Same', 'a', 'a')],
    [entry('One'), entry('Two')],
    [entry('One', 'a', 'b'), entry('Two', 'a', 'b')],
    [entry('Bad', 'a', 'b', 'yes')],
    Array.from({ length: 21 }, (_, i) => entry(String(i), String(i), `${i + 1}`)),
  ]) {
    assert.equal(validSavedComparisons(value), false);
  }
  assert.notEqual(comparisonKey(entry('A')), comparisonKey(entry('A', 'to', 'from')));
});

test('saving keeps order, ignores exact duplicates and caps the collection atomically', () => {
  const first = entry('Morning');
  const current = [first];
  assert.deepEqual(saveComparison(current, first), current);
  assert.deepEqual(saveComparison(current, entry('Evening', 'to', 'from', true)), [
    first,
    entry('Evening', 'to', 'from', true),
  ]);
  const full = Array.from({ length: 20 }, (_, i) =>
    entry(String(i), String(i), String(i + 100)),
  );
  assert.throws(
    () => saveComparison(full, entry('Overflow', 'new-from', 'new-to')),
    /20 saved/,
  );
  assert.equal(full.length, 20);
  assert.throws(() => saveComparison(current, entry('bad', '', 'to')), /different stops/);
});
