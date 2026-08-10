import { requireSession, workspaceManagers } from "@/app/server/authz";
import { listAudit } from "@/app/server/audit";
import {
  jsonResponse,
  parseInteger,
  withApiErrors,
} from "@/app/server/http";

export async function GET(request: Request) {
  return withApiErrors(async () => {
    await requireSession(request, workspaceManagers);
    const limit =
      parseInteger(new URL(request.url).searchParams.get("limit"), "limit", {
        min: 1,
        max: 200,
      }) ?? 100;
    return jsonResponse({ audit: await listAudit(limit) });
  });
}
