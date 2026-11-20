import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { rentalClientVite } from "../../scripts/rental-client-vite";
import {
  apiProxyTarget,
  loadViteEnvironment,
  publicEnvironmentDefinitions,
} from "../../config/environment.cjs";

// 开发时把 /api 代理到配置的 API，API_PROXY_TARGET 与旧 VITE_API_TARGET 均可使用。
// 让官网直接消费租户客户端公开接口 /api/client/v1/*，无需 CORS。

export default defineConfig(({ command, mode }) => {
  const rental = rentalClientVite(fileURLToPath(new URL("../../", import.meta.url)),
    command === "build" && !["development", "ai-offline", "offline"].includes(mode));
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
    plugins: [...rental.plugins, react()],
    css: rental.postcss.length ? { postcss: { plugins: rental.postcss } } : undefined,
    resolve: {
      dedupe: rental.dedupe,
      extensions: [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
      alias: {
        "@rental-os/web-client": fileURLToPath(
          new URL("../../packages/web-client/src/index.ts", import.meta.url),
        ),
        "@rental-os/shared": fileURLToPath(
          new URL("../../packages/shared/src/index.ts", import.meta.url),
        ),
        ...rental.alias,
      },
    },
    build: { commonjsOptions: rental.commonjsOptions },
    server: { port, strictPort: true, proxy },
    preview: { port, strictPort: true, proxy },
  };
});
