import type { Metadata } from "next";
import { MigrationClient } from "../components/migration-client";
import { requireProtectedPage } from "../server/page-auth";
import "./migration.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "迁移备份",
  description: "由工作区所有者创建加密业务数据迁移包。",
  robots: { index: false, follow: false },
};

export default async function MigrationPage() {
  await requireProtectedPage("/migration");
  return <MigrationClient />;
}
