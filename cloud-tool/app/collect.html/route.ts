import { requireSession } from "@/app/server/authz";
import { protectedAssetErrorResponse } from "@/app/server/protected-assets";

async function respond(request: Request) {
  try {
    await requireSession(request);
    return new Response(null, {
      status: 307,
      headers: {
        "Cache-Control": "no-store",
        Location: `/report.html${new URL(request.url).search}`,
        "Referrer-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return protectedAssetErrorResponse(error, request);
  }
}

export const GET = respond;
export const HEAD = respond;
