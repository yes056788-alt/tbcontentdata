"use client";

/* eslint-disable @next/next/no-html-link-for-pages */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ClientApiError, isLocalPreview, loginPath, requestJson } from "./auth-api";
import { TeamTopbar } from "./team-topbar";
import { ArrowIcon, CheckIcon, EyeIcon, EyeOffIcon, KeyIcon, LockIcon, PeopleIcon, ShieldIcon, UserIcon } from "./icons";

type Role = "owner" | "admin" | "operator" | "viewer";
type MemberStatus = "active" | "disabled" | "invited";

type CurrentMember = {
  username: string;
  email: string;
  name: string;
  role: Role;
  userId: string;
  mustChangePassword: boolean;
};

type TeamMember = {
  id: string;
  userId: string;
  username: string;
  email: string;
  name: string;
  role: Role;
  status: MemberStatus;
  createdAt: string;
  lastSeenAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickRecord(...values: unknown[]) {
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

function statusValue(value: unknown): MemberStatus {
  return value === "disabled" || value === "invited" ? value : "active";
}

function normalizeCurrent(payload: unknown): CurrentMember {
  const root = pickRecord(payload);
  const data = pickRecord(root.data, root.session, root);
  const user = pickRecord(data.user, root.user);
  const member = pickRecord(data.member, data.membership, root.member, root.membership);
  return {
    username: pickString(user.username, member.username, data.username),
    email: pickString(user.email, member.email, data.email),
    name: pickString(user.name, user.displayName, member.displayName, data.name) || "团队成员",
    role: roleValue(member.role ?? data.role ?? root.role),
    userId: pickString(user.id, user.userId, member.userId, member.user_id),
    mustChangePassword: Boolean(user.mustChangePassword ?? member.mustChangePassword ?? data.mustChangePassword ?? root.mustChangePassword),
  };
}

function normalizeMembers(payload: unknown): TeamMember[] {
  const root = pickRecord(payload);
  const data = pickRecord(root.data);
  const memberValues = Array.isArray(payload)
    ? payload
    : Array.isArray(root.members)
      ? root.members
      : Array.isArray(data.members)
        ? data.members
        : [];
  const inviteValues = Array.isArray(root.invites)
    ? root.invites
    : Array.isArray(data.invites)
      ? data.invites
      : [];
  const activeEmails = new Set(memberValues.filter(isRecord).map((member) => pickString(member.email)));
  const pendingInvites = inviteValues.filter(isRecord).filter((invite) => {
    const inviteStatus = pickString(invite.status);
    return !activeEmails.has(pickString(invite.email)) && (inviteStatus === "pending" || inviteStatus === "revoked");
  });
  return [...memberValues, ...pendingInvites].filter(isRecord).map((member, index) => ({
    id: pickString(member.id, member.userId, member.user_id, member.email) || `member-${index}`,
    userId: pickString(member.userId, member.user_id),
    username: pickString(member.username, member.loginName, member.login_name),
    email: pickString(member.email),
    name: pickString(member.name, member.displayName, member.display_name) || "待登录成员",
    role: roleValue(member.role),
    status: pickString(member.status) === "pending"
      ? "invited"
      : pickString(member.status) === "revoked"
        ? "disabled"
        : statusValue(member.status),
    createdAt: timestampText(member.createdAt, member.created_at),
    lastSeenAt: timestampText(member.lastSeenAt, member.last_seen_at, member.updatedAt),
  }));
}

function roleLabel(role: Role) {
  return ({ owner: "所有者", admin: "管理员", operator: "操作员", viewer: "只读成员" } as const)[role];
}

function statusLabel(status: MemberStatus) {
  return ({ active: "已启用", disabled: "已停用", invited: "待首次登录" } as const)[status];
}

function formatDate(value: string) {
  if (!value) return "尚未登录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function passwordRules(value: string) {
  return {
    length: value.length >= 16 && value.length <= 256,
    letter: /[a-z]/i.test(value),
    number: /\d/.test(value),
    symbol: /[^a-z0-9]/i.test(value),
  };
}

export function AdminClient() {
  const [current, setCurrent] = useState<CurrentMember | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [authPreview, setAuthPreview] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [resetMember, setResetMember] = useState<TeamMember | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAuthPreview(false);
    try {
      const sessionPayload = await requestJson("/api/session");
      const nextCurrent = normalizeCurrent(sessionPayload);
      if (nextCurrent.mustChangePassword) {
        window.location.replace("/change-password");
        return;
      }
      setCurrent(nextCurrent);
      if (nextCurrent.role === "owner" || nextCurrent.role === "admin") {
        const membersPayload = await requestJson("/api/admin/members");
        setMembers(normalizeMembers(membersPayload));
      } else {
        setMembers([]);
      }
    } catch (loadError) {
      if (loadError instanceof ClientApiError && loadError.status === 401 && !isLocalPreview()) {
        window.location.replace(loginPath("/admin"));
        return;
      }
      if (loadError instanceof ClientApiError && loadError.status === 401 && isLocalPreview()) {
        setAuthPreview(true);
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "权限数据加载失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const isOwner = current?.role === "owner";
  const canManage = isOwner || current?.role === "admin";
  const counts = useMemo(() => ({
    total: members.length,
    admin: members.filter((member) => member.role === "owner" || member.role === "admin").length,
    legacy: members.filter((member) => member.role === "operator" || member.role === "viewer").length,
    active: members.filter((member) => member.status === "active").length,
  }), [members]);
  const temporaryRules = useMemo(() => passwordRules(temporaryPassword), [temporaryPassword]);
  const resetRules = useMemo(() => passwordRules(resetPassword), [resetPassword]);
  const validTemporaryPassword = Object.values(temporaryRules).every(Boolean);
  const validResetPassword = Object.values(resetRules).every(Boolean);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!displayName.trim() || !username.trim() || !validTemporaryPassword || submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await requestJson("/api/admin/members", {
        method: "POST",
        body: JSON.stringify({
          displayName: displayName.trim(),
          username: username.trim(),
          ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
          role: "admin",
          temporaryPassword,
        }),
      });
      setNotice(`已为 ${displayName.trim()}（${username.trim()}）创建管理员账号。首次登录必须修改临时密码。`);
      setDisplayName("");
      setUsername("");
      setEmail("");
      setTemporaryPassword("");
      await load();
    } catch (inviteError) {
      setTemporaryPassword("");
      setError(inviteError instanceof Error ? inviteError.message : "成员开通失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const updateMember = async (member: TeamMember, changes: Partial<Pick<TeamMember, "role" | "status">>) => {
    if (updatingId) return;
    setUpdatingId(member.id);
    setError("");
    setNotice("");
    try {
      await requestJson("/api/admin/members", {
        method: "PATCH",
        body: JSON.stringify({
          id: member.id,
          ...changes,
        }),
      });
      setMembers((items) => items.map((item) => item.id === member.id ? { ...item, ...changes } : item));
      setNotice(`已更新 ${member.email || member.name} 的权限。`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "成员权限更新失败。");
    } finally {
      setUpdatingId("");
    }
  };

  const submitPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetMember || resetting || !validResetPassword) return;
    setResetting(true);
    setError("");
    setNotice("");
    try {
      await requestJson(`/api/admin/members/${encodeURIComponent(resetMember.id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ temporaryPassword: resetPassword }),
      });
      setNotice(`已重置 ${resetMember.name} 的临时密码；对方下次登录会被强制要求改密。`);
      setResetMember(null);
      setResetPassword("");
      await load();
    } catch (resetError) {
      setResetPassword("");
      setError(resetError instanceof Error ? resetError.message : "临时密码重置失败。");
    } finally {
      setResetting(false);
    }
  };

  return (
    <main className="admin-page">
      <TeamTopbar
        activePage="team"
        accountName={current?.name || "管理员"}
        accountSubtitle={current ? roleLabel(current.role) : "权限校验中"}
        showAccountActions={Boolean(current)}
      />

      <div className="admin-shell">
        <a className="back-link" href="/"><ArrowIcon /> 返回团队首页</a>
        <section className="admin-title" aria-labelledby="admin-title">
          <div>
            <span className="eyebrow"><ShieldIcon /> 访问控制</span>
            <h1 id="admin-title">团队权限管理</h1>
            <p>首版为同事开通管理员账号，共同维护账号库、运行任务和历史记录。</p>
          </div>
          {isOwner ? (
            <a className="admin-security-note" href="/migration" aria-label="打开加密业务数据迁移备份">
              <KeyIcon /><span><strong>加密迁移备份</strong><small>导出账号库密文、项目目录与全部历史报告</small></span>
            </a>
          ) : current?.role === "admin" ? (
            <a className="admin-security-note" href="/owner-recovery" aria-label="使用部署恢复码恢复所有者密码">
              <KeyIcon /><span><strong>所有者密码恢复</strong><small>需要部署管理员为本次事件生成的短期一次性恢复码</small></span>
            </a>
          ) : (
            <div className="admin-security-note"><LockIcon /><span><strong>双层权限保护</strong><small>安全登录会话 + 应用内角色校验</small></span></div>
          )}
        </section>

        {error ? <div className="alert alert--error" role="alert"><span><strong>操作没有完成</strong><small>{error}</small></span><button type="button" onClick={() => setError("")}>关闭</button></div> : null}
        {notice ? <div className="alert alert--success" role="status"><CheckIcon /><span>{notice}</span><button type="button" onClick={() => setNotice("")}>关闭</button></div> : null}

        {loading ? (
          <section className="access-denied" aria-live="polite" aria-busy="true">
            <span className="loader" aria-hidden="true" />
            <h2>正在校验管理权限</h2>
            <p>请稍候，系统正在确认当前账号的角色。</p>
          </section>
        ) : authPreview ? (
          <section className="access-denied access-denied--preview">
            <ShieldIcon />
            <h2>当前是本地权限管理预览</h2>
            <p>本地环境尚未建立成员登录会话。部署后，未登录用户会自动前往登录页，管理员登录后即可管理成员。</p>
            <a className="button button--primary" href="/login?next=%2Fadmin">预览登录页</a>
          </section>
        ) : !canManage ? (
          <section className="access-denied">
            <LockIcon />
            <h2>当前账号没有权限管理权限</h2>
            <p>只有所有者和管理员可以打开此页面。你的角色是“{current ? roleLabel(current.role) : "未知"}”。</p>
            <a className="button button--primary" href="/">返回团队首页</a>
          </section>
        ) : (
          <>
            <section className="admin-metrics" aria-label="成员统计">
              <div><span>团队成员</span><strong>{loading ? "—" : counts.total}<small> 人</small></strong></div>
              <div><span>管理员</span><strong>{loading ? "—" : counts.admin}<small> 人</small></strong></div>
              <div><span>历史兼容角色</span><strong>{loading ? "—" : counts.legacy}<small> 人</small></strong></div>
              <div><span>已启用</span><strong>{loading ? "—" : counts.active}<small> 人</small></strong></div>
            </section>

            <section className="admin-grid">
              <article className="panel invite-panel">
                <div className="panel__head">
                  <div><span className="section-kicker">CREATE MEMBER</span><h2>创建成员账号</h2></div>
                  <span className="panel-head-icon"><PeopleIcon /></span>
                </div>
                <form className="invite-form" onSubmit={invite}>
                  <div className="form-columns">
                    <div>
                      <label htmlFor="member-name">成员姓名</label>
                      <input id="member-name" type="text" autoComplete="name" placeholder="例如：李四" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={100} />
                    </div>
                    <div>
                      <label htmlFor="member-username">登录用户名</label>
                      <input id="member-username" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="字母、数字或下划线" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={64} pattern="[A-Za-z0-9._\u4e00-\u9fff-]+" />
                    </div>
                  </div>
                  <label htmlFor="member-email">邮箱 <small>选填</small></label>
                  <input
                    id="member-email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    maxLength={200}
                  />
                  <div className="fixed-role-note" role="note" aria-label="新成员角色">
                    <ShieldIcon />
                    <span><strong>管理员</strong><small>首版新成员固定为管理员；操作员和只读成员将在后续版本开放。</small></span>
                  </div>
                  <label htmlFor="member-password">一次性临时密码</label>
                  <div className="input-shell input-shell--plain">
                    <input id="member-password" type={showTemporaryPassword ? "text" : "password"} autoComplete="new-password" placeholder="至少 16 位，首次登录后强制修改" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} required minLength={16} maxLength={256} />
                    <button className="password-toggle" type="button" onClick={() => setShowTemporaryPassword((value) => !value)} aria-label={showTemporaryPassword ? "隐藏临时密码" : "显示临时密码"}>{showTemporaryPassword ? <EyeOffIcon /> : <EyeIcon />}</button>
                  </div>
                  <ul className="password-rules password-rules--compact" aria-label="临时密码要求">
                    <li className={temporaryRules.length ? "is-ok" : ""}><CheckIcon /> 16–256 位</li>
                    <li className={temporaryRules.letter ? "is-ok" : ""}><CheckIcon /> 字母</li>
                    <li className={temporaryRules.number ? "is-ok" : ""}><CheckIcon /> 数字</li>
                    <li className={temporaryRules.symbol ? "is-ok" : ""}><CheckIcon /> 特殊字符</li>
                  </ul>
                  <button className="button button--primary button--full" type="submit" disabled={submitting || !displayName.trim() || !username.trim() || !validTemporaryPassword}>
                    {submitting ? <span className="loader loader--light" /> : <PeopleIcon />}
                    {submitting ? "正在创建…" : "创建成员账号"}
                  </button>
                </form>
                <p className="form-note"><LockIcon /> 临时密码不会再次显示。请通过安全渠道交给成员，并要求首次登录立即改密。</p>
              </article>

              <article className="panel roles-panel">
                <div className="panel__head"><div><span className="section-kicker">ROLE MATRIX</span><h2>角色权限说明</h2></div></div>
                <div className="role-list">
                  <div className="role-item role-item--owner"><span>所有者 · 当前开放</span><p>最高权限，可管理所有成员、共享账号库和历史记录。</p></div>
                  <div className="role-item role-item--admin"><span>管理员 · 当前开放</span><p>可与所有者共同维护共享账号库，并读取、生成和管理团队历史记录。</p></div>
                  <div className="role-item role-item--operator"><span>操作员 · 后续开放</span><p>首版暂不创建或分配；后续用于执行取数及生成团队历史。</p></div>
                  <div className="role-item role-item--viewer"><span>只读成员 · 后续开放</span><p>首版暂不创建或分配；后续用于查看共享历史和已生成报告。</p></div>
                </div>
              </article>
            </section>

            <section className="panel members-panel">
              <div className="panel__head">
                <div><span className="section-kicker">TEAM MEMBERS</span><h2>成员列表</h2></div>
                <button className="text-button" type="button" onClick={() => void load()} disabled={loading}>刷新列表</button>
              </div>
              <div className="members-table-wrap">
                <table className="members-table">
                  <caption className="sr-only">团队成员、角色、状态和最近访问时间</caption>
                  <thead><tr><th scope="col">成员</th><th scope="col">角色</th><th scope="col">状态</th><th scope="col">最近访问</th><th scope="col">管理</th></tr></thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={5}><div className="empty-state"><span className="loader" /> 正在载入成员列表…</div></td></tr>
                    ) : members.length ? members.map((member) => {
                      const protectedOwner = member.role === "owner";
                      const legacyRole = member.role === "operator" || member.role === "viewer";
                      const isSelf = Boolean(current?.userId && member.userId === current.userId) || Boolean(current?.username && member.username === current.username) || Boolean(current?.email && member.email === current.email);
                      const locked = protectedOwner || updatingId === member.id;
                      return (
                        <tr key={member.id}>
                          <td data-label="成员"><div className="member-cell"><span className="member-avatar"><UserIcon /></span><span><strong>{member.name}</strong><small>@{member.username || "未设置用户名"}{member.email ? ` · ${member.email}` : ""}</small></span>{isSelf ? <i>当前账号</i> : null}</div></td>
                          <td data-label="角色"><span className={`role-badge role-badge--${member.role}`}>{roleLabel(member.role)}</span></td>
                          <td data-label="状态"><span className={`status-pill status-pill--${member.status}`}>{statusLabel(member.status)}</span></td>
                          <td data-label="最近访问"><span className="date-cell">{formatDate(member.lastSeenAt)}</span></td>
                          <td data-label="管理">
                            <div className="member-actions">
                              {legacyRole ? (
                                <button
                                  className="toggle-button"
                                  type="button"
                                  disabled={locked}
                                  onClick={() => void updateMember(member, { role: "admin" })}
                                  aria-label={`将 ${member.email || member.name} 升级为管理员`}
                                >
                                  升级为管理员
                                </button>
                              ) : null}
                              <button
                                className="toggle-button"
                                type="button"
                                disabled={locked || isSelf}
                                onClick={() => void updateMember(member, { status: member.status === "disabled" ? "active" : "disabled" })}
                              >
                                {member.status === "disabled" ? "启用" : "停用"}
                              </button>
                              <button className="toggle-button toggle-button--key" type="button" disabled={protectedOwner || isSelf || Boolean(updatingId)} onClick={() => { setResetMember(member); setResetPassword(""); setShowResetPassword(false); }}><KeyIcon /> 重置密码</button>
                            </div>
                            {protectedOwner ? <small className="locked-note"><LockIcon /> 所有者账号不能在成员列表中修改</small> : null}
                            {legacyRole ? <small className="locked-note"><LockIcon /> 历史角色仅兼容展示，首版暂未开放；可升级为管理员</small> : null}
                            {isSelf && !protectedOwner ? <small className="locked-note"><LockIcon /> 当前账号不能停用或重置自己的密码</small> : null}
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr><td colSpan={5}><div className="empty-state"><PeopleIcon /><strong>暂无团队成员</strong><span>使用上方表单开通第一位同事。</span></div></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
      {resetMember ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !resetting) setResetMember(null); }}>
          <section className="password-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
            <span className="password-dialog__icon"><KeyIcon /></span>
            <h2 id="reset-password-title">重置 {resetMember.name} 的密码</h2>
            <p>请设置一次性临时密码。系统不会再次显示这段密码，成员下次登录时必须改为自己的新密码。</p>
            <form onSubmit={submitPasswordReset}>
              <label htmlFor="reset-password">新临时密码</label>
              <div className="input-shell input-shell--plain">
                <input id="reset-password" type={showResetPassword ? "text" : "password"} autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="至少 16 位" required minLength={16} maxLength={256} />
                <button className="password-toggle" type="button" onClick={() => setShowResetPassword((value) => !value)} aria-label={showResetPassword ? "隐藏临时密码" : "显示临时密码"}>{showResetPassword ? <EyeOffIcon /> : <EyeIcon />}</button>
              </div>
              <ul className="password-rules password-rules--compact" aria-label="重置密码要求">
                <li className={resetRules.length ? "is-ok" : ""}><CheckIcon /> 16–256 位</li>
                <li className={resetRules.letter ? "is-ok" : ""}><CheckIcon /> 字母</li>
                <li className={resetRules.number ? "is-ok" : ""}><CheckIcon /> 数字</li>
                <li className={resetRules.symbol ? "is-ok" : ""}><CheckIcon /> 特殊字符</li>
              </ul>
              <div className="dialog-actions">
                <button className="button button--secondary" type="button" onClick={() => { setResetMember(null); setResetPassword(""); }} disabled={resetting}>取消</button>
                <button className="button button--primary" type="submit" disabled={resetting || !validResetPassword}>{resetting ? <span className="loader loader--light" /> : <KeyIcon />}{resetting ? "正在重置…" : "确认重置"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      <footer className="site-footer"><span><span className="brand-mark brand-mark--small">TB</span> 淘宝经营数据团队工作台</span><span>成员权限变更会记录在审计日志中</span></footer>
    </main>
  );
}
