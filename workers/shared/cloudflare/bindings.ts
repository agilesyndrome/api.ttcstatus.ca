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
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<R2Objects>;
}

export interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
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
