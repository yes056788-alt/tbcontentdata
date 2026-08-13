"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BoltIcon,
  CloudIcon,
  DatabaseIcon,
  DownloadIcon,
  HistoryIcon,
  LockIcon,
  ShieldIcon,
} from "./icons";
import { isLocalPreview, loginPath } from "./auth-api";
import { TeamTopbar } from "./team-topbar";

const CHANNEL = "taobao-full-chain-tool-v1";

type Role = "owner" | "admin" | "operator" | "viewer";

type SessionView = {
  name: string;
  role: Role;
  mustChangePassword: boolean;
  vaultReady: boolean;
};

type BridgeState = {
  connected: boolean;
  version: string;
  checked: boolean;
};

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickRecord(...values: unknown[]): Record<string, unknown> {
  return values.find(isRecord) as Record<string, unknown> | undefined ?? {};
}

function pickString(...values: unknown[]) {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value.trim() : "";
}

function roleValue(value: unknown): Role {
  return value === "owner" || value === "admin" || value === "operator" || value === "viewer"
    ? value
    : "viewer";
}

function normalizeSession(payload: unknown): SessionView {
  const root = pickRecord(payload);
  const data = pickRecord(root.data, root.session, root);
  const user = pickRecord(data.user, root.user);
  const member = pickRecord(data.member, data.membership, root.member, root.membership);
  const vault = pickRecord(data.vault, root.vault);
  return {
    name: pickString(user.name, user.displayName, member.displayName, data.name) || "团队成员",
    role: roleValue(member.role ?? data.role ?? root.role),
    mustChangePassword: Boolean(
      user.mustChangePassword ?? member.mustChangePassword ?? data.mustChangePassword ?? root.mustChangePassword,
    ),
    vaultReady: Boolean(
      data.vaultReady ?? root.vaultReady ?? vault.exists ?? vault.ready,
    ),
  };
}

async function getJson(path: string) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const record = pickRecord(body);
    const apiError = pickRecord(record.error);
    throw new ApiError(pickString(apiError.message, record.message) || `请求失败（${response.status}）`, response.status);
  }
  return body;
}

function roleLabel(role: Role) {
  return ({ owner: "所有者", admin: "管理员", operator: "操作员", viewer: "只读成员" } as const)[role];
}

