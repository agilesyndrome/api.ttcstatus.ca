import type {
  D1Database,
  ExecutionContextLike,
  Fetcher,
  R2Bucket,
  ScheduledControllerLike,
} from "../../shared/cloudflare";
import { syncStaticGtfs, type SyncEnv } from "./sync";
import { DEFAULT_VEHICLE_FEED_URL } from "./realtime";
import { VehicleSnapshotCache } from "./vehicle-snapshot-cache";
import { liveUpdateSeconds } from "../../shared/live-config";

interface Env extends SyncEnv {
  DB: D1Database;
  GTFS_BUCKET: R2Bucket;
  MAP_GENERATOR: Fetcher;
  STATIC_GTFS_URL: string;
  SOURCE_ATTRIBUTION: string;
  NO_VALIDATOR_REFETCH_DAYS?: string;
  SYNC_TOKEN?: string;
  REALTIME_VEHICLE_URL?: string;
  REALTIME_UPDATE_SECONDS?: string;
}

interface ActiveArtifact {
  id: number;
  version_id: number;
  mode: string;
  style: string;
  generator_version: string;
  etag: string;
  byte_size: number;
  chunk_count: number;
  created_at: string;
}

function cors(headers = new Headers()): Headers {
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
  headers.set("access-control-allow-headers", "Authorization, Content-Type, If-None-Match");
  headers.set("access-control-expose-headers", "ETag, X-Live-Update-Seconds, X-Live-Next-Update-At, Retry-After");
  return headers;
}

function json(value: unknown, status = 200, extra?: Record<string, string>): Response {
  const headers = cors(new Headers({ "content-type": "application/json; charset=utf-8" }));
  if (extra) for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(JSON.stringify(value), { status, headers });
}

async function activeArtifact(env: Env): Promise<ActiveArtifact | null> {
  return env.DB.prepare(
    `SELECT id, version_id, mode, style, generator_version, etag, byte_size, chunk_count, created_at
     FROM map_artifacts
     WHERE mode = 'streetcar' AND style = 'snake-v1' AND active = 1
     ORDER BY id DESC LIMIT 1`
  ).first<ActiveArtifact>();
}

async function mapResponse(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
  const artifact = await activeArtifact(env);
  if (!artifact) {
    return json(
      {
        error: "map-not-ready",
        message: "No active streetcar map has been generated yet. Run the first static GTFS sync after provisioning D1/R2.",
      },
      503,
      { "cache-control": "no-store" },
    );
  }

  const quotedEtag = `"${artifact.etag}"`;
  if (request.headers.get("if-none-match") === quotedEtag) {
    return new Response(null, {
      status: 304,
      headers: cors(new Headers({
        etag: quotedEtag,
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "x-network-version": String(artifact.version_id),
      })),
    });
  }

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(
    `https://ttcstatus-cache.invalid/api/v1/map/streetcar?v=${artifact.version_id}&etag=${artifact.etag}`,
    { method: "GET" },
  );
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = cors(new Headers(cached.headers));
    headers.set("x-ttcstatus-cache", "HIT");
    return new Response(request.method === "HEAD" ? null : cached.body, {
      status: cached.status,
      headers,
    });
  }

  const chunks = (await env.DB.prepare(
    `SELECT payload FROM map_artifact_chunks
     WHERE artifact_id = ?
     ORDER BY chunk_index`
  ).bind(artifact.id).all<{ payload: string }>()).results;

  if (chunks.length !== artifact.chunk_count) {
    return json(
      {
        error: "map-artifact-incomplete",
        expectedChunks: artifact.chunk_count,
        actualChunks: chunks.length,
      },
      503,
      { "cache-control": "no-store" },
    );
  }

  const body = chunks.map((chunk) => chunk.payload).join("");
  const headers = cors(new Headers({
    "content-type": "application/json; charset=utf-8",
    etag: quotedEtag,
    "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    "x-network-version": String(artifact.version_id),
    "x-map-generator": artifact.generator_version,
    "x-ttcstatus-cache": "MISS",
  }));
  const response = new Response(body, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers: response.headers,
  });
}

