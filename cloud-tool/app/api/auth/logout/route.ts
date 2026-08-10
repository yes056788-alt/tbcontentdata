import {
  assertSameOrigin,
  clearSessionCookie,
  revokeRequestSession,
} from "@/app/server/auth";
import { jsonResponse, withApiErrors } from "@/app/server/http";

export async function POST(request: Request) {
  return withApiErrors(async () => {
    assertSameOrigin(request);
    await revokeRequestSession(request);
    return jsonResponse(
      { loggedOut: true },
      200,
      { "Set-Cookie": clearSessionCookie() },
    );
  });
}
