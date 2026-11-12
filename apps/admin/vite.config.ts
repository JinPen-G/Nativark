import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { motionPreferenceAdapter, motionPreferenceStyles } from "./config/motionPreferenceAdapter.js";
import tailwindcss from "@tailwindcss/vite";
import { nativeSidebarStyles } from "./config/nativeSidebarStyles.js";
import { actionButtonIconAdapter } from "./config/actionButtonIconAdapter.js";
import { copilotArchiveStyles } from "./config/copilotArchiveStyles.js";
import { kanbanBoardAdapter } from "./config/kanbanBoardAdapter.js";
import { apiProxyTarget, loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";

export default defineConfig(({ mode }) => {
  const offline = mode === "ai-offline";
  const env = loadViteEnvironment(mode, fileURLToPath(new URL(".", import.meta.url)), loadEnv, { offline });

  return {
    // Explicit verification mode: never load deployment secrets or replace release artifacts.
    envDir: false,
    envPrefix: [],
    define: publicEnvironmentDefinitions("admin", env),
    build: offline ? { outDir: "dist-ai-offline" } : undefined,
    plugins: [motionPreferenceAdapter(), actionButtonIconAdapter(), kanbanBoardAdapter(), tailwindcss(), react()],
    css: { postcss: { plugins: [motionPreferenceStyles(), nativeSidebarStyles(), copilotArchiveStyles()] } },
    resolve: {
      // Prefer source contracts over stray CommonJS build artifacts in shared/src.
      extensions: [".mjs", ".ts", ".tsx", ".js", ".jsx", ".json"],
      alias: {
        "@/registry": fileURLToPath(new URL("../../packages/ui-arc/vendor/registry", import.meta.url)),
        "@/lib/motion-tokens": fileURLToPath(new URL("../../packages/ui-arc/vendor/lib/motion-tokens.ts", import.meta.url)),
        "@/lib/media": fileURLToPath(new URL("../../packages/ui-arc/vendor/lib/media.ts", import.meta.url)),
        "@/lib/use-copy-feedback": fileURLToPath(new URL("../../packages/ui-arc/vendor/lib/use-copy-feedback.ts", import.meta.url)),
        "@/lib/use-today": fileURLToPath(new URL("../../packages/ui-arc/vendor/lib/use-today.ts", import.meta.url)),
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
