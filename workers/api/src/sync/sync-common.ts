import type { D1Database, Fetcher, R2Bucket } from '../../../shared/cloudflare/bindings';

export const SOURCE_KEY = 'ttc-surface-gtfs';
const USER_AGENT =
  'TTCStatus.ca static GTFS importer/0.1 (+https://github.com/agilesyndrome/api.ttcstatus.ca)';
export const R2_PREFIX = 'gtfs/versions/';
const LOCK_MINUTES = 20;
export const BATCH_SIZE = 75;

export interface SyncEnv {
  DB: D1Database;
  GTFS_BUCKET: R2Bucket;
  MAP_GENERATOR: Fetcher;
  STATIC_GTFS_URL: string;
  SOURCE_ATTRIBUTION: string;
  NO_VALIDATOR_REFETCH_DAYS?: string;
  /** Shared only between the API and map-generator service binding. */
  SYNC_TOKEN?: string;
}

interface SourceState {
  source_key: string;
  source_url: string;
  source_etag: string | null;
  source_last_modified: string | null;
  source_content_length: number | null;
  r2_etag: string | null;
  r2_key: string | null;
  active_version_id: number | null;
  last_checked_at: string | null;
  last_full_fetch_at: string | null;
  last_changed_at: string | null;
  lock_until: string | null;
  last_error: string | null;
}

export interface NetworkVersion {
  id: number;
  source_key: string;
  source_url: string;
  source_etag: string | null;
  source_last_modified: string | null;
  source_content_length: number | null;
  r2_etag: string;
  r2_key: string;
  fetched_at: string;
  imported_at: string | null;
  activated_at: string | null;
  status: string;
  error: string | null;
  active: number;
  raw_retained: number;
}

export interface SourceHeaders {
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
}

export interface SyncResult {
  status: 'unchanged' | 'updated' | 'busy';
  reason: string;
  versionId?: number;
  sourceCheckedAt: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function sourceHeaders(response: Response): SourceHeaders {
  return {
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    contentLength: parseContentLength(response.headers.get('content-length')),
  };
}

export function sourceRequestHeaders(state: SourceState | null): Headers {
  const headers = new Headers({
    Accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.1',
    'Cache-Control': 'no-cache',
    'User-Agent': USER_AGENT,
  });
  if (state?.source_etag) headers.set('If-None-Match', state.source_etag);
  if (state?.source_last_modified)
    headers.set('If-Modified-Since', state.source_last_modified);
  return headers;
}

export function sameReliableValidators(
  state: SourceState | null,
  incoming: SourceHeaders,
): boolean {
  if (!state) return false;
  if (incoming.etag && state.source_etag) return incoming.etag === state.source_etag;
  if (incoming.lastModified && state.source_last_modified) {
    return (
      incoming.lastModified === state.source_last_modified &&
      (incoming.contentLength == null ||
        state.source_content_length == null ||
        incoming.contentLength === state.source_content_length)
    );
  }
  return false;
}

export function hasReliableValidator(headers: SourceHeaders): boolean {
  return Boolean(headers.etag || headers.lastModified);
}

export function daysSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? ms / 86_400_000 : Number.POSITIVE_INFINITY;
}

