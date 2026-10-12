import {
  array,
  boolean,
  nullable,
  object,
  ref,
  revision,
  string,
  timestamp,
} from './schema';

export const metadataSchemas = {
  Health: object({ ok: boolean, worker: string }),
  WorkerVersion: object({
    site: string,
    source: string,
    deploy: nullable(object({ id: string, tag: string, timestamp })),
  }),
  NetworkVersion: object({
    id: revision,
    source_url: string,
    source_etag: nullable(string),
    source_last_modified: nullable(string),
    fetched_at: timestamp,
    imported_at: nullable(timestamp),
    activated_at: nullable(timestamp),
    route_count: revision,
    pattern_count: revision,
    shape_count: revision,
    stop_count: revision,
    pattern_stop_count: revision,
    r2_etag: string,
  }),
  Network: object({
    mode: { const: 'streetcar' },
    version: ref('NetworkVersion'),
    attribution: string,
  }),
  FeedDiagnostics: object({
    state: nullable({ type: 'object' }),
    recentVersions: array({ type: 'object' }),
    recorder: nullable({ type: 'object' }),
  }),
  SyncResult: object(
    { changed: boolean, reason: string, versionId: revision, artifactId: revision },
    [],
  ),
};
