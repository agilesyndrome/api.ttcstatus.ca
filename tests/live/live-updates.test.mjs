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
  requestTickUpdate,
  liveTickUrl,
  liveUpdateSeconds,
  parseLiveTransportConfig,
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
test('a shorter cadence from config reschedules the next poll earlier', async () => {
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
test('an unpublished tick keeps the last-good snapshot without backing off', async () => {
  let calls = 0;
  const { clock, poller, snapshots, statuses } = harness(async () => {
    calls++;
    return calls === 1
      ? { snapshot, etag: '"tick-1"', updateSeconds: 30 }
      : { updateSeconds: 30, unpublished: true };
  });
  await poller.refreshOnce();
  poller.setActive(true);
  await clock.tick(30000);
  assert.equal(calls, 2);
  assert.equal(snapshots.length, 1, 'last-good snapshot stands');
  assert.equal(statuses.at(-1).failed, false, 'unpublished is not a failure');
  // Retries at the normal cadence — not an error backoff.
  await clock.tick(30000);
  assert.equal(calls, 3);
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
test('tick transport implements exactly the three-case contract (200, 404→tick−1, network)', async () => {
  const transport = parseLiveTransportConfig({
    live: {
      base: 'https://live.example.ca',
      pathTemplate: '/live/t/{tick}/vehicles.json',
      updateSeconds: 30,
    },
  });
  assert.equal(
    liveTickUrl(transport, 42),
    'https://live.example.ca/live/t/42/vehicles.json',
  );
  const original = globalThis.fetch;
  const seen = [];
  // A controlled clock: the device sits inside tick 43 (skew scenario).
  const now = () => 43 * 30_000 + 1000;
  try {
    // 200 → use the document (outage included — it is a body field).
    globalThis.fetch = async (url, opts) => {
      seen.push([url, opts]);
      return new Response(JSON.stringify({ ...snapshot, tickId: 43 }), {
        status: 200,
        headers: { etag: '"tick-43"' },
      });
    };
    const result = await requestTickUpdate(
      transport,
      new AbortController().signal,
      undefined,
      undefined,
      now,
    );
    assert.equal(result.snapshot.tickId, 43);
    assert.equal(result.etag, '"tick-43"');
    assert.equal(result.updateSeconds, 30);
    assert.equal(seen.at(-1)[1].cache, 'no-store');
    // 304 → same-tick refetch costs no body; ETag retained.
    globalThis.fetch = async () =>
      new Response(null, { status: 304, headers: { etag: '"tick-43"' } });
    const same = await requestTickUpdate(
      transport,
      new AbortController().signal,
      '"tick-43"',
      undefined,
      now,
    );
    assert.equal(same.snapshot, undefined);
    assert.equal(same.etag, '"tick-43"');
    // 404 → unpublished tick → retry tick−1 once.
    let currentTick = 43;
    globalThis.fetch = async (url) => {
      const tick = Number(/\/live\/t\/(\d+)\//.exec(url)[1]);
      if (tick >= currentTick) return new Response('not yet', { status: 404 });
      return new Response(JSON.stringify({ ...snapshot, tickId: tick }), {
        status: 200,
        headers: { etag: `"tick-${tick}"` },
      });
    };
    const skewed = await requestTickUpdate(
      transport,
      new AbortController().signal,
      undefined,
      undefined,
      now,
    );
    assert.equal(skewed.snapshot.tickId, 42, 'falls back to the previous tick once');
    // 404 twice → unpublished: keep last-good, next scheduled poll retries.
    currentTick = 42;
    const unpublished = await requestTickUpdate(
      transport,
      new AbortController().signal,
      undefined,
      undefined,
      now,
    );
    assert.equal(unpublished.unpublished, true);
    assert.equal(unpublished.snapshot, undefined);
    // Any other status (5xx included) is a plain network failure — the
    // caller's backoff owns it; there is no 5xx/Retry-After parsing.
    globalThis.fetch = async () => new Response('down', { status: 503 });
    await assert.rejects(
      requestTickUpdate(
        transport,
        new AbortController().signal,
        undefined,
        undefined,
        now,
      ),
      /HTTP 503/,
    );
    // 304 without a previous ETag is a contract violation, not a no-op.
    globalThis.fetch = async () =>
      new Response(null, { status: 304, headers: { etag: '"x"' } });
    await assert.rejects(
      requestTickUpdate(
        transport,
        new AbortController().signal,
        undefined,
        undefined,
        now,
      ),
      /previous snapshot/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('live transport config parses defensively: no fallback URL is ever invented', () => {
  const good = parseLiveTransportConfig({
    live: {
      base: 'https://live.ttcstatus.ca',
      pathTemplate: '/live/t/{tick}/vehicles.json',
      updateSeconds: '45',
      extra: 'ignored',
    },
  });
  assert.equal(good.updateSeconds, 45);
  // Same-origin base ('') is valid (local preview); HTTP is not.
  assert.equal(
    parseLiveTransportConfig({
      live: { base: '', pathTemplate: '/live/t/{tick}/vehicles.json' },
    }).base,
    '',
  );
  for (const bad of [
    null,
    {},
    { live: null },
    { live: { base: 7, pathTemplate: '/live/t/{tick}/vehicles.json' } },
    {
      live: {
        base: 'http://insecure.example',
        pathTemplate: '/live/t/{tick}/vehicles.json',
      },
    },
    { live: { base: 'https://x', pathTemplate: '/api/v1/vehicles/streetcar' } },
  ])
    assert.throws(() => parseLiveTransportConfig(bad));
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
