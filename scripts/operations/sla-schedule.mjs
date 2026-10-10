import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// Production operator motions for the SLA pipeline that the scheduled crons
// cannot do for an unchanged feed (docs/sla.md, docs/sla-stories.md Epic 8):
//
//   targets — re-derive and persist the promise lens (sla_schedule_dates /
//             sla_schedule_targets / sla_route_targets) for the ALREADY-ACTIVE
//             version, from the same retained R2 archive the import read. Needed
//             when the promise lens ships after a version was imported: the
//             unchanged-feed sync path never reprocesses, by design.
//   fold    — run the hourly SLA rollup (Tier 3) immediately: folds completed
//             Toronto days from the 5-minute rollup tier into the daily/weekly
//             tables and refreshes today's partial. Idempotent and self-healing —
//             the same code the 41 * * * * cron runs.
//
// Both follow scripts/operations/regenerate-map.mjs: compile the worker's own
// modules and run them against production D1 (and R2) through Wrangler's
// remote platform proxy. `--local` targets the API Worker's own dev D1 state
// instead; `--dry-run` validates and reports without writing.
//
// Usage: npm run sla:backfill:remote [-- --dry-run] | npm run sla:fold:remote
//        (or the :local variants)

const SOURCE_KEY = 'ttc-surface-gtfs';

