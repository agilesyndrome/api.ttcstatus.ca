import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';

const compiled = await build({
  stdin: {
    contents: `
      export { syncStaticGtfs } from './workers/api/src/sync/sync';
      export { generateStreetcarMap } from './workers/map-generator/src/generate';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});

const modules = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`,
);
const platform = await getPlatformProxy({
  configPath: 'workers/api/wrangler.jsonc',
  envFiles: [],
  persist: { path: 'workers/api/.wrangler/state/v3' },
  remoteBindings: false,
});

try {
  const baseEnv = platform.env;
  console.log('Local bootstrap: downloading and importing TTC Complete GTFS...');
  const localBucket = {
    async put(key, value, options) {
      // Miniflare's Node R2 adapter requires a known length for streams. The
      // production Worker streams the ZIP directly; bootstrap is one local
      // operation, so materialize that bounded stream before storing it.
      if (value && typeof value.getReader === 'function') {
        value = new Uint8Array(await new Response(value).arrayBuffer());
      }
      return baseEnv.GTFS_BUCKET.put(key, value, options);
    },
    get: (...args) => baseEnv.GTFS_BUCKET.get(...args),
    head: (...args) => baseEnv.GTFS_BUCKET.head(...args),
    delete: (...args) => baseEnv.GTFS_BUCKET.delete(...args),
    list: (...args) => baseEnv.GTFS_BUCKET.list(...args),
  };
  const mapGenerator = {
    async fetch(_input, init = {}) {
      const body = JSON.parse(String(init.body || '{}'));
      const versionId = Number(body.versionId);
      if (!Number.isInteger(versionId) || versionId <= 0)
        return Response.json({ error: 'invalid-version-id' }, { status: 400 });

      await baseEnv.DB.prepare(
        `UPDATE map_generation_jobs
         SET status = 'running', started_at = ?, error = NULL
         WHERE id = (
           SELECT id FROM map_generation_jobs
           WHERE version_id = ? AND mode = 'streetcar'
           ORDER BY id DESC LIMIT 1
         )`,
      )
        .bind(new Date().toISOString(), versionId)
        .run();

      try {
        console.log(`Local bootstrap: generating map for network version ${versionId}...`);
        const artifactId = await modules.generateStreetcarMap({
          DB: baseEnv.DB,
          SOURCE_ATTRIBUTION: baseEnv.SOURCE_ATTRIBUTION,
        }, versionId);
        console.log(`Local bootstrap: generated map artifact ${artifactId}.`);
        return Response.json({ artifactId, versionId });
      } catch (error) {
        await baseEnv.DB.prepare(
          `UPDATE map_generation_jobs
           SET status = 'failed', completed_at = ?, error = ?
           WHERE id = (
             SELECT id FROM map_generation_jobs
             WHERE version_id = ? AND mode = 'streetcar'
             ORDER BY id DESC LIMIT 1
           )`,
        )
          .bind(new Date().toISOString(), String(error).slice(0, 2000), versionId)
          .run();
        throw error;
      }
    },
  };

  const result = await modules.syncStaticGtfs({
    ...baseEnv,
    GTFS_BUCKET: localBucket,
    MAP_GENERATOR: mapGenerator,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Local bootstrap failed: ${message}`);
  if (error && typeof error === 'object' && 'cause' in error && error.cause)
    console.error(`Cause: ${String(error.cause)}`);
  process.exitCode = 1;
} finally {
  await platform.dispose();
}
