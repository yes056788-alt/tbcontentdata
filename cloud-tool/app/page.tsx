import type { Metadata } from "next";
import { DashboardClient } from "./components/dashboard-client";
import { requireProtectedPage } from "./server/page-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "团队工作台",
};

export default async function Home() {
  await requireProtectedPage("/");
  return (
    <>
      <script src="/cloud-sync.js" defer />
      <DashboardClient />
    </>
  );
}
