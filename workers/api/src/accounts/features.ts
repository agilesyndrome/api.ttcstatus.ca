import type { FeatureFlagsResponse } from '../../../../shared/service/contracts';
import { json } from '../http/responses';
import type { AccountEnv } from './env';

/** Does this verified caller hold a per-user feature flag? — RETIRED with
 * the overlay grant (docs/optimize-overlay.md E6S1): the service endpoints
 * no longer consult per-user flags (history is public, wave is any verified
 * session), and the `callerHasFlag` lookup — one D1 read per request on the
 * critical path — is deleted rather than cached. The generic flag machinery
 * below stays for future flags. */

/** GET /api/v1/me/features — the caller's enabled per-user feature flags
 * (sla-epics.md §0B): a small generic surface for future per-user grants.
 * Clerk-authenticated upstream; identity comes exclusively from
 * authentication, never from request data. `no-store` (flags can change
 * with one CLI command) and CORS, per the story card. Empty for everyone
 * else — scaffolding never means "visible to everyone". */
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
