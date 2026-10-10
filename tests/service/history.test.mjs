import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../helpers/database.mjs';
import { compileModules } from '../helpers/compile.mjs';

// The Epic 4 + E2S9 boundary: fold mechanics and retention through the real
// window store and D1 (SQLite harness), fold-failure grace, the history
// endpoint's exact merged moments, and rollup-stabilized baselines — no DO
// runtime anywhere.
const {
  runFoldCycle,
  FoldError,
  serviceHistoryResponse,
  stopServiceState,
  serviceStatesAt,
  writeRollupRows,
  deriveRollupRow,
  moments,
  cvSquared,
  WindowStore,
  serviceConfig,
  SERVICE_BUCKET_SECONDS,
} = await compileModules(`
  export { runFoldCycle, FoldError } from './workers/api/src/service/fold';
  export { serviceHistoryResponse } from './workers/api/src/service/responses';
  export { stopServiceState, serviceStatesAt, deriveRollupRow, cvSquared, moments } from './shared/service/wait-metrics';
  export { writeRollupRows } from './workers/api/src/service/rollup-writes';
  export { WindowStore } from './workers/api/src/service/window-store';
  export { serviceConfig, SERVICE_BUCKET_SECONDS } from './shared/service/config';
`);

const rollupsSchema = await readFile('migrations/0006_service_rollups.sql', 'utf8');
const config = serviceConfig();
const T0 = Math.floor(1_800_000_000_000 / 30_000) * 30_000; // 30 s AND 300 s aligned
const BUCKET_MS = SERVICE_BUCKET_SECONDS * 1000;
const coverage = () => [
  {
    from: T0 - 9 * BUCKET_MS,
    to: T0 + 9 * BUCKET_MS,
    mode: 'streetcar',
    kind: 'observable',
  },
];
const touch = (stopId, t) => ({
  t,
  stopId,
  directionId: 0,
  mode: 'streetcar',
  vehicleId: '4400',
  routeId: '506',
});
const sqlAdapter = (sqlite) => ({
  exec: (query, ...params) => {
    const statement = sqlite.prepare(query);
    const rows = params.length ? statement.all(...params) : statement.all();
    return { toArray: () => rows };
  },
});
// The history endpoint reads the edge cache; in tests it never hits.
globalThis.caches = { default: { match: async () => null, put: async () => {} } };

/** A scripted stream: one touch every `headwayMs` inside a bounded span,
 * with an optional silent wound (the void a bunched pair drags behind). */
function scriptedStore({
  headwayMs = 600_000,
  from = T0 - 4 * BUCKET_MS,
  to = T0 + 6 * BUCKET_MS,
  woundAt,
  woundMs,
} = {}) {
  const store = new WindowStore(sqlAdapter(new DatabaseSync(':memory:')));
  store.initialize();
  const touches = [];
  for (let t = from; t <= to; t += headwayMs) {
    if (woundAt !== undefined && t >= woundAt && t < woundAt + (woundMs ?? 0)) continue;
    touches.push(touch('st_hist', t));
  }
  store.insertTouches(touches);
  store.insertCoverage(coverage());
  return { store, touches };
}

const readAll = async (db) =>
  (await db.prepare(`SELECT * FROM service_rollups ORDER BY bucket_start`).bind().all())
    .results;

test('E4S1: buckets fold as they complete; refold after a restart is byte-identical', async () => {
  const db = createDatabase(rollupsSchema);
  const { store, touches } = scriptedStore({});
  assert.equal(touches.length, 6); // -1200, -600, 0, +600, +1200, +1800 s
  const first = await runFoldCycle(store, db, config, T0 + 3 * BUCKET_MS, coverage());
  // Buckets from the window clamp up to the newest completed: 7 buckets,
  // of which 4 hold touches (one of them only an anchor, n = 0).
  assert.equal(first.bucketsFolded, 7);
  assert.equal(first.rowsWritten, 4);
  const rowsAfterFirst = await readAll(db);
  assert.equal(rowsAfterFirst.length, 4);
  // A "restart" runs the cycle again at the same time: INSERT OR REPLACE and
  // the deterministic hash mean nothing changes — byte-identical rows.
  const again = await runFoldCycle(store, db, config, T0 + 3 * BUCKET_MS, coverage());
  assert.equal(again.bucketsFolded, 0);
  const rowsAfterAgain = await readAll(db);
  assert.deepEqual(rowsAfterAgain, rowsAfterFirst);
  for (const row of rowsAfterFirst) assert.match(row.fold_hash, /^[0-9a-f]{16}$/);
});

