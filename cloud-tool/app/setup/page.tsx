import type { Metadata } from "next";
import { SetupClient } from "../components/setup-client";

export const metadata: Metadata = {
  title: "初始化所有者",
  description: "首次初始化淘宝经营数据团队工作台所有者账号。",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SetupPage() {
  return <SetupClient />;
}
