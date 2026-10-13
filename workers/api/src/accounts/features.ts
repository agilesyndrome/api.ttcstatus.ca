import type { FeatureFlagsResponse } from '../../../../shared/service/contracts';
import { json } from '../http/responses';
import type { AccountEnv } from './env';
import type { D1Database } from '../../../shared/cloudflare/bindings';

/** Does this verified caller hold a per-user feature flag? The server-side
 * grant check for the protected service endpoints (optimize-transport.md
 * change 4, E4S2): the `voidOverlay` flag is the experimental overlay grant,
 * administered through the existing feature:enable/disable/list workflow —
 * never through request data. */
export async function callerHasFlag(
  db: D1Database,
  userId: string,
  flag: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT flag FROM feature_flags WHERE subject = ? AND flag = ?')
    .bind(userId, flag)
    .first();
  return row !== null;
}

/** GET /api/v1/me/features — the caller's enabled per-user feature flags
 * (sla-epics.md §0B): the only new public endpoint in the entire SLA preface.
 * Clerk-authenticated upstream; identity comes exclusively from authentication,
 * never from request data. `no-store` (flags can change with one CLI command)
 * and CORS, per the story card. Empty for everyone else — scaffolding never
 * means "visible to everyone". */
export async function ownedFeaturesResponse(
  request: Request,
  env: AccountEnv,
  userId: string,
): Promise<Response> {
  if (request.method !== 'GET')
    return json({ error: 'method-not-allowed' }, 405, { 'cache-control': 'no-store' });
  const rows = await env.DB.prepare(
    'SELECT flag FROM feature_flags WHERE subject = ? ORDER BY flag',
  )
    .bind(userId)
    .all();
  const flags = (rows.results ?? [])
    .map((row) => String(row.flag))
    .filter((flag) => /^[\w][\w.-]{0,63}$/.test(flag));
  const body: FeatureFlagsResponse = { schemaVersion: 1, flags };
  return json(body, 200, { 'cache-control': 'no-store' });
}