async function compileWorkerModules() {
  const compiled = await build({
    stdin: {
      contents: `
    export { backfillSlaSchedule } from './workers/api/src/sync/import-version';
    export { acquireLock, releaseLock } from './workers/api/src/sync/sync-common';
    export { runSlaRollup } from './workers/api/src/sla/fold';
    export { serviceConfig } from './shared/service/config';`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
}

/** The active version row, with enough context to report what will happen. */
async function activeVersion(db) {
  const state = await db
    .prepare(`SELECT active_version_id FROM source_state WHERE source_key = ?`)
    .bind(SOURCE_KEY)
    .first();
  if (!state?.active_version_id)
    throw new Error('No active network version; run the first static GTFS sync.');
  const version = await db
    .prepare(`SELECT * FROM network_versions WHERE id = ?`)
    .bind(state.active_version_id)
    .first();
  if (!version) throw new Error(`Active version ${state.active_version_id} not found`);
  return version;
}

/** An R2ZipArchive-compatible bucket view over in-memory bytes. */
function bytesBucket(bytes) {
  return {
    async head() {
      return { size: bytes.length };
    },
    async get(_key, { range }) {
      return {
        body: new Response(bytes.subarray(range.offset, range.offset + range.length))
          .body,
      };
    },
  };
}

const SOURCE_USER_AGENT =
  'TTCStatus.ca SLA backfill/0.1 (+https://github.com/agilesyndrome/api.ttcstatus.ca)';

/** Resolve the archive the backfill reads: the retained R2 object, or — when
 * that was lost — the version's recorded source, but only when the source
 * still serves the exact bytes the version was fetched with (the same
 * validator citizenship the sync's conditional GET uses). A changed source is
 * refused: re-deriving would attach a newer schedule's promises to this
 * version, and the next real feed change belongs to the sync pipeline. */
async function resolveArchiveBucket({ bucket, version }) {
  if (await bucket.head(version.r2_key)) return { bucket, source: 'r2' };
  if (!version.source_url || !version.source_etag) {
    throw new Error(
      'The retained R2 archive is missing and the version recorded no source validators.',
    );
  }
  const response = await fetch(version.source_url, {
    headers: { 'If-None-Match': version.source_etag, 'User-Agent': SOURCE_USER_AGENT },
  });
  const etag = response.headers.get('etag');
  if (response.status === 304 || (response.ok && etag === version.source_etag)) {
    const full =
      response.status === 304
        ? await fetch(version.source_url, {
            headers: { 'User-Agent': SOURCE_USER_AGENT },
          })
        : response;
    if (!full.ok) throw new Error(`Source fetch failed with HTTP ${full.status}`);
    if (full.headers.get('etag') !== version.source_etag) {
      throw new Error('The source changed mid-fetch; retry.');
    }
    const bytes = Buffer.from(await full.arrayBuffer());
    if (
      version.source_content_length != null &&
      bytes.length !== version.source_content_length
    ) {
      throw new Error(
        `Source length ${bytes.length} does not match the recorded ${version.source_content_length}`,
      );
    }
    return { bucket: bytesBucket(bytes), source: 'source-url' };
  }
  throw new Error(
    `The retained R2 archive is gone and the source has changed (etag ${etag} vs recorded ${version.source_etag}). ` +
      'Wait for the next real feed change to reach the sync pipeline instead.',
  );
}

async function backfillTargets({ db, bucket, dryRun }) {
  const { backfillSlaSchedule, acquireLock, releaseLock } = await compileWorkerModules();
  // The same lock the nightly sync takes: never re-derive while a sync flip
  // could be pruning or reimporting the active version's rows underneath us.
  const lease = await acquireLock({ DB: db });
  if (!lease)
    throw new Error(
      'Static sync is busy or has not initialized. Retry after it finishes.',
    );
  try {
    const version = await activeVersion(db);
    const { bucket: archive, source } = await resolveArchiveBucket({ bucket, version });
    console.log(
      JSON.stringify(
        {
          networkVersion: version.id,
          status: version.status,
          rawRetained: version.raw_retained,
          r2Key: version.r2_key,
          archiveSource: source,
        },
        null,
        2,
      ),
    );
    // The version's own source_url — the URL the archive was actually fetched
    // from — drives the complete-feed rail-line rail.
    const result = await backfillSlaSchedule(
      { DB: db, GTFS_BUCKET: archive, STATIC_GTFS_URL: version.source_url },
      { id: version.id, r2_key: version.r2_key },
      { dryRun },
    );
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await releaseLock({ DB: db }, lease);
  }
}

async function runFoldNow({ db }) {
  const { runSlaRollup, serviceConfig } = await compileWorkerModules();
  // The validated defaults equal the deployed overrides (workers/api/
  // wrangler.jsonc mirrors shared/service/config.ts), so the same config the
  // cron runs applies here without reading production vars.
  const result = await runSlaRollup(db, serviceConfig(), Date.now());
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function localPlatform(getPlatformProxy) {
  const platform = await getPlatformProxy({
    configPath: 'workers/api/wrangler.jsonc',
    persist: { path: 'workers/api/.wrangler/state/v3' },
  });
  return { platform, directory: null };
}

/** Remote mode uses a temporary config with only the production D1 and R2
 * bindings; Wrangler supplies credentials. Mirrors regenerate-map.mjs. */
async function remotePlatform(getPlatformProxy) {
  const configPath = 'workers/api/wrangler.jsonc';
  const { config, error } = ts.parseConfigFileTextToJson(
    configPath,
    await readFile(configPath, 'utf8'),
  );
  if (error) throw new Error(`Unable to read ${configPath}`);
  const d1 = config.d1_databases.find((binding) => binding.binding === 'DB');
  const r2 = config.r2_buckets.find((binding) => binding.binding === 'GTFS_BUCKET');
  if (!d1?.database_id) throw new Error('DB binding is not configured');
  if (!r2?.bucket_name) throw new Error('GTFS_BUCKET binding is not configured');
  const directory = await mkdtemp(join(tmpdir(), 'ttc-sla-ops-'));
  const file = join(directory, 'wrangler.json');
  await writeFile(
    file,
    JSON.stringify({
      name: 'ttcstatus-sla-ops',
      compatibility_date: config.compatibility_date,
      ...(config.account_id ? { account_id: config.account_id } : {}),
      d1_databases: [
        {
          binding: 'DB',
          database_name: d1.database_name,
          database_id: d1.database_id,
          remote: true,
        },
      ],
      r2_buckets: [{ binding: 'GTFS_BUCKET', bucket_name: r2.bucket_name }],
    }),
  );
  const platform = await getPlatformProxy({
    configPath: file,
    envFiles: [],
    persist: false,
    remoteBindings: true,
  });
  return { platform, directory };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith('--'));
  const unknown = args.filter(
    (arg) => !['targets', 'fold', '--local', '--dry-run'].includes(arg),
  );
  if (!command || unknown.length > 0)
    throw new Error(
      'Usage: node scripts/operations/sla-schedule.mjs <targets|fold> [--dry-run] [--local]',
    );
  const { getPlatformProxy } = await import('wrangler');
  const { platform, directory } = await (args.includes('--local')
    ? localPlatform(getPlatformProxy)
    : remotePlatform(getPlatformProxy));
  try {
    if (command === 'targets') {
      await backfillTargets({
        db: platform.env.DB,
        bucket: platform.env.GTFS_BUCKET,
        dryRun: args.includes('--dry-run'),
      });
    } else {
      await runFoldNow({ db: platform.env.DB });
    }
  } finally {
    await platform.dispose();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
