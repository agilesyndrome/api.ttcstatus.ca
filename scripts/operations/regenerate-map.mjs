import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

export async function regenerateMap(db, modules, { dryRun = false } = {}) {
  const {
    loadMapSourceData,
    buildStreetcarMapBundle,
    generateStreetcarMap,
    buildViewerData,
    GENERATOR_VERSION,
  } = modules;
  const sourceKey = 'ttc-surface-gtfs';
  const lockUntil = new Date(Date.now() + 20 * 60_000).toISOString();
  let locked = false,
    jobId;
  try {
    if (!dryRun) {
      const lock = await db
        .prepare(
          `UPDATE source_state SET lock_until = ? WHERE source_key = ?
        AND (lock_until IS NULL OR lock_until < ?) RETURNING source_key`,
        )
        .bind(lockUntil, sourceKey, new Date().toISOString())
        .first();
      if (!lock)
        throw new Error(
          'Static sync is busy or has not initialized. Retry after it finishes.',
        );
      locked = true;
    }
    const version = await db
      .prepare(
        'SELECT id FROM network_versions WHERE source_key = ? AND active = 1 ORDER BY id DESC LIMIT 1',
      )
      .bind(sourceKey)
      .first();
    if (!version)
      throw new Error('No active imported network; run the first static GTFS sync.');
    const active = await db
      .prepare(
        "SELECT id, generator_version FROM map_artifacts WHERE version_id = ? AND mode = 'streetcar' AND style = 'snake-v1' AND active = 1 LIMIT 1",
      )
      .bind(version.id)
      .first();
    if (!dryRun && active?.generator_version === GENERATOR_VERSION)
      return {
        status: 'unchanged',
        networkVersion: version.id,
        artifactId: active.id,
        generatorVersion: GENERATOR_VERSION,
      };
    const env = {
      DB: db,
      SOURCE_ATTRIBUTION:
        'Contains information licensed under the Open Government Licence - Toronto',
    };
    const source = await loadMapSourceData(env, version.id);
    const bundle = buildStreetcarMapBundle(source, env.SOURCE_ATTRIBUTION);
    const viewer = buildViewerData(bundle); // Validate the exact React contract before any publication.
    if (dryRun)
      return {
        status: 'validated',
        networkVersion: version.id,
        generatorVersion: GENERATOR_VERSION,
        edges: viewer.edges.length,
        stops: viewer.features.length,
      };
    const startedAt = new Date().toISOString();
    const job = await db
      .prepare(
        `INSERT INTO map_generation_jobs (version_id, mode, generator, status, created_at, started_at)
      VALUES (?, 'streetcar', 'snake-v1', 'running', ?, ?) RETURNING id`,
      )
      .bind(version.id, startedAt, startedAt)
      .first();
    jobId = job.id;
    // Publish the same pair of named artifacts as the nightly pipeline:
    // the schematic map and the derived snake board.
    const { artifactId, snakeArtifactId } = await generateStreetcarMap(env, version.id);
    // One atomic statement flips only map pointers. Keep the old artifact for rollback;
    // publish only if this network remains active and every chunk was stored.
    await db
      .prepare(
        `UPDATE map_artifacts SET active = CASE WHEN id = ? THEN 1 ELSE 0 END
      WHERE mode = 'streetcar' AND style = 'snake-v1'
      AND EXISTS (SELECT 1 FROM network_versions WHERE id = ? AND active = 1)
      AND EXISTS (SELECT 1 FROM map_artifacts AS ready WHERE ready.id = ? AND ready.version_id = ?
        AND ready.chunk_count = (SELECT COUNT(*) FROM map_artifact_chunks WHERE artifact_id = ready.id))`,
      )
      .bind(artifactId, version.id, artifactId, version.id)
      .run();
    await db
      .prepare(
        `UPDATE map_artifacts SET active = CASE WHEN id = ? THEN 1 ELSE 0 END
      WHERE mode = 'streetcar' AND style = 'snake-board-v1'
      AND EXISTS (SELECT 1 FROM network_versions WHERE id = ? AND active = 1)
      AND EXISTS (SELECT 1 FROM map_artifacts AS ready WHERE ready.id = ? AND ready.version_id = ?
        AND ready.chunk_count = (SELECT COUNT(*) FROM map_artifact_chunks WHERE artifact_id = ready.id))`,
      )
      .bind(snakeArtifactId, version.id, snakeArtifactId, version.id)
      .run();
    const published = await db
      .prepare('SELECT active FROM map_artifacts WHERE id = ?')
      .bind(artifactId)
      .first();
    if (published?.active !== 1)
      throw new Error(
        'Map publication refused: network changed or artifact is incomplete.',
      );
    return {
      status: 'updated',
      networkVersion: version.id,
      artifactId,
      snakeArtifactId,
      previousArtifactId: active?.id,
      generatorVersion: GENERATOR_VERSION,
      edges: viewer.edges.length,
      stops: viewer.features.length,
    };
  } catch (error) {
    if (jobId)
      await db
        .prepare(
          "UPDATE map_generation_jobs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?",
        )
        .bind(new Date().toISOString(), String(error).slice(0, 2000), jobId)
        .run();
    throw error;
  } finally {
    if (locked)
      await db
        .prepare(
          'UPDATE source_state SET lock_until = NULL WHERE source_key = ? AND lock_until = ?',
        )
        .bind(sourceKey, lockUntil)
        .run();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some((arg) => !['--dry-run', '--local'].includes(arg)))
    throw new Error('Usage: npm run map:regenerate:remote -- [--dry-run] | [--local]');
  const local = process.argv.includes('--local');
  const compiled = await build({
    stdin: {
      contents: `
    export { loadMapSourceData } from './workers/map-generator/src/source/repository';
    export { buildStreetcarMapBundle } from './workers/map-generator/src/layout/build-map';
    export { generateStreetcarMap } from './workers/map-generator/src/generate';
    export { buildViewerData } from './shared/map/model';
    export { GENERATOR_VERSION } from './workers/map-generator/src/config';`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  });
  const modules = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  // Remote mode uses a temporary config with only the production D1 binding;
  // Wrangler supplies credentials and parameterized queries. Local mode targets
  // the API Worker's own config so the regenerated pair lands in the same
  // `workers/api/.wrangler` D1 state that `npm run dev:api` serves.
  const { getPlatformProxy } = await import('wrangler');
  if (local) {
    // Explicit persist path (object form): the same `.wrangler/state/v3` that
    // `wrangler dev -c workers/api/wrangler.jsonc` reads and writes, so the
    // regenerated pair is served by the local dev API immediately.
    const platform = await getPlatformProxy({
      configPath: 'workers/api/wrangler.jsonc',
      persist: { path: 'workers/api/.wrangler/state/v3' },
    });
    try {
      console.log(
        JSON.stringify(
          await regenerateMap(platform.env.DB, modules, {
            dryRun: process.argv.includes('--dry-run'),
          }),
          null,
          2,
        ),
      );
    } finally {
      await platform.dispose();
    }
  } else {
    await regenerateRemote(modules, getPlatformProxy, {
      dryRun: process.argv.includes('--dry-run'),
    });
  }
}

async function regenerateRemote(modules, getPlatformProxy, { dryRun }) {
  const configPath = 'workers/map-generator/wrangler.jsonc';
  const { config, error } = ts.parseConfigFileTextToJson(
    configPath,
    await readFile(configPath, 'utf8'),
  );
  if (error) throw new Error('Unable to read map-generator Wrangler configuration');
  const binding = config.d1_databases.find((binding) => binding.binding === 'DB');
  if (!binding?.database_id)
    throw new Error('Map-generator DB binding is not configured');
  const dir = await mkdtemp(join(tmpdir(), 'ttc-map-repair-'));
  let platform;
  try {
    const file = join(dir, 'wrangler.json');
    await writeFile(
      file,
      JSON.stringify({
        name: 'ttcstatus-map-repair',
        compatibility_date: config.compatibility_date,
        ...(config.account_id ? { account_id: config.account_id } : {}),
        d1_databases: [
          {
            binding: 'DB',
            database_name: binding.database_name,
            database_id: binding.database_id,
            remote: true,
          },
        ],
      }),
    );
    platform = await getPlatformProxy({
      configPath: file,
      envFiles: [],
      persist: false,
      remoteBindings: true,
    });
    console.log(
      JSON.stringify(
        await regenerateMap(platform.env.DB, modules, {
          dryRun,
        }),
        null,
        2,
      ),
    );
  } finally {
    await platform?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}
