import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { rectanglesOverlap, greedyLabelIndexes } = await compileModules(
  `export * from './web/ui/features/map/label-layout';`,
);

test('label rectangles use strict deterministic overlap rules', () => {
  const first = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(rectanglesOverlap(first, { x: 9, y: 0, width: 10, height: 10 }), true);
  assert.equal(rectanglesOverlap(first, { x: 10, y: 0, width: 10, height: 10 }), false);
});

test('greedy label placement preserves priority order', () => {
  const boxes = [
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 5, y: 0, width: 10, height: 10 },
    { x: 20, y: 0, width: 10, height: 10 },
  ];
  assert.deepEqual(
    greedyLabelIndexes(boxes, (box) => box),
    [0, 2],
  );
});
