import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';
const { bookmarkBackup, readBookmarkBackup, mergeBookmarks } = await compileModules(
  `export * from './web/ui/features/stops/bookmarks';`,
);

test('bookmark backups round-trip reserved and Unicode IDs, with no location data', () => {
  const ids = ['stop:Queen & King/#北', 'retired-stop'];
  const backup = bookmarkBackup(ids, new Date('2026-10-04T12:00:00Z'));
  assert.deepEqual(readBookmarkBackup(backup), ids);
  assert.deepEqual(Object.keys(JSON.parse(backup)), [
    'format',
    'version',
    'exportedAt',
    'stopIds',
  ]);
  assert.equal(JSON.parse(backup).exportedAt, '2026-10-04T12:00:00.000Z');
  assert.deepEqual(readBookmarkBackup(bookmarkBackup([])), []);
});

test('restore adds unique bookmarks in order, retains missing-map IDs and never mutates the inputs', () => {
  const current = ['queen', 'retired'];
  const incoming = ['queen', 'king'];
  assert.deepEqual(mergeBookmarks(current, incoming), {
    ids: ['queen', 'retired', 'king'],
    added: 1,
    existing: 1,
  });
  assert.deepEqual(current, ['queen', 'retired']);
  assert.deepEqual(incoming, ['queen', 'king']);
  assert.equal(mergeBookmarks(current, current).added, 0);
});

test('invalid formats, duplicate IDs, excessive sizes and overflow fail without losing current stops', () => {
  for (const value of [
    null,
    [],
    { format: 'other', version: 1, stopIds: [] },
    { format: 'ttc-saved-stops', version: 2, stopIds: [] },
    ...[
      null,
      [1],
      [''],
      ['a', 'a'],
      ['x'.repeat(201)],
      Array.from({ length: 101 }, (_, i) => String(i)),
    ].map((stopIds) => ({ format: 'ttc-saved-stops', version: 1, stopIds })),
  ])
    assert.throws(() => readBookmarkBackup(JSON.stringify(value)));
  assert.throws(() => readBookmarkBackup('{bad'), /valid JSON/);
  assert.throws(() => readBookmarkBackup(' '.repeat(64001)), /64 KB/);
  assert.throws(() => readBookmarkBackup('北'.repeat(22000)), /64 KB/);
  const full = Array.from({ length: 100 }, (_, i) => String(i));
  assert.throws(() => mergeBookmarks(full, ['new']), /exceed 100/);
  assert.equal(full.length, 100);
  assert.equal(mergeBookmarks(full, ['1']).ids.length, 100);
});