export async function ensureState(env: SyncEnv): Promise<SourceState> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO source_state (source_key, source_url)
     VALUES (?, ?)`,
  )
    .bind(SOURCE_KEY, env.STATIC_GTFS_URL)
    .run();

  await env.DB.prepare(
    `UPDATE source_state SET
      source_etag = CASE WHEN source_url = ? THEN source_etag ELSE NULL END,
      source_last_modified = CASE WHEN source_url = ? THEN source_last_modified ELSE NULL END,
      source_content_length = CASE WHEN source_url = ? THEN source_content_length ELSE NULL END,
      last_full_fetch_at = CASE WHEN source_url = ? THEN last_full_fetch_at ELSE NULL END,
      source_url = ? WHERE source_key = ?`,
  )
    .bind(
      env.STATIC_GTFS_URL,
      env.STATIC_GTFS_URL,
      env.STATIC_GTFS_URL,
      env.STATIC_GTFS_URL,
      env.STATIC_GTFS_URL,
      SOURCE_KEY,
    )
    .run();

  const state = await env.DB.prepare(
    `SELECT * FROM source_state WHERE source_key = ? LIMIT 1`,
  )
    .bind(SOURCE_KEY)
    .first<SourceState>();
  if (!state) throw new Error('Unable to initialize source state');
  return state;
}

export async function acquireLock(env: SyncEnv): Promise<string | null> {
  const now = nowIso();
  const until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
  const result = await env.DB.prepare(
    `UPDATE source_state
     SET lock_until = ?
     WHERE source_key = ? AND (lock_until IS NULL OR lock_until < ?)`,
  )
    .bind(until, SOURCE_KEY, now)
    .run();
  return (result.meta.changes ?? 0) === 1 ? until : null;
}

export async function releaseLock(env: SyncEnv, lease: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE source_state SET lock_until = NULL WHERE source_key = ? AND lock_until = ?`,
  )
    .bind(SOURCE_KEY, lease)
    .run();
}

export async function markCheck(
  env: SyncEnv,
  error: string | null = null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE source_state
     SET last_checked_at = ?, last_error = ?
     WHERE source_key = ?`,
  )
    .bind(nowIso(), error, SOURCE_KEY)
    .run();
}

export async function findReusableCandidate(
  env: SyncEnv,
  headers: SourceHeaders,
): Promise<NetworkVersion | null> {
  let candidate: NetworkVersion | null = null;
  if (headers.etag) {
    candidate = await env.DB.prepare(
      `SELECT * FROM network_versions
       WHERE source_key = ? AND source_etag = ? AND source_url = ? AND active = 0
       ORDER BY id DESC LIMIT 1`,
    )
      .bind(SOURCE_KEY, headers.etag, env.STATIC_GTFS_URL)
      .first<NetworkVersion>();
  } else if (headers.lastModified) {
    candidate = await env.DB.prepare(
      `SELECT * FROM network_versions
       WHERE source_key = ? AND source_last_modified = ? AND source_url = ?
         AND (? IS NULL OR source_content_length = ?)
         AND active = 0
       ORDER BY id DESC LIMIT 1`,
    )
      .bind(
        SOURCE_KEY,
        headers.lastModified,
        env.STATIC_GTFS_URL,
        headers.contentLength,
        headers.contentLength,
      )
      .first<NetworkVersion>();
  }

  if (!candidate || candidate.raw_retained !== 1) return null;
  const object = await env.GTFS_BUCKET.head(candidate.r2_key);
  return object ? candidate : null;
}

export async function insertVersion(
  env: SyncEnv,
  headers: SourceHeaders,
  r2Key: string,
  r2Etag: string,
  size: number,
): Promise<NetworkVersion> {
  const existing = await env.DB.prepare(
    `SELECT * FROM network_versions
     WHERE source_key = ? AND r2_etag = ?
     ORDER BY id DESC LIMIT 1`,
  )
    .bind(SOURCE_KEY, r2Etag)
    .first<NetworkVersion>();

  if (existing) return existing;

  await env.DB.prepare(
    `INSERT INTO network_versions (
       source_key, source_url, source_etag, source_last_modified,
       source_content_length, r2_etag, r2_key, fetched_at, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'downloaded')`,
  )
    .bind(
      SOURCE_KEY,
      env.STATIC_GTFS_URL,
      headers.etag,
      headers.lastModified,
      headers.contentLength ?? size,
      r2Etag,
      r2Key,
      nowIso(),
    )
    .run();

  const version = await env.DB.prepare(
    `SELECT * FROM network_versions
     WHERE source_key = ? AND r2_etag = ?
     ORDER BY id DESC LIMIT 1`,
  )
    .bind(SOURCE_KEY, r2Etag)
    .first<NetworkVersion>();
  if (!version) throw new Error('Unable to read newly-created network version');
  return version;
}

export async function runBatches(
  env: Pick<SyncEnv, 'DB'>,
  statements: ReturnType<D1Database['prepare']>[],
): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
  }
}
