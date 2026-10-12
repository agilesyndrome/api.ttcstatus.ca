import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { mergeJournal, mergeSavedStops, validJournal, writeAccountDocument } =
  await compileModules(`
  export * from './shared/accounts/merge';
  export { validJournal } from './shared/accounts/journal';
  export { writeAccountDocument } from './web/ui/features/accounts/document-write';
`);
const entry = (vehicleId, note = '') => ({
  vehicleId,
  label: vehicleId,
  note,
  recordedAt: '2026-10-12T17:00:00.000Z',
});
const schema = {
  path: '/api/v1/me/journal',
  field: 'entries',
  valid: validJournal,
  merge: mergeJournal,
};

test('three-way recovery retains independent edits and deletions; same-entry edits require an explicit choice', () => {
  const base = [entry('4400'), entry('4401')];
  const draft = [entry('4400', 'mine'), entry('4402')];
  const remote = [entry('4400'), entry('4401'), entry('4403', 'theirs')];
  assert.deepEqual(mergeJournal(base, draft, remote), [
    entry('4400', 'mine'),
    entry('4403', 'theirs'),
    entry('4402'),
  ]);
  const conflict = [entry('4400', 'also changed'), entry('4403')];
  assert.equal(mergeJournal(base, draft, conflict), null);
  assert.deepEqual(mergeJournal(base, draft, conflict, true), [
    entry('4400', 'mine'),
    entry('4403'),
    entry('4402'),
  ]);
  assert.deepEqual(mergeSavedStops(['a', 'b'], ['b', 'c'], ['a', 'b', 'd']), [
    'b',
    'd',
    'c',
  ]);
  assert.equal(
    mergeSavedStops(
      [],
      ['extra'],
      Array.from({ length: 100 }, (_, i) => String(i)),
    ),
    null,
  );
});

test('a conflict retries once with current revision and merged state; continued conflicts retain the unchanged draft', async () => {
  const pending = { base: [entry('4400')], items: [entry('4400', 'mine')] };
  const unchanged = structuredClone(pending);
  const requests = [];
  const current = { items: [entry('4400')], revision: 1 };
  const request = async (_path, init) => {
    const submitted = JSON.parse(init.body);
    requests.push(submitted);
    return requests.length === 1
      ? Response.json(
          {
            error: 'journal-conflict',
            revision: 2,
            current: { entries: [entry('4400'), entry('4401')], revision: 2 },
          },
          { status: 409 },
        )
      : Response.json({ revision: 3 });
  };
  const result = await writeAccountDocument(request, schema, current, pending);
  assert.equal(result.saved, true);
  assert.deepEqual(requests[1], {
    entries: [entry('4400', 'mine'), entry('4401')],
    revision: 2,
  });
  assert.deepEqual(pending, unchanged);
  let calls = 0;
  const conflicting = async () => {
    calls++;
    return Response.json(
      { revision: calls + 1, current: { entries: current.items, revision: calls + 1 } },
      { status: 409 },
    );
  };
  assert.equal(
    (await writeAccountDocument(conflicting, schema, current, pending)).saved,
    false,
  );
  assert.equal(calls, 2);
  assert.deepEqual(pending, unchanged);
});

test('changing accounts prevents a conflict retry from submitting an old private draft with a new session', async () => {
  let active = true,
    calls = 0;
  const request = async () => {
    calls++;
    active = false;
    return Response.json(
      { revision: 2, current: { entries: [], revision: 2 } },
      { status: 409 },
    );
  };
  await assert.rejects(
    writeAccountDocument(
      request,
      schema,
      { items: [], revision: 1 },
      { base: [], items: [entry('4400')] },
      false,
      () => active,
    ),
    /cancelled/,
  );
  assert.equal(calls, 1);
});
