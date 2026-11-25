# syntax=docker/dockerfile:1
# 固定源码在隔离 Linux 构建层编译。运行镜像只接收 API 及其正式工作区依赖。
FROM node:24.13.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS manifests
COPY package.json package-lock.json tsconfig.base.json LICENSE ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/enterprise-portal/package.json apps/enterprise-portal/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
COPY apps/staff-miniprogram/package.json apps/staff-miniprogram/package.json
COPY apps/tenant-website/package.json apps/tenant-website/package.json
COPY apps/website-next/package.json apps/website-next/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/web-client/package.json packages/web-client/package.json
COPY packages/platform-contracts/package.json packages/platform-contracts/package.json
COPY packages/platform-server/package.json packages/platform-server/package.json
COPY packages/platform-core-host/package.json packages/platform-core-host/package.json
COPY packages/platform-admin/package.json packages/platform-admin/package.json
COPY packages/core-contracts/package.json packages/core-contracts/package.json
COPY packages/core-host/package.json packages/core-host/package.json
COPY packages/rental-core/package.json packages/rental-core/package.json
COPY packages/ai-native-server/package.json packages/ai-native-server/package.json
COPY packages/ai-native-data/package.json packages/ai-native-data/package.json
COPY packages/ai-native-admin/package.json packages/ai-native-admin/package.json
COPY packages/rental-mcp-host/package.json packages/rental-mcp-host/package.json
COPY packages/example-tickets-core/package.json packages/example-tickets-core/package.json

FROM manifests AS build
RUN --mount=type=cache,id=nativark-npm,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --include-workspace-root \
    --workspace @rental-os/shared --workspace @rental-os/mcp-server \
    --workspace @rental-os/api --workspace @rental-os/admin
RUN node node_modules/@prisma/engines/scripts/postinstall.js
COPY config config
COPY apps/api apps/api
COPY apps/admin apps/admin
COPY packages packages
COPY scripts/build-selected-prisma.cjs scripts/miniprogram-shared-types.cjs scripts/
COPY assets assets
COPY tests/fixtures/ai-native/prisma-offline-preload.cjs tests/fixtures/ai-native/prisma-offline-preload.cjs
# 原离线守卫只允许生成器写本层专用临时目录。包编译显式消费这份 Client
# 的声明，旧 Nest 宿主运行携带同字节副本；编译结束才删除临时目录。
ENV NODE_ENV=production VITE_API_BASE_URL=/api VITE_SHOW_ACCOUNT_SHORTCUTS=true
RUN mkdir -p /app/output/.tmp/prisma && \
    sed '/provider = "prisma-client-js"/a\  output = "/app/output/.tmp/prisma/client"' \
      apps/api/prisma/schema.prisma > /app/output/.tmp/prisma/schema.prisma && \
    DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline \
    AI_OFFLINE_AUDIT=/app/output/.tmp/prisma/audit.log \
    AI_OFFLINE_WRITE_ROOT=/app/output/.tmp/prisma \
    TEMP=/app/output/.tmp/prisma TMP=/app/output/.tmp/prisma TMPDIR=/app/output/.tmp/prisma \
    XDG_CACHE_HOME=/app/output/.tmp/prisma npm_config_cache=/app/output/.tmp/prisma \
    NODE_OPTIONS="--require /app/tests/fixtures/ai-native/prisma-offline-preload.cjs" \
    CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 PRISMA_DISABLE_TELEMETRY=1 \
    PRISMA_GENERATE_SKIP_AUTOINSTALL=1 \
    PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node \
    PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x \
    node --require /app/tests/fixtures/ai-native/prisma-offline-preload.cjs \
      node_modules/prisma/build/index.js generate --schema /app/output/.tmp/prisma/schema.prisma && \
    if test -s /app/output/.tmp/prisma/audit.log; then cat /app/output/.tmp/prisma/audit.log; exit 1; fi && \
    mkdir -p node_modules/.prisma/client && \
    cp -a /app/output/.tmp/prisma/client/. node_modules/.prisma/client/ && \
    RENTAL_PRISMA_CLIENT=/app/output/.tmp/prisma/client/index.d.ts npm run build && \
    rm -rf /app/output/.tmp/prisma

FROM manifests AS dependencies
RUN --mount=type=cache,id=nativark-npm,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund --include-workspace-root \
    --workspace @rental-os/api --workspace @rental-os/shared --workspace @rental-os/mcp-server

FROM dependencies AS api
ARG PRODUCT_COMMIT
LABEL org.opencontainers.image.revision=$PRODUCT_COMMIT
COPY --from=build /app/node_modules/.prisma/client node_modules/.prisma/client
COPY --from=build /app/config config
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/dist-agent-desktop packages/shared/dist-agent-desktop
COPY --from=build /app/packages/mcp-server/dist packages/mcp-server/dist
COPY --from=build /app/packages/mcp-server/*.sql packages/mcp-server/
COPY --from=build /app/packages/platform-contracts/dist packages/platform-contracts/dist
COPY --from=build /app/packages/platform-server/dist packages/platform-server/dist
COPY --from=build /app/packages/platform-core-host/dist packages/platform-core-host/dist
COPY --from=build /app/packages/core-contracts/dist packages/core-contracts/dist
COPY --from=build /app/packages/core-host/dist packages/core-host/dist
COPY --from=build /app/packages/rental-core/dist packages/rental-core/dist
COPY --from=build /app/packages/rental-core/dist-clients packages/rental-core/dist-clients
COPY --from=build /app/packages/rental-core/prisma packages/rental-core/prisma
COPY --from=build /app/packages/example-tickets-core/dist packages/example-tickets-core/dist
COPY --from=build /app/packages/ai-native-server/dist packages/ai-native-server/dist
COPY --from=build /app/packages/rental-mcp-host/dist packages/rental-mcp-host/dist
COPY --from=build /app/LICENSE LICENSE
# 迁移源码目录供非 root 运行用户读取，兼容此前严格 umask 产生的构建缓存。
RUN find apps/api/prisma packages/rental-core/prisma -type d -exec chmod 0755 {} +
USER node
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]

FROM nginx:1.28-alpine AS web
ARG PRODUCT_COMMIT
LABEL org.opencontainers.image.revision=$PRODUCT_COMMIT
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
COPY scripts/ops/deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY scripts/ops/deployment/streams.conf /etc/nginx/streams.conf
RUN printf '\ninclude /etc/nginx/streams.conf;\n' >> /etc/nginx/nginx.conf
