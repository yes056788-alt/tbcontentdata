import { requireSession } from "@/app/server/authz";
import {
  extensionDownloadResponse,
  protectedAssetErrorResponse,
} from "@/app/server/protected-assets";

type RouteContext = {
  params: Promise<{ filename: string }> | { filename: string };
};

async function respond(request: Request, context: RouteContext) {
  try {
    await requireSession(request);
    const { filename } = await context.params;
    return extensionDownloadResponse(String(filename ?? ""), {
      head: request.method === "HEAD",
    });
  } catch (error) {
    return protectedAssetErrorResponse(error, request);
  }
}

export const GET = respond;
export const HEAD = respond;
