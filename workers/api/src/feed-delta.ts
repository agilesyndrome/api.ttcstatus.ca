import { SOURCE_KEY, nowIso, type SyncEnv } from "./sync-common";

interface TableDelta {
  added: number;
  removed: number;
  changed: number;
}

/**
 * Compare two materialized versions by stable row key + row hash.
 * Table/key names are internal constants only; no request data reaches SQL.
 */
async function tableDelta(
  env: SyncEnv,
  table: string,
  key: string,
  fromVersionId: number,
  toVersionId: number,
): Promise<TableDelta> {
  const row = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM ${table} n
        LEFT JOIN ${table} o ON o.version_id = ? AND o.${key} = n.${key}
        WHERE n.version_id = ? AND o.${key} IS NULL) AS added,
      (SELECT COUNT(*) FROM ${table} o
        LEFT JOIN ${table} n ON n.version_id = ? AND n.${key} = o.${key}
        WHERE o.version_id = ? AND n.${key} IS NULL) AS removed,
      (SELECT COUNT(*) FROM ${table} n
        JOIN ${table} o ON o.version_id = ? AND o.${key} = n.${key}
        WHERE n.version_id = ? AND n.row_hash <> o.row_hash) AS changed`,
  ).bind(
    fromVersionId, toVersionId,
    toVersionId, fromVersionId,
    fromVersionId, toVersionId,
  ).first<TableDelta>();

  return row ?? { added: 0, removed: 0, changed: 0 };
}

/** Store compact historical change metadata instead of retaining every raw ZIP. */
export async function recordFeedDelta(
  env: SyncEnv,
  fromVersionId: number | null,
  toVersionId: number,
): Promise<void> {
  let summary: Record<string, unknown>;

  if (fromVersionId == null) {
    const version = await env.DB.prepare(
      `SELECT route_count, pattern_count, shape_count, stop_count, pattern_stop_count
       FROM network_versions WHERE id = ?`,
    ).bind(toVersionId).first<Record<string, unknown>>();
    summary = { initialImport: true, counts: version ?? {} };
  } else {
    summary = {
      routes: await tableDelta(env, "gtfs_routes", "route_id", fromVersionId, toVersionId),
      patterns: await tableDelta(env, "gtfs_patterns", "pattern_id", fromVersionId, toVersionId),
      shapes: await tableDelta(env, "gtfs_shapes", "shape_id", fromVersionId, toVersionId),
      stops: await tableDelta(env, "gtfs_stops", "stop_id", fromVersionId, toVersionId),
    };
  }

  await env.DB.prepare(
    `INSERT OR REPLACE INTO feed_change_events (
       source_key, from_version_id, to_version_id, created_at, summary_json
     ) VALUES (?, ?, ?, ?, ?)`,
  ).bind(SOURCE_KEY, fromVersionId, toVersionId, nowIso(), JSON.stringify(summary)).run();
}
