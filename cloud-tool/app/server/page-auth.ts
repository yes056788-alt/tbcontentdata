import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "./authz";
import { ApiError } from "./http";
import { configuredPublicOrigin } from "./runtime-config";

function forwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || "";
}

function requestOrigin(headerValues: Headers) {
  const configured = configuredPublicOrigin();
  if (configured) return configured;
  const protocol = forwardedValue(headerValues.get("x-forwarded-proto"));
  const host =
    forwardedValue(headerValues.get("x-forwarded-host")) ||
    forwardedValue(headerValues.get("host"));
  if (host && (protocol === "https" || protocol === "http")) {
    try {
      return new URL(`${protocol}://${host}`).origin;
    } catch {
      // Fall through to the local value. The request is read-only and session
      // authorization still happens against the database below.
    }
  }
  return "http://localhost";
}

export async function requireProtectedPage(pathname: string) {
  const incoming = new Headers(await headers());
  const request = new Request(new URL(pathname, requestOrigin(incoming)), {
    method: "GET",
    headers: incoming,
  });
  try {
    return await requireSession(request);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "PASSWORD_CHANGE_REQUIRED") {
        redirect("/change-password");
      }
      if (error.status === 401 || error.status === 403) {
        redirect(`/login?next=${encodeURIComponent(pathname)}`);
      }
    }
    throw error;
  }
}
