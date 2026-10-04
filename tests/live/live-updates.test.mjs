import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: `
  export * from "./shared/live/polling";
  export * from "./shared/live/config";
  export * from "./workers/api/src/realtime/vehicle-snapshot-cache";`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
});
const {
  VehiclePoller,
  LiveUpdateError,
  requestVehicleUpdate,
  liveUpdateSeconds,
  VehicleSnapshotCache,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const snapshot = {
  schemaVersion: 1,
  fetchedAt: '2026-10-03T21:00:00Z',
  feedTimestamp: '2026-10-03T21:00:00Z',
  source: 'fixture',
  attribution: '',
  vehicles: [],
  invalidPositions: 0,
};
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

// Advance virtual time: production's 30–300s limits remain intact in tests.
class Clock {
  time = 0;
  id = 0;
  timers = new Map();
  now = () => this.time;
  setTimer = (callback, delay) => {
    const id = ++this.id;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  };
  clearTimer = (id) => this.timers.delete(id);
  async tick(ms) {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.timers]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    this.time = target;
    await flush();
  }
}
function harness(request) {
  const clock = new Clock(),
    snapshots = [],
    statuses = [];
  const poller = new VehiclePoller({
    request,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onSnapshot: (value) => snapshots.push(value),
    onStatus: (value) => statuses.push(value),
  });
  return { clock, poller, snapshots, statuses };
}

