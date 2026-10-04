import { limitStream } from '../../../shared/http/streams';
import { MAX_STATIC_GTFS_BYTES } from '../../../shared/gtfs/limits';
import {
  R2_PREFIX,
  SOURCE_KEY,
  acquireLock,
  daysSince,
  ensureState,
  findReusableCandidate,
  hasReliableValidator,
  insertVersion,
  markCheck,
  nowIso,
  releaseLock,
  sameReliableValidators,
  sourceHeaders,
  sourceRequestHeaders,
  type NetworkVersion,
  type SyncEnv,
  type SyncResult,
} from './sync-common';
import { processVersion } from './sync-pipeline';

export type { SyncEnv, SyncResult } from './sync-common';

export async function syncStaticGtfs(env: SyncEnv): Promise<SyncResult> {
  let state = await ensureState(env);
  const lease = await acquireLock(env);
  if (!lease) {
    return { status: 'busy', reason: 'sync-already-running', sourceCheckedAt: nowIso() };
  }

  try {
    // Refresh after lock acquisition so validator comparisons use current data.
    state = await ensureState(env);
    const requestHeaders = sourceRequestHeaders(state);

    let headResponse: Response | null = null;
    try {
      headResponse = await fetch(env.STATIC_GTFS_URL, {
        signal: AbortSignal.timeout(60_000),
        method: 'HEAD',
        headers: requestHeaders,
      });
    } catch {
      // Some origins/proxies do not support HEAD reliably. Conditional GET is
      // the fallback, but still only according to the conservative cadence below.
    }

    if (headResponse?.status === 304) {
      await markCheck(env);
      return {
        status: 'unchanged',
        reason: 'source-304-on-head',
        sourceCheckedAt: nowIso(),
      };
    }

    const head = headResponse?.ok ? sourceHeaders(headResponse) : null;
    if (head && sameReliableValidators(state, head)) {
      await markCheck(env);
      return {
        status: 'unchanged',
        reason: 'source-validators-unchanged',
        sourceCheckedAt: nowIso(),
      };
    }

    if (head && hasReliableValidator(head)) {
      const reusable = await findReusableCandidate(env, head);
      if (reusable) return await processVersion(env, reusable);
    }

    const fallbackDays = Math.max(1, Number(env.NO_VALIDATOR_REFETCH_DAYS || '7') || 7);
    if (
      (!head || !hasReliableValidator(head)) &&
      daysSince(state.last_full_fetch_at) < fallbackDays
    ) {
      await markCheck(env);
      return {
        status: 'unchanged',
        reason: `source-has-no-validator-full-fetch-deferred-${fallbackDays}d`,
        sourceCheckedAt: nowIso(),
      };
    }

    const getResponse = await fetch(env.STATIC_GTFS_URL, {
      signal: AbortSignal.timeout(180_000),
      method: 'GET',
      headers: requestHeaders,
    });

    if (getResponse.status === 304) {
      await env.DB.prepare(
        `UPDATE source_state SET last_checked_at = ?, last_full_fetch_at = ?, last_error = NULL
         WHERE source_key = ?`,
      )
        .bind(nowIso(), nowIso(), SOURCE_KEY)
        .run();
      return {
        status: 'unchanged',
        reason: 'source-304-on-get',
        sourceCheckedAt: nowIso(),
      };
    }
    if (!getResponse.ok || !getResponse.body) {
      throw new Error(`Static GTFS download failed with HTTP ${getResponse.status}`);
    }

    const getHeaders = sourceHeaders(getResponse);
    const versionKey = `${R2_PREFIX}${Date.now()}.zip`;
    const stored = await env.GTFS_BUCKET.put(
      versionKey,
      limitStream(getResponse.body, MAX_STATIC_GTFS_BYTES),
      {
        httpMetadata: {
          contentType: getResponse.headers.get('content-type') || 'application/zip',
        },
        customMetadata: {
          source: env.STATIC_GTFS_URL,
          sourceEtag: getHeaders.etag || '',
          sourceLastModified: getHeaders.lastModified || '',
          fetchedAt: nowIso(),
        },
      },
    );
    if (!stored) throw new Error('R2 did not return metadata for the cached GTFS object');

    await env.DB.prepare(
      `UPDATE source_state SET last_checked_at = ?, last_full_fetch_at = ?, last_error = NULL
       WHERE source_key = ?`,
    )
      .bind(nowIso(), nowIso(), SOURCE_KEY)
      .run();

    // The upstream may change metadata without changing bytes. R2's object ETag
    // gives us a local content identity so we do not rebuild for a metadata-only change.
    if (state.r2_etag && stored.etag === state.r2_etag) {
      await env.GTFS_BUCKET.delete(versionKey);
      await env.DB.prepare(
        `UPDATE source_state
         SET source_etag = ?, source_last_modified = ?, source_content_length = ?
         WHERE source_key = ?`,
      )
        .bind(
          getHeaders.etag,
          getHeaders.lastModified,
          getHeaders.contentLength ?? stored.size,
          SOURCE_KEY,
        )
        .run();
      return {
        status: 'unchanged',
        reason: 'downloaded-bytes-identical',
        sourceCheckedAt: nowIso(),
      };
    }

    const existingByContent = await env.DB.prepare(
      `SELECT * FROM network_versions
       WHERE source_key = ? AND r2_etag = ?
       ORDER BY id DESC LIMIT 1`,
    )
      .bind(SOURCE_KEY, stored.etag)
      .first<NetworkVersion>();

    if (existingByContent) {
      await env.GTFS_BUCKET.delete(versionKey);
      if (
        existingByContent.raw_retained === 1 &&
        (await env.GTFS_BUCKET.head(existingByContent.r2_key))
      ) {
        return await processVersion(env, existingByContent);
      }
      throw new Error(
        'A known GTFS content version was found but its retained R2 source is missing',
      );
    }

    const version = await insertVersion(
      env,
      getHeaders,
      versionKey,
      stored.etag,
      stored.size,
    );
    return await processVersion(env, version);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markCheck(env, message.slice(0, 2000));
    throw error;
  } finally {
    await releaseLock(env, lease);
  }
}
