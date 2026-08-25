"use client";

/* eslint-disable @next/next/no-html-link-for-pages */

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AuthShell } from "./auth-shell";
import { ClientApiError, normalizeAuthStatus, requestJson } from "./auth-api";
import { CheckIcon, EyeIcon, EyeOffIcon, KeyIcon, LockIcon } from "./icons";
import { lockVaultAndRedirect } from "./vault-session-lock";

export function ChangePasswordClient() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [forced, setForced] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const status = normalizeAuthStatus(await requestJson("/api/auth/status"));
        if (!status.authenticated) {
          await lockVaultAndRedirect("/login?next=%2Fchange-password");
          return;
        }
        setForced(status.mustChangePassword);
        setDisplayName(status.displayName || status.username);
      } catch (statusError) {
        if (statusError instanceof ClientApiError &&
            (statusError.status === 401 || statusError.status === 403)) {
          await lockVaultAndRedirect("/login?next=%2Fchange-password");
          return;
        }
        setError(statusError instanceof Error ? statusError.message : "暂时无法检查账号状态。");
      } finally {
        setChecking(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const requirements = useMemo(() => ({
    length: newPassword.length >= 16,
    letter: /[a-z]/i.test(newPassword),
    number: /\d/.test(newPassword),
    symbol: /[^a-z0-9]/i.test(newPassword),
    different: Boolean(newPassword) && newPassword !== currentPassword,
    match: Boolean(newPassword) && newPassword === confirmPassword,
  }), [currentPassword, newPassword, confirmPassword]);
  const validPassword = Object.values(requirements).every(Boolean);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !currentPassword || !validPassword) return;
    setSubmitting(true);
    setError("");
    try {
      await requestJson("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await lockVaultAndRedirect("/");
    } catch (changeError) {
      if (changeError instanceof ClientApiError &&
          (changeError.status === 401 || changeError.status === 403)) {
        await lockVaultAndRedirect("/login?next=%2Fchange-password");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(changeError instanceof Error ? changeError.message : "密码修改失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow={forced ? "PASSWORD UPDATE REQUIRED" : "ACCOUNT SECURITY"}
      title={forced ? "首次登录，请设置新密码" : "修改登录密码"}
      description={forced ? "管理员创建的是一次性临时密码。完成修改后才能进入团队工作台。" : `${displayName ? `${displayName}，` : ""}定期更新密码有助于保护账号安全。`}
      footer={<span><LockIcon /> 新密码提交后，其他登录会话可能需要重新验证</span>}
    >
      {forced ? <div className="auth-message auth-message--warning" role="status">临时密码只能用于首次登录，请勿继续使用或转发。</div> : null}
      {error ? <div className="auth-message auth-message--error" role="alert">{error}</div> : null}
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="current-password">当前密码</label>
        <div className="input-shell"><KeyIcon /><input id="current-password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={forced ? "输入管理员提供的临时密码" : "输入当前密码"} required maxLength={256} /></div>
        <label htmlFor="new-password">新密码</label>
        <div className="input-shell">
          <LockIcon /><input id="new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 16 位的高强度密码" required minLength={16} maxLength={256} />
          <button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOffIcon /> : <EyeIcon />}</button>
        </div>
        <label htmlFor="confirm-new-password">确认新密码</label>
        <div className="input-shell"><LockIcon /><input id="confirm-new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" required minLength={16} maxLength={256} /></div>
        <ul className="password-rules" aria-label="新密码要求">
          <li className={requirements.length ? "is-ok" : ""}><CheckIcon /> 至少 16 位</li>
          <li className={requirements.letter ? "is-ok" : ""}><CheckIcon /> 包含字母</li>
          <li className={requirements.number ? "is-ok" : ""}><CheckIcon /> 包含数字</li>
          <li className={requirements.symbol ? "is-ok" : ""}><CheckIcon /> 包含特殊字符</li>
          <li className={requirements.different ? "is-ok" : ""}><CheckIcon /> 不同于当前密码</li>
          <li className={requirements.match ? "is-ok" : ""}><CheckIcon /> 两次输入一致</li>
        </ul>
        <button className="button button--primary button--full auth-submit" type="submit" disabled={checking || submitting || !currentPassword || !validPassword}>
          {checking || submitting ? <span className="loader loader--light" /> : <KeyIcon />}{checking ? "正在检查账号…" : submitting ? "正在更新密码…" : "保存新密码"}
        </button>
      </form>
      {!forced ? <p className="auth-help"><a href="/">暂不修改，返回团队首页</a></p> : null}
    </AuthShell>
  );
}
