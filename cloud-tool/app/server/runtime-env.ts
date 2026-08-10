import { env } from "cloudflare:workers";

export function getRuntimeValue(name: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

export function runtimePlatform(): "cloudflare" {
  return "cloudflare";
}
