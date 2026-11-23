/** 无 Core Web 构建/开发入口，复用公共呈现适配；只公开原白名单配置。 */
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { platformAdminVite } from "../../packages/platform-admin/config/vite";
import { apiProxyTarget, loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";

export default defineConfig(({ mode }) => {
  const env = loadViteEnvironment(mode, fileURLToPath(new URL(".", import.meta.url)), loadEnv, { offline: mode === "ai-offline" });
  const platform = platformAdminVite();
  return {
    envDir: false,
    publicDir: platform.publicDir, envPrefix: [], define: publicEnvironmentDefinitions("admin", env),
    plugins: [...platform.plugins, tailwindcss(), react()],
    css: { postcss: { plugins: platform.postcss } },
    resolve: { alias: platform.alias },
    server: { port: Number(process.env.PORT ?? 5176), proxy: { "/api": { target: apiProxyTarget(env), changeOrigin: true } } }
  };
});
