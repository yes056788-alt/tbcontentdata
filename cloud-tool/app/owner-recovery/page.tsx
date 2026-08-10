import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OwnerRecoveryClient } from "../components/owner-recovery-client";
import { requireProtectedPage } from "../server/page-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "恢复所有者密码",
  description: "使用一次性部署恢复码更新工作区所有者密码。",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function OwnerRecoveryPage() {
  const session = await requireProtectedPage("/owner-recovery");
  if (session.member.role !== "admin") redirect("/admin");
  return <OwnerRecoveryClient />;
}