test('E4S4: fold sums equal raw sums — every consecutive pair counted exactly once', async () => {
  const db = createDatabase(rollupsSchema);
  const { store, touches } = scriptedStore({});
  await runFoldCycle(store, db, config, T0 + 3 * BUCKET_MS, coverage());
  // Raw gaps inside the folded span [-1200 s, +900 s):
  // [-1200→-600, -600→0, 0→+600].
  const foldedTouchTimes = touches
    .filter((t) => t.t < T0 + 3 * BUCKET_MS)
    .map((t) => t.t);
  const rawGaps = [];
  for (let index = 1; index < foldedTouchTimes.length; index += 1) {
    rawGaps.push((foldedTouchTimes[index] - foldedTouchTimes[index - 1]) / 1000);
  }
  assert.deepEqual(rawGaps, [600, 600, 600]);
  const raw = moments(rawGaps);
  const rows = await readAll(db);
  assert.equal(rows.length, 4);
  const foldedSum = rows.reduce((total, row) => total + row.headway_sum, 0);
  const foldedSumSq = rows.reduce((total, row) => total + row.headway_sum_sq, 0);
  const foldedN = rows.reduce((total, row) => total + row.n, 0);
  assert.equal(foldedN, raw.n);
  assert.equal(foldedSum, raw.sum);
  assert.equal(foldedSumSq, raw.sumSq);
  assert.equal(cvSquared({ n: foldedN, sum: foldedSum, sumSq: foldedSumSq }), 0);
});

test('E4S4: a 40-minute wound spanning buckets is found via the leading gap', async () => {
  const db = createDatabase(rollupsSchema);
  const { store } = scriptedStore({
    from: T0 - 4 * BUCKET_MS,
    to: T0 + 9 * BUCKET_MS,
    woundAt: T0 + 600_000,
    woundMs: 25 * 60_000,
  });
  // Touches: -1200, -600, 0, then silence until +2400 s — the 40-minute
  // wound the bunched pair dragged behind it.
  await runFoldCycle(store, db, config, T0 + 9 * BUCKET_MS, coverage());
  const rows = await readAll(db);
  const worst = rows.reduce((max, row) => Math.max(max, row.max_gap_seconds), 0);
  assert.ok(worst >= 2300 && worst <= 2500, `expected the ~40-min wound, got ${worst}`);
  // And the endpoint finds it in the merged summary, exactly.
  const response = await serviceHistoryResponse(
    new Request(
      `https://ttcstatus.ca/api/v1/service/history?stop=st_hist&from=${T0 - 12 * BUCKET_MS}`,
    ),
    { DB: db },
    { waitUntil: () => {} },
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.summaries.length, 1);
  assert.ok(
    body.summaries[0].maxGapSeconds >= 2300 && body.summaries[0].maxGapSeconds <= 2500,
  );
  assert.ok(body.bucketSeries.length === 1);
  assert.ok(body.bucketSeries[0].buckets.length >= 1);
});

