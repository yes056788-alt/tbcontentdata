import { requireSession } from "@/app/server/authz";
import {
  legacyHtmlResponse,
  protectedAssetErrorResponse,
} from "@/app/server/protected-assets";

async function respond(request: Request) {
  try {
    await requireSession(request);
    return legacyHtmlResponse("collect.html", {
      head: request.method === "HEAD",
    });
  } catch (error) {
    return protectedAssetErrorResponse(error, request);
  }
}

export const GET = respond;
export const HEAD = respond;
