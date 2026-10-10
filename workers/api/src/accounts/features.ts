import type { FeatureFlagsResponse } from '../../../../shared/service/contracts';
import { json } from '../http/responses';
import type { AccountEnv } from './env';

/** GET /api/v1/me/features — the caller's enabled per-user feature flags
 * (sla-epics.md §0B): the only new public endpoint in the entire SLA preface.
 * Clerk-authenticated upstream; identity comes exclusively from authentication,
 * never from request data. `no-store` (flags can change with one CLI command)
 * and CORS, per the story card. Empty for everyone else — scaffolding never
 * means "visible to everyone". */
export async function ownedFeaturesResponse(
  _request: Request,
  env: AccountEnv,
  userId: string,
): Promise<Response> {
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
