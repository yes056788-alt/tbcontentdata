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
import { runs } from "@/db/schema";

const MAX_RUN_REQUEST_BYTES = 25 * 1024 * 1024;

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
    const rows = await getDb()
      .select()
      .from(runs)
      .orderBy(desc(runs.sourceUpdatedAt), desc(runs.createdAt), desc(runs.id))
      .limit(limit);
    return jsonResponse({ runs: rows.map(serializeRunMetadata) });
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
      throw error;
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
