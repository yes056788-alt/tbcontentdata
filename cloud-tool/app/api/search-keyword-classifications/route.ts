import { requireSession, runWriters } from "@/app/server/authz";
import {
  jsonResponse,
  readJsonBody,
  withApiErrors,
} from "@/app/server/http";
import {
  DEFAULT_QWEN_MODEL,
  classifySearchKeywordsWithQwen,
  parseQwenTimeoutMilliseconds,
} from "@/app/server/qwen-classification";
import {
  QWEN_CREDENTIAL_VERSION_HEADER,
  assertQwenCredentialVersionMatches,
  createQwenCredentialVersion,
  qwenApiKeyFromRequest,
  withQwenCredentialVersionHeader,
} from "@/app/server/qwen-api-key-cookie";
import { runtimeValue } from "@/app/server/runtime-config";

function invalidCookieResponse(): Response {
  return jsonResponse(
    {
      error: {
        code: "QWEN_API_KEY_COOKIE_INVALID",
        message: "千问 API 配置已失效，请重新保存 API Key。",
      },
    },
    409,
  );
}

export async function POST(request: Request) {
  let credentialVersion: string | undefined;
  const response = await withApiErrors(async () => {
    const session = await requireSession(request, runWriters);
    const encryptionKey = runtimeValue("RUN_DATA_KEY");
    const cookieState = await qwenApiKeyFromRequest(
      request,
      session.member.id,
      { encryptionKey },
    );
    if (cookieState.state === "invalid") return invalidCookieResponse();
    const usesEnvironment = cookieState.state === "absent";
    const apiKey = usesEnvironment
      ? runtimeValue("DASHSCOPE_API_KEY")
      : cookieState.apiKey;
    if (apiKey) {
      credentialVersion = await createQwenCredentialVersion(
        usesEnvironment ? "server-environment" : "tool-cookie",
        apiKey,
        { encryptionKey },
      );
      assertQwenCredentialVersionMatches(
        request.headers.get(QWEN_CREDENTIAL_VERSION_HEADER),
        credentialVersion,
      );
    }
    const body = await readJsonBody<unknown>(request, 100_000);
    const result = await classifySearchKeywordsWithQwen(body, {
      apiKey,
      baseUrl: runtimeValue("DASHSCOPE_BASE_URL"),
      model: DEFAULT_QWEN_MODEL,
      timeoutMs: parseQwenTimeoutMilliseconds(runtimeValue("QWEN_TIMEOUT_MS")),
    });
    return jsonResponse(result);
  });
  return withQwenCredentialVersionHeader(response, credentialVersion);
}
