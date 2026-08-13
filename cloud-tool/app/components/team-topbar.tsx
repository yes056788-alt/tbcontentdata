"use client";

/* eslint-disable @next/next/no-html-link-for-pages */

import { LockIcon } from "./icons";
import { LogoutButton } from "./logout-button";
import { useEffect, useRef } from "react";

export type TeamTopbarPage = "home" | "projects" | "report" | "accounts" | "team";

type TeamTopbarProps = {
  activePage: TeamTopbarPage;
  accountName: string;
  accountSubtitle: string;
  showAccountActions: boolean;
};

const navigation = [
  { id: "home", href: "/", label: "首页" },
  { id: "projects", href: "/workspace.html", label: "项目管理" },
  { id: "report", href: "/report.html", label: "一键取数" },
  { id: "accounts", href: "/accounts.html", label: "账号库管理" },
  { id: "team", href: "/admin", label: "团队管理" },
] as const;

export function TeamTopbar({
  activePage,
  accountName,
  accountSubtitle,
  showAccountActions,
}: TeamTopbarProps) {
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const navigationNode = navigationRef.current;
      const activeNode = navigationNode?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!navigationNode || !activeNode || navigationNode.scrollWidth <= navigationNode.clientWidth) return;
      navigationNode.scrollLeft = Math.max(
        0,
        activeNode.offsetLeft - (navigationNode.clientWidth - activeNode.offsetWidth) / 2,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [activePage]);

  return (
    <header className="topbar">
      <a
        className="brand"
        href="/"
        aria-label="淘宝经营数据团队工作台首页"
      >
        <span className="brand-mark" aria-hidden="true">TB</span>
        <span>
          <strong>淘宝经营数据</strong>
          <small>全链路经营工作台</small>
        </span>
      </a>

      <nav className="topnav" aria-label="团队工作台主导航" ref={navigationRef}>
        {navigation.map((item) => {
          const active = item.id === activePage;
          return (
            <a
              className={`topnav__link${active ? " is-active" : ""}`}
              href={item.href}
              aria-current={active ? "page" : undefined}
              key={item.id}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="topbar__account">
        <span className="avatar" aria-hidden="true">
          {(accountName || "用").slice(0, 1).toUpperCase()}
        </span>
        <span className="account-copy">
          <strong>{accountName}</strong>
          <small>{accountSubtitle}</small>
        </span>
        {showAccountActions ? (
          <span className="account-actions">
            <a className="button button--secondary topbar-account-button" href="/change-password">
              <LockIcon />
              <span>修改密码</span>
            </a>
            <LogoutButton />
          </span>
        ) : null}
      </div>
    </header>
  );
}
