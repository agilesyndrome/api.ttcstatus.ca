/** Per-user feature-flag CLI (sla-epics.md §0B; sla.md §4.7) — the map:tag
 * precedent for operator tooling that writes to the remote production D1:
 *
 *   npm run feature:enable -- voidOverlay drew@easleyowl.com
 *   npm run feature:disable -- voidOverlay drew@easleyowl.com
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
  console.log(`Grant, revoke, and list per-user feature flags against the remote production D1.

Usage:
  npm run feature:enable -- <flag> <subject> [--by <operator>]
  npm run feature:disable -- <flag> <subject>
  npm run feature:list

Subjects are Clerk user ids (user_...) or email addresses. Emails are resolved
to user ids via the Clerk Backend API when CLERK_SECRET_KEY is exported;
otherwise pass the user id directly.

Examples:
  npm run feature:enable -- voidOverlay user_2qzGkAFpXqXmZ8pQ3zLmAoCnEJ
  npm run feature:enable -- voidOverlay drew@easleyowl.com
  npm run feature:disable -- voidOverlay drew@easleyowl.com
  npm run feature:list
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

async function remoteDb() {
  // Use a temporary config with only the remote production D1 binding. Wrangler
  // supplies credentials; no admin token is involved (the map:tag precedent).
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
            remote: true,
          },
        ],
      }),
    );
    const { getPlatformProxy } = await import('wrangler');
    platform = await getPlatformProxy({
      configPath: file,
      envFiles: [],
      persist: false,
      remoteBindings: true,
    });
    return { db: platform.env.DB, dispose: () => platform.dispose() };
  } catch (cause) {
    await platform?.dispose();
    await rm(dir, { recursive: true, force: true });
    throw cause;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const operator = (() => {
    const index = args.indexOf('--by');
    return index >= 0 ? args[index + 1] : (process.env.USER ?? 'operator');
  })();
  const [command, flagArg, subjectArg] = args;
  const withRemoteDb = async (work) => {
    const { db, dispose } = await remoteDb();
    try {
      return await work(db);
    } finally {
      await dispose();
    }
  };
  try {
    if (command === 'list') {
      console.log(
        JSON.stringify(await withRemoteDb((db) => listFeatureFlags(db)), null, 2),
      );
    } else if (command === 'enable' || command === 'disable') {
      if (!flagArg || !subjectArg) {
        usage();
        process.exit(1);
      }
      const subject = await resolveSubject(subjectArg, {
        clerkSecretKey: process.env.CLERK_SECRET_KEY,
      });
      const action = command === 'enable' ? enableFeature : disableFeature;
      const outcome = await withRemoteDb((db) =>
        action(db, { flag: flagArg, subject, grantedBy: operator }),
      );
      console.log(JSON.stringify(outcome, null, 2));
    } else {
      usage();
      process.exit(command ? 1 : 0);
    }
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exit(1);
  }
}
