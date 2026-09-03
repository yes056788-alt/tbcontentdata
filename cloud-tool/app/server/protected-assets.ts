import {
  EXTENSION_PACKAGE_BASE64,
  EXTENSION_PACKAGE_FILENAMES,
  EXTENSION_PACKAGE_VERSION,
  LEGACY_PAGE_HTML,
} from "./generated-protected-assets";
import { ApiError, NO_STORE_HEADERS } from "./http";
import { legacyContentSecurityPolicy } from "./legacy-csp";
import { configuredPublicOrigin } from "./runtime-config";

export const LEGACY_PAGE_FILENAMES = [
  "workspace.html",
  "accounts.html",
  "report.html",
  "comments.html",
  "data.html",
  "report-view.html",
] as const;

export type LegacyPageFilename = (typeof LEGACY_PAGE_FILENAMES)[number];

const HTML_SECURITY_HEADERS = {
  ...NO_STORE_HEADERS,
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": legacyContentSecurityPolicy(),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
} as const;

function legacyHtmlSecurityHeaders(filename: LegacyPageFilename) {
  return {
    ...HTML_SECURITY_HEADERS,
    "Content-Security-Policy": legacyContentSecurityPolicy(filename),
  };
}

const DOWNLOAD_SECURITY_HEADERS = {
  ...NO_STORE_HEADERS,
  "Content-Type": "application/zip",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

function responseHeaders(values: Record<string, string>) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(values)) headers.set(key, value);
  return headers;
}

export function legacyHtmlResponse(
  filename: LegacyPageFilename,
  options: { head?: boolean } = {},
) {
  const html = (LEGACY_PAGE_HTML as Record<string, string>)[filename];
  if (typeof html !== "string" || !/^<!doctype html>/i.test(html)) {
    throw new Error(`Generated protected HTML is missing: ${filename}`);
  }
  return new Response(options.head ? null : html, {
    status: 200,
    headers: responseHeaders({
      ...legacyHtmlSecurityHeaders(filename),
      "Content-Disposition": `inline; filename="${filename}"`,
    }),
  });
}

function safeNextPath(request: Request) {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || "";
}

function forwardedPublicOrigin(request: Request): string | undefined {
  const protocol = firstForwardedValue(
    request.headers.get("x-forwarded-proto"),
  ).toLowerCase();
  if (protocol !== "https" && protocol !== "http") return undefined;

  const requestUrl = new URL(request.url);
  const host =
    firstForwardedValue(request.headers.get("x-forwarded-host")) ||
    requestUrl.host;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return undefined;
  }
}

function publicRedirectOrigin(request: Request) {
  return (
    configuredPublicOrigin() ??
    forwardedPublicOrigin(request) ??
    new URL(request.url).origin
  );
}

function redirectResponse(request: Request, pathname: string) {
  return new Response(null, {
    status: 307,
    headers: responseHeaders({
      ...NO_STORE_HEADERS,
      Location: new URL(pathname, publicRedirectOrigin(request)).toString(),
      "Referrer-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    }),
  });
}

export function protectedAssetErrorResponse(error: unknown, request: Request) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return redirectResponse(
        request,
        `/login?next=${encodeURIComponent(safeNextPath(request))}`,
      );
    }
    if (error.code === "PASSWORD_CHANGE_REQUIRED") {
      return redirectResponse(request, "/change-password");
    }
    const status = error.status >= 400 && error.status <= 599
      ? error.status
      : 500;
    const body = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>无法访问</title></head><body><main><h1>无法访问</h1><p>${status === 403 ? "当前账号无权访问此页面。" : "服务器暂时无法处理请求。"}</p><p><a href="/login">返回登录</a></p></main></body></html>`;
    return new Response(request.method === "HEAD" ? null : body, {
      status,
      headers: responseHeaders(HTML_SECURITY_HEADERS),
    });
  }
  console.error(
    "Protected asset route failed",
    error instanceof Error ? error.name : typeof error,
  );
  return new Response(
    request.method === "HEAD"
      ? null
      : "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>服务器错误</title></head><body><h1>服务器暂时不可用</h1></body></html>",
    {
      status: 500,
      headers: responseHeaders(HTML_SECURITY_HEADERS),
    },
  );
}

function base64ToArrayBuffer(value: string) {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Generated extension package is not valid base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export function extensionDownloadResponse(
  filename: string,
  options: { head?: boolean } = {},
) {
  const allowed = new Set<string>(EXTENSION_PACKAGE_FILENAMES);
  if (!allowed.has(filename)) {
    return new Response(null, {
      status: 404,
      headers: responseHeaders(DOWNLOAD_SECURITY_HEADERS),
    });
  }
  if (!EXTENSION_PACKAGE_BASE64) {
    throw new Error("Generated extension package is missing");
  }
  const quotedFilename = filename.replace(/["\\\r\n]/g, "_");
  return new Response(
    options.head ? null : base64ToArrayBuffer(EXTENSION_PACKAGE_BASE64),
    {
      status: 200,
      headers: responseHeaders({
        ...DOWNLOAD_SECURITY_HEADERS,
        "Content-Disposition": `attachment; filename="${quotedFilename}"`,
        "X-Extension-Version": EXTENSION_PACKAGE_VERSION,
      }),
    },
  );
}