async function networkResponse(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, source_url, source_etag, source_last_modified, fetched_at, imported_at,
            activated_at, route_count, pattern_count, shape_count, stop_count,
            pattern_stop_count, r2_etag
     FROM network_versions
     WHERE source_key = 'ttc-surface-gtfs' AND active = 1
     ORDER BY id DESC LIMIT 1`
  ).first<Record<string, unknown>>();

  if (!row) return json({ error: "network-not-ready" }, 503, { "cache-control": "no-store" });
  return json(
    {
      mode: "streetcar",
      version: row,
      attribution: env.SOURCE_ATTRIBUTION,
    },
    200,
    { "cache-control": "public, max-age=300" },
  );
}

// Keep only the current configuration in an isolate; edge caching is shared
// within a Cloudflare location, not a global single-poller guarantee.
let vehicleStore: { key: string; cache: VehicleSnapshotCache } | undefined;
async function vehicleResponse(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
  const source = env.REALTIME_VEHICLE_URL ?? DEFAULT_VEHICLE_FEED_URL;
  const updateSeconds = liveUpdateSeconds(env.REALTIME_UPDATE_SECONDS);
  const cache = (caches as unknown as { default: Cache }).default;
  const storeKey = JSON.stringify([source, env.SOURCE_ATTRIBUTION, updateSeconds]);
  const key = new Request(`https://ttcstatus-cache.invalid/api/v1/vehicles/streetcar?config=${encodeURIComponent(storeKey)}`);
  const cached = await cache.match(key);
  const conditional = (response: Response) => request.headers.get("if-none-match") === response.headers.get("etag")
    ? new Response(null, { status: 304, headers: response.headers }) : response;
  if (cached) return conditional(cached);
  try {
    if (vehicleStore?.key !== storeKey) vehicleStore = { key: storeKey, cache: new VehicleSnapshotCache(source, env.SOURCE_ATTRIBUTION, updateSeconds) };
    const result = await vehicleStore.cache.get();
    const remainingSeconds = Math.max(0, Math.floor((result.nextUpdateAt - Date.now()) / 1000));
    const response = json(result.snapshot, 200, { "cache-control": `public, max-age=${remainingSeconds}`,
      etag: result.etag, "x-live-update-seconds": String(updateSeconds),
      "x-live-next-update-at": new Date(result.nextUpdateAt).toISOString() });
    ctx.waitUntil(cache.put(key, response.clone()));
    return conditional(response);
  } catch (error) {
    console.error("Streetcar snapshot failed", error);
    return json({ error: "vehicles-unavailable", message: "Live streetcar positions are temporarily unavailable." }, 503,
      { "cache-control": "no-store", "x-live-update-seconds": String(updateSeconds), "retry-after": String(updateSeconds) });
  }
}

async function feedStatusResponse(env: Env): Promise<Response> {
  const state = await env.DB.prepare(
    `SELECT source_key, source_url, source_etag, source_last_modified, source_content_length,
            r2_etag, active_version_id, last_checked_at, last_full_fetch_at,
            last_changed_at, lock_until, last_error
     FROM source_state WHERE source_key = 'ttc-surface-gtfs' LIMIT 1`
  ).first<Record<string, unknown>>();

  const recent = (await env.DB.prepare(
    `SELECT id, fetched_at, imported_at, activated_at, status, error, route_count,
            pattern_count, shape_count, stop_count, active, raw_retained
     FROM network_versions
     WHERE source_key = 'ttc-surface-gtfs'
     ORDER BY id DESC LIMIT 5`
  ).all<Record<string, unknown>>()).results;

  return json({ state, recentVersions: recent }, 200, { "cache-control": "no-store" });
}

function authorizedSync(request: Request, env: Env): boolean {
  if (!env.SYNC_TOKEN) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${env.SYNC_TOKEN}`;
}

async function debugMapResponse(request: Request, env: Env): Promise<Response> {
  if (!env.SYNC_TOKEN) return json({ error: "debug-render-disabled" }, 404, { "cache-control": "no-store" });
  if (!authorizedSync(request, env)) return json({ error: "unauthorized" }, 401, { "cache-control": "no-store" });

  const body = await request.text();
  const response = await env.MAP_GENERATOR.fetch("https://map-generator.internal/api/debug/render", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.SYNC_TOKEN}`,
      "content-type": request.headers.get("content-type") ?? "application/json",
    },
    body,
  });

  const headers = cors(new Headers(response.headers));
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/healthz") {
      return request.method === "HEAD"
        ? new Response(null, { status: 200, headers: cors() })
        : json({ ok: true, worker: "ttcstatus-api" }, 200, { "cache-control": "no-store" });
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/v1/map/streetcar") {
      return mapResponse(request, env, ctx);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/network") {
      return networkResponse(env);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/vehicles/streetcar") {
      return vehicleResponse(request, env, ctx);
    }

    if (request.method === "GET" && url.pathname === "/api/v1/feed/status") {
      return feedStatusResponse(env);
    }

    if (request.method === "POST" && url.pathname === "/api/v1/debug/map/streetcar.svg") {
      return debugMapResponse(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/v1/admin/sync") {
      if (!env.SYNC_TOKEN) return json({ error: "manual-sync-disabled" }, 404, { "cache-control": "no-store" });
      if (!authorizedSync(request, env)) return json({ error: "unauthorized" }, 401, { "cache-control": "no-store" });
      ctx.waitUntil(
        syncStaticGtfs(env)
          .then((result) => console.log("manual static GTFS sync result", result))
          .catch((error) => console.error("manual static GTFS sync failed", error)),
      );
      return json(
        { status: "accepted", reason: "static-sync-started" },
        202,
        { "cache-control": "no-store" },
      );
    }

    return json({ error: "not-found" }, 404, { "cache-control": "no-store" });
  },

  async scheduled(
    _controller: ScheduledControllerLike,
    env: Env,
    _ctx: ExecutionContextLike,
  ): Promise<void> {
    const result = await syncStaticGtfs(env);
    console.log("static GTFS sync result", result);
  },
};
