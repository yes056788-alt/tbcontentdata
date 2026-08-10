import type { Metadata } from "next";
import { AdminClient } from "../components/admin-client";
import { requireProtectedPage } from "../server/page-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "权限管理",
};

export default async function AdminPage() {
  await requireProtectedPage("/admin");
  return <AdminClient />;
}
