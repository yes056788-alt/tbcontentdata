import { permissionsForRole, requireSession } from "@/app/server/authz";
import { jsonResponse, withApiErrors } from "@/app/server/http";

export async function GET(request: Request) {
  return withApiErrors(async () => {
    const session = await requireSession(request, undefined, {
      allowPasswordChangeRequired: true,
    });
    return jsonResponse({
      user: {
        id: session.user.userId,
        username: session.user.username,
        email: session.user.email,
        displayName: session.user.displayName,
      },
      member: {
        id: session.member.id,
        email: session.member.email,
        displayName: session.member.displayName,
        role: session.member.role,
        status: session.member.status,
      },
      role: session.member.role,
      mustChangePassword: session.account.mustChangePassword,
      permissions: permissionsForRole(session.member.role),
    });
  });
}
