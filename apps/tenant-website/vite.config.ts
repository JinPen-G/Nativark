import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import {
  apiProxyTarget,
  loadViteEnvironment,
  publicEnvironmentDefinitions,
} from "../../config/environment.cjs";

// 开发时把 /api 代理到配置的 API，API_PROXY_TARGET 与旧 VITE_API_TARGET 均可使用。
// 让官网直接消费租户客户端公开接口 /api/client/v1/*，无需 CORS。

export default defineConfig(({ mode }) => {
  const env = loadViteEnvironment(
    mode,
    fileURLToPath(new URL(".", import.meta.url)),
    loadEnv,
    { offline: mode === "ai-offline" },
  );
  const apiTarget = apiProxyTarget(env);
  const port = Number(env.TENANT_WEBSITE_PORT ?? 4186);
  const proxy =
    mode === "ai-offline"
      ? undefined
      : { "/api": { target: apiTarget, changeOrigin: true } };
  return {
    envDir: false,
    envPrefix: [],
    define: publicEnvironmentDefinitions("tenantWebsite", env),
    plugins: [react()],
    resolve: {
      extensions: [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
      alias: {
        "@rental-os/web-client": fileURLToPath(
          new URL("../../packages/web-client/src/index.ts", import.meta.url),
        ),
        "@rental-os/shared": fileURLToPath(
          new URL("../../packages/shared/src/index.ts", import.meta.url),
        ),
      },
    },
    server: { port, strictPort: true, proxy },
    preview: { port, strictPort: true, proxy },
  };
});
