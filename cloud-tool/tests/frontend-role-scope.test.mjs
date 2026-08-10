import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminSource = await readFile(
  new URL("../app/components/admin-client.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = await readFile(
  new URL("../app/components/dashboard-client.tsx", import.meta.url),
  "utf8",
);
const authShellSource = await readFile(
  new URL("../app/components/auth-shell.tsx", import.meta.url),
  "utf8",
);

test("new local members are fixed to the administrator role", () => {
  assert.match(adminSource, /role:\s*"admin"/);
  assert.match(adminSource, /首版新成员固定为管理员/);
  assert.doesNotMatch(adminSource, /id="member-role"/);
  assert.doesNotMatch(adminSource, /<option value="operator">/);
  assert.doesNotMatch(adminSource, /<option value="viewer">/);
});

test("legacy roles remain readable but cannot be newly assigned", () => {
  assert.match(adminSource, /member\.role === "operator" \|\| member\.role === "viewer"/);
  assert.match(adminSource, /历史角色仅兼容展示，首版暂未开放/);
  assert.match(adminSource, /操作员 · 后续开放/);
  assert.match(adminSource, /只读成员 · 后续开放/);
  assert.match(adminSource, /升级为管理员/);
  assert.match(adminSource, /updateMember\(member, \{ role: "admin" \}\)/);
});

test("management controls stay hidden until role validation completes", () => {
  assert.match(adminSource, /loading \? \(\s*<section className="access-denied"/);
  assert.doesNotMatch(adminSource, /Promise\.all\(\[\s*requestJson\("\/api\/session"\)/);
  assert.match(adminSource, /nextCurrent\.role === "owner" \|\| nextCurrent\.role === "admin"/);
  assert.match(adminSource, /disabled=\{locked \|\| isSelf\}/);
});

test("dashboard keeps compatibility labels for historical roles", () => {
  assert.match(dashboardSource, /operator: "操作员"/);
  assert.match(dashboardSource, /viewer: "只读成员"/);
  assert.match(authShellSource, /首版开放所有者与管理员，更多角色后续提供/);
});
