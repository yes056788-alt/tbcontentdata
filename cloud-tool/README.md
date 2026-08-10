# 淘宝经营数据协作平台

这是本地 Chrome 数据助手的多人在线门户。网站负责身份、权限、共享加密账号库、项目目录和历史归档；真实淘宝登录态与取数动作仍只发生在每位成员自己的 Chrome 中。

项目同时保留两种部署目标：

| 目标 | 数据层 | 构建命令 | 用途 |
| --- | --- | --- | --- |
| Cloudflare / Sites（原路径） | D1 + R2 | `npm run build` | 保持现有部署可回滚 |
| 独立 Node 24 | `node:sqlite` + 本地对象文件 | `npm run build:node` | 阿里云 ECS 或普通 Linux 服务器 |

两种目标共用业务路由、鉴权和页面代码。独立 Node 构建通过精确的运行时别名换入 SQLite 与文件对象存储；默认 Cloudflare 构建仍使用原来的 Worker 绑定。

## 权限模型

- 首次访问 `/setup` 时需输入部署专用的 `BOOTSTRAP_TOKEN`，建立本地所有者账号。
- 成员使用独立用户名和密码登录；密码需至少 16 位，经 PBKDF2-SHA256（10 万次）与服务器端独立 pepper 共同保护，不保存明文。
- 首版只签发 `owner / admin` 登录账号。所有者和管理员可新建管理员成员、停用账号及重置临时密码；`operator / viewer` 仅保留为历史兼容角色。
- 普通成员接口始终拒绝管理员重置所有者。紧急恢复必须由已登录管理员在 `/owner-recovery` 同时提交服务器端短期恢复码和强临时密码；成功后撤销全部所有者会话，并强制所有者首次登录立即私下改密。
- 登录会话使用 `HttpOnly` Cookie；数据库只保存不可逆的 SHA-256 token hash，会话过期、撤销或成员停用后立即失效。
- `/`、`/admin`、`/migration`、`/owner-recovery`、六个旧版工作台 HTML、业务 API 和扩展下载都由服务端校验会话；未登录请求不会先收到受保护页面正文。

## 数据边界

- 账号库沿用浏览器端 PBKDF2-SHA256 + AES-GCM，服务器只保存密文和 revision，主密码不会上传。
- 历史正文使用运行时 `RUN_DATA_KEY` 再次 AES-GCM 加密。Cloudflare 写入 R2；独立 Node 写入 `RUNS_PATH` 下的对象文件。数据库只保存脱敏索引和 SHA-256。
- 淘宝 Cookie、平台 token、账号库解锁会话、正在运行的任务和临时标签页不上传。
- 账号库、目录写入使用 revision / `If-Match`；运行记录以 runId 幂等并拒绝密码字段。

## 本地开发

```bash
npm install
npm run dev
npm test
```

`predev`、`prebuild` 与 `prebuild:node` 会运行 `scripts/sync-web-tool.mjs`，把 `../web-tool` 页面和共享脚本同步到 `public/`。不要直接修改生成后的同名文件。

同一脚本会按 `manifest.json` 版本生成 `app/server/generated-protected-assets.ts`。六个旧版工作台 HTML 和扩展 ZIP 内嵌在该模块中，由鉴权后的服务端路由返回，不会作为公开静态文件写入 `public` 或 `dist/client`。

## 独立 Node 运行时

生产环境使用 Node 24。首次启动会从 `drizzle/` 自动创建或升级 SQLite schema；已有表但缺少 Drizzle migration ledger 时会拒绝启动，避免把未知数据库误当作目标库。

```bash
cp .env.production.example .env.production
# 编辑 .env.production，全部替换为部署自己的强随机值。
set -a
. ./.env.production
set +a

npm run build:node
npm run start:node
```

默认数据路径是项目下的 `.data/team.sqlite` 与 `.data/objects`。生产部署应显式配置到持久磁盘或 Docker volume。

运行时变量：

