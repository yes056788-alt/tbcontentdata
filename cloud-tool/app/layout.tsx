import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "淘宝经营数据 · 团队工作台",
    template: "%s · 淘宝经营数据",
  },
  description: "淘宝经营数据团队工作台，共享加密账号库、运行记录与诊断报告。",
  openGraph: {
    title: "淘宝经营数据 · 团队工作台",
    description: "共享加密账号库、运行历史与诊断报告，让团队经营取数更安全高效。",
    locale: "zh_CN",
    type: "website",
    images: [{ url: "/social-preview.png", alt: "淘宝经营数据团队工作台" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "淘宝经营数据 · 团队工作台",
    description: "共享加密账号库、运行历史与诊断报告。",
    images: ["/social-preview.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
