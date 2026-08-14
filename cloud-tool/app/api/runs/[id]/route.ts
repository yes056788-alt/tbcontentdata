import { eq } from "drizzle-orm";
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
import { getDb, getRunsBucket } from "@/runtime-db";
import { runs } from "@/db/schema";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function routeId(context: RouteContext) {
  const params = await context.params;
  return validateRunId(params.id);
}

export async function GET(request: Request, context: RouteContext) {
  return withApiErrors(async () => {
    await requireSession(request);
    const id = await routeId(context);
    const [row] = await getDb()
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
    if (!row) {
      throw new ApiError(404, "RUN_NOT_FOUND", "未找到这条历史归档。");
    }
    await db.delete(runs).where(eq(runs.id, id));
    await getRunsBucket().delete(row.blobKey);
    await writeAudit(session, "run.deleted", "run", id, {
      runId: id,
      storeId: row.storeId,
      taskType: row.taskType,
      payloadBytes: row.payloadBytes,
    });
    return jsonResponse({ deleted: true, runId: id });
  });
}
