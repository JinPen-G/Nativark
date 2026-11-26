/** 无 Core Web 构建/开发入口，复用公共呈现适配；只公开原白名单配置。 */
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { platformAdminVite } from "../../packages/platform-admin/config/vite";
import { apiProxyTarget, loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";

export default defineConfig(({ mode }) => {
  // 根公共入口显式提供代理和公开变量，避免加载旧组合的环境文件。
  const env = process.env.ZELO_PLATFORM_PROCESS_ENV === "1" ? process.env
    : loadViteEnvironment(mode, fileURLToPath(new URL(".", import.meta.url)), loadEnv, { offline: mode === "ai-offline" });
  const platform = platformAdminVite();
  return {
    envDir: false,
    publicDir: platform.publicDir, envPrefix: [], define: publicEnvironmentDefinitions("admin", env),
    plugins: [...(mode === "public-ai" ? [{ name: "platform-public-ai-entry",
      transformIndexHtml: { order: "pre" as const, handler: (html: string) => html.replace("/src/start.tsx", "/src/start-ai.tsx") }
    }] : []), ...platform.plugins, tailwindcss(), react()],
    css: { postcss: { plugins: platform.postcss } },
    resolve: { alias: platform.alias, extensions: platform.extensions },
    server: { port: Number(process.env.PORT ?? 5176), proxy: { "/api": { target: apiProxyTarget(env), changeOrigin: true } } }
  };
});
