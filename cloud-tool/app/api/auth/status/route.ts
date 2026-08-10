import { requireSession } from "@/app/server/authz";
import { ApiError, jsonResponse, withApiErrors } from "@/app/server/http";
import { getDb } from "@/runtime-db";
import { localAccounts } from "@/db/schema";

export async function GET(request: Request) {
  return withApiErrors(async () => {
    const [account] = await getDb().select().from(localAccounts).limit(1);
    if (!account) {
      return jsonResponse({
        authenticated: false,
        setupRequired: true,
        mustChangePassword: false,
        user: null,
      });
    }
    try {
      const session = await requireSession(request, undefined, {
        allowPasswordChangeRequired: true,
      });
      return jsonResponse({
        authenticated: true,
        setupRequired: false,
        mustChangePassword: session.account.mustChangePassword,
        user: {
          id: session.member.id,
          username: session.account.username,
          displayName: session.member.displayName || session.account.username,
          role: session.member.role,
          status: session.member.status,
          mustChangePassword: session.account.mustChangePassword,
        },
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        [401, 403].includes(error.status)
      ) {
        return jsonResponse({
          authenticated: false,
          setupRequired: false,
          mustChangePassword: false,
          user: null,
        });
      }
      throw error;
    }
  });
}
