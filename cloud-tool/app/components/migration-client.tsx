"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { loginPath, recordOf, requestJson, textOf } from "./auth-api";
import { ArrowIcon, DownloadIcon, KeyIcon, LockIcon, ShieldIcon } from "./icons";
import { TeamTopbar } from "./team-topbar";

type MigrationSession = {
  name: string;
  role: string;
};

type MigrationFileHandle = {
  createWritable(): Promise<WritableStream<Uint8Array>>;
};

type MigrationWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<MigrationFileHandle>;
};

function migrationSession(payload: unknown): MigrationSession {
  const root = recordOf(payload);
  const user = recordOf(root.user);
  const member = recordOf(root.member);
  return {
    name: textOf(user.displayName, member.displayName, user.username) || "工作区所有者",
    role: textOf(root.role, member.role),
  };
}

function passphraseRules(value: string) {
  return {
    length: Array.from(value).length >= 20 && Array.from(value).length <= 256,
    letter: /[a-z]/i.test(value),
    number: /\d/.test(value),
    symbol: /[^a-z0-9]/i.test(value),
  };
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as unknown;
  const root = recordOf(body);
  const error = recordOf(root.error);
  return textOf(error.message, root.message) || `迁移导出失败（${response.status}）。`;
}

export function MigrationClient() {
  const [session, setSession] = useState<MigrationSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void requestJson("/api/session")
      .then((payload) => {
        if (!active) return;
        setSession(migrationSession(payload));
      })
      .catch((loadError) => {
        if (!active) return;
        const status = Number(recordOf(loadError).status) || Number((loadError as { status?: number })?.status);
        if (status === 401) {
          window.location.replace(loginPath("/migration"));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "无法读取当前账号权限。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const rules = useMemo(() => passphraseRules(passphrase), [passphrase]);
  const validPassphrase = Object.values(rules).every(Boolean);
  const matches = confirmation.length > 0 && confirmation === passphrase;
  const canExport = session?.role === "owner" && validPassphrase && matches && !working;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canExport) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const saveFilePicker = (window as MigrationWindow).showSaveFilePicker?.bind(window);
      if (!saveFilePicker) {
        throw new Error("当前浏览器不支持流式保存大文件，请使用最新版 Chrome 后重试。");
      }
      let fileHandle: MigrationFileHandle;
      try {
        fileHandle = await saveFilePicker({
          suggestedName: `taobao-business-migration-${new Date().toISOString().slice(0, 10)}.tbmig`,
          types: [{
            description: "淘宝经营数据加密迁移包",
            accept: { "application/vnd.taobao.business-migration": [".tbmig"] },
          }],
        });
      } catch (pickerError) {
        if (pickerError instanceof DOMException && pickerError.name === "AbortError") return;
        throw pickerError;
      }
      const response = await fetch("/api/admin/migration/export", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/vnd.taobao.business-migration, application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ passphrase }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (!response.body) throw new Error("浏览器无法读取迁移数据流，请升级 Chrome 后重试。");
      const writable = await fileHandle.createWritable();
      try {
        await response.body.pipeTo(writable);
      } catch (streamError) {
        await writable.abort(streamError).catch(() => {});
        throw streamError;
      }
      setPassphrase("");
      setConfirmation("");
      setNotice("加密迁移包已生成。请将迁移口令与文件分开保管，并在目标服务器先执行校验模式。");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "迁移导出没有完成。");
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="admin-page migration-page">
      <TeamTopbar
        activePage="team"
        accountName={session?.name || (loading ? "正在识别…" : "工作区成员")}
        accountSubtitle={session?.role === "owner" ? "所有者" : "权限校验中"}
        showAccountActions={Boolean(session)}
      />

      <div className="admin-shell migration-shell">
        <a className="back-link" href="/admin"><ArrowIcon /> 返回团队管理</a>
        <section className="admin-title" aria-labelledby="migration-title">
          <div>
            <span className="eyebrow"><ShieldIcon /> OWNER-ONLY BACKUP</span>
            <h1 id="migration-title">加密业务数据迁移</h1>
            <p>导出共享账号库密文、项目目录与全部历史报告；不会包含登录会话、成员密码、环境密钥或浏览器 Cookie。</p>
          </div>
          <div className="admin-security-note"><LockIcon /><span><strong>逐记录 AES-GCM</strong><small>PBKDF2 派生独立迁移密钥并生成 SHA-256 manifest</small></span></div>
        </section>

        {error ? <div className="alert alert--error" role="alert"><span><strong>迁移操作没有完成</strong><small>{error}</small></span><button type="button" onClick={() => setError("")}>关闭</button></div> : null}
        {notice ? <div className="alert alert--success" role="status"><span><strong>迁移包已下载</strong><small>{notice}</small></span><button type="button" onClick={() => setNotice("")}>关闭</button></div> : null}

        {loading ? (
          <section className="access-denied" aria-live="polite" aria-busy="true">
            <span className="loader" aria-hidden="true" />
            <h2>正在校验所有者权限</h2>
            <p>迁移导出只对工作区所有者开放。</p>
          </section>
        ) : session?.role !== "owner" ? (
          <section className="access-denied">
            <LockIcon />
            <h2>只有工作区所有者可以导出迁移包</h2>
            <p>管理员可以继续维护成员和业务数据，但不能下载完整迁移备份。</p>
            <a className="button button--primary" href="/admin">返回团队管理</a>
          </section>
        ) : (
          <div className="migration-grid">
            <section className="migration-card">
              <div className="migration-card__head"><KeyIcon /><div><h2>设置迁移口令</h2><p>该口令只用于本次文件加密，不是网页登录密码或账号库主密码。</p></div></div>
              <form className="migration-form" onSubmit={(event) => void submit(event)}>
                <label htmlFor="migrationPassphrase">迁移口令</label>
                <input
                  id="migrationPassphrase"
                  type="password"
                  autoComplete="off"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  minLength={20}
                  maxLength={256}
                  required
                />
                <label htmlFor="migrationPassphraseConfirmation">确认迁移口令</label>
                <input
                  id="migrationPassphraseConfirmation"
                  type="password"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  minLength={20}
                  maxLength={256}
                  required
                />
                <div className="migration-rules" aria-live="polite">
                  <span data-valid={rules.length}>20–256 位</span>
                  <span data-valid={rules.letter}>包含字母</span>
                  <span data-valid={rules.number}>包含数字</span>
                  <span data-valid={rules.symbol}>包含特殊字符</span>
                  <span data-valid={matches}>两次输入一致</span>
                </div>
                <button className="button button--primary migration-download" type="submit" disabled={!canExport}>
                  <DownloadIcon /> {working ? "正在逐条加密并保存…" : "生成并流式保存迁移包"}
                </button>
              </form>
            </section>

            <aside className="migration-card migration-notes">
              <h2>迁移包安全边界</h2>
              <ul>
                <li><strong>账号库</strong><span>仅复制浏览器端已加密的 AES-GCM 密文，服务器不会获得主密码。</span></li>
                <li><strong>历史报告</strong><span>源端校验完整性后逐条重新加密写入迁移包，不在文件中保存运行密钥。</span></li>
                <li><strong>一致性</strong><span>导出前后会比对 revision 与历史索引；数据发生变化时，目标导入器会拒绝该包。</span></li>
                <li><strong>明确排除</strong><span>成员登录密码、会话、Cookie、初始化令牌与环境密钥不会进入迁移包。</span></li>
              </ul>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
