import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { platformAdminVite } from "../../packages/platform-admin/config/vite";
import tailwindcss from "@tailwindcss/vite";
import { copilotArchiveStyles } from "./config/copilotArchiveStyles.js";
import { apiProxyTarget, loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";

export default defineConfig(({ mode }) => {
  const offline = mode === "ai-offline";
  const env = loadViteEnvironment(mode, fileURLToPath(new URL(".", import.meta.url)), loadEnv, { offline });
  const platform = platformAdminVite();
  const brandSource = fileURLToPath(new URL("./public/brand/nativark-icon.svg", import.meta.url));
  const brandModule = "\0nativark-default-brand-icon";

  return {
    // Explicit verification mode: never load deployment secrets or replace release artifacts.
    envDir: false,
    envPrefix: [],
    define: publicEnvironmentDefinitions("admin", env),
    build: offline ? { outDir: "dist-ai-offline" } : undefined,
    plugins: [
      ...platform.plugins,
      {
        name: "nativark-default-brand-icon",
        resolveId: (source: string) => source === "virtual:nativark-default-brand-icon" ? brandModule : undefined,
        load(id: string) {
          if (id !== brandModule) return;
          // public 保留唯一原稿与静态 URL，模块仅在编译时读取相同字节。
          this.addWatchFile(brandSource);
          return `export default ${JSON.stringify(readFileSync(brandSource, "utf8"))};`;
        },
      },
      tailwindcss(),
      react(),
    ],
    // Shared 源码转发这些正式 CJS 出口，开发扫描须同时覆盖链接包的子路径。
    optimizeDeps: {
      include: [
        "@rental-os/platform-contracts/ai-gateway",
        "@rental-os/platform-contracts/ai-task",
        "@rental-os/platform-contracts/rich-text",
        "@rental-os/platform-contracts/subscription",
        "@rental-os/platform-contracts/tenant-integrations",
        "@rental-os/platform-contracts/tenant-messaging",
      ],
    },
    css: { postcss: { plugins: [...platform.postcss, copilotArchiveStyles()] } },
    resolve: {
      // Prefer source contracts over stray CommonJS build artifacts in shared/src.
      extensions: [".mjs", ".ts", ".tsx", ".js", ".jsx", ".json"],
      alias: [
        ...Object.entries(platform.alias).map(([find, replacement]) => ({ find, replacement })),
        { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
        {
          // 总出口读取源码；子入口继续按包 exports 解析，不能拼到 index.ts 后面。
          find: /^@rental-os\/shared$/,
          replacement: fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url))
        }
      ]
    },
    server: {
      port: Number(process.env.PORT ?? env.REACT_ADMIN_PORT ?? 5175),
      proxy: {
        "/api": {
          target: apiProxyTarget(env),
          changeOrigin: true
        }
      }
    }
  };
});
