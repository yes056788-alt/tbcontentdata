import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type RunsBucket = {
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<
    | (ReadableStream & {
        text(): Promise<string>;
      })
    | {
        body: ReadableStream;
        text(): Promise<string>;
      }
    | null
  >;
  delete(key: string): Promise<void>;
};

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export function getRunsBucket(): RunsBucket {
  const bucket = (env as unknown as { RUNS?: RunsBucket }).RUNS;
  if (!bucket) {
    throw new Error(
      "Cloudflare R2 binding `RUNS` is unavailable. Set the `r2` field in .openai/hosting.json to `RUNS` before using shared run history.",
    );
  }
  return bucket;
}

export type AppDb = ReturnType<typeof getDb>;
