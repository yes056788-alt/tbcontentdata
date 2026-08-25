import { desc, eq, sql } from "drizzle-orm";
import { requireSession, runWriters } from "@/app/server/authz";
import { writeAudit } from "@/app/server/audit";
import {
  ApiError,
  jsonResponse,
  parseInteger,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import {
  extractRunMetadata,
  serializeRunMetadata,
  sha256Hex,
} from "@/app/server/runs";
import { encryptRunPayload } from "@/app/server/run-crypto";
import { getDb, getRunsBucket } from "@/runtime-db";
import { runDeletions, runs } from "@/db/schema";

const MAX_RUN_REQUEST_BYTES = 25 * 1024 * 1024;
const RUN_DELETED_TOMBSTONE_ERROR = "RUN_DELETED_TOMBSTONE";

function isRunDeletedTombstoneError(error: unknown) {
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; current !== undefined && depth < 6; depth += 1) {
    if (typeof current === "string") {
      return current.includes(RUN_DELETED_TOMBSTONE_ERROR);
    }
    if (!current || typeof current !== "object" || seen.has(current)) {
      return false;
    }
    seen.add(current);
    if (
      "message" in current &&
      typeof current.message === "string" &&
      current.message.includes(RUN_DELETED_TOMBSTONE_ERROR)
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function versionedBlobKey(runId: string, payloadSha256: string) {
  // Each write owns a unique object.  The hash keeps the object
  // content-addressable for incident recovery while the UUID prevents one
  // failed/concurrent request from deleting another request's in-flight blob.
  return `runs/${runId}/${payloadSha256}/${crypto.randomUUID()}.json`;
}

async function deleteBlobOnlyWhenUnreferenced(
  db: ReturnType<typeof getDb>,
  blobKey: string,
) {
  try {
    const [reference] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.blobKey, blobKey))
      .limit(1);
    if (!reference) {
      await getRunsBucket().delete(blobKey);
    }
  } catch {
    // Cleanup is deliberately best-effort.  If the database cannot prove the
    // object is unreferenced, retaining an orphan is safer than breaking a run
    // whose DB commit succeeded but whose response was interrupted.
  }
}

export async function GET(request: Request) {
  return withApiErrors(async () => {
    await requireSession(request);
    const url = new URL(request.url);
    const limit =
      parseInteger(url.searchParams.get("limit"), "limit", {
        min: 1,
        max: 1_000,
      }) ?? 1_000;
    const db = getDb();
    const rows = await db
      .select()
      .from(runs)
      .where(sql`not exists (
        select 1 from ${runDeletions}
        where ${runDeletions.runId} = ${runs.id}
      )`)
      .orderBy(desc(runs.sourceUpdatedAt), desc(runs.createdAt), desc(runs.id))
      .limit(limit);
    const deletions = await db
      .select({ runId: runDeletions.runId })
      .from(runDeletions)
      .orderBy(desc(runDeletions.deletedAt), desc(runDeletions.runId));
    return jsonResponse({
      runs: rows.map(serializeRunMetadata),
      deletedRunIds: deletions.map((item) => item.runId),
    });
  });
}

export async function POST(request: Request) {
  return withApiErrors(async () => {
    const session = await requireSession(request, runWriters);
    const body = requireObject(
      await readJsonBody<unknown>(request, MAX_RUN_REQUEST_BYTES),
    );
    if (
      body.expectedAbsent !== undefined &&
      typeof body.expectedAbsent !== "boolean"
    ) {
      throw new ApiError(
        400,
        "INVALID_EXPECTED_ABSENT",
        "expectedAbsent 必须是布尔值。",
      );
    }
    const metadata = extractRunMetadata(body.run, body.metadata);
    const payload = JSON.stringify(body.run);
    const payloadBytes = new TextEncoder().encode(payload).byteLength;
    if (payloadBytes > 24 * 1024 * 1024) {
      throw new ApiError(
        413,
        "RUN_TOO_LARGE",
        "单条历史归档不能超过 24MB。",
      );
    }
    const payloadSha256 = await sha256Hex(payload);
    const db = getDb();
    const [existingDeletion] = await db
      .select({ runId: runDeletions.runId })
      .from(runDeletions)
      .where(eq(runDeletions.runId, metadata.id))
      .limit(1);
    if (existingDeletion) {
      throw new ApiError(
        410,
        "RUN_DELETED",
        "该历史归档已删除，不能由旧客户端重新上传。",
      );
    }
    const [existing] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, metadata.id))
      .limit(1);

    if (existing && body.expectedAbsent === true) {
      throw new ApiError(
        409,
        "RUN_ALREADY_EXISTS",
        "该历史归档已存在，请刷新云端记录后重试。",
      );
    }

    const incomingFreshness = metadata.sourceUpdatedAt.getTime();
    const existingFreshness = existing?.sourceUpdatedAt?.getTime() ?? 0;
    if (existing && existingFreshness > incomingFreshness) {
      return jsonResponse({
        run: serializeRunMetadata(existing),
        stored: false,
        reason: "server-newer",
      });
    }
    if (
      existing &&
      existingFreshness === incomingFreshness &&
      existing.payloadSha256 === payloadSha256
    ) {
      return jsonResponse({
        run: serializeRunMetadata(existing),
        stored: false,
        reason: "already-current",
      });
    }
    if (
      existing &&
      existingFreshness === incomingFreshness &&
      existing.payloadSha256 !== payloadSha256
    ) {
      throw new ApiError(
        409,
        "RUN_CONTENT_CONFLICT",
        "相同更新时间的历史归档内容不一致，请保留更新版本后重试。",
      );
    }

    const blobKey = versionedBlobKey(metadata.id, payloadSha256);
    const encryptedPayload = await encryptRunPayload(payload, request);
    await getRunsBucket().put(blobKey, encryptedPayload, {
      httpMetadata: { contentType: "application/vnd.taobao.run+encrypted" },
      customMetadata: {
        sha256: payloadSha256,
        payloadBytes: String(payloadBytes),
      },
    });

    const now = new Date();
    const insert = db.insert(runs).values({
      ...metadata,
      blobKey,
      payloadBytes,
      payloadSha256,
      createdBy: session.member.id,
      createdAt: now,
      updatedAt: now,
    });

    let saved: typeof runs.$inferSelect | undefined;
    try {
      if (body.expectedAbsent === true) {
        [saved] = await insert
          .onConflictDoNothing({ target: runs.id })
          .returning();
      } else {
        [saved] = await insert
          .onConflictDoUpdate({
            target: runs.id,
            set: {
              ...metadata,
              blobKey,
              payloadBytes,
              payloadSha256,
              updatedAt: now,
            },
            // The freshness check must be part of the same SQLite/D1 write as
            // the upsert.  A preflight SELECT alone is racy when two clients
            // upload the same runId concurrently.
            setWhere: sql`${runs.sourceUpdatedAt} is null or ${runs.sourceUpdatedAt} < excluded.source_updated_at`,
          })
          .returning();
      }
    } catch (error) {
      await deleteBlobOnlyWhenUnreferenced(db, blobKey);
      if (isRunDeletedTombstoneError(error)) {
        throw new ApiError(
          410,
          "RUN_DELETED",
          "该历史归档已删除，不能由旧客户端重新上传。",
        );
      }
      throw error;
    }

    const [committedDeletion] = await db
      .select({ runId: runDeletions.runId })
      .from(runDeletions)
      .where(eq(runDeletions.runId, metadata.id))
      .limit(1);
    if (committedDeletion) {
      const [deletedCurrent] = await db
        .delete(runs)
        .where(eq(runs.id, metadata.id))
        .returning({ blobKey: runs.blobKey });
      await deleteBlobOnlyWhenUnreferenced(db, blobKey);
      if (deletedCurrent?.blobKey && deletedCurrent.blobKey !== blobKey) {
        await deleteBlobOnlyWhenUnreferenced(db, deletedCurrent.blobKey);
      }
      if (
        existing?.blobKey &&
        existing.blobKey !== blobKey &&
        existing.blobKey !== deletedCurrent?.blobKey
      ) {
        await deleteBlobOnlyWhenUnreferenced(db, existing.blobKey);
      }
      throw new ApiError(
        410,
        "RUN_DELETED",
        "该历史归档已删除，不能由旧客户端重新上传。",
      );
    }

    const [current] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, metadata.id))
      .limit(1);
    if (!current) {
      await deleteBlobOnlyWhenUnreferenced(db, blobKey);
      throw new ApiError(500, "RUN_SAVE_FAILED", "历史归档保存失败。");
    }

    // A newer/equal contender may have won after our preflight read.  Never
    // report our object as current unless the final DB row actually points to
    // it; the unique version key can then be removed without touching the
    // winner's body.
    if (!saved || current.blobKey !== blobKey) {
      await deleteBlobOnlyWhenUnreferenced(db, blobKey);
      if (body.expectedAbsent === true) {
        throw new ApiError(
          409,
          "RUN_ALREADY_EXISTS",
          "该历史归档已存在，请刷新云端记录后重试。",
        );
      }

      const currentFreshness = current.sourceUpdatedAt?.getTime() ?? 0;
      if (currentFreshness > incomingFreshness) {
        return jsonResponse({
          run: serializeRunMetadata(current),
          stored: false,
          reason: "server-newer",
        });
      }
      if (
        currentFreshness === incomingFreshness &&
        current.payloadSha256 === payloadSha256
      ) {
        return jsonResponse({
          run: serializeRunMetadata(current),
          stored: false,
          reason: "already-current",
        });
      }
      if (currentFreshness === incomingFreshness) {
        throw new ApiError(
          409,
          "RUN_CONTENT_CONFLICT",
          "相同更新时间的历史归档内容不一致，请保留更新版本后重试。",
        );
      }
      throw new ApiError(500, "RUN_SAVE_FAILED", "历史归档保存失败。");
    }

    if (existing?.blobKey && existing.blobKey !== blobKey) {
      await deleteBlobOnlyWhenUnreferenced(db, existing.blobKey);
    }

    await writeAudit(session, "run.saved", "run", current.id, {
      runId: current.id,
      storeId: current.storeId,
      taskType: current.taskType,
      failureCount: current.failureCount,
      payloadBytes,
    });
    return jsonResponse(
      { run: serializeRunMetadata(current), stored: true },
      existing ? 200 : 201,
    );
  });
}
