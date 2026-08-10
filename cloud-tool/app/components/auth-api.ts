export type AuthStatus = {
  authenticated: boolean;
  setupRequired: boolean;
  mustChangePassword: boolean;
  username: string;
  displayName: string;
};

export class ClientApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "") {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.code = code;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function recordOf(...values: unknown[]): Record<string, unknown> {
  return values.find(isRecord) as Record<string, unknown> | undefined ?? {};
}

export function textOf(...values: unknown[]) {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value.trim() : "";
}

export async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const root = recordOf(body);
    const apiError = recordOf(root.error);
    throw new ClientApiError(
      textOf(apiError.message, root.message) || `请求失败（${response.status}）`,
      response.status,
      textOf(apiError.code, root.code),
    );
  }
  return body;
}

export function normalizeAuthStatus(payload: unknown): AuthStatus {
  const root = recordOf(payload);
  const data = recordOf(root.data, root.status, root);
  const user = recordOf(data.user, root.user);
  return {
    authenticated: Boolean(data.authenticated ?? root.authenticated ?? user.username),
    setupRequired: Boolean(data.setupRequired ?? root.setupRequired ?? data.needsSetup ?? root.needsSetup),
    mustChangePassword: Boolean(
      data.mustChangePassword ?? root.mustChangePassword ?? user.mustChangePassword,
    ),
    username: textOf(user.username, data.username),
    displayName: textOf(user.displayName, user.name, data.displayName),
  };
}

export function isLocalPreview() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

export function safeNextPath(value: string | null, fallback = "/") {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  if (["/login", "/setup", "/change-password"].some((path) => candidate.startsWith(path))) return fallback;
  return candidate;
}

export function loginPath(nextPath: string) {
  return `/login?next=${encodeURIComponent(safeNextPath(nextPath))}`;
}
