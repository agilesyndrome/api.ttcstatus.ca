import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const compiled = await build({ stdin: { contents: `export * from './web/ui/journal'; export * from './web/ui/stops'; export * from './web/ui/commute'; export { demoData } from './web/ui/stories/fixtures'; export { mapToGps } from './workers/shared/map-projection';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm' });
const { JOURNAL_LIMIT, validJournal, journalEntry, journalBadges, journalBackup, readJournalBackup, mergeJournal, filterStops, DEFAULT_STOP_FILTERS, demoData, mapToGps, readMapLink, mapLinkHash, DEFAULT_FILTERS } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const entry = (id, extra = {}) => ({ vehicleId: id, label: id, recordedAt: '2026-10-03T12:00:00.000Z', note: '', ...extra });

test('journal validates bounded unique entries and refuses coordinates, unknown keys and invalid dates', () => {
  assert.ok(validJournal([]));
  assert.ok(validJournal([entry('4400', { note: 'A favourite ride', routeId: '501', overnight: false })]));
  for (const input of [null, {}, [entry('')], [entry('a'), entry('a')], [entry('a', { latitude: 43.6 })], [entry('a', { point: [1, 2] })], [entry('a', { note: 'x'.repeat(1001) })], [entry('a', { recordedAt: 'not a date' })], [entry('a', { recordedAt: '2026-02-30T12:00:00.000Z' })], [entry('a', { overnight: 'true' })], [entry('a', { routeName: {} })]]) assert.equal(validJournal(input), false);
  assert.ok(validJournal(Array.from({ length: JOURNAL_LIMIT }, (_, index) => entry(String(index)))));
  assert.equal(validJournal(Array.from({ length: JOURNAL_LIMIT + 1 }, (_, index) => entry(String(index)))), false);
});

test('manually collecting a car saves identity, assignment and recording time, never position or observation history', () => {
  const car = { vehicle: { id: '4400', label: '4400', latitude: 43.65, longitude: -79.4, routeId: '501', observedAt: '2000-01-01T00:00:00Z', speedMetresPerSecond: 10 }, point: [1, 2], stale: true };
  const saved = journalEntry(car, demoData.routes, new Date('2026-10-03T12:00:00Z'));
  assert.equal(saved.recordedAt, '2026-10-03T12:00:00.000Z');
  assert.equal(saved.routeNumber, '501');
  assert.ok(validJournal([saved]));
  for (const field of ['latitude', 'longitude', 'observedAt', 'point', 'speedMetresPerSecond']) assert.ok(!(field in saved));
  assert.deepEqual(journalEntry({ vehicle: { id: 'other', label: 'Other' } }, demoData.routes, new Date('2026-10-03T12:00:00Z')), entry('other', { label: 'Other' }));
});

test('collection badges count distinct saved identities and supplied route assignments, including overnight assignments', () => {
  assert.ok(journalBadges([]).every(badge => !badge.earned && badge.progress === 0));
  assert.equal(journalBadges([entry('a')]).filter(badge => badge.earned).length, 1);
  const entries = Array.from({ length: 20 }, (_, index) => entry(String(index), { routeId: String(index % 3), overnight: index === 0 }));
  assert.ok(journalBadges(entries).every(badge => badge.earned && badge.progress === badge.target));
  assert.equal(journalBadges(entries.map(item => ({ ...item, routeId: undefined, overnight: false }))).find(badge => badge.name === 'Route rover').earned, false);
});

test('journal backup round-trips multiline Unicode notes and rejects unsupported, malformed and oversized files', () => {
  const entries = [entry('4400', { note: '<script>東京</script>\nMy favourite car =1+1' })];
  assert.deepEqual(readJournalBackup(journalBackup(entries)), entries);
  for (const contents of ['null', '[{}]', '{', JSON.stringify({ format: 'ttc-streetcar-journal', version: 2, entries }), journalBackup([entry('a', { longitude: -79.4 })]), ' '.repeat(2_000_001)]) assert.throws(() => readJournalBackup(contents));
});

test('restoring keeps existing notes, ignores duplicate cars and rejects over-capacity imports atomically', () => {
  const current = [entry('4400', { note: 'Keep this' })];
  const incoming = [entry('4400', { note: 'Do not overwrite' }), entry('4401')];
  assert.deepEqual(mergeJournal(current, incoming), { entries: [current[0], incoming[1]], added: 1 });
  assert.equal(current.length, 1);
  assert.equal(mergeJournal(current, current).added, 0);
  const full = Array.from({ length: JOURNAL_LIMIT }, (_, index) => entry(String(index)));
  assert.throws(() => mergeJournal(full, [entry('new')]));
  assert.equal(full.length, JOURNAL_LIMIT);
});

test('stop directory searches routes and combines boarding, terminal, accessible and saved filters', () => {
  const all = { ...DEFAULT_STOP_FILTERS, kind: 'all' };
  assert.equal(filterStops(demoData, all, []).length, demoData.features.length);
  const boarding = filterStops(demoData, DEFAULT_STOP_FILTERS, []);
  assert.ok(boarding.every(({ stop }) => stop.boardingPoints > 0));
  const route = demoData.routes.find(route => route.id === '501');
  assert.ok(filterStops(demoData, { ...all, query: route.name }, []).every(({ stop }) => stop.routeIds.includes(route.id)));
  const accessible = demoData.features.find(stop => stop.accessible === true);
  assert.equal(filterStops(demoData, { ...all, accessible: true, saved: true }, [accessible.id]).length, 1);
  assert.equal(filterStops(demoData, { ...all, accessible: true, saved: true }, []).length, 0);
  assert.ok(filterStops(demoData, { ...all, kind: 'terminal' }, []).every(({ stop }) => stop.kind === 'terminal'));
  assert.equal(filterStops(demoData, { ...all, route: 'absent' }, []).length, 0);
});

test('directory distances use geographic coordinates, with stable alphabetical fallback when location is cleared', () => {
  const target = demoData.features.find(stop => stop.boardingPoints);
  const location = mapToGps(target.point, demoData.geographicTransform);
  const sorted = filterStops(demoData, { ...DEFAULT_STOP_FILTERS, sort: 'distance' }, [], location);
  assert.equal(sorted[0].stop.id, target.id);
  assert.equal(sorted[0].metres, 0);
  assert.ok(sorted.every((item, index) => !index || item.metres >= sorted[index - 1].metres));
  assert.deepEqual(filterStops(demoData, { ...DEFAULT_STOP_FILTERS, sort: 'distance' }, []), filterStops(demoData, DEFAULT_STOP_FILTERS, []));
});

test('new tool links restore the directory and journal without including personal collection data', () => {
  for (const panel of ['stops', 'journal']) {
    const hash = mapLinkHash(undefined, DEFAULT_FILTERS, undefined, { panel });
    assert.equal(hash, '#view=' + panel);
    assert.deepEqual(readMapLink(hash), { panel, filters: {} });
  }
});
