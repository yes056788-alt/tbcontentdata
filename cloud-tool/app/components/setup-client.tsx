"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AuthShell } from "./auth-shell";
import { normalizeAuthStatus, requestJson } from "./auth-api";
import { CheckIcon, EyeIcon, EyeOffIcon, KeyIcon, LockIcon, UserIcon } from "./icons";

export function SetupClient() {
  const [token, setToken] = useState("");
  const [tokenChecked, setTokenChecked] = useState(false);
  const [manualTokenEntry, setManualTokenEntry] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const url = new URL(window.location.href);
      const setupToken = (url.searchParams.get("token") || "").trim();
      url.searchParams.delete("token");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      setToken(setupToken);
      setManualTokenEntry(!setupToken);
      setTokenChecked(true);
      try {
        const status = normalizeAuthStatus(await requestJson("/api/auth/status"));
        setInitialized(!status.setupRequired);
        if (!status.setupRequired) setToken("");
        if (status.authenticated && !status.setupRequired) window.location.replace("/");
      } catch {
        // The setup token is still validated by the setup endpoint. A status
        // check failure must not expose or consume it.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const requirements = useMemo(() => ({
    length: password.length >= 16,
    letter: /[a-z]/i.test(password),
    number: /\d/.test(password),
    symbol: /[^a-z0-9]/i.test(password),
    match: Boolean(password) && password === confirmPassword,
  }), [password, confirmPassword]);
  const validPassword = Object.values(requirements).every(Boolean);
  const normalizedUsername = username.trim();
  const usernameLooksLikeEmail = normalizedUsername.includes("@");
  const validUsername = /^[A-Za-z0-9._\u4e00-\u9fff-]{3,64}$/.test(normalizedUsername);
  const usernameInvalid = Boolean(normalizedUsername) && !validUsername;
  const passwordsMismatch = Boolean(confirmPassword) && password !== confirmPassword;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const bootstrapToken = token.trim();
    if (submitting || !bootstrapToken || !displayName.trim() || !validUsername || !validPassword) return;
    setSubmitting(true);
    setError("");
    // Remove the security key from component state as soon as the request is
    // submitted. A failed attempt must be re-entered instead of being retained.
    setToken("");
    try {
      await requestJson("/api/auth/setup", {
        method: "POST",
        body: JSON.stringify({
          bootstrapToken,
          displayName: displayName.trim(),
          username: normalizedUsername,
          ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
          password,
        }),
      });
      setPassword("");
      setConfirmPassword("");
      window.location.replace("/");
    } catch (setupError) {
      setManualTokenEntry(true);
      setPassword("");
      setConfirmPassword("");
      setError(setupError instanceof Error ? setupError.message : "初始化失败，请重新打开安全初始化链接。");
    } finally {
      setToken("");
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="FIRST-TIME SETUP"
      title="创建工作区所有者"
      description="此步骤只能完成一次。所有者将拥有成员、账号库和历史记录的最高管理权限。"
      footer={<span><KeyIcon /> 初始化密钥只在本次请求中使用，不会写入页面或浏览器存储</span>}
    >
      {initialized ? (
        <div className="auth-message auth-message--warning" role="status">工作区已经完成初始化，不能再次创建所有者。<a href="/login">前往登录</a></div>
      ) : tokenChecked && manualTokenEntry && !token ? (
        <div className="auth-message auth-message--warning" role="status">没有检测到完整初始化链接。请在下方粘贴部署时获得的初始化安全密钥。</div>
      ) : null}
      {error ? <div className="auth-message auth-message--error" role="alert">{error}</div> : null}
      <form className="auth-form auth-form--setup" onSubmit={submit}>
        {tokenChecked && manualTokenEntry && !initialized ? (
          <div className="bootstrap-key-field">
            <label htmlFor="setup-token">初始化安全密钥</label>
            <div className="input-shell">
              <KeyIcon />
              <input
                id="setup-token"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  setError("");
                }}
                placeholder="粘贴完整安全密钥"
                aria-describedby="setup-token-help"
                disabled={submitting}
                required
              />
            </div>
            <p id="setup-token-help" className="auth-field-help">密钥不会回显，也不会写入本地存储或浏览器会话；每次提交后都会立即清空。</p>
          </div>
        ) : null}
        <div className="form-columns">
          <div>
            <label htmlFor="setup-name">姓名</label>
            <div className="input-shell"><UserIcon /><input id="setup-name" type="text" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：张三" required maxLength={100} /></div>
          </div>
          <div>
            <label htmlFor="setup-username">登录用户名</label>
            <div className="input-shell"><UserIcon /><input id="setup-username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="例如：yesong" required minLength={3} maxLength={64} pattern="[A-Za-z0-9._\u4e00-\u9fff-]+" aria-invalid={usernameInvalid} aria-describedby={usernameInvalid ? "setup-username-help setup-username-error" : "setup-username-help"} /></div>
            <p id="setup-username-help" className="auth-field-help">不能填写邮箱；请使用 3–64 个字母、数字、中文、点、下划线或短横线。</p>
            {usernameInvalid ? <p id="setup-username-error" className="auth-field-error" role="alert">{usernameLooksLikeEmail ? "登录用户名不能使用邮箱地址；请只填写邮箱 @ 前的部分，邮箱填写在下方。" : "用户名格式不正确，请检查是否包含空格或其他特殊字符。"}</p> : null}
          </div>
        </div>
        <label htmlFor="setup-email">邮箱 <small>选填，用于账号识别</small></label>
        <div className="input-shell"><span className="input-prefix" aria-hidden="true">@</span><input id="setup-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" maxLength={200} /></div>
        <label htmlFor="setup-password">设置密码</label>
        <div className="input-shell">
          <LockIcon /><input id="setup-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 16 位的高强度密码" required minLength={16} maxLength={256} />
          <button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOffIcon /> : <EyeIcon />}</button>
        </div>
        <label htmlFor="setup-confirm">确认密码</label>
        <div className="input-shell"><LockIcon /><input id="setup-confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" required minLength={16} maxLength={256} aria-invalid={passwordsMismatch} aria-describedby={passwordsMismatch ? "setup-confirm-error" : undefined} /></div>
        {passwordsMismatch ? <p id="setup-confirm-error" className="auth-field-error" role="alert">两次输入的密码不一致，请重新确认。</p> : null}
        <ul className="password-rules" aria-label="密码要求">
          <li className={requirements.length ? "is-ok" : ""}><CheckIcon /> 至少 16 位</li>
          <li className={requirements.letter ? "is-ok" : ""}><CheckIcon /> 包含字母</li>
          <li className={requirements.number ? "is-ok" : ""}><CheckIcon /> 包含数字</li>
          <li className={requirements.symbol ? "is-ok" : ""}><CheckIcon /> 包含特殊字符</li>
          <li className={requirements.match ? "is-ok" : ""}><CheckIcon /> 两次输入一致</li>
        </ul>
        <button className="button button--primary button--full auth-submit" type="submit" disabled={submitting || !token.trim() || initialized || !displayName.trim() || !validUsername || !validPassword}>
          {submitting ? <span className="loader loader--light" /> : <KeyIcon />}{submitting ? "正在安全初始化…" : "创建所有者账号"}
        </button>
      </form>
    </AuthShell>
  );
}
