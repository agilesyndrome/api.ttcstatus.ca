import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileModules } from '../helpers/compile.mjs';
import { createDatabase } from '../helpers/database.mjs';
import { tagMap, clearMapTag, listMapTags } from '../../scripts/operations/tag-map.mjs';

const { api, resolveMapArtifact } = await compileModules(`
  export { default as api } from './workers/api/src/index';
  export { resolveMapArtifact } from './workers/api/src/maps/responses';`);
const ctx = { waitUntil() {} };
const schema =
  (await readFile('migrations/0001_initial.sql', 'utf8')) +
  (await readFile('migrations/0002_accounts.sql', 'utf8')) +
  (await readFile('migrations/0003_map_names.sql', 'utf8'));

// The edge cache API only exists inside the Worker runtime; stub it like the
// realtime tests do when exercising 200 responses end to end.
async function withEdgeCache(run) {
  const entries = new Map(),
    original = globalThis.caches;
  globalThis.caches = {
    default: {
      match: async (key) => entries.get(key.url)?.clone(),
      put: async (key, response) => entries.set(key.url, response),
    },
  };
  try {
    return await run();
  } finally {
    globalThis.caches = original;
  }
}

function environment() {
  return { DB: createDatabase(schema) };
}

async function artifact(env, id, name, versionId, generator, active = 0) {
  await env.DB.prepare(
    `INSERT INTO map_artifacts (
       id, version_id, mode, style, name, generator_version, etag, byte_size, chunk_count, created_at, active
     ) VALUES (?, ?, 'streetcar', ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(
      id,
      versionId,
      name === 'snake' ? 'snake-board-v1' : 'snake-v1',
      name,
      generator,
      `etag-${id}`,
      10,
      '2026-10-01',
      active,
    )
    .run();
  await env.DB.prepare('INSERT INTO map_artifact_chunks VALUES (?, 0, \'{"ok":true}\')')
    .bind(id)
    .run();
}

test('named maps resolve tags first, then the active pipeline pointer', async () => {
  const env = environment();
  await artifact(env, 1, 'streetcar', 7, 'g-old', 1);
  await artifact(env, 2, 'streetcar', 8, 'g-new');
  // The nightly pipeline activates every published name of the version.
  await artifact(env, 3, 'snake', 8, 'g-new', 1);

  // No tags yet: the nightly import's active pointer serves both names.
  assert.equal((await resolveMapArtifact({ DB: env.DB }, 'streetcar')).artifact.id, 1);
  assert.equal((await resolveMapArtifact({ DB: env.DB }, 'snake')).artifact.id, 3);
  assert.equal((await resolveMapArtifact({ DB: env.DB }, 'streetcar')).via, 'active');

  // Publish a stable tag on the new schematic generation.
  const set = await tagMap(env.DB, {
    name: 'streetcar',
    tag: 'stable',
    generatorVersion: 'g-new',
  });
  assert.equal(set.artifactId, 2);
  const stable = await resolveMapArtifact({ DB: env.DB }, 'streetcar');
  assert.equal(stable.artifact.id, 2);
  assert.equal(stable.via, 'stable');

  // An explicit tag must exist; unknown tags never silently fall back.
  const missing = await resolveMapArtifact({ DB: env.DB }, 'streetcar', 'latest');
  assert.equal(missing.error.message.includes("no tag 'latest'"), true);

  // Tags do not leak across names.
  await assert.rejects(
    tagMap(env.DB, { name: 'snake', tag: 'stable', artifactId: 2 }),
    /belongs to map 'streetcar'/,
  );
  await clearMapTag(env.DB, 'streetcar', 'stable');
  assert.equal((await resolveMapArtifact({ DB: env.DB }, 'streetcar')).artifact.id, 1);
});

test('map endpoints serve any published name with tagged artifacts and caching headers', async () => {
  const env = environment();
  await artifact(env, 1, 'streetcar', 7, 'g-old', 1);
  await artifact(env, 2, 'streetcar', 8, 'g-new');
  await artifact(env, 3, 'snake', 8, 'g-new', 1);
  await tagMap(env.DB, { name: 'snake', tag: 'latest', generatorVersion: 'g-new' });

  await withEdgeCache(async () => {
    const legacy = await api.fetch(
      new Request('https://example.test/api/v1/map/streetcar?format=schematic-v1'),
      env,
      ctx,
    );
    assert.equal(legacy.status, 200);
    assert.equal(legacy.headers.get('x-map-generator'), 'g-old');
    assert.equal(legacy.headers.get('x-network-version'), '7');

    // The snake board is a first-class named artifact at its own path.
    const snake = await api.fetch(
      new Request('https://example.test/api/v1/map/snake'),
      env,
      ctx,
    );
    assert.equal(snake.status, 200);
    assert.deepEqual(await snake.json(), { ok: true });
    assert.equal(snake.headers.get('x-network-version'), '8');

    // A cached response is still served for the same name + artifact.
    const cached = await api.fetch(
      new Request('https://example.test/api/v1/map/snake'),
      env,
      ctx,
    );
    assert.equal(cached.status, 200);
    assert.equal(cached.headers.get('x-ttcstatus-cache'), 'HIT');

    // Explicit tags select a specific artifact over the active pointer.
    const tagged = await api.fetch(
      new Request('https://example.test/api/v1/map/snake?tag=latest'),
      env,
      ctx,
    );
    assert.equal(tagged.status, 200);
    assert.equal(tagged.headers.get('x-network-version'), '8');
  });

  const missing = await api.fetch(
    new Request('https://example.test/api/v1/map/snake?tag=experimental'),
    env,
    ctx,
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'map-tag-missing');

  const unknownName = await api.fetch(
    new Request('https://example.test/api/v1/map/unknown'),
    env,
    ctx,
  );
  assert.equal(unknownName.status, 404);

  const listed = await listMapTags(env.DB);
  assert.deepEqual(
    listed.tags.map((row) => [row.name, row.tag, row.artifact_id]),
    [['snake', 'latest', 3]],
  );
});
