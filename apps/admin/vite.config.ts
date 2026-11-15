import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { platformAdminVite } from "../../packages/platform-admin/config/vite";
import tailwindcss from "@tailwindcss/vite";
import { copilotArchiveStyles } from "./config/copilotArchiveStyles.js";
import { kanbanBoardAdapter } from "./config/kanbanBoardAdapter.js";
import { apiProxyTarget, loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";

export default defineConfig(({ mode }) => {
  const offline = mode === "ai-offline";
  const env = loadViteEnvironment(mode, fileURLToPath(new URL(".", import.meta.url)), loadEnv, { offline });
  const platform = platformAdminVite();

  return {
    // Explicit verification mode: never load deployment secrets or replace release artifacts.
    envDir: false,
    envPrefix: [],
    define: publicEnvironmentDefinitions("admin", env),
    build: offline ? { outDir: "dist-ai-offline" } : undefined,
    plugins: [...platform.plugins, kanbanBoardAdapter(), tailwindcss(), react()],
    css: { postcss: { plugins: [...platform.postcss, copilotArchiveStyles()] } },
    resolve: {
      // Prefer source contracts over stray CommonJS build artifacts in shared/src.
      extensions: [".mjs", ".ts", ".tsx", ".js", ".jsx", ".json"],
      alias: {
        ...platform.alias,
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@rental-os/shared": fileURLToPath(
          new URL("../../packages/shared/src/index.ts", import.meta.url)
        )
      }
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
