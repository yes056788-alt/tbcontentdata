import { eq, sql } from "drizzle-orm";
import { requireSession, workspaceManagers } from "@/app/server/authz";
import { writeAudit } from "@/app/server/audit";
import {
  ApiError,
  jsonResponse,
  withApiErrors,
} from "@/app/server/http";
import {
  assertRunPayloadSafe,
  serializeRunMetadata,
  sha256Hex,
  validateRunId,
} from "@/app/server/runs";
import { decryptRunPayload } from "@/app/server/run-crypto";
import { deleteRunBodyBestEffort } from "@/app/server/run-deletion";
import { getDb, getRunsBucket } from "@/runtime-db";
import { runDeletions, runs } from "@/db/schema";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function routeId(context: RouteContext) {
  const params = await context.params;
  return validateRunId(params.id);
}

export async function GET(request: Request, context: RouteContext) {
  return withApiErrors(async () => {
    await requireSession(request);
    const id = await routeId(context);
    const db = getDb();
    const [deletion] = await db
      .select({ runId: runDeletions.runId })
      .from(runDeletions)
      .where(eq(runDeletions.runId, id))
      .limit(1);
    if (deletion) {
      throw new ApiError(404, "RUN_NOT_FOUND", "未找到这条历史归档。");
    }
    const [row] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, id))
      .limit(1);
    if (!row) {
      throw new ApiError(404, "RUN_NOT_FOUND", "未找到这条历史归档。");
    }
    const object = await getRunsBucket().get(row.blobKey);
    if (!object) {
      throw new ApiError(
        503,
        "RUN_BODY_UNAVAILABLE",
        "历史归档正文暂时不可用，请联系管理员。",
      );
    }
    const encrypted = await object.text();
    const text = await decryptRunPayload(encrypted, request);
    if ((await sha256Hex(text)) !== row.payloadSha256) {
      throw new ApiError(
        503,
        "RUN_BODY_INTEGRITY_FAILED",
        "历史归档完整性校验失败，请联系管理员。",
      );
    }
    let run: unknown;
    try {
      run = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(
        503,
        "RUN_BODY_INVALID",
        "历史归档正文已损坏，请联系管理员。",
      );
    }
    assertRunPayloadSafe(run);
    return jsonResponse({ run, metadata: serializeRunMetadata(row) });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return withApiErrors(async () => {
    const session = await requireSession(request, workspaceManagers);
    const id = await routeId(context);
    const db = getDb();
    const [row] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
    const [existingDeletion] = await db
      .select({ blobKey: runDeletions.blobKey })
      .from(runDeletions)
      .where(eq(runDeletions.runId, id))
      .limit(1);
    const deletedAt = new Date();
    const [insertedDeletions, deletedRows] = await db.batch([
      db.insert(runDeletions).values({
        runId: id,
        // Resolve the key inside the same atomic batch that creates the
        // tombstone and removes the row.  This keeps cleanup retryable even
        // when an upload races with the preflight SELECT above.
        blobKey: sql<string | null>`(
          select ${runs.blobKey} from ${runs} where ${runs.id} = ${id}
        )`,
        deletedBy: session.member.id,
        deletedAt,
      }).onConflictDoNothing({ target: runDeletions.runId })
        .returning({
          runId: runDeletions.runId,
          blobKey: runDeletions.blobKey,
        }),
      db.delete(runs)
        .where(eq(runs.id, id))
        .returning({ blobKey: runs.blobKey }),
    ]);
    const deletedRow = deletedRows[0];
    const blobKey =
      deletedRow?.blobKey ||
      insertedDeletions[0]?.blobKey ||
      existingDeletion?.blobKey ||
      row?.blobKey;
    let cleanupPending = false;
    if (blobKey) {
      const bodyDeleted = await deleteRunBodyBestEffort(
        getRunsBucket(),
        blobKey,
        (error) => {
          cleanupPending = true;
          console.error(
            "Run body cleanup failed after logical deletion",
            id,
            error instanceof Error ? error.name : typeof error,
          );
        },
      );
      if (bodyDeleted) {
        try {
          await db
            .update(runDeletions)
            .set({ blobKey: null })
            .where(eq(runDeletions.runId, id));
        } catch (error) {
          // The body is already gone.  Retaining the key is safe and lets a
          // later idempotent DELETE repair the tombstone reference.
          cleanupPending = true;
          console.error(
            "Run deletion tombstone cleanup failed",
            id,
            error instanceof Error ? error.name : typeof error,
          );
        }
      }
    }
    const newlyDeleted = Boolean(insertedDeletions[0]);
    if (newlyDeleted) {
      try {
        await writeAudit(session, "run.deleted", "run", id, {
          runId: id,
          storeId: row?.storeId ?? null,
          taskType: row?.taskType ?? null,
          payloadBytes: row?.payloadBytes ?? null,
        });
      } catch (error) {
        // The tombstone itself records who deleted the run and when.  An
        // auxiliary audit write must not turn a committed delete into a 500.
        console.error(
          "Run deletion audit write failed",
          id,
          error instanceof Error ? error.name : typeof error,
        );
      }
    }
    return jsonResponse({
      deleted: true,
      runId: id,
      cleanupPending,
      ...(newlyDeleted ? {} : { alreadyDeleted: true }),
    });
  });
}
