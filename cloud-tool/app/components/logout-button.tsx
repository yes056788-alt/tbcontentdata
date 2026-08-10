"use client";

import { useState } from "react";
import { requestJson } from "./auth-api";
import { LogoutIcon } from "./icons";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const [working, setWorking] = useState(false);

  const logout = async () => {
    if (working) return;
    setWorking(true);
    try {
      await requestJson("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
      // Always leave the authenticated UI. The server also expires sessions
      // independently, and the login page will re-check the current status.
    } finally {
      window.location.replace("/login");
    }
  };

  return (
    <button
      className={compact ? "account-action account-action--danger" : "button button--secondary"}
      type="button"
      onClick={() => void logout()}
      disabled={working}
      aria-label={working ? "正在退出登录" : "退出登录"}
    >
      <LogoutIcon /> {compact ? null : working ? "正在退出…" : "退出登录"}
    </button>
  );
}
