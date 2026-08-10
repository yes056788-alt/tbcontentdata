import type { MemberRole } from "@/db/schema";

export const localAccountRoles = ["owner", "admin"] as const satisfies readonly MemberRole[];

export type LocalAccountRole = (typeof localAccountRoles)[number];

export function isLocalAccountRole(value: unknown): value is LocalAccountRole {
  return (
    typeof value === "string" &&
    (localAccountRoles as readonly string[]).includes(value)
  );
}

export function isManagedLocalAccountRole(value: unknown): value is "admin" {
  return value === "admin";
}
