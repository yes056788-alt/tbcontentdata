import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/runtime-db";
import { authSessions, members } from "@/db/schema";
import {
  createOpaqueSessionToken,
  secureTextEqual,
  SESSION_DURATION_SECONDS,
  sha256Hex,
} from "./auth-crypto";
import { ApiError } from "./http";
import { isLocalAccountRole } from "./local-account-role";
import { requestPublicOrigin, runtimeValue } from "./runtime-config";

export const SESSION_COOKIE_NAME = "tb_team_session";

function parseCookieHeader(value: string) {
  const output = new Map<string, string>();
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      output.set(key, decodeURIComponent(rawValue));
    } catch {
      output.set(key, rawValue);
    }
  }
  return output;
}

export function sessionTokenFromRequest(request: Request) {
  const token = parseCookieHeader(request.headers.get("cookie") ?? "").get(
    SESSION_COOKIE_NAME,
  );
  if (!token || token.length < 40 || token.length > 128) return null;
  return token;
}

export function sessionCookie(token: string) {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_DURATION_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function clearSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;
  const expectedOrigin = requestPublicOrigin(request);
  const origin = request.headers.get("origin");
  if (origin) {
    let actualOrigin = "";
    try {
      actualOrigin = new URL(origin).origin;
    } catch {
      // Rejected below.
    }
    if (actualOrigin === expectedOrigin) return;
  } else {
    const fetchSite = request.headers.get("sec-fetch-site");
    const referer = request.headers.get("referer");
    if (fetchSite === "same-origin" && referer) {
      try {
        if (new URL(referer).origin === expectedOrigin) return;
      } catch {
        // Rejected below.
      }
    }
  }
  throw new ApiError(
    403,
    "CROSS_ORIGIN_WRITE_BLOCKED",
    "写入请求必须来自当前网站。",
  );
}

export async function verifyBootstrapToken(value: unknown) {
  const configured = runtimeValue("BOOTSTRAP_TOKEN");
  if (!configured) {
    throw new ApiError(
      503,
      "BOOTSTRAP_NOT_CONFIGURED",
      "服务器尚未配置初始化令牌。",
    );
  }
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    !(await secureTextEqual(value, configured))
  ) {
    throw new ApiError(401, "INVALID_BOOTSTRAP_TOKEN", "初始化令牌无效。");
  }
}

export async function createSession(memberId: string) {
  const db = getDb();
  const [member] = await db
    .select({ role: members.role, status: members.status })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) {
    throw new ApiError(401, "MEMBER_NOT_FOUND", "未找到登录成员。");
  }
  if (member.status !== "active") {
    throw new ApiError(403, "MEMBER_DISABLED", "当前成员权限已被停用。");
  }
  if (!isLocalAccountRole(member.role)) {
    throw new ApiError(
      403,
      "LOCAL_ACCOUNT_ROLE_UNSUPPORTED",
      "当前版本仅支持所有者或管理员登录，请联系管理员调整角色。",
    );
  }
  const token = createOpaqueSessionToken();
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + SESSION_DURATION_SECONDS * 1000,
  );
  const [record] = await db
    .insert(authSessions)
    .values({
      id: crypto.randomUUID(),
      memberId,
      tokenHash,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
    })
    .returning();
  if (!record) {
    throw new ApiError(500, "SESSION_CREATE_FAILED", "登录会话创建失败。");
  }
  return { token, record };
}

export async function revokeRequestSession(request: Request) {
  const token = sessionTokenFromRequest(request);
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await getDb()
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
      ),
    );
}

export async function revokeMemberSessions(memberId: string) {
  await getDb()
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authSessions.memberId, memberId),
        isNull(authSessions.revokedAt),
      ),
    );
}
