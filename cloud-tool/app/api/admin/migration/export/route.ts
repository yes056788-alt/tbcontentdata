import { requireSession } from "@/app/server/authz";
import {
  businessMigrationFilename,
  createBusinessMigrationStream,
} from "@/app/server/migration-export";
import {
  ApiError,
  readJsonBody,
  requireObject,
  withApiErrors,
} from "@/app/server/http";
import { validateMigrationPassphrase } from "@/lib/business-migration-format.mjs";

const MAX_EXPORT_REQUEST_BYTES = 8_192;

export async function POST(request: Request) {
  return withApiErrors(async () => {
    await requireSession(request, ["owner"]);
    const body = requireObject(
      await readJsonBody<unknown>(request, MAX_EXPORT_REQUEST_BYTES),
    );
    let passphrase: string;
    try {
      passphrase = validateMigrationPassphrase(body.passphrase);
    } catch {
      throw new ApiError(
        400,
        "INVALID_MIGRATION_EXPORT_REQUEST",
        "迁移口令必须为 20–256 位，并同时包含字母、数字和特殊字符。",
      );
    }
    // Storage and cryptographic setup failures intentionally flow into the
    // shared API error boundary so internal error details are never echoed.
    const stream = await createBusinessMigrationStream(request, passphrase);
    return new Response(stream, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${businessMigrationFilename()}"`,
        "Content-Type": "application/vnd.taobao.business-migration",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
