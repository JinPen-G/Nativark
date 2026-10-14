import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const offline = mode === "ai-offline";
  const env = offline ? {} : loadEnv(mode, process.cwd(), "");

  return {
    // Explicit verification mode: never load deployment secrets or replace release artifacts.
    envDir: offline ? false : undefined,
    build: offline ? { outDir: "dist-ai-offline" } : undefined,
    plugins: [react()],
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
          target: env.VITE_API_BASE_URL?.replace(/\/api$/, "") ?? "http://localhost:3000",
          changeOrigin: true
        }
      }
    }
  };
});
