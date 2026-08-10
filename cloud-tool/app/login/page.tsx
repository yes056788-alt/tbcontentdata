import type { Metadata } from "next";
import { LoginClient } from "../components/login-client";

export const metadata: Metadata = {
  title: "登录",
  description: "登录淘宝经营数据团队工作台。",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginClient />;
}
