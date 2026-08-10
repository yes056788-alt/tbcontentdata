import { and, eq } from "drizzle-orm";
import { requireSession, workspaceManagers } from "@/app/server/authz";
import { writeAudit } from "@/app/server/audit";
import { validateDirectory } from "@/app/server/directory";
import {
  ApiError,
  jsonResponse,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import { parseExpectedRevision, revisionEtag } from "@/app/server/revisions";
import { getDb } from "@/runtime-db";
import { sharedDocuments } from "@/db/schema";

const DIRECTORY_KEY = "project_directory";
const MAX_DIRECTORY_BYTES = 2_000_000;

export async function GET(request: Request) {
  return withApiErrors(async () => {
    await requireSession(request);
    const [row] = await getDb()
      .select()
      .from(sharedDocuments)
      .where(eq(sharedDocuments.key, DIRECTORY_KEY))
      .limit(1);
    if (!row) {
      return jsonResponse(
        { directory: null, revision: 0, updatedAt: null },
        200,
        { ETag: revisionEtag(0) },
      );
    }
    return jsonResponse(
      {
        directory: JSON.parse(row.jsonPayload) as unknown,
        revision: row.revision,
        updatedAt: row.updatedAt,
      },
      200,
      { ETag: revisionEtag(row.revision) },
    );
  });
}

export async function PUT(request: Request) {
  return withApiErrors(async () => {
    const session = await requireSession(request, workspaceManagers);
    const body = requireObject(
      await readJsonBody<unknown>(request, MAX_DIRECTORY_BYTES),
    );
    const expectedRevision = parseExpectedRevision(
      request,
      body.expectedRevision,
    );
    const directory = validateDirectory(body.directory);
    const jsonPayload = JSON.stringify(directory);
    const payloadBytes = new TextEncoder().encode(jsonPayload).byteLength;
    const now = new Date();
    const nextRevision = expectedRevision + 1;
    const db = getDb();

    let saved: typeof sharedDocuments.$inferSelect | undefined;
    if (expectedRevision === 0) {
      [saved] = await db
        .insert(sharedDocuments)
        .values({
          key: DIRECTORY_KEY,
          jsonPayload,
          payloadBytes,
          revision: nextRevision,
          updatedBy: session.member.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
    } else {
      [saved] = await db
        .update(sharedDocuments)
        .set({
          jsonPayload,
          payloadBytes,
          revision: nextRevision,
          updatedBy: session.member.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(sharedDocuments.key, DIRECTORY_KEY),
            eq(sharedDocuments.revision, expectedRevision),
          ),
        )
        .returning();
    }

    if (!saved) {
      const [current] = await db
        .select({ revision: sharedDocuments.revision })
        .from(sharedDocuments)
        .where(eq(sharedDocuments.key, DIRECTORY_KEY))
        .limit(1);
      throw new ApiError(
        409,
        "REVISION_CONFLICT",
        "项目目录已被其他成员更新，请同步最新版本后重试。",
        { currentRevision: current?.revision ?? 0 },
      );
    }

    await writeAudit(session, "directory.updated", "shared_document", DIRECTORY_KEY, {
      revision: saved.revision,
      payloadBytes,
    });
    return jsonResponse(
      {
        directory: JSON.parse(saved.jsonPayload) as unknown,
        revision: saved.revision,
        updatedAt: saved.updatedAt,
      },
      200,
      { ETag: revisionEtag(saved.revision) },
    );
  });
}
