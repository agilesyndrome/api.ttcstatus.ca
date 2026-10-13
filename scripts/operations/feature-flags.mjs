/** Per-user feature-flag CLI (sla-epics.md §0B; sla.md §4.7):
 *
 *   npm run feature:enable -- betaFeature drew@easleyowl.com
 *   npm run feature:enable:local -- betaFeature user_local
 *   npm run feature:disable -- betaFeature drew@easleyowl.com
 *   npm run feature:list
 *
 * The subject is the Clerk user id — the Stage 0 spike (E5S1) confirmed the
 * server can only verify user ids server-side, so emails can't be the primary
 * key. The CLI still accepts either: an email argument is resolved to the
 * Clerk user id via the Backend API when CLERK_SECRET_KEY is available.
 * Emails churn; user ids don't. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = () => {
  console.log(`Grant, revoke, and list per-user feature flags.

Usage:
  npm run feature:enable[:local] -- <flag> <subject> [--by <operator>]
  npm run feature:disable[:local] -- <flag> <subject>
  npm run feature:list[:local]

The :local commands use the same D1 state as make dev. Other commands use
the remote production D1. Add --json for machine-readable output; tables are
shown by default. The Node CLI also accepts --local directly.

Subjects are Clerk user ids (user_...) or email addresses. Emails are resolved
to user ids via the Clerk Backend API when CLERK_SECRET_KEY is exported;
otherwise pass the user id directly.

Examples:
  npm run feature:enable -- betaFeature user_2qzGkAFpXqXmZ8pQ3zLmAoCnEJ
  npm run feature:enable -- betaFeature drew@easleyowl.com
  npm run feature:enable:local -- betaFeature user_local
  npm run feature:disable -- betaFeature drew@easleyowl.com
  npm run feature:list:local
`);
};

/** Flag names follow the same shape as map tags (tag-map.mjs). */
export function validFlagName(flag) {
  return /^[\w][\w.-]{0,63}$/.test(String(flag));
}

/** Grant a flag to a subject. Idempotent: re-granting refreshes the grant
 * instead of duplicating it. */
export async function enableFeature(db, { flag, subject, grantedBy, grantedAt }) {
  if (!validFlagName(flag)) throw new Error(`Invalid flag '${flag}'.`);
  if (!subject || String(subject).length > 255)
    throw new Error(`Invalid subject '${subject}'.`);
  const at = grantedAt ?? Date.now();
  const by = grantedBy ?? 'operator';
  await db
    .prepare(
      `INSERT INTO feature_flags (flag, subject, granted_at, granted_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(flag, subject) DO UPDATE
       SET granted_at = excluded.granted_at, granted_by = excluded.granted_by`,
    )
    .bind(String(flag), String(subject), at, String(by))
    .run();
  return { flag, subject: String(subject), grantedAt: at, grantedBy: String(by) };
}

export async function disableFeature(db, { flag, subject }) {
  if (!validFlagName(flag)) throw new Error(`Invalid flag '${flag}'.`);
  if (!subject || String(subject).length > 255)
    throw new Error(`Invalid subject '${subject}'.`);
  const result = await db
    .prepare('DELETE FROM feature_flags WHERE flag = ? AND subject = ?')
    .bind(String(flag), String(subject))
    .run();
  return { flag, subject: String(subject), removed: Boolean(result.meta?.changes) };
}

export async function listFeatureFlags(db) {
  const rows = await db
    .prepare(
      'SELECT flag, subject, granted_at, granted_by FROM feature_flags ORDER BY flag, subject',
    )
    .all();
  const grants = rows.results ?? [];
  const byFlag = new Map();
  for (const row of grants) {
    if (!byFlag.has(row.flag)) byFlag.set(row.flag, []);
    byFlag.get(row.flag).push({
      subject: row.subject,
      grantedAt: row.granted_at,
      grantedBy: row.granted_by,
    });
  }
  return {
    total: grants.length,
    flags: [...byFlag.entries()].map(([flag, subjects]) => ({ flag, subjects })),
  };
}

/** Resolve a CLI subject argument to a Clerk user id. A non-email passes
 * through unchanged; an email is resolved via the Clerk Backend API. */
