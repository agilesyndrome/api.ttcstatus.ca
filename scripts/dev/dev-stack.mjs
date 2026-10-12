#!/usr/bin/env node
// The `make dev` supervisor: it owns the entire dev-stack process tree and
// guarantees that every process spawned beneath it can be stopped, no matter
// how deeply nested (with-secrets → op run → npx → wrangler → workerd) or how
// the supervisor itself dies.
//
// Three mechanisms, each backing up the others:
//
//   1. Process groups. Each Worker is spawned as a session/process-group
//      leader, so `kill(-pgid, signal)` reaches every descendant at once —
//      no signal forwarding required at any intermediate level.
//   2. A lock file (.wrangler/dev-stack.json, gitignored) recording the stack
//      UUID, PIDs and PGIDs. It survives `kill -9` of the supervisor, so the
//      next `make dev` (or `make dev/stop`) can still find and stop a
//      previous stack. Recorded PIDs are only trusted when their environment
//      still carries the stack's tag, so a recycled PID is never killed.
//   3. An environment tag (TTC_DEV_STACK_ID) inherited by every descendant.
//      A /proc sweep finds tagged processes still working inside this
//      checkout and kills them — catching orphans that escaped their process
//      group (double-forks), even when the lock file is gone. The repo
//      scoping means another checkout's dev stack is never touched.
//
// Consequences: `make dev` is idempotent (it stops a previous stack first),
// `make dev/stop` tears the whole tree down on demand, `make dev/status`
// reports what is running, and a Worker that dies during startup is reported
// instead of being papered over by a health check answered by some stale
// server on the same port.
//
// Usage:
//   node scripts/dev/dev-stack.mjs start [apiPort] [--no-bootstrap]
//   node scripts/dev/dev-stack.mjs stop
//   node scripts/dev/dev-stack.mjs status
import { spawn, spawnSync, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lockFile = resolve(root, '.wrangler/dev-stack.json');
const TAG = 'TTC_DEV_STACK_ID';

const [command = 'start', ...rest] = process.argv.slice(2);
const positional = rest.filter((argument) => !argument.startsWith('--'));
const flags = new Set(rest.filter((argument) => argument.startsWith('--')));
const apiPort = Number(positional[0] ?? process.env.API_PORT ?? 8787);

/* ————————————————————————— book-keeping ————————————————————————— */

const readLock = () => {
  try {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    if (lock && Array.isArray(lock.workers) && typeof lock.stackId === 'string')
      return lock;
  } catch {
    /* no lock, or unreadable */
  }
  return null;
};

const writeLock = (lock) => {
  mkdirSync(dirname(lockFile), { recursive: true });
  writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
};

const clearLock = () => {
  try {
    rmSync(lockFile);
  } catch {
    /* already gone */
  }
};

/** Every live process carrying a dev-stack tag: { pid, pgid, stackId }. */
const taggedProcesses = () => {
  const found = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    try {
      const environ = readFileSync(`/proc/${entry}/environ`);
      const start = environ.indexOf(`${TAG}=`);
      if (start < 0) continue;
      const end = environ.indexOf(0, start);
      const stackId = environ.toString('latin1', start + TAG.length + 1, end);
      // The comm field can contain spaces and parens; fields after (comm)
      // start past the last ')'. pgid is the 4th field after it.
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
      const pgid = Number(fields[3]);
      found.push({ pid, pgid, stackId });
    } catch {
      /* process exited, or not ours to read */
    }
  }
  return found;
};

/** Tagged processes that still work inside this checkout — a stack-less
 * orphan (lock lost, supervisor SIGKILLed) is found this way; another
 * checkout's stack never is. */
const repoStackProcesses = () =>
  taggedProcesses().filter((entry) => {
    try {
      return readlinkSync(`/proc/${entry.pid}/cwd`).startsWith(`${root}/`);
    } catch {
      return false;
    }
  });

/** TERM first, KILL after a grace period; signal the whole process group of
 * every target as well as each target itself. */
const terminate = async (targets) => {
  if (!targets.length) return;
  const groups = new Set(targets.map((target) => target.pgid).filter((pgid) => pgid > 0));
  const signalAll = (signal) => {
    for (const target of targets) {
      try {
        process.kill(target.pid, signal);
      } catch {
        /* already gone */
      }
    }
    for (const pgid of groups) {
      try {
        process.kill(-pgid, signal);
      } catch {
        /* group already gone */
      }
    }
  };
  signalAll('SIGTERM');
  const alive = () => taggedProcesses().some((p) => targets.some((t) => t.pid === p.pid));
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && alive()) await sleep(100);
  if (alive()) signalAll('SIGKILL');
};

