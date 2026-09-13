import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@rental-os/shared": fileURLToPath(
          new URL("../../packages/shared/src/index.ts", import.meta.url)
        )
      }
    },
    server: {
      port: Number(env.REACT_ADMIN_PORT ?? 5175),
      proxy: {
        "/api": {
          target: env.VITE_API_BASE_URL?.replace(/\/api$/, "") ?? "http://localhost:3000",
          changeOrigin: true
        }
      }
    }
  };
});
