import { desc } from "drizzle-orm";
import { requireSession } from "@/app/server/authz";
import {
  ApiError,
  jsonResponse,
  parseInteger,
  withApiErrors,
} from "@/app/server/http";
import { serializeRunMetadata } from "@/app/server/runs";
import { getDb } from "@/runtime-db";
import { runs } from "@/db/schema";

function decodeCursor(value: string | null) {
  if (!value) return 0;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as unknown;
    const offset = Number(
      decoded && typeof decoded === "object" && !Array.isArray(decoded)
        ? (decoded as Record<string, unknown>).offset
        : NaN,
    );
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error();
    return offset;
  } catch {
    throw new ApiError(400, "INVALID_MIGRATION_CURSOR", "迁移分页游标无效。");
  }
}

function encodeCursor(offset: number) {
  return btoa(JSON.stringify({ offset }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET(request: Request) {
  return withApiErrors(async () => {
    await requireSession(request, ["owner"]);
    const url = new URL(request.url);
    const limit = parseInteger(url.searchParams.get("limit"), "limit", {
      min: 1,
      max: 200,
    }) ?? 100;
    const offset = decodeCursor(url.searchParams.get("cursor"));
    const rows = await getDb()
      .select()
      .from(runs)
      .orderBy(desc(runs.sourceUpdatedAt), desc(runs.createdAt), desc(runs.id))
      .limit(limit + 1)
      .offset(offset);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return jsonResponse({
      items: page.map((row) => ({
        ...serializeRunMetadata(row),
        sha256: row.payloadSha256,
      })),
      nextCursor: hasMore ? encodeCursor(offset + page.length) : null,
    });
  });
}
