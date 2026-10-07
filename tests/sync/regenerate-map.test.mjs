import assert from 'node:assert/strict';
import test from 'node:test';
import { regenerateMap } from '../../scripts/operations/regenerate-map.mjs';

function fixture({
  busy = false,
  validationFails = false,
  storageFails = false,
  publishFails = false,
  current = false,
} = {}) {
  const calls = [];
  let published = false;
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          calls.push(statement);
          if (sql.includes('RETURNING source_key'))
            return busy ? null : { source_key: 'ttc-surface-gtfs' };
          if (sql.startsWith('SELECT id FROM network_versions')) return { id: 7 };
          if (sql.startsWith('SELECT id, generator_version'))
            return {
              id: 3,
              generator_version: current ? 'new-generator' : 'old-generator',
            };
          if (sql.includes('RETURNING id')) return { id: 8 };
          if (sql.startsWith('SELECT active')) return { active: published ? 1 : 0 };
          throw new Error(`Unexpected first: ${sql}`);
        },
        async run() {
          calls.push(statement);
          if (sql.startsWith('UPDATE map_artifacts')) published = !publishFails;
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
  const modules = {
    GENERATOR_VERSION: 'new-generator',
    loadMapSourceData: async (_env, version) => {
      assert.equal(version, 7);
      return {};
    },
    buildStreetcarMapBundle: () => ({}),
    buildViewerData: () => {
      if (validationFails) throw new Error('invalid schematic');
      return { edges: [1, 2], features: [1] };
    },
    generateStreetcarMap: async () => {
      if (storageFails) throw new Error('chunk write failed');
      return { artifactId: 9, snakeArtifactId: 10 };
    },
  };
  return { db, modules, calls };
}

test('dry-run validates without writing, locking or publishing production records', async () => {
  const f = fixture();
  assert.equal(
    (await regenerateMap(f.db, f.modules, { dryRun: true })).status,
    'validated',
  );
  assert.ok(f.calls.every((call) => call.sql.startsWith('SELECT')));
});
test('regeneration publishes both named maps with guarded statements and releases its own sync lock', async () => {
  const f = fixture();
  const result = await regenerateMap(f.db, f.modules);
  assert.equal(result.status, 'updated');
  assert.equal(result.previousArtifactId, 3);
  assert.equal(result.snakeArtifactId, 10);
  const publication = f.calls.filter((call) =>
    call.sql.startsWith('UPDATE map_artifacts'),
  );
  // One guarded flip per published name: the schematic and the snake board.
  assert.equal(publication.length, 2);
  for (const statement of publication) {
    assert.ok(statement.sql.includes('ready.chunk_count = (SELECT COUNT(*)'));
    assert.ok(statement.sql.includes('network_versions WHERE id = ? AND active = 1'));
  }
  assert.ok(publication.some((call) => call.sql.includes("style = 'snake-v1'")));
  assert.ok(publication.some((call) => call.sql.includes("style = 'snake-board-v1'")));
  const release = f.calls.at(-1);
  assert.ok(release.sql.includes('AND lock_until = ?'));
  assert.equal(release.values[1], f.calls[0].values[0]);
});
test('a busy sync never clears another operation’s lock', async () => {
  const f = fixture({ busy: true });
  await assert.rejects(regenerateMap(f.db, f.modules), /busy/);
  assert.equal(f.calls.length, 1);
});
test('invalid schematics and incomplete writes never switch the active map', async () => {
  for (const options of [{ validationFails: true }, { storageFails: true }]) {
    const f = fixture(options);
    await assert.rejects(
      regenerateMap(f.db, f.modules),
      /invalid schematic|chunk write failed/,
    );
    assert.ok(!f.calls.some((call) => call.sql.startsWith('UPDATE map_artifacts')));
    assert.ok(f.calls.at(-1).sql.includes('lock_until = NULL'));
  }
});
test('refused publication is reported as failure and the generation job records the error', async () => {
  const f = fixture({ publishFails: true });
  await assert.rejects(regenerateMap(f.db, f.modules), /publication refused/);
  assert.ok(f.calls.some((call) => call.sql.includes("status = 'failed'")));
});
test('an already-current artifact is not rewritten while viewers use it', async () => {
  const f = fixture({ current: true });
  assert.equal((await regenerateMap(f.db, f.modules)).status, 'unchanged');
  assert.ok(
    !f.calls.some(
      (call) =>
        call.sql.includes('INSERT') || call.sql.startsWith('UPDATE map_artifacts'),
    ),
  );
});
