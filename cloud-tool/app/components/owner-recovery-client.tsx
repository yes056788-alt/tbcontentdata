"use client";

import { FormEvent, useMemo, useState } from "react";
import { AuthShell } from "./auth-shell";
import { requestJson } from "./auth-api";
import { CheckIcon, KeyIcon, LockIcon } from "./icons";

export function OwnerRecoveryClient() {
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [error, setError] = useState("");

  const requirements = useMemo(() => ({
    length: Array.from(newPassword).length >= 16 && Array.from(newPassword).length <= 256,
    letter: /[a-z]/i.test(newPassword),
    number: /\d/.test(newPassword),
    symbol: /[^a-z0-9]/i.test(newPassword),
    match: Boolean(newPassword) && newPassword === confirmPassword,
  }), [newPassword, confirmPassword]);
  const validPassword = Object.values(requirements).every(Boolean);
  const passwordsMismatch = Boolean(confirmPassword) && newPassword !== confirmPassword;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedCode = recoveryCode.trim();
    const submittedPassword = newPassword;
    const submittedConfirmation = confirmPassword;
    if (submitting || !submittedCode || !validPassword) return;
    setSubmitting(true);
    setError("");
    // Recovery material is memory-only and removed from component state before
    // the network request completes. A failed attempt must be entered again.
    setRecoveryCode("");
    setNewPassword("");
    setConfirmPassword("");
    try {
      await requestJson("/api/auth/owner-recovery", {
        method: "POST",
        body: JSON.stringify({
          recoveryCode: submittedCode,
          newPassword: submittedPassword,
          confirmPassword: submittedConfirmation,
        }),
      });
      setRecovered(true);
    } catch (recoveryError) {
      setError(
        recoveryError instanceof Error
          ? recoveryError.message
          : "所有者密码恢复失败，请重新输入恢复码和新密码。",
      );
    } finally {
      setRecoveryCode("");
      setNewPassword("");
      setConfirmPassword("");
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="OWNER RECOVERY"
      title="恢复工作区所有者访问"
      description="当前管理员会话只能发起恢复；还必须输入部署管理员为本次事件生成的短期一次性恢复码。"
      footer={<span><LockIcon /> 恢复码和新密码仅发送到当前站点，不写入 URL、本地存储或浏览器会话</span>}
    >
      {recovered ? (
        <div className="auth-message auth-message--success" role="status">
          所有者临时密码已更新，原有所有者登录会话均已撤销。所有者使用刚输入的临时密码登录后，必须立即设置只有自己知道的新密码。
          <a href="/admin">返回权限管理</a>
        </div>
      ) : (
        <>
          <div className="auth-message auth-message--warning" role="status">
            恢复码最长只在 60 分钟内有效且只能成功使用一次。恢复完成后，部署管理员必须立即删除服务器端恢复配置。
          </div>
          {error ? <div className="auth-message auth-message--error" role="alert">{error}</div> : null}
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="owner-recovery-code">一次性所有者恢复码</label>
            <div className="input-shell">
              <KeyIcon />
              <input
                id="owner-recovery-code"
                name="owner-recovery-code"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                placeholder="粘贴部署管理员提供的恢复码"
                disabled={submitting}
                required
                minLength={43}
                maxLength={43}
              />
            </div>
            <p className="auth-field-help">恢复码不会回显；提交后无论成功或失败都会立即清空。</p>

            <label htmlFor="owner-recovery-password">设置所有者临时密码</label>
            <div className="input-shell">
              <LockIcon />
              <input
                id="owner-recovery-password"
                name="temporary-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="至少 16 位的高强度临时密码"
                disabled={submitting}
                required
                minLength={16}
                maxLength={256}
              />
            </div>
            <label htmlFor="owner-recovery-confirm">确认所有者临时密码</label>
            <div className="input-shell">
              <LockIcon />
              <input
                id="owner-recovery-confirm"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再次输入临时密码"
                disabled={submitting}
                required
                minLength={16}
                maxLength={256}
                aria-invalid={passwordsMismatch}
                aria-describedby={passwordsMismatch ? "owner-recovery-confirm-error" : undefined}
              />
            </div>
            {passwordsMismatch ? (
              <p id="owner-recovery-confirm-error" className="auth-field-error" role="alert">两次输入的新密码不一致。</p>
            ) : null}
            <ul className="password-rules" aria-label="密码要求">
              <li className={requirements.length ? "is-ok" : ""}><CheckIcon /> 16–256 位</li>
              <li className={requirements.letter ? "is-ok" : ""}><CheckIcon /> 包含字母</li>
              <li className={requirements.number ? "is-ok" : ""}><CheckIcon /> 包含数字</li>
              <li className={requirements.symbol ? "is-ok" : ""}><CheckIcon /> 包含特殊字符</li>
              <li className={requirements.match ? "is-ok" : ""}><CheckIcon /> 两次输入一致</li>
            </ul>
            <button
              className="button button--primary button--full auth-submit"
              type="submit"
              disabled={submitting || !recoveryCode.trim() || !validPassword}
            >
              {submitting ? <span className="loader loader--light" /> : <KeyIcon />}
              {submitting ? "正在安全恢复…" : "设置临时密码并撤销旧会话"}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
