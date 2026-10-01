import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@/registry": fileURLToPath(new URL("../../packages/ui-arc/vendor/registry", import.meta.url)),
        "@/lib/motion-tokens": fileURLToPath(new URL("../../packages/ui-arc/vendor/lib/motion-tokens.ts", import.meta.url)),
        "@/lib/media": fileURLToPath(new URL("../../packages/ui-arc/vendor/lib/media.ts", import.meta.url)),
        "@/lib/use-copy-feedback": fileURLToPath(new URL("../../packages/ui-arc/vendor/lib/use-copy-feedback.ts", import.meta.url)),
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