export function DashboardClient() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [bridge, setBridge] = useState<BridgeState>({ connected: false, version: "", checked: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAuthRequired(false);
    try {
      const sessionPayload = await getJson("/api/session");
      const nextSession = normalizeSession(sessionPayload);
      if (nextSession.mustChangePassword) {
        window.location.replace("/change-password");
        return;
      }
      let vaultReady = nextSession.vaultReady;
      if (nextSession.role !== "viewer") {
        try {
          const vaultRoot = pickRecord(await getJson("/api/vault"));
          vaultReady = vaultRoot.vault !== null && isRecord(vaultRoot.vault);
        } catch (vaultError) {
          if (vaultError instanceof ApiError && vaultError.status === 401) throw vaultError;
          setSession({ ...nextSession, vaultReady: false });
          setError(vaultError instanceof Error ? vaultError.message : "账号库状态暂时无法读取。");
          return;
        }
      }
      setSession({
        ...nextSession,
        vaultReady,
      });
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        if (isLocalPreview()) {
          setAuthRequired(true);
          setSession(null);
        } else {
          window.location.replace(loginPath(`${window.location.pathname}${window.location.search}`));
        }
      } else {
        setError(loadError instanceof Error ? loadError.message : "工作台加载失败，请稍后重试。");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const onCloudSync = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail;
      if (detail?.type === "sync-complete") void load();
    };
    window.addEventListener("taobao-cloud-sync", onCloudSync);
    return () => window.removeEventListener("taobao-cloud-sync", onCloudSync);
  }, [load]);

  useEffect(() => {
    const requestId = `portal-${Date.now().toString(36)}`;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || !isRecord(event.data)) return;
      const message = event.data;
      if (message.channel !== CHANNEL) return;
      if (message.type === "ready") {
        setBridge({ connected: message.connected !== false, version: pickString(message.version), checked: true });
      }
      if (message.type === "response" && message.requestId === requestId) {
        const data = pickRecord(message.data);
        setBridge({
          connected: message.ok !== false && data.connected !== false,
          version: pickString(data.version, message.version),
          checked: true,
        });
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ channel: CHANNEL, type: "request", requestId, action: "ping", payload: {} }, window.location.origin);
    const timer = window.setTimeout(() => {
      setBridge((current) => current.checked ? current : { connected: false, version: "", checked: true });
    }, 2200);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  return (
    <main className="portal-page">
      <TeamTopbar
        activePage="home"
        accountName={loading ? "正在识别…" : session?.name || (authRequired ? "部署预览" : "已登录成员")}
        accountSubtitle={session ? roleLabel(session.role) : authRequired ? "等待本地登录服务" : "账号安全登录"}
        showAccountActions={Boolean(session)}
      />

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__glow hero__glow--one" />
        <div className="hero__glow hero__glow--two" />
        <div className="hero__content">
          <div className="eyebrow"><ShieldIcon /> 团队安全空间</div>
          <h1 id="hero-title">一个账号库，协同完成<br /><span>全链路经营取数</span></h1>
          <p>账号密文、运行历史和诊断结果统一保存。团队成员按权限使用，每一次操作都有清晰边界。</p>
          <div className="hero-install" role="group" aria-labelledby="extension-install-title">
            <span className="hero-install__icon"><DownloadIcon /></span>
            <span className="hero-install__copy">
              <strong id="extension-install-title">安装 Chrome 数据助手</strong>
              <small>下载并解压后，在 Chrome 扩展管理页选择“加载已解压的扩展程序”。</small>
            </span>
            <a className="button hero-install__button" href="/downloads/taobao-data-assistant.zip" download>
              <DownloadIcon /> 下载数据助手扩展
            </a>
          </div>
          <div className="trust-row" aria-label="安全说明">
            <span><LockIcon /> 账号库端到端加密</span>
            <span><ShieldIcon /> 独立账号逐请求鉴权</span>
            <span><HistoryIcon /> 历史记录团队共享</span>
          </div>
        </div>

        <aside className="status-console" aria-label="系统连接状态">
          <div className="status-console__head">
            <span>工作环境</span>
            <span className="status-console__live"><i /> ONLINE</span>
          </div>
          <div className="status-item">
            <span className={`status-icon ${bridge.connected ? "is-ok" : "is-warn"}`}><BoltIcon /></span>
            <span>
              <strong>Chrome 数据助手</strong>
              <small>{!bridge.checked ? "正在检测本机扩展…" : bridge.connected ? `已连接${bridge.version ? ` · v${bridge.version}` : ""}` : "未连接，需要安装或启用扩展"}</small>
            </span>
            <i className={`signal ${bridge.connected ? "is-ok" : "is-warn"}`} aria-label={bridge.connected ? "已连接" : "未连接"} />
          </div>
          <div className="status-item">
            <span className="status-icon is-ok"><CloudIcon /></span>
            <span>
              <strong>团队云端空间</strong>
              <small>{authRequired ? "本地预览未注入登录身份" : error ? "暂时无法读取" : "安全连接正常"}</small>
            </span>
            <i className={`signal ${authRequired ? "is-neutral" : error ? "is-warn" : "is-ok"}`} aria-label={authRequired ? "等待登录" : error ? "异常" : "正常"} />
          </div>
          <div className="status-item">
            <span className={`status-icon ${error ? "is-warn" : session?.vaultReady ? "is-ok" : "is-neutral"}`}><DatabaseIcon /></span>
            <span>
              <strong>共享加密账号库</strong>
              <small>{error ? "暂时无法确认账号库状态" : session?.vaultReady ? "已建立，可按权限同步" : "等待管理员首次上传"}</small>
            </span>
            <i className={`signal ${error ? "is-warn" : session?.vaultReady ? "is-ok" : "is-neutral"}`} aria-label={error ? "异常" : session?.vaultReady ? "已就绪" : "待初始化"} />
          </div>
          <div className="status-console__foot">
            <span><LockIcon /> 淘宝登录态仍保留在每位成员自己的浏览器中</span>
            {error ? (
              <button type="button" onClick={() => void load()} disabled={loading}>
                {loading ? "连接中…" : "重新连接"}
              </button>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
