# 淘宝经营数据协作平台与数据助手

本仓库保存生产站点 [tbdata.aizicheng.com](https://tbdata.aizicheng.com) 对应的网页工具源码，以及配套的 Chrome 数据助手扩展源码。当前扩展版本为 `2.37.36`。

## 目录说明

- 仓库根目录：Chrome MV3 数据助手扩展；入口为 `manifest.json`。
- `web-tool/`：本地网页工作台及在线版共用的业务页面、脚本与样式。
- `cloud-tool/`：在线团队协作站点，支持 Cloudflare D1/R2 和 Node 24 + SQLite 两种部署方式。
- `tests/`：扩展与网页桥接的 Node.js 回归测试。
- `cloud-tool/tests/`：在线站点的构建、鉴权、存储与迁移测试。

`cloud-tool/scripts/sync-web-tool.mjs` 会在构建前同步 `web-tool/` 资源，并根据根目录扩展源码生成受保护页面和扩展下载包。请修改源文件，不要直接修改生成副本。

## 本地验证

扩展与网页工具：

```bash
node --test tests/*.test.js
```

在线站点：

```bash
cd cloud-tool
npm ci
npm run lint
npm test
npm run test:node
```

更多部署、权限、备份与迁移说明见 [`cloud-tool/README.md`](cloud-tool/README.md)，扩展使用说明见 [`README_V2.md`](README_V2.md)。

## 安全边界

不要提交真实 `.env.production`、`.dev.vars`、数据库、对象存储数据、迁移包、账号凭据、TLS 私钥或备份。仓库仅保留可公开复用的示例配置。

在线版密码库绑定当前团队工作区，成员按权限共享同一份 AES-GCM 密文；在另一台电脑登录同一团队账号后会下载同一份密文，首次使用仍需输入团队密码库主密码。主密码只在成员之间通过安全渠道传递，不上传服务器。退出登录、成员停用或会话失效会清除扩展内的明文解锁态并停止账号库任务；任务启动、平台登录和实际提交密码前都会实时复核团队授权，已打开页面还会按 30 秒及重新聚焦时复核。切换到其他部署/本地开发空间不会串库。团队重置由 owner/admin 执行带版本的云端删除，持久删除标记会阻止旧电脑重新上传已删除密文；只有用户明确新建才能重建。项目目录、运行历史和诊断报告同样属于团队共享数据。
