import type { Env } from '../env';
import { json } from '../http/responses';
import { authorizedSync } from '../../../shared/http/admin-auth';

// Operational diagnostics are internal: the public feed-status payload exposed
// source URLs, R2 keys, lock state and raw upstream error text. Keep the data,
// but require the admin credential, exactly like the other SYNC_TOKEN routes.
export async function feedStatusResponse(request: Request, env: Env): Promise<Response> {
  if (!env.SYNC_TOKEN)
    return json({ error: 'feed-status-disabled' }, 404, { 'cache-control': 'no-store' });
  if (!(await authorizedSync(request, env)))
    return json({ error: 'unauthorized' }, 401, { 'cache-control': 'no-store' });
  const state = await env.DB.prepare(
    `SELECT source_key, source_url, source_etag, source_last_modified, source_content_length,
            r2_etag, active_version_id, last_checked_at, last_full_fetch_at,
            last_changed_at, lock_until, last_error
     FROM source_state WHERE source_key = 'ttc-surface-gtfs' LIMIT 1`,
  ).first<Record<string, unknown>>();

  const recent = (
    await env.DB.prepare(
      `SELECT id, fetched_at, imported_at, activated_at, status, error, route_count,
            pattern_count, shape_count, stop_count, active, raw_retained
     FROM network_versions
     WHERE source_key = 'ttc-surface-gtfs'
     ORDER BY id DESC LIMIT 5`,
    ).all<Record<string, unknown>>()
  ).results;

  return json({ state, recentVersions: recent }, 200, { 'cache-control': 'no-store' });
}
