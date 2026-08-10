FROM node:24-bookworm-slim AS dependencies

WORKDIR /workspace/cloud-tool
COPY cloud-tool/package.json cloud-tool/package-lock.json ./
RUN npm ci

FROM dependencies AS builder

WORKDIR /workspace
COPY cloud-tool/ ./cloud-tool/
COPY web-tool/ ./web-tool/
COPY vendor/xlsx.full.min.js ./vendor/xlsx.full.min.js
COPY manifest.json README_V2.md diagnosis-popup.html diagnosis-popup.js diagnosis-spec.js ./
COPY background.js content-script.js dmp-content-script.js dmp-crowd-presets.json dmp-page-hook.js ./
COPY page-hook.js rules.js sycm-content-script.js web-tool-bridge.js xinghe-content-script.js ./
COPY wxt-report-content.js wxt-report-page-hook.js wxt-report-response-hook.js wxt-report-trace.js ./
WORKDIR /workspace/cloud-tool
ENV DEPLOY_TARGET=node
RUN npm run build:node

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DEPLOY_TARGET=node \
    HOST=0.0.0.0 \
    PORT=3000 \
    APP_DATA_DIR=/data \
    MIGRATIONS_PATH=/app/drizzle

WORKDIR /app
RUN groupadd --system --gid 10001 tbdata \
    && useradd --system --uid 10001 --gid tbdata --home-dir /app tbdata \
    && mkdir -p /data/objects/runs \
    && chown -R tbdata:tbdata /app /data

COPY --from=builder --chown=tbdata:tbdata /workspace/cloud-tool/dist/standalone/ ./
COPY --from=builder --chown=tbdata:tbdata /workspace/cloud-tool/drizzle/ ./drizzle/
COPY --from=builder --chown=tbdata:tbdata /workspace/cloud-tool/public/ ./public/
COPY --from=builder --chown=tbdata:tbdata /workspace/cloud-tool/scripts/import-business-migration.mjs ./scripts/import-business-migration.mjs
COPY --from=builder --chown=tbdata:tbdata /workspace/cloud-tool/scripts/start-node.mjs ./scripts/start-node.mjs
COPY --from=builder --chown=tbdata:tbdata /workspace/cloud-tool/scripts/lib/ ./scripts/lib/
COPY --from=builder --chown=tbdata:tbdata /workspace/cloud-tool/lib/business-migration-format.mjs ./lib/business-migration-format.mjs
COPY --from=builder --chown=tbdata:tbdata /workspace/cloud-tool/lib/node-production-config.mjs ./lib/node-production-config.mjs
COPY --from=builder --chown=tbdata:tbdata /workspace/cloud-tool/node_modules/drizzle-orm/ ./node_modules/drizzle-orm/

USER tbdata
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "scripts/start-node.mjs"]
