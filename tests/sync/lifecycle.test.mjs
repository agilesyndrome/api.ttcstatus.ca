import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileModules } from '../helpers/compile.mjs';
import { createDatabase } from '../helpers/database.mjs';

const {
  ensureState,
  acquireLock,
  releaseLock,
  activateNetworkVersion,
  pruneOldNetworkVersions,
} = await compileModules(`
  export { ensureState, acquireLock, releaseLock } from './workers/api/src/sync/sync-common';
  export { activateNetworkVersion, pruneOldNetworkVersions } from './workers/api/src/sync/network-lifecycle';
`);
const schema =
  (await readFile('migrations/0001_initial.sql', 'utf8')) +
  (await readFile('migrations/0003_map_names.sql', 'utf8'));
function environment() {
  const deleted = [];
  return {
    DB: createDatabase(schema),
    STATIC_GTFS_URL: 'https://feed.test/static.zip',
    GTFS_BUCKET: {
      async delete(key) {
        deleted.push(key);
      },
    },
    deleted,
  };
}
async function version(env, id, active = 0) {
  await env.DB.prepare(
    `INSERT INTO network_versions (id, source_key, source_url, r2_etag, r2_key, fetched_at, status, active)
    VALUES (?, 'ttc-surface-gtfs', 'https://feed.test/static.zip', ?, ?, '2026-10-01', 'imported', ?)`,
  )
    .bind(id, `etag-${id}`, `version-${id}`, active)
    .run();
  return env.DB.prepare('SELECT * FROM network_versions WHERE id = ?').bind(id).first();
}
async function artifact(env, id, versionId, chunks = 1, active = 0, board = false) {
  await env.DB.prepare(
    `INSERT INTO map_artifacts (id, version_id, mode, style, name, generator_version, etag, byte_size, chunk_count, created_at, active)
    VALUES (?, ?, 'streetcar', ?, ?, 'fixture', ?, 2, ?, '2026-10-01', ?)`,
  )
    .bind(
      id,
      versionId,
      board === 'snake'
        ? 'snake-board-v1'
        : board === 'ttcstatus'
          ? 'ttcstatus-board-v1'
          : 'snake-v1',
      board ? board : 'streetcar',
      `map-${id}`,
      chunks,
      active,
    )
    .run();
}
async function chunk(env, artifactId, index = 0) {
  await env.DB.prepare('INSERT INTO map_artifact_chunks VALUES (?, ?, ?)')
    .bind(artifactId, index, '{}')
    .run();
}

test('expired sync owners cannot release a replacement lease', async () => {
  const env = environment();
  await ensureState(env);
  const oldLease = await acquireLock(env);
  assert.ok(oldLease);
  assert.equal(await acquireLock(env), null);
  const replacement = '2099-01-01T00:00:00.000Z';
  await env.DB.prepare('UPDATE source_state SET lock_until = ?').bind(replacement).run();
  await releaseLock(env, oldLease);
  assert.equal(
    (await env.DB.prepare('SELECT lock_until FROM source_state').first()).lock_until,
    replacement,
  );
  await releaseLock(env, replacement);
  assert.equal(
    (await env.DB.prepare('SELECT lock_until FROM source_state').first()).lock_until,
    null,
  );
});

test('publication refuses incomplete or mismatched artifacts without changing active pointers', async () => {
  const env = environment();
  await ensureState(env);
  await version(env, 1, 1);
  const next = await version(env, 2);
  await artifact(env, 1, 1, 1, 1);
  await artifact(env, 2, 2, 2);
  await env.DB.prepare("INSERT INTO map_artifact_chunks VALUES (2, 0, '{}')").run();
  await assert.rejects(activateNetworkVersion(env, next, 2), /incomplete/);
  await assert.rejects(activateNetworkVersion(env, next, 1), /mismatched/);
  assert.equal(
    (await env.DB.prepare('SELECT id FROM network_versions WHERE active = 1').first()).id,
    1,
  );
  assert.equal(
    (await env.DB.prepare('SELECT id FROM map_artifacts WHERE active = 1').first()).id,
    1,
  );
  await env.DB.prepare("INSERT INTO map_artifact_chunks VALUES (2, 1, '{}')").run();
  // A complete schematic alone is not enough: every published name of the
  // version must flip atomically or none of them does.
  await assert.rejects(activateNetworkVersion(env, next, 2), /snake/);
  await artifact(env, 3, 2, 1, 0, 'snake');
  await chunk(env, 3);
  // The stable ttcstatus site map activates with the same guarantee.
  await assert.rejects(activateNetworkVersion(env, next, 2), /ttcstatus/);
  await artifact(env, 4, 2, 1, 0, 'ttcstatus');
  await chunk(env, 4);
  await activateNetworkVersion(env, next, 2);
  assert.equal(
    (await env.DB.prepare('SELECT id FROM network_versions WHERE active = 1').first()).id,
    2,
  );
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT id FROM map_artifacts WHERE style = 'snake-v1' AND active = 1",
      ).first()
    ).id,
    2,
  );
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT id FROM map_artifacts WHERE name = 'snake' AND active = 1",
      ).first()
    ).id,
    3,
  );
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT id FROM map_artifacts WHERE name = 'ttcstatus' AND active = 1",
      ).first()
    ).id,
    4,
  );
});

test('retention keeps the active map even when newer imports have failed', async () => {
  const env = environment();
  for (const id of [1, 2, 3, 4]) await version(env, id, id === 2 ? 1 : 0);
  await artifact(env, 2, 2, 1, 1);
  await env.DB.prepare("INSERT INTO map_artifact_chunks VALUES (2, 0, '{}')").run();
  await pruneOldNetworkVersions(env);
  assert.deepEqual(env.deleted, ['version-1']);
  assert.equal(
    (
      await env.DB.prepare(
        'SELECT raw_retained FROM network_versions WHERE id = 2',
      ).first()
    ).raw_retained,
    1,
  );
  assert.equal(
    (
      await env.DB.prepare(
        'SELECT payload FROM map_artifact_chunks WHERE artifact_id = 2',
      ).first()
    ).payload,
    '{}',
  );
});

test('switching to Complete GTFS clears old source validators while retaining the active network', async () => {
  const env = environment();
  await ensureState(env);
  await env.DB.prepare(
    "UPDATE source_state SET source_etag = 'old', source_last_modified = 'old', last_full_fetch_at = '2026-10-04', active_version_id = 42",
  ).run();
  env.STATIC_GTFS_URL = 'https://feed.test/completegtfs.zip';
  const state = await ensureState(env);
  assert.equal(state.source_etag, null);
  assert.equal(state.source_last_modified, null);
  assert.equal(state.last_full_fetch_at, null);
  assert.equal(state.active_version_id, 42);
});
