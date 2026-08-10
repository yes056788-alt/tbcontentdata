import { and, eq } from "drizzle-orm";
import { requireSession, vaultReaders, workspaceManagers } from "@/app/server/authz";
import { writeAudit } from "@/app/server/audit";
import {
  ApiError,
  jsonResponse,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import { parseExpectedRevision, revisionEtag } from "@/app/server/revisions";
import { validateEncryptedVault } from "@/app/server/vault";
import { getDb } from "@/runtime-db";
import { sharedVault } from "@/db/schema";

const VAULT_ROW_ID = 1;
const MAX_VAULT_REQUEST_BYTES = 3_000_000;

export async function GET(request: Request) {
  return withApiErrors(async () => {
    await requireSession(request, vaultReaders);
    const [row] = await getDb()
      .select()
      .from(sharedVault)
      .where(eq(sharedVault.id, VAULT_ROW_ID))
      .limit(1);
    if (!row) {
      return jsonResponse(
        { vault: null, revision: 0, updatedAt: null },
        200,
        { ETag: revisionEtag(0) },
      );
    }
    return jsonResponse(
      {
        vault: JSON.parse(row.encryptedPayload) as unknown,
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
      await readJsonBody<unknown>(request, MAX_VAULT_REQUEST_BYTES),
    );
    const expectedRevision = parseExpectedRevision(
      request,
      body.expectedRevision,
    );
    const vault = validateEncryptedVault(body.vault);
    const encryptedPayload = JSON.stringify(vault);
    const payloadBytes = new TextEncoder().encode(encryptedPayload).byteLength;
    const now = new Date();
    const nextRevision = expectedRevision + 1;
    const db = getDb();

    let saved: typeof sharedVault.$inferSelect | undefined;
    if (expectedRevision === 0) {
      [saved] = await db
        .insert(sharedVault)
        .values({
          id: VAULT_ROW_ID,
          encryptedPayload,
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
        .update(sharedVault)
        .set({
          encryptedPayload,
          payloadBytes,
          revision: nextRevision,
          updatedBy: session.member.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(sharedVault.id, VAULT_ROW_ID),
            eq(sharedVault.revision, expectedRevision),
          ),
        )
        .returning();
    }

    if (!saved) {
      const [current] = await db
        .select({ revision: sharedVault.revision })
        .from(sharedVault)
        .where(eq(sharedVault.id, VAULT_ROW_ID))
        .limit(1);
      throw new ApiError(
        409,
        "REVISION_CONFLICT",
        "账号库已被其他成员更新，请同步最新版本后重试。",
        { currentRevision: current?.revision ?? 0 },
      );
    }

    await writeAudit(session, "vault.updated", "shared_vault", "shared", {
      revision: saved.revision,
      payloadBytes,
    });
    return jsonResponse(
      {
        vault: JSON.parse(saved.encryptedPayload) as unknown,
        revision: saved.revision,
        updatedAt: saved.updatedAt,
      },
      200,
      { ETag: revisionEtag(saved.revision) },
    );
  });
}
