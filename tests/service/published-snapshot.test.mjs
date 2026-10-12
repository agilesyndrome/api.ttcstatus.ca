import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { compileModules } from '../helpers/compile.mjs';

const { SnapshotPublisher, RecorderSnapshotStore } = await compileModules(`
  export { SnapshotPublisher } from './workers/api/src/service/published-snapshot';
  export { RecorderSnapshotStore } from './workers/api/src/service/snapshot-store';
`);
const snapshot = {
  schemaVersion: 1,
  fetchedAt: '2026-10-12T17:00:00.000Z',
  feedTimestamp: null,
  source: 'fixture',
  attribution: '',
  vehicles: [],
  invalidPositions: 0,
  surfaceStatus: 'available',
  subwayStatus: 'unavailable',
  subwayPredictions: [],
};

function sqliteStorage(sqlite) {
  return {
    sql: {
      exec: (query, ...values) => {
        const rows = sqlite.prepare(query).all(...values);
        return { toArray: () => rows };
      },
    },
    transactionSync(callback) {
      sqlite.exec('BEGIN');
      try {
        const value = callback();
        sqlite.exec('COMMIT');
        return value;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('alarms, concurrent consumers, and an evicted recorder share persisted acquisitions and outage cooldowns', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const store = new RecorderSnapshotStore(sqliteStorage(sqlite));
    let time = 0,
      calls = 0,
      unavailable = false;
    const acquire = async () => {
      calls++;
      if (unavailable) throw new Error('upstream');
      return { ...snapshot, fetchedAt: new Date(time).toISOString() };
    };
    const owner = new SnapshotPublisher(store, acquire, 'feed-config', 30, () => time);
    const results = await Promise.all(Array.from({ length: 100 }, () => owner.get()));
    assert.equal(calls, 1);
    assert.equal(results[0].nextUpdateAt, 30000);
    assert.equal(results[0].snapshot.subwayStatus, 'unavailable');
    const restarted = new SnapshotPublisher(
      new RecorderSnapshotStore(sqliteStorage(sqlite)),
      acquire,
      'feed-config',
      30,
      () => time,
    );
    assert.equal((await restarted.get()).etag, results[0].etag);
    assert.equal(calls, 1);
    time = 30000;
    assert.equal((await restarted.get()).etag, results[0].etag);
    assert.equal(calls, 2);
    time = 60000;
    unavailable = true;
    assert.equal((await restarted.get()).snapshot, null);
    await Promise.all(Array.from({ length: 100 }, () => restarted.get()));
    assert.equal(calls, 3);
    time = 90000;
    unavailable = false;
    assert.equal((await restarted.get()).etag, results[0].etag);
    assert.equal(calls, 4);
    const changed = new SnapshotPublisher(store, acquire, 'new-feed', 30, () => time);
    await changed.get();
    assert.equal(calls, 5);
  } finally {
    sqlite.close();
  }
});

test('snapshot publication chunks large fleets atomically and restores them after a failed write', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const storage = sqliteStorage(sqlite);
    const store = new RecorderSnapshotStore(storage);
    const publication = {
      configKey: 'test',
      snapshot: { ...snapshot, attribution: 'x'.repeat(700000) },
      etag: 'fleet',
      checkedAt: 0,
      nextUpdateAt: 30000,
    };
    store.write(publication);
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS n FROM published_snapshot').get().n,
      3,
    );
    assert.deepEqual(store.read(), publication);
    const exec = storage.sql.exec;
    storage.sql.exec = (query, ...values) => {
      if (query.startsWith('INSERT') && values[0] === 1)
        throw new Error('storage failed');
      return exec(query, ...values);
    };
    assert.throws(() => store.write({ ...publication, etag: 'new' }), /storage failed/);
    assert.deepEqual(store.read(), publication);
  } finally {
    sqlite.close();
  }
});