/** Stop the stack recorded in the lock (if its processes still carry the
 * recorded stack's tag — recycled PIDs are never trusted) plus any tagged
 * orphan of this repo. Returns how many processes were stopped. */
const stopRecordedStack = async () => {
  let stopped = 0;
  const lock = readLock();
  if (lock) {
    const recorded = taggedProcesses().filter((p) => p.stackId === lock.stackId);
    if (recorded.length) {
      console.log(
        `Stopping previous dev stack (started ${lock.startedAt}, ${recorded.length} process(es))…`,
      );
      await terminate(recorded);
      stopped += recorded.length;
    }
    clearLock();
  }
  const orphans = repoStackProcesses();
  if (orphans.length) {
    console.log(
      `Stopping ${orphans.length} orphaned dev-stack process(es) from this checkout…`,
    );
    await terminate(orphans);
    stopped += orphans.length;
  }
  return stopped;
};

/** Bind-probe a port (SO_REUSEADDR, like a real server) — the only test that
 * sees holders invisible to `ss`, such as a bound-but-not-listening socket
 * left by a half-restarted wrangler/workerd. */
const bindable = (port) =>
  new Promise((resolve) => {
    const server = createServer();
    const watchdog = setTimeout(() => {
      try {
        server.close();
      } catch {
        /* already closed */
      }
      resolve(false);
    }, 5_000);
    server.once('error', () => {
      clearTimeout(watchdog);
      try {
        server.close();
      } catch {
        /* already closed */
      }
      resolve(false);
    });
    server.listen(port, '0.0.0.0', () => {
      clearTimeout(watchdog);
      server.close(() => resolve(true));
    });
  });