test('E4S3: the history endpoint merges exactly; filters and validation behave', async () => {
  const db = createDatabase(rollupsSchema);
  const { store } = scriptedStore({});
  await runFoldCycle(store, db, config, T0 + 3 * BUCKET_MS, coverage());
  const response = await serviceHistoryResponse(
    new Request(
      `https://ttcstatus.ca/api/v1/service/history?routes=506&from=${T0 - 9 * BUCKET_MS}`,
    ),
    { DB: db },
    { waitUntil: () => {} },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
  const body = await response.json();
  assert.equal(body.summaries.length, 1);
  // Merged moments from the endpoint match the folded ground truth exactly:
  // clockwork — mean 600 s, CV² 0.
  assert.equal(body.summaries[0].meanHeadwaySeconds, 600);
  assert.equal(body.summaries[0].irregularity, 0);
  assert.deepEqual(body.summaries[0].routeIds, ['506']);
  assert.ok(body.bucketSeries === undefined, 'route queries do not carry bucket series');
  // Unfiltered queries are rejected with guidance (bounded cost by design).
  const unfiltered = await serviceHistoryResponse(
    new Request('https://ttcstatus.ca/api/v1/service/history'),
    { DB: db },
    { waitUntil: () => {} },
  );
  assert.equal(unfiltered.status, 400);
  assert.deepEqual(await unfiltered.json(), { error: 'history-query-required' });
  // A route that folded nothing returns an empty set, not an error.
  const empty = await serviceHistoryResponse(
    new Request(`https://ttcstatus.ca/api/v1/service/history?routes=999&from=${T0}`),
    { DB: db },
    { waitUntil: () => {} },
  );
  assert.equal((await empty.json()).summaries.length, 0);
});

test('E4S2: retention prunes only rows older than the configured history hours', async () => {
  const db = createDatabase(rollupsSchema);
  const { store } = scriptedStore({});
  await runFoldCycle(store, db, config, T0 + 3 * BUCKET_MS, coverage());
  const now = Date.now();
  const staleRow = deriveRollupRow(
    'st_stale',
    Math.floor((now - 37 * 3_600_000) / BUCKET_MS) * BUCKET_MS,
    300,
    [touch('st_stale', now - 37 * 3_600_000)],
    [],
    null,
  );
  await writeRollupRows(db, [staleRow]);
  const before = (await readAll(db)).length;
  // Reset the hourly retention gate so this cycle runs retention on purpose.
  store.saveMeta('retentionCheckedAt', '0');
  const outcome = await runFoldCycle(store, db, config, now, coverage());
  assert.equal(outcome.rowsPruned, 1);
  const after = await readAll(db);
  assert.equal(after.length, before - 1);
  assert.ok(
    after.every((row) => row.bucket_start >= now - config.historyHours * 3_600_000),
  );
});

test('E4S5: a fold-failure is loud and retried — the alarm, not silence', async () => {
  const db = createDatabase(rollupsSchema);
  const { store } = scriptedStore({});
  const failingDb = new Proxy(db, {
    get(target, property) {
      if (property === 'batch') {
        return async () => {
          throw new Error('D1 unavailable');
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await assert.rejects(
    () => runFoldCycle(store, failingDb, config, T0 + 3 * BUCKET_MS, coverage()),
    (error) => {
      assert.ok(error instanceof FoldError, 'a FoldError, loudly');
      assert.match(error.message, /Fold write failed/);
      return true;
    },
  );
  // The marker never advanced, and nothing was written.
  assert.equal((await readAll(db)).length, 0);
  assert.equal(store.loadMeta('foldedThrough'), null);
  // The healed database folds the missed buckets on the next tick: the raw
  // rows were still inside their 30-minute policy window.
  const healed = await runFoldCycle(
    store,
    db,
    config,
    T0 + 3 * BUCKET_MS + 30_000,
    coverage(),
  );
  assert.ok(healed.bucketsFolded >= 1);
  assert.ok((await readAll(db)).length > 0);
});

test('E2S9: rollup-stabilized baselines rescue thin windows; rich windows are unchanged', async () => {
  const cover = coverage();
  // A 15-minute night stop inside a 30-minute window can hold at most two
  // touches — Stage 1 left it collecting. With a stabilized baseline of
  // 900 s, e = 14.5 min is r = 0.967 — due, calm (the doc's own example:
  // the data calms night service itself, now over the long memory).
  const nightTouches = [
    touch('st_night_thin', T0 - 1_770_000),
    touch('st_night_thin', T0 - 870_000),
  ];
  const stabilized = stopServiceState('st_night_thin', nightTouches, cover, {
    windowStart: T0 - 1_800_000,
    at: T0,
    config,
    stabilized: () => ({
      medianSeconds: 900,
      moments: { n: 96, sum: 86_400, sumSq: 77_760_000 },
    }),
  });
  assert.equal(stabilized.state, 'due');
  assert.equal(stabilized.medianHeadwayOwnSeconds, 900);
  assert.ok(Math.abs(stabilized.dryness - 870 / 900) < 1e-9);
  // Without the stabilizer the same window is honestly collecting.
  const unstabilized = stopServiceState('st_night_thin', nightTouches, cover, {
    windowStart: T0 - 1_800_000,
    at: T0,
    config,
  });
  assert.equal(unstabilized.state, 'collecting');
  // Window-rich stops behave identically with or without the upgrade.
  const rich = [
    touch('st_rich', T0 - 1_800_000),
    touch('st_rich', T0 - 1_200_000),
    touch('st_rich', T0 - 600_000),
    touch('st_rich', T0),
  ];
  const withUpgrade = serviceStatesAt(rich, cover, {
    windowStart: T0 - 1_800_000,
    at: T0,
    config,
    stabilized: () => ({
      medianSeconds: 900,
      moments: { n: 96, sum: 86_400, sumSq: 77_760_000 },
    }),
  });
  const without = serviceStatesAt(rich, cover, {
    windowStart: T0 - 1_800_000,
    at: T0,
    config,
  });
  assert.deepEqual(withUpgrade.get('st_rich'), without.get('st_rich'));
});
