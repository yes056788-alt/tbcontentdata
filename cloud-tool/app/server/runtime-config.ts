import {
  getRuntimeValue,
  runtimePlatform as detectedRuntimePlatform,
} from "@/app/server/runtime-env";

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "APP_PUBLIC_ORIGIN must be an http(s) origin without credentials, path, query or fragment.",
    );
  }
  return url.origin;
}

export function runtimeValue(name: string): string | undefined {
  const value = getRuntimeValue(name)?.trim();
  return value || undefined;
}

export function runtimePlatform(): "cloudflare" | "node" {
  return detectedRuntimePlatform();
}

export function configuredPublicOrigin(): string | undefined {
  const value = runtimeValue("APP_PUBLIC_ORIGIN");
  return value ? normalizedOrigin(value) : undefined;
}

export function requestPublicOrigin(request: Request): string {
  return configuredPublicOrigin() ?? new URL(request.url).origin;
}
