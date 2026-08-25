import { eq } from "drizzle-orm";
import { requireSession, vaultReaders, workspaceManagers } from "@/app/server/authz";
import { auditRecord, writeAudit } from "@/app/server/audit";
import {
  jsonResponse,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import { parseExpectedRevision, revisionEtag } from "@/app/server/revisions";
import { validateEncryptedVault } from "@/app/server/vault";
import {
  deleteSharedVaultAtRevision,
  isSharedVaultTombstonePayload,
  saveSharedVaultAtRevision,
  SHARED_VAULT_ROW_ID,
} from "@/app/server/vault-deletion";
import { getDb } from "@/runtime-db";
import { sharedVault } from "@/db/schema";

const MAX_VAULT_REQUEST_BYTES = 3_000_000;
const MAX_VAULT_DELETE_REQUEST_BYTES = 10_000;

export async function GET(request: Request) {
  return withApiErrors(async () => {
    await requireSession(request, vaultReaders);
    const [row] = await getDb()
      .select()
      .from(sharedVault)
      .where(eq(sharedVault.id, SHARED_VAULT_ROW_ID))
      .limit(1);
    if (!row) {
      return jsonResponse(
        {
          vault: null,
          deleted: false,
          tombstone: false,
          revision: 0,
          updatedAt: null,
        },
        200,
        { ETag: revisionEtag(0) },
      );
    }
    if (isSharedVaultTombstonePayload(row.encryptedPayload)) {
      return jsonResponse(
        {
          vault: null,
          deleted: true,
          tombstone: true,
          revision: row.revision,
          updatedAt: row.updatedAt,
        },
        200,
        { ETag: revisionEtag(row.revision) },
      );
    }
    return jsonResponse(
      {
        vault: JSON.parse(row.encryptedPayload) as unknown,
        deleted: false,
        tombstone: false,
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
    const db = getDb();
    const recreate = body.recreate === true;
    const saved = await saveSharedVaultAtRevision(db, {
      encryptedPayload,
      payloadBytes,
      expectedRevision,
      updatedBy: session.member.id,
      recreate,
      now,
    });

    await writeAudit(
      session,
      recreate ? "vault.recreated" : "vault.updated",
      "shared_vault",
      "shared",
      {
        revision: saved.revision,
        payloadBytes,
      },
    );
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

export async function DELETE(request: Request) {
  return withApiErrors(async () => {
    const session = await requireSession(request, workspaceManagers);
    const body = request.body === null
      ? {}
      : requireObject(
          await readJsonBody<unknown>(request, MAX_VAULT_DELETE_REQUEST_BYTES),
        );
    const expectedRevision = parseExpectedRevision(
      request,
      body.expectedRevision,
    );
    const result = await deleteSharedVaultAtRevision(
      getDb(),
      expectedRevision,
      auditRecord(session, "vault.deleted", "shared_vault", "shared", {
        revision: expectedRevision + 1,
      }),
    );
    return jsonResponse(result, 200, {
      ETag: revisionEtag(result.revision),
    });
  });
}