- `APP_PUBLIC_ORIGIN`：浏览器访问的精确 HTTPS origin，例如 `https://tbdata.example.com`。用于同源写入保护，不得包含路径、查询参数或末尾以外的内容。
- `PASSWORD_PEPPER`：至少 32 个随机字符。已存在网页登录账号时不得更换，否则旧密码无法验证。
- `RUN_DATA_KEY`：base64 编码的恰好 32 字节密钥。已有历史对象时不得直接更换，否则旧历史无法解密；通过迁移包导入时可用目标端的新密钥重新加密。
- `BOOTSTRAP_TOKEN`：至少 24 位的高强度首次初始化令牌。创建所有者后可轮换。
- `OWNER_RECOVERY_TOKEN_HASH` / `OWNER_RECOVERY_TOKEN`：仅在实际恢复事件中临时配置二选一；首选前者（32 随机字节 base64url 恢复码的 SHA-256 小写十六进制摘要），后者也必须是该 43 位 base64url 恢复码原文。两者均须配套 `OWNER_RECOVERY_TOKEN_EXPIRES_AT`，且有效期不得超过 60 分钟。平时不要配置。
- `APP_DATA_DIR`：默认 `.data`。
- `DATABASE_PATH`：默认 `$APP_DATA_DIR/team.sqlite`。
- `RUNS_PATH`：默认 `$APP_DATA_DIR/objects`。
- `MIGRATIONS_PATH`：默认当前目录下的 `drizzle`。
- `HOST` / `PORT`：默认由 standalone server 使用 `0.0.0.0:3000`。

`npm run start:node` 会在绑定端口之前执行生产配置校验：必须使用真实的 HTTPS `APP_PUBLIC_ORIGIN`，常驻密钥必须满足长度和随机性要求，且会拒绝示例文件中的占位值及全零历史密钥。所有者恢复配置平时可以完全缺省；一旦出现任一 `OWNER_RECOVERY_*` 值，就必须成对完整、有效且不超过 60 分钟。校验失败时进程直接退出，不会以部分可用状态对外服务。`GET /api/health` 仅返回非敏感的就绪状态，并同时检查启动校验标记、SQLite 迁移及对象存储可用性。Cloudflare 开发与回滚构建不执行 Node 生产启动校验。

### 所有者密码紧急恢复

恢复能力默认关闭。部署管理员应在事件发生时离线生成恰好 32 个随机字节并编码为 43 位无填充 base64url，妥善保存恢复码原文；服务器只配置其 SHA-256 小写摘要和不超过 60 分钟的 UTC 到期时间。不要把恢复码放入 URL、聊天记录、日志或浏览器持久存储。也可临时配置原文 `OWNER_RECOVERY_TOKEN`，服务端仍只用 SHA-256 常量时间比对，但生产环境优先使用摘要配置。

配置生效并重启应用后，由一个已登录的 `admin` 打开 `/owner-recovery`，手动输入恢复码和所有者强临时密码。单凭管理员会话无法重置所有者。成功事务会原子地记录恢复码指纹、更新唯一所有者本地账号、撤销全部所有者会话并写入不含密钥/密码的审计；任何一步失败都会整体回滚。恢复码指纹为追加式主键，即使以后把配置从 A 换成 B 再换回 A，A 仍会被拒绝。

所有者随后用临时密码登录并立即设置私有新密码。部署管理员必须在成功或到期后立即删除全部 `OWNER_RECOVERY_*` 运行时变量并重启；删除后生产启动仍正常，恢复接口会安全地返回“未配置”。

不要把 `.env.production`、密钥、迁移口令、TLS 私钥或 `.tbmig` 文件提交到 Git 或放入 Docker build context。

## 阿里云 ECS Docker 部署

`docker-compose.ecs.yml` 默认只把应用映射到 ECS 回环地址 `127.0.0.1:3401`，不会占用宿主机的 80/443，也不会替换服务器上已有多个域名共用的反向代理。

```bash
cp .env.production.example .env.production
# 编辑密钥与 APP_PUBLIC_ORIGIN 后：
docker compose --env-file .env.production -f docker-compose.ecs.yml build app
docker compose --env-file .env.production -f docker-compose.ecs.yml up -d app
docker compose --env-file .env.production -f docker-compose.ecs.yml ps
```

镜像使用 Node 24、非 root 用户和只读根文件系统。SQLite、WAL 与历史对象只保存在命名卷 `taobao-business-data`。保持单个 app 实例；不要在同一个 SQLite 数据卷上横向启动多个副本。

如 3401 已被占用，可在 `.env.production` 增加 `APP_PORT=其他空闲端口`，并同步修改宿主 Nginx 的 `proxy_pass`。

### 接入宿主已有 Nginx

将 `deploy/nginx/tbdata-host.conf.example` 中的 `server` 配置复制到宿主现有 Nginx，修改域名及宿主当前证书路径，然后执行宿主已有的配置校验与平滑重载流程。核心上游是：

