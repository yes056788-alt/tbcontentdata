export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Origin",
} as const;

export function jsonResponse(
  body: unknown,
  init: number | ResponseInit = 200,
  extraHeaders?: HeadersInit,
): Response {
  const responseInit: ResponseInit =
    typeof init === "number" ? { status: init } : { ...init };
  const headers = new Headers(responseInit.headers);
  Object.entries(NO_STORE_HEADERS).forEach(([key, value]) =>
    headers.set(key, value),
  );
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  responseInit.headers = headers;
  return Response.json(body, responseInit);
}

export async function readJsonBody<T>(
  request: Request,
  maxBytes = 1_000_000,
): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      `请求内容不能超过 ${maxBytes} 字节。`,
    );
  }

  const text = await request.text();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    throw new ApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      `请求内容不能超过 ${maxBytes} 字节。`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求内容不是有效的 JSON。");
  }
}

export function requireObject(
  value: unknown,
  message = "请求内容必须是 JSON 对象。",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_BODY", message);
  }
  return value as Record<string, unknown>;
}

export async function withApiErrors(
  operation: () => Promise<Response>,
): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        },
        error.status,
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    const unavailable =
      message.includes("no such table") ||
      message.includes("binding `DB` is unavailable") ||
      message.includes("binding `RUNS` is unavailable");

    // Do not echo raw database, object-store or framework errors to clients.
    console.error(
      "Unhandled API error",
      error instanceof Error ? error.name : typeof error,
    );
    return jsonResponse(
      {
        error: {
          code: unavailable ? "STORAGE_UNAVAILABLE" : "INTERNAL_ERROR",
          message: unavailable
            ? "共享存储尚未初始化，请联系管理员完成站点部署。"
            : "服务器暂时无法处理请求。",
        },
      },
      unavailable ? 503 : 500,
    );
  }
}

export function parseInteger(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; required?: boolean } = {},
): number | undefined {
  if (value === undefined || value === null || value === "") {
    if (options.required) {
      throw new ApiError(400, "INVALID_FIELD", `${field} 为必填项。`);
    }
    return undefined;
  }
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new ApiError(400, "INVALID_FIELD", `${field} 必须是整数。`);
  }
  if (options.min !== undefined && number < options.min) {
    throw new ApiError(400, "INVALID_FIELD", `${field} 不能小于 ${options.min}。`);
  }
  if (options.max !== undefined && number > options.max) {
    throw new ApiError(400, "INVALID_FIELD", `${field} 不能大于 ${options.max}。`);
  }
  return number;
}
