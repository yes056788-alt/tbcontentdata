# 淘宝经营数据协作平台与数据助手

本仓库保存生产站点 [tbdata.aizicheng.com](https://tbdata.aizicheng.com) 对应的网页工具源码，以及配套的 Chrome 数据助手扩展源码。当前扩展版本为 `2.37.5`。

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
