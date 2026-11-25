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
  const brandSource = fileURLToPath(new URL("../../packages/platform-admin/public/brand/zelo-icon-black.svg", import.meta.url));
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
    // 拆分包的正式运行时出口为 CJS；统一预打包，避免源码 export * 丢失具名导出。
    optimizeDeps: {
      include: [
        "@rental-os/core-contracts",
        "@rental-os/core-contracts/github-discovery",
        "@rental-os/platform-contracts",
        "@rental-os/platform-contracts/ai-gateway",
        "@rental-os/platform-contracts/ai-task",
        "@rental-os/platform-contracts/rich-text",
        "@rental-os/platform-contracts/subscription",
        "@rental-os/platform-contracts/tenant-integrations",
        "@rental-os/platform-contracts/tenant-messaging",
        "@rental-os/platform-core-host/core-package-ports",
        "@rental-os/platform-core-host/core-package-preparation/protocol",
        "@rental-os/platform-core-host/core-package-selection/protocol",
        "@rental-os/rental-core",
        "@rental-os/rental-core/category-governance",
        "@rental-os/rental-core/client-contracts",
        "@rental-os/rental-core/enterprise",
        "@rental-os/rental-core/enterprise-exchange",
        "@rental-os/rental-core/enterprise-expense",
        "@rental-os/rental-core/enterprise-order-delegation",
        "@rental-os/rental-core/enterprise-policy",
        "@rental-os/rental-core/enterprise-transfer-decision",
        "@rental-os/rental-core/enterprise-workflows",
        "@rental-os/rental-core/exchange-inspection-preparation",
        "@rental-os/rental-core/permissions",
        "@rental-os/rental-core/staff-upload-observation",
        "@rental-os/shared/ai-admin",
        "@rental-os/shared/agent-desktop",
        "@rental-os/shared",
      ],
    },
    css: { postcss: { plugins: [...platform.postcss, copilotArchiveStyles()] } },
    resolve: {
      extensions: [".mjs", ".ts", ".tsx", ".js", ".jsx", ".json"],
      alias: [
        ...Object.entries(platform.alias).map(([find, replacement]) => ({ find, replacement })),
        { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }
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
