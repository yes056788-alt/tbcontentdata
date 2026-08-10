// Minimal Cloudflare runtime declarations used by this Sites/Vinext project.
// Wrangler supplies the concrete implementations at runtime; keeping the
// declarations local avoids making the application depend on a generated file.
interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
  meta: Record<string, unknown>;
}

interface D1Response extends D1Result {
  changes?: number;
  duration?: number;
  last_row_id?: number;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(options?: { columnNames?: boolean }): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
  dump(): Promise<ArrayBuffer>;
}

interface D1ExecResult {
  count: number;
  duration: number;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface R2ObjectBody {
  body: ReadableStream;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2Bucket {
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string | string[]): Promise<void>;
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    RUNS: R2Bucket;
    RUN_DATA_KEY?: string;
    BOOTSTRAP_TOKEN?: string;
    OWNER_RECOVERY_TOKEN?: string;
    OWNER_RECOVERY_TOKEN_HASH?: string;
    OWNER_RECOVERY_TOKEN_EXPIRES_AT?: string;
    PASSWORD_PEPPER?: string;
    APP_PUBLIC_ORIGIN?: string;
  }
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}