export async function resolveSubject(
  subject,
  { clerkSecretKey, fetchImpl = fetch } = {},
) {
  const value = String(subject ?? '').trim();
  if (!value) throw new Error('A subject is required.');
  if (!value.includes('@')) return value;
  if (!clerkSecretKey) {
    throw new Error(
      `'${value}' looks like an email. Export CLERK_SECRET_KEY to resolve emails to Clerk user ids, or pass the user id (user_...) directly.`,
    );
  }
  const url = `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(value)}&limit=1`;
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${clerkSecretKey}` },
  });
  if (!response.ok)
    throw new Error(`Clerk API rejected the lookup (HTTP ${response.status}).`);
  const body = await response.json();
  const [match] = Array.isArray(body) ? body : (body.data ?? []);
  if (!match?.id) throw new Error(`No Clerk user found for '${value}'.`);
  return String(match.id);
}

async function featureDb(local) {
  // Keep the same D1 binding for both targets. The local proxy persists to the
  // API Worker's dev state; the remote proxy uses Wrangler's credentials.
  // A D1-only config avoids starting unrelated Worker bindings for this CLI.
  const configPath = 'workers/api/wrangler.jsonc';
  const ts = await import('typescript');
  const { config, error } = ts.parseConfigFileTextToJson(
    configPath,
    await readFile(configPath, 'utf8'),
  );
  if (error) throw new Error('Unable to read API Wrangler configuration');
  const binding = config.d1_databases.find((entry) => entry.binding === 'DB');
  if (!binding?.database_id) throw new Error('API DB binding is not configured');
  const dir = await mkdtemp(join(tmpdir(), 'ttc-feature-flags-'));
  let platform;
  try {
    const file = join(dir, 'wrangler.json');
    await writeFile(
      file,
      JSON.stringify({
        name: 'ttcstatus-feature-flags',
        compatibility_date: config.compatibility_date,
        ...(config.account_id ? { account_id: config.account_id } : {}),
        d1_databases: [
          {
            binding: 'DB',
            database_name: binding.database_name,
            database_id: binding.database_id,
            ...(local ? {} : { remote: true }),
          },
        ],
      }),
    );
    const { getPlatformProxy } = await import('wrangler');
    platform = await getPlatformProxy({
      configPath: file,
      envFiles: [],
      persist: local ? { path: resolve('workers/api/.wrangler/state/v3') } : false,
      remoteBindings: !local,
    });
    return {
      db: platform.env.DB,
      dispose: async () => {
        try {
          await platform.dispose();
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    };
  } catch (cause) {
    await platform?.dispose();
    await rm(dir, { recursive: true, force: true });
    throw cause;
  }
}

export function parseFeatureArgs(args) {
  const [command, ...rest] = args;
  const positionals = [];
  let local = false;
  let json = false;
  let operator = process.env.USER ?? 'operator';
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--local') local = true;
    else if (arg === '--json') json = true;
    else if (arg === '--by') {
      operator = rest[++index];
      if (!operator || operator.startsWith('--'))
        throw new Error('--by requires an operator.');
    } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positionals.push(arg);
  }
  if (command === 'list' && positionals.length === 0)
    return { command, local, json, operator };
  if ((command === 'enable' || command === 'disable') && positionals.length === 2)
    return {
      command,
      flag: positionals[0],
      subject: positionals[1],
      local,
      json,
      operator,
    };
  throw new Error('Invalid feature command or arguments.');
}

function printResult(command, result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'list') {
    const rows = result.flags.flatMap(({ flag, subjects }) =>
      subjects.map(({ subject, grantedAt, grantedBy }) => ({
        flag,
        subject,
        grantedAt: new Date(grantedAt).toISOString(),
        grantedBy,
      })),
    );
    if (rows.length) console.table(rows);
    else console.log('No feature flags granted.');
  } else if (command === 'enable') {
    console.table([{ ...result, grantedAt: new Date(result.grantedAt).toISOString() }]);
  } else {
    console.table([result]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const withDb = async (local, work) => {
    const { db, dispose } = await featureDb(local);
    try {
      return await work(db);
    } finally {
      await dispose();
    }
  };
  try {
    if (process.argv.length === 2) {
      usage();
      process.exit(0);
    }
    const {
      command,
      flag,
      subject: subjectArg,
      local,
      json,
      operator,
    } = parseFeatureArgs(process.argv.slice(2));
    if (command === 'list') {
      printResult(command, await withDb(local, (db) => listFeatureFlags(db)), json);
    } else {
      const subject = await resolveSubject(subjectArg, {
        clerkSecretKey: process.env.CLERK_SECRET_KEY,
      });
      const action = command === 'enable' ? enableFeature : disableFeature;
      const outcome = await withDb(local, (db) =>
        action(db, { flag, subject, grantedBy: operator }),
      );
      printResult(command, outcome, json);
    }
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exit(1);
  }
}