test('one interval setting accepts 30 seconds to five minutes and safely defaults invalid values', () => {
  for (const value of [30, '45', '60', '300', 300])
    assert.equal(liveUpdateSeconds(value), Number(value));
  for (const value of [undefined, null, '', 0, 1, 29, 301, 30.5, 'broken', Infinity])
    assert.equal(liveUpdateSeconds(value), 30);
});
test("default timer functions preserve the browser's global receiver", async () => {
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout,
    clock = new Clock();
  try {
    globalThis.setTimeout = function (callback, delay) {
      assert.ok(
        this === undefined || this === globalThis,
        'setTimeout received a poller as this',
      );
      return clock.setTimer(callback, delay);
    };
    globalThis.clearTimeout = function (timer) {
      assert.ok(
        this === undefined || this === globalThis,
        'clearTimeout received a poller as this',
      );
      return clock.clearTimer(timer);
    };
    let calls = 0;
    const poller = new VehiclePoller({
      request: async () => {
        calls++;
        return { snapshot, updateSeconds: 30 };
      },
      now: clock.now,
      onSnapshot() {},
      onStatus() {},
    });
    await poller.refreshOnce();
    poller.setActive(true);
    await clock.tick(30000);
    assert.equal(calls, 2);
    poller.dispose();
    assert.equal(clock.timers.size, 0);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});
test('startup takes one snapshot; active updates use ETags at the server interval', async () => {
  const etags = [];
  const { clock, poller, snapshots } = harness(async (_signal, etag) => {
    etags.push(etag);
    return { snapshot, etag: '"fleet"', updateSeconds: 30 };
  });
  await poller.refreshOnce();
  assert.equal(snapshots.length, 1);
  assert.equal(clock.timers.size, 0);
  poller.setActive(true);
  await clock.tick(29999);
  assert.equal(snapshots.length, 1);
  await clock.tick(1);
  assert.equal(snapshots.length, 2);
  assert.deepEqual(etags, [undefined, '"fleet"']);
  poller.dispose();
  assert.equal(clock.timers.size, 0);
});
test('server can change cadence to five minutes without a browser rebuild', async () => {
  let calls = 0;
  const { clock, poller } = harness(async () => ({
    snapshot,
    etag: String(++calls),
    updateSeconds: calls === 1 ? 300 : 30,
  }));
  await poller.refreshOnce();
  poller.setActive(true);
  await clock.tick(299999);
  assert.equal(calls, 1);
  await clock.tick(1);
  assert.equal(calls, 2);
  await clock.tick(30000);
  assert.equal(calls, 3);
  poller.dispose();
});
test('clients join the shared cache expiry rather than repeatedly polling a nearly-expired snapshot', async () => {
  let calls = 0;
  const { clock, poller } = harness(async () => ({
    snapshot,
    updateSeconds: 30,
    nextUpdateAt: ++calls === 1 ? 12000 : 42000,
  }));
  await poller.refreshOnce();
  poller.setActive(true);
  await clock.tick(11999);
  assert.equal(calls, 1);
  await clock.tick(1);
  assert.equal(calls, 2);
  poller.dispose();
});
test('pausing stops requests; returning to an overdue page refreshes immediately', async () => {
  let calls = 0;
  const { clock, poller } = harness(async () => {
    calls++;
    return { snapshot, updateSeconds: 30 };
  });
  await poller.refreshOnce();
  poller.setActive(true);
  poller.setActive(false);
  await clock.tick(300000);
  assert.equal(calls, 1);
  poller.setActive(true);
  await clock.tick(0);
  assert.equal(calls, 2);
  poller.dispose();
});
test('a slow request never overlaps another refresh', async () => {
  let resolve,
    calls = 0;
  const { clock, poller } = harness(() => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  });
  poller.setActive(true);
  await clock.tick(0);
  await clock.tick(10000);
  assert.equal(calls, 1);
  resolve({ snapshot, updateSeconds: 30 });
  await flush();
  await clock.tick(29999);
  assert.equal(calls, 1);
  await clock.tick(1);
  assert.equal(calls, 2);
  poller.dispose();
  resolve({ snapshot, updateSeconds: 30 });
  await flush();
});
test('pause aborts pending fetches silently and permits a fresh request on resume', async () => {
  let calls = 0,
    signal;
  const { clock, poller, statuses } = harness((s) => {
    signal = s;
    calls++;
    return new Promise((_resolve, reject) =>
      s.addEventListener('abort', () => reject(s.reason)),
    );
  });
  poller.setActive(true);
  await clock.tick(0);
  poller.setActive(false);
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(statuses.length, 0);
  assert.equal(clock.timers.size, 0);
  poller.setActive(true);
  await clock.tick(0);
  assert.equal(calls, 2);
  poller.dispose();
  await flush();
});
test('failures retain snapshots, back off to five minutes, then reset after recovery', async () => {
  let calls = 0;
  const { clock, poller, snapshots, statuses } = harness(async () => {
    calls++;
    if (calls >= 2 && calls <= 6) throw new Error('offline');
    return { snapshot, updateSeconds: 30 };
  });
  await poller.refreshOnce();
  poller.setActive(true);
  for (const delay of [30000, 30000, 60000, 120000, 240000, 300000])
    await clock.tick(delay);
  assert.equal(calls, 7);
  assert.equal(snapshots.length, 2);
  assert.deepEqual(
    statuses.filter((s) => s.failed).map((s) => s.retrySeconds),
    [30, 60, 120, 240, 300],
  );
  await clock.tick(30000);
  assert.equal(calls, 8);
  poller.dispose();
});
test('timeouts report a failure and schedule another attempt', async () => {
  const { clock, poller, statuses } = harness(
    (signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      ),
  );
  poller.setActive(true);
  await clock.tick(0);
  await clock.tick(15000);
  assert.equal(statuses[0].failed, true);
  assert.equal(statuses[0].retrySeconds, 30);
  poller.dispose();
});
test('304 avoids replacing/projecting identical observations and clears previous errors', async () => {
  let calls = 0;
  const { clock, poller, snapshots, statuses } = harness(async () => {
    calls++;
    if (calls === 2) throw new Error('temporary');
    return {
      snapshot: calls === 1 ? snapshot : undefined,
      etag: '"fleet"',
      updateSeconds: 30,
    };
  });
  await poller.refreshOnce();
  poller.setActive(true);
  await clock.tick(60000);
  assert.equal(snapshots.length, 1);
  assert.equal(statuses.at(-1).failed, false);
  poller.dispose();
});
test('HTTP transport bypasses browser caching and handles 304 and retry/config headers', async () => {
  const original = globalThis.fetch;
  let options;
  try {
    globalThis.fetch = async (_url, opts) => {
      options = opts;
      return new Response(null, {
        status: 304,
        headers: { etag: '"fleet"', 'x-live-update-seconds': '300' },
      });
    };
    const result = await requestVehicleUpdate(
      'fixture',
      new AbortController().signal,
      '"fleet"',
    );
    assert.equal(result.snapshot, undefined);
    assert.equal(result.updateSeconds, 300);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['if-none-match'], '"fleet"');
    await assert.rejects(
      requestVehicleUpdate('fixture', new AbortController().signal),
      /previous snapshot/,
    );
    globalThis.fetch = async () =>
      new Response('down', {
        status: 503,
        headers: { 'x-live-update-seconds': '300', 'retry-after': '300' },
      });
    await assert.rejects(
      requestVehicleUpdate('fixture', new AbortController().signal),
      (e) =>
        e instanceof LiveUpdateError &&
        e.updateSeconds === 300 &&
        e.retryAfterSeconds === 300,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('shared acquisition coalesces simultaneous viewers and refreshes only after configured expiry', async () => {
  let calls = 0,
    time = 0,
    resolve;
  const store = new VehicleSnapshotCache(
    'fixture',
    '',
    30,
    () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    },
    () => time,
  );
  const first = store.get(),
    second = store.get();
  assert.equal(calls, 1);
  assert.equal(first, second);
  resolve(snapshot);
  const a = await first;
  await second;
  assert.equal(a.nextUpdateAt, 30000);
  time = 29999;
  assert.equal((await store.get()).etag, a.etag);
  assert.equal(calls, 1);
  time = 30000;
  const next = store.get();
  assert.equal(calls, 2);
  resolve({ ...snapshot, fetchedAt: 'later' });
  assert.equal(
    (await next).etag,
    a.etag,
    'acquisition time does not invalidate identical observations',
  );
});
test('shared acquisition throttles failures across viewers and recovers after cooldown', async () => {
  let calls = 0,
    time = 0;
  const store = new VehicleSnapshotCache(
    'fixture',
    '',
    300,
    async () => {
      calls++;
      if (calls === 1) throw new Error('upstream down');
      return snapshot;
    },
    () => time,
  );
  await assert.rejects(store.get(), /upstream down/);
  await assert.rejects(store.get(), /upstream down/);
  assert.equal(calls, 1);
  time = 300000;
  assert.equal((await store.get()).snapshot, snapshot);
  assert.equal(calls, 2);
});

test('100 simultaneous viewers share one upstream acquisition per refresh interval', async () => {
  let calls = 0,
    time = 0,
    release;
  const store = new VehicleSnapshotCache(
    'hundred-viewers',
    '',
    30,
    () => {
      calls++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    () => time,
  );
  const first = Array.from({ length: 100 }, () => store.get());
  assert.equal(calls, 1);
  release(snapshot);
  const results = await Promise.all(first);
  assert.ok(results.every((result) => result === results[0]));
  await Promise.all(Array.from({ length: 100 }, () => store.get()));
  assert.equal(calls, 1);
  time = 30_000;
  const next = Array.from({ length: 100 }, () => store.get());
  assert.equal(calls, 2);
  release(snapshot);
  await Promise.all(next);
});
