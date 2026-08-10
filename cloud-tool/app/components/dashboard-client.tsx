"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowIcon,
  BoltIcon,
  CheckIcon,
  ClockIcon,
  CloudIcon,
  DatabaseIcon,
  DownloadIcon,
  HistoryIcon,
  LockIcon,
  PeopleIcon,
  ShieldIcon,
  StoreIcon,
} from "./icons";
import { isLocalPreview, loginPath } from "./auth-api";
import { TeamTopbar } from "./team-topbar";

const CHANNEL = "taobao-full-chain-tool-v1";

type Role = "owner" | "admin" | "operator" | "viewer";

type SessionView = {
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
  vaultReady: boolean;
  memberCount: number;
};

type RunView = {
  id: string;
  status: string;
  storeName: string;
  finishedAt: string;
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

function timestampText(...values: unknown[]) {
  const value = values.find((item) => (typeof item === "string" && item.trim()) || (typeof item === "number" && Number.isFinite(item)));
  return typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
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
  const stats = pickRecord(data.stats, root.stats);
  const vault = pickRecord(data.vault, root.vault);
  return {
    name: pickString(user.name, user.displayName, member.displayName, data.name) || "团队成员",
    email: pickString(user.email, member.email, data.email),
    role: roleValue(member.role ?? data.role ?? root.role),
    mustChangePassword: Boolean(
      user.mustChangePassword ?? member.mustChangePassword ?? data.mustChangePassword ?? root.mustChangePassword,
    ),
    vaultReady: Boolean(
      data.vaultReady ?? root.vaultReady ?? vault.exists ?? vault.ready ?? stats.vaultReady,
    ),
    memberCount: Math.max(0, Number(stats.memberCount ?? data.memberCount ?? root.memberCount) || 0),
  };
}

function normalizeRuns(payload: unknown): RunView[] {
  const root = pickRecord(payload);
  const data = pickRecord(root.data);
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(root.runs)
      ? root.runs
      : Array.isArray(data.runs)
        ? data.runs
        : [];
  return candidates.filter(isRecord).map((run, index) => ({
    id: pickString(run.runId, run.id) || `run-${index}`,
    status: pickString(run.status).toLowerCase(),
    storeName: pickString(run.storeName, run.store_name) || "未命名店铺",
    finishedAt: timestampText(run.finishedAt, run.finished_at, run.updatedAt, run.createdAt),
  }));
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

function formatDate(value: string) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function LoadingCard() {
  return (
    <div className="metric-card metric-card--loading" aria-hidden="true">
      <span className="skeleton skeleton--icon" />
      <span className="skeleton skeleton--line" />
      <span className="skeleton skeleton--value" />
    </div>
  );
}

export function DashboardClient() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [runs, setRuns] = useState<RunView[]>([]);
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
      const [runsResult, vaultResult, membersResult] = await Promise.allSettled([
        getJson("/api/runs"),
        nextSession.role === "viewer" ? Promise.resolve(null) : getJson("/api/vault"),
        nextSession.role === "owner" || nextSession.role === "admin"
          ? getJson("/api/admin/members")
          : Promise.resolve(null),
      ]);
      if (runsResult.status === "rejected") throw runsResult.reason;
      const vaultRoot = vaultResult.status === "fulfilled" ? pickRecord(vaultResult.value) : {};
      const memberRoot = membersResult.status === "fulfilled" ? pickRecord(membersResult.value) : {};
      const memberData = pickRecord(memberRoot.data);
      const memberValues = Array.isArray(memberRoot.members)
        ? memberRoot.members
        : Array.isArray(memberData.members)
          ? memberData.members
          : [];
      setSession({
        ...nextSession,
        vaultReady: vaultResult.status === "fulfilled" && vaultRoot.vault !== null && isRecord(vaultRoot.vault),
        memberCount: memberValues.length || nextSession.memberCount,
      });
      setRuns(normalizeRuns(runsResult.value));
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        if (isLocalPreview()) {
          setAuthRequired(true);
          setSession(null);
          setRuns([]);
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

  const completedRuns = useMemo(
    () => runs.filter((run) => ["success", "succeeded", "completed", "complete", "done"].includes(run.status)).length,
    [runs],
  );
  const latestRun = useMemo(() => {
    return [...runs].sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0];
  }, [runs]);
  const canManage = session?.role === "owner" || session?.role === "admin";

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
          <div className="hero__actions">
            <a className="button button--primary" href="/workspace.html">
              进入经营工作台 <ArrowIcon />
            </a>
            {canManage ? (
              <a className="button button--ghost" href="/admin">
                <PeopleIcon /> 管理团队权限
              </a>
            ) : null}
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
            <span className={`status-icon ${session?.vaultReady ? "is-ok" : "is-neutral"}`}><DatabaseIcon /></span>
            <span>
              <strong>共享加密账号库</strong>
              <small>{session?.vaultReady ? "已建立，可按权限同步" : "等待管理员首次上传"}</small>
            </span>
            <i className={`signal ${session?.vaultReady ? "is-ok" : "is-neutral"}`} aria-label={session?.vaultReady ? "已就绪" : "待初始化"} />
          </div>
          <div className="status-console__foot">
            <LockIcon /> 淘宝登录态仍保留在每位成员自己的浏览器中
          </div>
        </aside>
      </section>

      <section className="workspace-content" aria-labelledby="overview-title">
        <div className="section-heading">
          <div>
            <span className="section-kicker">OVERVIEW</span>
            <h2 id="overview-title">团队数据概览</h2>
          </div>
          <button className="text-button" type="button" onClick={() => void load()} disabled={loading}>
            <ClockIcon /> {loading ? "正在刷新" : "刷新数据"}
          </button>
        </div>

        {error ? (
          <div className="alert alert--error" role="alert">
            <span><strong>数据暂时没有加载成功</strong><small>{error}</small></span>
            <button type="button" onClick={() => void load()}>重新加载</button>
          </div>
        ) : null}

        {authRequired ? (
          <div className="alert alert--preview" role="status">
            <CloudIcon />
            <span><strong>当前是本地部署预览</strong><small>本地预览未建立登录会话；生产环境会自动前往账号登录页。</small></span>
          </div>
        ) : null}

        <div className="metric-grid">
          {loading ? (
            <><LoadingCard /><LoadingCard /><LoadingCard /><LoadingCard /></>
          ) : (
            <>
              <article className="metric-card">
                <span className="metric-icon metric-icon--blue"><HistoryIcon /></span>
                <span className="metric-label">共享历史记录</span>
                <strong>{runs.length}<small> 次</small></strong>
                <span className="metric-note">团队全部经营任务</span>
              </article>
              <article className="metric-card">
                <span className="metric-icon metric-icon--green"><CheckIcon /></span>
                <span className="metric-label">已完成任务</span>
                <strong>{completedRuns}<small> 次</small></strong>
                <span className="metric-note">可直接查看或导出报告</span>
              </article>
              <article className="metric-card">
                <span className="metric-icon metric-icon--violet"><PeopleIcon /></span>
                <span className="metric-label">团队成员</span>
                <strong>{session?.memberCount || 1}<small> 人</small></strong>
                <span className="metric-note">按角色分配使用范围</span>
              </article>
              <article className="metric-card">
                <span className="metric-icon metric-icon--orange"><StoreIcon /></span>
                <span className="metric-label">最近一次取数</span>
                <strong className="metric-value--text">{latestRun?.storeName || "暂无"}</strong>
                <span className="metric-note">{formatDate(latestRun?.finishedAt || "")}</span>
              </article>
            </>
          )}
        </div>

        <div className="lower-grid">
          <article className="panel recent-panel">
            <div className="panel__head">
              <div>
                <span className="section-kicker">RECENT RUNS</span>
                <h2>最近运行记录</h2>
              </div>
              <a href="/workspace.html">查看全部 <ArrowIcon /></a>
            </div>
            <div className="run-list">
              {loading ? (
                <div className="empty-state"><span className="loader" /> 正在载入团队记录…</div>
              ) : runs.length ? runs.slice(0, 4).map((run) => {
                const success = ["success", "succeeded", "completed", "complete", "done"].includes(run.status);
                return (
                  <div className="run-row" key={run.id}>
                    <span className={`run-row__icon ${success ? "is-ok" : "is-warn"}`}>{success ? <CheckIcon /> : <ClockIcon />}</span>
                    <span className="run-row__main"><strong>{run.storeName}</strong><small>{formatDate(run.finishedAt)}</small></span>
                    <span className={`status-pill ${success ? "is-ok" : "is-warn"}`}>{success ? "已完成" : "进行中"}</span>
                  </div>
                );
              }) : (
                <div className="empty-state">
                  <HistoryIcon />
                  <strong>还没有共享运行记录</strong>
                  <span>进入工作台完成第一次取数后，团队历史会显示在这里。</span>
                </div>
              )}
            </div>
          </article>

          <article className="panel install-panel">
            <div className="install-panel__top">
              <span className="install-art"><DownloadIcon /></span>
              <div><span className="section-kicker">GET STARTED</span><h2>在这台电脑上使用</h2></div>
            </div>
            <ol className="steps">
              <li><span>1</span><div><strong>安装数据助手扩展</strong><small>下载扩展包，解压后通过 Chrome「加载已解压的扩展程序」安装。</small></div></li>
              <li><span>2</span><div><strong>登录需要取数的平台</strong><small>淘宝登录态只保留在你的浏览器中，不会上传到团队服务器。</small></div></li>
              <li><span>3</span><div><strong>进入经营工作台</strong><small>看到“数据助手已连接”后，即可使用共享账号库运行任务。</small></div></li>
            </ol>
            <a className="button button--secondary" href="/downloads/taobao-data-assistant.zip" download>
              <DownloadIcon /> 下载数据助手扩展
            </a>
            <p className="install-note"><LockIcon /> 共享账号库在浏览器内解密，服务器仅保存加密密文。</p>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        <span><span className="brand-mark brand-mark--small">TB</span> 淘宝经营数据团队工作台</span>
        <span>{session?.email ? `当前账号：${session.email}` : "由独立成员账号与角色权限保护"}</span>
      </footer>
    </main>
  );
}
