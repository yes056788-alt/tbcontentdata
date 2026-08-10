import type { NextConfig } from "next";

const isStandaloneNode = process.env.DEPLOY_TARGET === "node";

const nextConfig: NextConfig = {
  ...(isStandaloneNode ? { output: "standalone" as const } : {}),
  ...(isStandaloneNode
    ? {
        turbopack: {
          resolveAlias: {
            "@/runtime-db": "./db/node.ts",
            "@/app/server/runtime-env": "./app/server/runtime-env.node.ts",
          },
        },
      }
    : {}),
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Vary", value: "Cookie, Origin" },
        ],
      },
      {
        source: "/admin",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Vary", value: "Cookie, Origin" },
        ],
      },
      {
        source: "/migration",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Vary", value: "Cookie, Origin" },
        ],
      },
      {
        source: "/owner-recovery",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Vary", value: "Cookie, Origin" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "connect-src 'self'",
              "font-src 'self' data:",
              "form-action 'self'",
              "frame-ancestors 'self'",
              "frame-src 'self'",
              "img-src 'self' data: blob:",
              "object-src 'none'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "worker-src 'self' blob:",
            ].join("; "),
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
