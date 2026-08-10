import { desc } from "drizzle-orm";
import { getDb } from "@/runtime-db";
import { auditLogs } from "@/db/schema";
import type { AppSession } from "./authz";

const SAFE_METADATA_KEYS = new Set([
  "role",
  "status",
  "revision",
  "payloadBytes",
  "runId",
  "storeId",
  "taskType",
  "failureCount",
  "inviteStatus",
  "mustChangePassword",
]);

function sanitizeMetadata(metadata: Record<string, unknown> | undefined) {
  const safe: Record<string, string | number | boolean | null> = {};
  if (!metadata) return safe;
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      safe[key] = typeof value === "string" ? value.slice(0, 200) : value;
    }
  }
  return safe;
}

export async function writeAudit(
  session: AppSession,
  action: string,
  targetType: string,
  targetId = "",
  metadata?: Record<string, unknown>,
) {
  await getDb().insert(auditLogs).values(auditRecord(
    session,
    action,
    targetType,
    targetId,
    metadata,
  ));
}

export function auditRecord(
  session: AppSession,
  action: string,
  targetType: string,
  targetId = "",
  metadata?: Record<string, unknown>,
) {
  return {
    id: crypto.randomUUID(),
    actorMemberId: session.member.id,
    actorEmail: session.member.email,
    action: action.slice(0, 120),
    targetType: targetType.slice(0, 80),
    targetId: targetId.slice(0, 240),
    metadataJson: JSON.stringify(sanitizeMetadata(metadata)),
  };
}

export async function listAudit(limit: number) {
  const rows = await getDb()
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    metadata: JSON.parse(row.metadataJson) as Record<string, unknown>,
    metadataJson: undefined,
  }));
}
