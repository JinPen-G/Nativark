# syntax=docker/dockerfile:1
# 固定源码在隔离 Linux 构建层编译。运行镜像只接收 API 及其正式工作区依赖。
FROM node:24.13.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
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
RUN --mount=type=cache,id=nativark-npm,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --include-workspace-root \
    --workspace @rental-os/shared --workspace @rental-os/mcp-server \
    --workspace @rental-os/api --workspace @rental-os/admin
RUN node node_modules/@prisma/engines/scripts/postinstall.js
COPY config config
COPY apps/api apps/api
COPY apps/admin apps/admin
COPY packages/shared packages/shared
COPY packages/mcp-server packages/mcp-server
COPY packages/ui-arc packages/ui-arc
COPY packages/ui-motiq packages/ui-motiq
COPY assets assets
COPY tests/fixtures/ai-native/prisma-offline-preload.cjs tests/fixtures/ai-native/prisma-offline-preload.cjs
# 原离线守卫只允许生成器写本层专用临时目录，生成后再放入本镜像的 Client 位置。
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
    rm -rf /app/output/.tmp/prisma
ENV NODE_ENV=production VITE_API_BASE_URL=/api VITE_SHOW_ACCOUNT_SHORTCUTS=true
RUN npm run build

FROM base AS dependencies
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/mcp-server/package.json packages/mcp-server/package.json
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
COPY --from=build /app/LICENSE LICENSE
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
