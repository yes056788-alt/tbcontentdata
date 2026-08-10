/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  RUNS: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const TEAM_SESSION_COOKIE = "tb_team_session";
const PUBLIC_PAGE_PATHS = new Set(["/login", "/setup", "/change-password"]);
const PUBLIC_AUTH_API_PATHS = new Set([
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/setup",
]);
const PUBLIC_ASSET_PATHS = new Set(["/favicon.svg", "/social-preview.png"]);
const PUBLIC_ASSET_PREFIXES = ["/_next/", "/assets/"];

function normalizedPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function isPublicRequestPath(pathname: string): boolean {
  const path = normalizedPath(pathname);
  return (
    PUBLIC_PAGE_PATHS.has(path) ||
    PUBLIC_AUTH_API_PATHS.has(path) ||
    PUBLIC_ASSET_PATHS.has(path) ||
    PUBLIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    path === "/_vinext/image"
  );
}

function sessionCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const values: string[] = [];
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== TEAM_SESSION_COOKIE) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      values.push(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(values[0])) return null;
  return values[0];
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hasValidTeamSession(request: Request, env: Env): Promise<boolean> {
  const token = sessionCookie(request);
  if (!token || !env.DB) return false;
  try {
    const tokenHash = await sha256Hex(token);
    const row = await env.DB.prepare(
      `select s.id
       from auth_sessions s
       inner join local_accounts a on a.member_id = s.member_id
       inner join members m on m.id = s.member_id
       where s.token_hash = ?1
         and s.revoked_at is null
         and s.expires_at > ?2
         and a.must_change_password = 0
         and m.status = 'active'
         and m.role in ('owner', 'admin')
       limit 1`,
    )
      .bind(tokenHash, Date.now())
      .first<{ id: string }>();
    return Boolean(row?.id);
  } catch (error) {
    // Missing migrations, unavailable D1, and malformed rows all fail closed.
    console.warn("[auth-gate] session validation failed", error);
    return false;
  }
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function loginRedirect(request: Request): Response {
  const requestUrl = new URL(request.url);
  const next = `${requestUrl.pathname}${requestUrl.search}`.slice(0, 1600);
  const location = new URL("/login", requestUrl.origin);
  if (next && next !== "/") location.searchParams.set("next", next);
  const headers = new Headers({
    Location: location.toString(),
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  return new Response(null, {
    status: request.method === "GET" || request.method === "HEAD" ? 302 : 303,
    headers,
  });
}

function protectedResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  const vary = (headers.get("Vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!vary.some((value) => value.toLowerCase() === "cookie")) vary.push("Cookie");
  headers.set("Vary", vary.join(", "));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const isProtectedPage = !isPublicRequestPath(url.pathname) && !isApiPath(url.pathname);
    if (isProtectedPage) {
      if (!(await hasValidTeamSession(request, env))) return loginRedirect(request);
    }

    const response = await handler.fetch(request, env, ctx);
    return isProtectedPage ? protectedResponse(response) : response;
  },
};

export default worker;
