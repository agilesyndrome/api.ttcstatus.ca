import type { Env } from '../env';
import { json } from '../http/responses';

export async function feedStatusResponse(env: Env): Promise<Response> {
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
