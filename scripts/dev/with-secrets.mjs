#!/usr/bin/env node
// Runs a development command with `.env.local` secrets resolved.
//
// The repo's `.env.local` stores secrets as `op://` (1Password) references.
// The dev commands (`npm run dev:viewer`, `dev:api`, `dev:map`, `make dev`)
// run through this wrapper so every entry point behaves the same:
//
//   - `.env.local` absent, or free of `op://` references → run as-is. A
//     contributor can paste literal `pk_test_…`/`sk_test_…` development keys
//     (or any other literal values) straight into `.env.local` and everything
//     works with no 1Password at all.
//   - references present and the 1Password CLI is available (`op whoami`
//     succeeds — it triggers the usual biometric prompt, so the probe waits)
//     → run through `op run --env-file=.env.local`, exactly like the old
//     Makefile did.
//   - references present but 1Password cannot resolve them (locked, signed
//     out, headless CI) → print one warning and run anyway with the *literal*
//     values from `.env.local` injected into the child environment: the map
//     keeps working, and any literal Clerk keys still reach the preview
//     middleware. Accounts whose values are unresolved `op://` references stay
//     disabled (`/api/v1/auth/config` reports `publishableKey: null`) until a
//     key resolves.
//
// Usage (from the repo root, via the npm dev scripts):
//   node scripts/dev/with-secrets.mjs <command> [args…]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// DEV_ENV_FILE (a path relative to the repo root) exists only so the wrapper's
// file handling can be tested against a fixture without touching .env.local.
const envFile = resolve(root, process.env.DEV_ENV_FILE || '.env.local');
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('usage: node scripts/dev/with-secrets.mjs <command> [args…]');
  process.exit(2);
}

/** One KEY=VALUE per line; only the presence of op:// references matters. */
const referencesSecretManager = () => {
  if (!existsSync(envFile)) return false;
  return /^\s*[\w.-]+\s*=\s*(["']?)op:\/\//m.test(readFileSync(envFile, 'utf8'));
};

/** Literal (non-`op://`) KEY=VALUE pairs from the env file, quotes stripped.
 * Only injects keys the child does not already carry, so a real environment
 * always wins over the file. */
const literalValues = () => {
  const values = {};
  if (!existsSync(envFile)) return values;
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    if (value && !value.startsWith('op://')) values[match[1]] = value;
  }
  return values;
};

/** The child environment is trimmed to what a dev command plausibly needs:
 * tooling paths, locale, proxies, the 1Password session (so `op run` itself
 * can authenticate) and Cloudflare/Wrangler/npm configuration. Two reasons:
 * `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` forwards the whole child environment
 * into the Worker bindings — a full desktop shell would both flood the
 * startup banner with a hundred irrelevant `env.X` lines and leak unrelated
 * secrets (API keys, agent sockets) into the sandbox. The `.env.local` values
 * always ride along on top of this. */
const ENV_PASSTHROUGH = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'TZ',
  'TMPDIR',
  'PWD',
  'NODE_OPTIONS',
  'NODE_PATH',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  // The dev-stack supervisor's tag: every descendant must keep carrying it so
  // `make dev/stop` and the next `make dev` can find and kill the whole tree.
  'TTC_DEV_STACK_ID',
];
const ENV_PREFIXES = ['LC_', 'OP_', 'XDG_', 'CLOUDFLARE_', 'WRANGLER_', 'npm_'];
const childEnv = () => {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      ENV_PASSTHROUGH.includes(key) ||
      ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    )
      env[key] = value;
  }
  return env;
};

const run = (file, argv, extraEnv = {}) => {
  const child = spawn(file, argv, {
    stdio: 'inherit',
    cwd: root,
    env: { ...childEnv(), ...extraEnv },
  });
  // Forward the wrapper's termination signals. `make dev`'s cleanup trap
  // kills this wrapper by PID; without forwarding, the child chain (op run →
  // wrangler → workerd) would be orphaned and keep holding its ports — the
  // very "stale dev server" this stack guards against.
  let terminated = false;
  const forward = (signal) => {
    terminated = true;
    child.kill(signal);
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'])
    process.on(signal, () => forward(signal));
  child.on('close', (code, signal) => {
    // 128+N is the conventional exit status for termination by signal N.
    if (signal ?? terminated) process.exit(128);
    process.exit(code ?? 0);
  });
};

if (!referencesSecretManager()) {
  // No references (or no file): the literals still deserve to reach the child
  // (Vite's preview middleware reads process.env; Wrangler loads the file
  // itself either way).
  run(command, args, literalValues());
} else {
  // Probe 1Password the same way the real run resolves: `op run` with a
  // no-op command that exits with a sentinel code. `op whoami` cannot be the
  // gate — it reports "not signed in" while the 1Password desktop-app
  // integration (or a session for a non-default account) still resolves
  // `op://` references perfectly, and vice versa. Exit 77 means 1Password
  // resolved the file AND executed the no-op — the exact machinery the real
  // command will use. Anything else (locked, signed out, denied prompt,
  // missing binary, timeout) falls back to the literal values below.
  const probe = spawnSync(
    'op',
    ['run', '--env-file', envFile, '--', process.execPath, '-e', 'process.exit(77)'],
    { stdio: 'ignore', timeout: 45_000 },
  );
  if (probe.error || probe.status !== 77) {
    console.warn(
      `⚠ .env.local holds 1Password (op://) secret references, but they could not be resolved ${
        probe.error
          ? `(${probe.error.code ?? probe.error.message})`
          : '(the op run probe failed)'
      }.`,
    );
    console.warn(
      '  Starting without those secrets — Clerk accounts stay disabled in dev',
    );
    console.warn('  (/api/v1/auth/config returns publishableKey: null).');
    console.warn(
      '  Unlock 1Password / approve the prompt / sign in (`op signin`) and restart, or paste',
    );
    console.warn('  literal development keys (pk_test_… / sk_test_…) into .env.local.');
    run(command, args, literalValues());
  } else {
    // Proven: resolution works — run the real command through it.
    run('op', ['run', '--env-file', envFile, '--', command, ...args]);
  }
}