```nginx
location / {
  proxy_pass http://127.0.0.1:3401;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

TLS 证书、80 到 443 跳转和其他域名继续由宿主现有体系管理。代码与 compose 不修改 DNS，也不主动申请或替换证书。

## 首次业务数据迁移

迁移包只包含共享账号库密文、项目目录和历史报告。它明确不包含成员、`local_accounts`、登录密码、会话、环境密钥、Cookie 或初始化令牌，所以目标站仍需在 `/setup` 创建自己的所有者和管理员。

### 1. 从源站导出

所有者登录源站，访问 `/migration`，设置一个 20–256 位且包含字母、数字和特殊字符的独立迁移口令，然后下载 `.tbmig` 文件。迁移口令与文件应分开传输和保管。

导出会逐记录 AES-GCM 加密并生成完整性 manifest；若导出期间源数据发生变化，包会被标记为不一致，目标导入器将拒绝导入。

### 2. 目标端先做只读校验

先构建目标镜像。把迁移文件保存在 Docker build context 之外，并使用绝对路径只读挂载：

```bash
read -s TB_MIGRATION_PASSPHRASE
export TB_MIGRATION_PASSPHRASE

docker compose --env-file .env.production -f docker-compose.ecs.yml run --rm --no-deps \
  -e TB_MIGRATION_PASSPHRASE \
  -v /absolute/secure/path/export.tbmig:/migration/source.tbmig:ro \
  app node scripts/import-business-migration.mjs \
  --package /migration/source.tbmig --dry-run
```

校验模式会验证口令、每条密文、schema、敏感字段禁入规则和 manifest，不打开或创建目标数据库。

### 3. 停止写入并备份卷

真实导入前停止 app。即使目标尚未写入业务数据，也先对持久卷做快照：

```bash
docker compose --env-file .env.production -f docker-compose.ecs.yml stop app
mkdir -p backups
docker run --rm --user 0:0 \
  -v taobao-business-data:/data:ro \
  -v "$PWD/backups:/backup" \
  taobao-business-tool:node24 \
  tar -C /data -czf /backup/tbdata-before-import.tgz .
```

把备份复制到服务器之外的安全位置。SQLite 使用 WAL；必须在 app 停止后再做文件级备份。

### 4. 真实导入并重启

```bash
docker compose --env-file .env.production -f docker-compose.ecs.yml run --rm --no-deps \
  -e TB_MIGRATION_PASSPHRASE \
  -v /absolute/secure/path/export.tbmig:/migration/source.tbmig:ro \
  app node scripts/import-business-migration.mjs \
  --package /migration/source.tbmig

unset TB_MIGRATION_PASSPHRASE
docker compose --env-file .env.production -f docker-compose.ecs.yml up -d app
```

导入器会先完整校验整个包，再开始写入；会使用目标 `.env.production` 的 `RUN_DATA_KEY` 重新加密历史，并拒绝覆盖任何非空的账号库、目录或历史业务表。导入中断或失败时不要反复尝试写入，先查看错误并按备份恢复干净目标卷。

非 Docker 环境可用同一入口：

```bash
TB_MIGRATION_PASSPHRASE='仅示意，不要把真实口令写入 shell 历史' \
  npm run migration:import -- --package /secure/export.tbmig --dry-run
```

真实导入还需要目标端的 `RUN_DATA_KEY`，并可通过 `--sqlite`、`--objects`、`--migrations` 覆盖目标路径。

## 备份与恢复

- 备份时停止 app，然后同时保存整个 `taobao-business-data` 卷和部署使用的密钥。只备份 SQLite 而不备份对象目录，历史正文将无法恢复。
- 恢复必须使用与该快照配套的 `PASSWORD_PEPPER` 和 `RUN_DATA_KEY`。
- 每次升级前保留离线卷快照。生产数据库不要直接用桌面 SQLite 工具改表。

## Cloudflare / Sites 回滚构建

原构建路径保持不变：

```bash
npm run build
npm test
```

`.openai/hosting.json` 仍声明 D1 `DB` 和 R2 `RUNS`。Cloudflare 环境同样需要设置 `PASSWORD_PEPPER`、`RUN_DATA_KEY`、`BOOTSTRAP_TOKEN` 与精确的 `APP_PUBLIC_ORIGIN`；短期 `OWNER_RECOVERY_*` 配置遵循上面的同一规则。

取得稳定 HTTPS 地址后，还必须把该精确 origin 加入扩展的 `manifest.json`、`web-tool-bridge.js` 与 `background.js`，重新打包并让同事安装对应扩展。更换域名时要同时更新这些白名单和 `APP_PUBLIC_ORIGIN`。
