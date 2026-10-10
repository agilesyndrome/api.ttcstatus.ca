export interface D1Meta {
  changes?: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
}

export interface R2Range {
  offset: number;
  length: number;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  uploaded?: Date;
  customMetadata?: Record<string, string>;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream<Uint8Array>;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

export interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string, options?: { range?: R2Range }): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string,
    options?: {
      httpMetadata?: Record<string, string>;
      customMetadata?: Record<string, string>;
    },
  ): Promise<R2Object | null>;
  createMultipartUpload(
    key: string,
    options?: R2MultipartOptions,
  ): Promise<R2MultipartUpload>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<R2Objects>;
}

export interface R2MultipartOptions {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

export interface R2UploadedPart {
  partNumber: number;
  etag: string;
}

export interface R2MultipartUpload {
  uploadPart(
    partNumber: number,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob,
  ): Promise<R2UploadedPart>;
  complete(parts: R2UploadedPart[]): Promise<R2Object>;
  abort(): Promise<void>;
}

export interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/** Narrow version_metadata binding interface; Cloudflare injects the running
 * Worker version's id, tag and creation timestamp. */
export interface WorkerVersionMetadata {
  id: string;
  tag: string;
  timestamp: string;
}

/** Workers Analytics Engine data point: up to 20 blobs (strings), 20
 * doubles and 20 indexes (unsigned ints) per sample. */
export interface AnalyticsEngineDataPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: number[];
}

/** Narrow analytics_engine_datasets binding interface. `writeDataPoint` is
 * fire-and-forget: it buffers in the runtime and never blocks the request. */
export interface AnalyticsEngineDataset {
  writeDataPoint(event: AnalyticsEngineDataPoint): void;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface ScheduledControllerLike {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

/** Narrow durable_objects binding interfaces (house style: hand-written,
 * structurally compatible with the runtime). */
export interface DurableObjectIdLike {
  name?: string;
  toString(): string;
}

export interface DurableObjectStubLike {
  fetch(input: string | Request): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}

/** SQLite-backed DO storage — the subset the ServiceRecorder uses (the window
 * store runs on SQL so an isolate eviction can't hole the window, sla.md §4.5). */
export interface DurableObjectSqlResultLike {
  rows(): unknown[];
  toArray(): unknown[];
}

export interface DurableObjectSqlLike {
  exec(query: string, ...bindings: unknown[]): DurableObjectSqlResultLike;
}

export interface DurableObjectStorageLike {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  setAlarm(scheduledTime: number): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
  sql: DurableObjectSqlLike;
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}
