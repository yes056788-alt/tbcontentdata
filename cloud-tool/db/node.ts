import { existsSync, mkdirSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  drizzle,
  type AsyncBatchRemoteCallback,
  type RemoteCallback,
} from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema.ts";

type QueryMethod = "run" | "all" | "values" | "get";

type RunsBucketValue =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream;

export type RunsBucket = {
  put(
    key: string,
    value: RunsBucketValue,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<{ size: number; text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
};

type NodePersistenceOptions = {
  databasePath: string;
  runsRoot: string;
  migrationsFolder: string;
};

function executeQuery(
  client: DatabaseSync,
  sql: string,
  params: unknown[],
  method: QueryMethod,
) {
  const statement = client.prepare(sql);
  statement.setReturnArrays(true);
  const values = params as SQLInputValue[];
  if (method === "run") {
    return { rows: [statement.run(...values)] };
  }
  if (method === "get") {
    return { rows: statement.get(...values) as unknown as unknown[] };
  }
  return { rows: statement.all(...values) as unknown as unknown[][] };
}

function databaseCallbacks(client: DatabaseSync) {
  const query: RemoteCallback = async (sql, params, method) =>
    executeQuery(client, sql, params, method);
  const batch: AsyncBatchRemoteCallback = async (queries) => {
    client.exec("BEGIN IMMEDIATE");
    try {
      const results = queries.map(({ sql, params, method }) =>
        executeQuery(client, sql, params, method),
      );
      client.exec("COMMIT");
      return results;
    } catch (error) {
      client.exec("ROLLBACK");
      throw error;
    }
  };
  return { query, batch };
}

function userTableNames(client: DatabaseSync) {
  return client
    .prepare(
      `select name from sqlite_schema
       where type = 'table'
         and name not like 'sqlite_%'
         and name <> '__drizzle_migrations'
       order by name`,
    )
    .all()
    .map((row) => String((row as { name?: unknown }).name ?? ""))
    .filter(Boolean);
}

function applyMigrations(client: DatabaseSync, migrationsFolder: string) {
  if (!existsSync(resolve(migrationsFolder, "meta", "_journal.json"))) {
    throw new Error(
      `Node persistence migrations are unavailable at ${migrationsFolder}.`,
    );
  }
  client.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC NOT NULL UNIQUE
    )
  `);
  const appliedRows = client
    .prepare("SELECT hash, created_at FROM __drizzle_migrations")
    .all() as Array<{ hash: string; created_at: number }>;
  if (appliedRows.length === 0) {
    const existingTables = userTableNames(client);
    if (existingTables.length > 0) {
      throw new Error(
        "Existing SQLite data has no migration ledger. Import the cloud export with the migration importer instead of using it as DATABASE_PATH directly.",
      );
    }
  }

  const applied = new Map(
    appliedRows.map((row) => [Number(row.created_at), String(row.hash)]),
  );
  const migrations = readMigrationFiles({ migrationsFolder });
  for (const migration of migrations) {
    const knownHash = applied.get(migration.folderMillis);
    if (knownHash && knownHash !== migration.hash) {
      throw new Error(
        `Migration checksum mismatch for ${migration.folderMillis}. Refusing to open the database.`,
      );
    }
  }

  const insertMigration = client.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );
  for (const migration of migrations) {
    if (applied.has(migration.folderMillis)) continue;
    client.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.sql) {
        if (statement.trim()) client.exec(statement);
      }
      insertMigration.run(migration.hash, migration.folderMillis);
      client.exec("COMMIT");
    } catch (error) {
      client.exec("ROLLBACK");
      throw error;
    }
  }
}

async function valueBytes(value: RunsBucketValue): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(await new Response(value).arrayBuffer());
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export class FileRunsBucket implements RunsBucket {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(resolve(this.root, "runs"), { recursive: true, mode: 0o700 });
  }

  private async objectPath(key: string) {
    const legacy = key.match(/^runs\/(store-run-[a-z0-9-]+)\.json$/i);
    const versioned = key.match(
      /^runs\/(store-run-[a-z0-9-]+)\/([a-f0-9]{64})\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.json$/i,
    );
    if (!legacy && !versioned) {
      throw new Error("Invalid run object key.");
    }
    // Keep the filesystem layout flat.  Besides making backup/restore simple,
    // this prevents a pre-created symlink in a run-id directory from making a
    // nested content-addressed key escape RUNS_PATH.
    const objectName = legacy
      ? `${legacy[1]}.json`
      : `${versioned![1]}--${versioned![2]}--${versioned![3]}.json`;
    const rootPath = await realpath(this.root);
    const runDirectory = resolve(this.root, "runs");
    await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const parentPath = await realpath(runDirectory);
    if (
      parentPath !== rootPath &&
      !parentPath.startsWith(`${rootPath}${sep}`)
    ) {
      throw new Error("Run object directory escapes its configured root.");
    }
    return resolve(parentPath, objectName);
  }

  async put(key: string, value: RunsBucketValue) {
    const target = await this.objectPath(key);
    const temporary = resolve(
      dirname(target),
      `.${basename(target)}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, await valueBytes(value), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((error) => {
        if (!isMissing(error)) throw error;
      });
    }
  }

  async get(key: string) {
    const target = await this.objectPath(key);
    try {
      const details = await lstat(target);
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new Error("Run object is not a regular file.");
      }
      return {
        size: details.size,
        text: () => readFile(target, "utf8"),
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(key: string) {
    const target = await this.objectPath(key);
    try {
      const details = await lstat(target);
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new Error("Run object is not a regular file.");
      }
      await unlink(target);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

export function createNodePersistence(options: NodePersistenceOptions) {
  const databasePath =
    options.databasePath === ":memory:"
      ? options.databasePath
      : resolve(options.databasePath);
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  }
  const client = new DatabaseSync(databasePath, {
    allowExtension: false,
    enableForeignKeyConstraints: true,
  });
  client.exec("PRAGMA busy_timeout = 5000");
  if (databasePath !== ":memory:") client.exec("PRAGMA journal_mode = WAL");
  client.exec("PRAGMA synchronous = NORMAL");
  try {
    applyMigrations(client, resolve(options.migrationsFolder));
    client.exec("PRAGMA optimize");
    const callbacks = databaseCallbacks(client);
    const db = drizzle(callbacks.query, callbacks.batch, { schema });
    const bucket = new FileRunsBucket(options.runsRoot);
    return {
      db,
      bucket,
      databasePath,
      close() {
        client.close();
      },
    };
  } catch (error) {
    client.close();
    throw error;
  }
}

let singleton: ReturnType<typeof createNodePersistence> | undefined;

function environmentPath(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  if (value?.includes("\0")) throw new Error(`${name} contains a null byte.`);
  return resolve(value || fallback);
}

function persistence() {
  if (singleton) return singleton;
  const dataRoot = environmentPath("APP_DATA_DIR", resolve(process.cwd(), ".data"));
  singleton = createNodePersistence({
    databasePath: environmentPath(
      "DATABASE_PATH",
      resolve(dataRoot, "team.sqlite"),
    ),
    runsRoot: environmentPath("RUNS_PATH", resolve(dataRoot, "objects")),
    migrationsFolder: environmentPath(
      "MIGRATIONS_PATH",
      resolve(process.cwd(), "drizzle"),
    ),
  });
  return singleton;
}

export function getDb() {
  return persistence().db;
}

export function getRunsBucket(): RunsBucket {
  return persistence().bucket;
}

export type AppDb = ReturnType<typeof getDb>;
