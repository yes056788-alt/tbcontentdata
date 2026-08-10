"use client";

import { FormEvent, useEffect, useState } from "react";
import { AuthShell } from "./auth-shell";
import {
  ClientApiError,
  normalizeAuthStatus,
  requestJson,
  safeNextPath,
} from "./auth-api";
import { ArrowIcon, EyeIcon, EyeOffIcon, LockIcon, UserIcon } from "./icons";

export function LoginClient() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const url = new URL(window.location.href);
      setSetupComplete(url.searchParams.get("setup") === "success");
      try {
        const status = normalizeAuthStatus(await requestJson("/api/auth/status"));
        setSetupRequired(status.setupRequired);
        if (status.authenticated) {
          window.location.replace(status.mustChangePassword ? "/change-password" : safeNextPath(url.searchParams.get("next")));
          return;
        }
      } catch (statusError) {
        if (!(statusError instanceof ClientApiError && statusError.status === 401)) {
          setError(statusError instanceof Error ? statusError.message : "暂时无法检查登录状态。");
        }
      } finally {
        setChecking(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !username.trim() || !password) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await requestJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const status = normalizeAuthStatus(result);
      setPassword("");
      const next = safeNextPath(new URL(window.location.href).searchParams.get("next"));
      window.location.replace(status.mustChangePassword ? "/change-password" : next);
    } catch (loginError) {
      setPassword("");
      setError(loginError instanceof Error ? loginError.message : "登录失败，请检查用户名和密码。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="MEMBER SIGN IN"
      title="登录团队工作台"
      description="使用管理员为你创建的用户名和密码登录，无需 ChatGPT 账号。"
      footer={<span><LockIcon /> 登录会话仅保存在安全、HttpOnly 的站点 Cookie 中</span>}
    >
      {setupComplete ? (
        <div className="auth-message auth-message--success" role="status">所有者账号已创建，请使用新账号登录。</div>
      ) : null}
      {setupRequired ? (
        <div className="auth-message auth-message--warning" role="status">
          系统尚未完成首次初始化。请使用部署时生成的安全初始化链接<a href="/setup">创建所有者账号</a>；没有完整密钥时请联系部署管理员。
        </div>
      ) : null}
      {error ? <div className="auth-message auth-message--error" role="alert">{error}</div> : null}
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="login-username">用户名</label>
        <div className="input-shell">
          <UserIcon />
          <input
            id="login-username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="请输入用户名"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={checking || submitting}
            required
            maxLength={64}
          />
        </div>
        <label htmlFor="login-password">密码</label>
        <div className="input-shell">
          <LockIcon />
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="请输入密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={checking || submitting}
            required
            maxLength={256}
          />
          <button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        <button className="button button--primary button--full auth-submit" type="submit" disabled={checking || submitting || !username.trim() || !password}>
          {checking || submitting ? <span className="loader loader--light" /> : null}
          {checking ? "正在检查登录状态…" : submitting ? "正在安全登录…" : <>登录工作台 <ArrowIcon /></>}
        </button>
      </form>
      <p className="auth-help">管理员忘记密码或账号被停用？请联系工作区所有者。所有者忘记密码时，请由已登录管理员打开<a href="/owner-recovery">所有者恢复页</a>并准备部署恢复码。</p>
    </AuthShell>
  );
}