const portHolders = (port) => {
  try {
    return execSync(`ss -ltnp 2>/dev/null | grep -E ":${port}\\b"`, {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
};

const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { stdio: 'inherit', cwd: root, ...options });
  if (result.status !== 0) {
    console.error(
      `dev-stack: \`${file} ${args.join(' ')}\` failed (${result.status ?? 'signal'})`,
    );
    process.exit(1);
  }
};

/* ——————————————————————————— commands ——————————————————————————— */

const stop = async () => {
  const stopped = await stopRecordedStack();
  console.log(stopped ? 'Dev stack stopped.' : 'No dev stack is running.');
};

const status = () => {
  const lock = readLock();
  if (!lock) console.log('No dev stack is recorded for this checkout.');
  else {
    console.log(`Dev stack ${lock.stackId} (started ${lock.startedAt}):`);
    for (const worker of lock.workers) {
      const alive = taggedProcesses().some(
        (p) => p.pid === worker.pid && p.stackId === lock.stackId,
      );
      console.log(
        `  ${worker.name}: pid ${worker.pid} (process group ${worker.pgid}) — ${alive ? 'running' : 'exited'}`,
      );
    }
  }
  const orphans = repoStackProcesses();
  if (orphans.length)
    console.log(`${orphans.length} tagged process(es) alive from this checkout.`);
};

const start = async () => {
  // ——— Clean slate: stop any previous stack of this checkout, then confirm
  //      the pinned ports can actually be bound. ———
  await stopRecordedStack();
  // The inspector ports matter as much as the entry ports: `wrangler dev`
  // otherwise binds the fixed default 127.0.0.1:9229 for devtools in every
  // instance, so two Workers started together race for it — the loser dies
  // with workerd's fatal "bind(): Address already in use". Each Worker gets
  // its own (entry port + 200).
  const apiInspectorPort = apiPort + 200;
  for (const port of [apiPort, apiInspectorPort]) {
    let ready = false;
    for (let attempt = 0; attempt < 5 && !ready; attempt += 1) {
      ready = await bindable(port);
      if (!ready) await sleep(1000);
    }
    if (!ready) {
      console.error(`ERROR: port ${port} cannot be bound (already in use).`);
      const holders = portHolders(port);
      if (holders) console.error(holders);
      else
        console.error(
          'No listener is shown — the port is held by a bound-but-silent socket, often a half-restarted wrangler/workerd from an earlier dev session.',
        );
      console.error(
        "Stop the old server first (ps aux | grep -E 'wrangler|workerd' — kill both the wrangler and its workerd), then re-run: make dev",
      );
      process.exit(1);
    }
  }

  // ——— Build and migrate before spawning anything. ———
  run('npm', ['run', '--silent', 'build:ui']);
  run('npm', ['run', '--silent', 'build:viewer']);
  run('npm', ['run', '--silent', 'dev:headers']);
  run('npm', ['run', '--silent', 'db:migrate:local']);

  // ——— Spawn the Workers: each is a session/process-group leader carrying
  //      the stack tag, so the whole descendant tree is one kill(-pgid) away.
  //      Killing this supervisor outright leaves the lock file behind, and
  //      the next start (or `make dev/stop`) still finds the tree via the tag.
  const stackId = randomUUID();
  const workers = [];
  let shuttingDown = false;
  const killStack = async () => {
    shuttingDown = true;
    await terminate(taggedProcesses().filter((p) => p.stackId === stackId));
    clearLock();
  };
  const spawnWorker = (name, args) => {
    const child = spawn('node', ['scripts/dev/with-secrets.mjs', ...args], {
      cwd: root,
      stdio: 'inherit',
      detached: true,
      env: { ...process.env, [TAG]: stackId },
    });
    workers.push({ name, pid: child.pid, pgid: child.pid, exited: null });
    child.on('exit', (code, signal) => {
      const worker = workers.find((entry) => entry.pid === child.pid);
      if (worker) worker.exited = { code, signal };
      // A Worker dying while the stack is meant to be running takes the whole
      // stack down — loudly, instead of leaving a half-alive dev server.
      if (!shuttingDown) {
        console.error(
          `ERROR: the ${name} Worker exited (code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}) — its output is above. Stopping the rest of the dev stack.`,
        );
        void killStack().then(() => process.exit(1));
      }
    });
    return child;
  };

  spawnWorker('api', [
    'npx',
    'wrangler',
    'dev',
    '-c',
    'workers/api/wrangler.jsonc',
    '--port',
    String(apiPort),
    '--inspector-port',
    String(apiInspectorPort),
    '--test-scheduled',
  ]);
  // Single worker since Epic 7 (docs/optimize-transport.md): map generation
  // runs in-process inside the API Worker — there is no second stack entry.
  writeLock({
    version: 1,
    stackId,
    startedAt: new Date().toISOString(),
    workers: workers.map(({ name, pid, pgid }) => ({ name, pid, pgid })),
  });

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(signal, () => {
      console.log(`dev-stack: ${signal} received — stopping the dev stack…`);
      void killStack().then(() => process.exit(0));
    });

  // ——— Wait for the API Worker to answer health checks. ———
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (workers.some((worker) => worker.exited)) {
      // The exit handler already reported and scheduled the shutdown.
      await sleep(3_500);
      process.exit(1);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/healthz`);
      if (response.ok && (await response.json()).worker === 'ttcstatus-api') break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      console.error(
        'ERROR: the API Worker did not answer /api/healthz in time — see its output above.',
      );
      await killStack();
      process.exit(1);
    }
    await sleep(500);
  }
  console.log(
    `Dev stack ready: api on http://localhost:${apiPort} (single worker — map generation runs in-process)`,
  );

  if (!flags.has('--no-bootstrap')) {
    const bootstrap = spawnSync('make', ['--no-print-directory', 'dev/bootstrap'], {
      stdio: 'inherit',
      cwd: root,
      env: { ...process.env, API_PORT: String(apiPort) },
    });
    if (bootstrap.status !== 0)
      console.error(
        'dev/bootstrap failed — see its error above (if the Workers died, restart: make dev; otherwise fix the source and re-run: make dev/bootstrap)',
      );
  }

  // ——— Say it plainly when accounts are not configured. ———
  try {
    const { enabled } = await (
      await fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/config`)
    ).json();
    if (enabled !== true) {
      console.log('');
      console.log(
        'Accounts are DISABLED on this dev stack (the map itself is unaffected):',
      );
      const references = existsSync(resolve(root, '.env.local'))
        ? /^CLERK_PUBLISHABLE_KEY=.*op:\/\//m.test(
            readFileSync(resolve(root, '.env.local'), 'utf8'),
          )
        : false;
      if (references) {
        console.log(
          '  .env.local stores the Clerk keys as 1Password (op://) references and they did not resolve.',
        );
        console.log(
          '  Unlock 1Password / sign in (op signin) and restart make dev — or paste literal',
        );
        console.log('  development keys (pk_test_… / sk_test_…) into .env.local.');
      } else {
        console.log(
          '  .env.local has no usable CLERK_PUBLISHABLE_KEY/CLERK_SECRET_KEY pair (pk_test_…/sk_test_…).',
        );
      }
    }
  } catch {
    /* the config endpoint will surface its own errors in the browser */
  }

  // ——— Stay in the foreground until the Workers stop. ———
  await new Promise((resolveWait) => {
    const check = setInterval(() => {
      if (workers.every((worker) => worker.exited)) {
        clearInterval(check);
        resolveWait();
      }
    }, 250);
  });
  clearLock();
};

if (command === 'stop') await stop();
else if (command === 'status') status();
else if (command === 'start') await start();
else {
  console.error(
    'usage: node scripts/dev/dev-stack.mjs start|stop|status [ports] [--no-bootstrap]',
  );
  process.exit(2);
}
