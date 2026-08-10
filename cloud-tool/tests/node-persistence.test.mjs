import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createNodePersistence } from "../db/node.ts";
import { members, sharedDocuments } from "../db/schema.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function member(id, email) {
  const now = new Date();
  return {
    id,
    userId: null,
    email,
    displayName: id,
    role: "admin",
    status: "active",
    invitedBy: null,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: null,
  };
}

test("Node SQLite migrations, atomic batches and filesystem objects persist", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbdata-node-persistence-"));
  const databasePath = join(root, "team.sqlite");
  const runsRoot = join(root, "objects");
  let persistence;
  try {
    persistence = createNodePersistence({
      databasePath,
      runsRoot,
      migrationsFolder,
    });
    await assert.rejects(
      persistence.db.batch([
        persistence.db
          .insert(members)
          .values(member("duplicate", "one@example.invalid")),
        persistence.db
          .insert(members)
          .values(member("duplicate", "two@example.invalid")),
      ]),
    );
    assert.deepEqual(
      await persistence.db
        .select()
        .from(members)
        .where(eq(members.id, "duplicate")),
      [],
      "a failed batch must roll back every statement",
    );

    await persistence.db.insert(sharedDocuments).values({
      key: "node-test",
      jsonPayload: '{"ok":true}',
      payloadBytes: 11,
      revision: 1,
      updatedBy: "test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await persistence.bucket.put(
      "runs/store-run-node-persistence.json",
      "encrypted-test-value",
    );
    const versionedKey = `runs/store-run-node-versioned/${"a".repeat(64)}/123e4567-e89b-42d3-a456-426614174000.json`;
    await persistence.bucket.put(versionedKey, "encrypted-versioned-value");
    const firstObject = await persistence.bucket.get(
      "runs/store-run-node-persistence.json",
    );
    assert.equal(firstObject?.size, Buffer.byteLength("encrypted-test-value"));
    assert.equal(await firstObject?.text(), "encrypted-test-value");
    assert.equal(
      await (await persistence.bucket.get(versionedKey))?.text(),
      "encrypted-versioned-value",
    );
    await assert.rejects(
      persistence.bucket.put("../outside.json", "blocked"),
      /Invalid run object key/,
    );
    persistence.close();
    persistence = undefined;

    const reopened = createNodePersistence({
      databasePath,
      runsRoot,
      migrationsFolder,
    });
    persistence = reopened;
    const [document] = await reopened.db
      .select()
      .from(sharedDocuments)
      .where(eq(sharedDocuments.key, "node-test"));
    assert.equal(document?.revision, 1);
    assert.equal(
      await (
        await reopened.bucket.get("runs/store-run-node-persistence.json")
      )?.text(),
      "encrypted-test-value",
    );
    assert.equal(
      await (await reopened.bucket.get(versionedKey))?.text(),
      "encrypted-versioned-value",
    );
    await reopened.bucket.delete("runs/store-run-node-persistence.json");
    assert.equal(
      await reopened.bucket.get("runs/store-run-node-persistence.json"),
      null,
    );
    await reopened.bucket.delete(versionedKey);
    assert.equal(await reopened.bucket.get(versionedKey), null);
  } finally {
    persistence?.close();
    await rm(root, { recursive: true, force: true });
  }
});
