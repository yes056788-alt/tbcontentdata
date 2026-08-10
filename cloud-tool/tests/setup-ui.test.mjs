import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const setupSource = await readFile(
  new URL("../app/components/setup-client.tsx", import.meta.url),
  "utf8",
);

test("setup accepts a URL token or a manually entered masked security key", () => {
  assert.match(setupSource, /searchParams\.get\("token"\)/);
  assert.match(setupSource, /searchParams\.delete\("token"\)/);
  assert.match(setupSource, /setManualTokenEntry\(!setupToken\)/);
  assert.match(setupSource, /id="setup-token"[\s\S]*?type="password"/);
  assert.match(setupSource, /初始化安全密钥/);
});

test("setup security key remains memory-only and is cleared after submission", () => {
  assert.doesNotMatch(setupSource, /localStorage|sessionStorage/);
  assert.match(setupSource, /const bootstrapToken = token\.trim\(\)/);
  assert.match(setupSource, /setToken\(""\)[\s\S]*?requestJson\("\/api\/auth\/setup"/);
  assert.match(setupSource, /finally \{[\s\S]*?setToken\(""\)/);
});

test("setup explains username restrictions and reports password mismatch", () => {
  assert.match(setupSource, /登录用户名不能使用邮箱地址/);
  assert.match(setupSource, /不能填写邮箱/);
  assert.match(setupSource, /两次输入的密码不一致，请重新确认/);
  assert.match(setupSource, /aria-invalid=\{passwordsMismatch\}/);
});
