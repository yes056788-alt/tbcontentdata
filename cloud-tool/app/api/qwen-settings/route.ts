import { requireSession, runWriters } from "@/app/server/authz";
import { ApiError, jsonResponse, readJsonBody, withApiErrors } from "@/app/server/http";
import {
  clearQwenApiKeyCookie,
  createQwenApiKeyCookie,
  qwenApiKeyFromRequest,
} from "@/app/server/qwen-api-key-cookie";
import { runtimeValue } from "@/app/server/runtime-config";

function exactSettingsBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(
      400,
      "INVALID_QWEN_SETTINGS",
      "千问 API 配置必须是 JSON 对象。",
    );
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (
    keys.length !== 1 ||
    keys[0] !== "apiKey" ||
    !Object.hasOwn(body, "apiKey")
  ) {
    throw new ApiError(
      400,
      "INVALID_QWEN_SETTINGS",
      "千问 API 配置仅支持 apiKey 字段。",
    );
  }
  return body;
}

export async function GET(request: Request) {
  return withApiErrors(async () => {
    const session = await requireSession(request, runWriters);
    const cookieState = await qwenApiKeyFromRequest(
      request,
      session.member.id,
      { encryptionKey: runtimeValue("RUN_DATA_KEY") },
    );
    if (cookieState.state === "invalid") {
      return jsonResponse({
        configured: false,
        managedByTool: false,
        needsReentry: true,
      });
    }
    const managedByTool = cookieState.state === "valid";
    return jsonResponse({
      configured: managedByTool || Boolean(runtimeValue("DASHSCOPE_API_KEY")),
      managedByTool,
      needsReentry: false,
    });
  });
}

export async function PUT(request: Request) {
  return withApiErrors(async () => {
    const session = await requireSession(request, runWriters);
    const body = exactSettingsBody(
      await readJsonBody<unknown>(request, 8_192),
    );
    const cookie = await createQwenApiKeyCookie(
      body.apiKey,
      session.member.id,
      { encryptionKey: runtimeValue("RUN_DATA_KEY") },
    );
    return jsonResponse(
      { configured: true, managedByTool: true, needsReentry: false },
      200,
      { "Set-Cookie": cookie },
    );
  });
}

export async function DELETE(request: Request) {
  return withApiErrors(async () => {
    await requireSession(request, runWriters);
    return jsonResponse(
      {
        configured: Boolean(runtimeValue("DASHSCOPE_API_KEY")),
        managedByTool: false,
        needsReentry: false,
      },
      200,
      { "Set-Cookie": clearQwenApiKeyCookie() },
    );
  });
}
