import type { Metadata } from "next";
import { ChangePasswordClient } from "../components/change-password-client";

export const metadata: Metadata = {
  title: "修改密码",
  description: "更新淘宝经营数据团队工作台登录密码。",
  robots: { index: false, follow: false },
};

export default function ChangePasswordPage() {
  return <ChangePasswordClient />;
}
