/* eslint-disable @next/next/no-html-link-for-pages */

import type { ReactNode } from "react";
import { CheckIcon, LockIcon, ShieldIcon } from "./icons";

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="平台介绍">
        <a className="brand brand--light" href="/" aria-label="淘宝经营数据首页">
          <span className="brand-mark" aria-hidden="true">TB</span>
          <span><strong>淘宝经营数据</strong><small>全链路经营工作台</small></span>
        </a>
        <div className="auth-story__content">
          <span className="eyebrow"><ShieldIcon /> 团队私有空间</span>
          <h1>让经营数据协作<br /><span>简单，也更安全</span></h1>
          <p>共享账号库只保存加密密文，登录凭据经过安全哈希处理；每位成员按角色访问工作台与历史报告。</p>
          <ul className="auth-benefits">
            <li><CheckIcon /><span><strong>独立成员账号</strong><small>不再共享管理员密码</small></span></li>
            <li><CheckIcon /><span><strong>分级权限控制</strong><small>首版开放所有者与管理员，更多角色后续提供</small></span></li>
            <li><CheckIcon /><span><strong>敏感数据保护</strong><small>密码不会以明文保存或显示</small></span></li>
          </ul>
        </div>
        <p className="auth-story__foot"><LockIcon /> 仅限获授权的团队成员访问</p>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <div className="auth-card__head">
            <span className="section-kicker">{eyebrow}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {children}
          {footer ? <div className="auth-card__footer">{footer}</div> : null}
        </div>
      </section>
    </main>
  );
}
