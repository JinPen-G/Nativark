import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        "@store-rental/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url))
      }
    },
    server: {
      port: Number(env.ADMIN_PORT ?? 5173),
      proxy: {
        "/api": {
          target: env.VITE_API_BASE_URL?.replace(/\/api$/, "") ?? "http://localhost:3000",
          changeOrigin: true
        }
      }
    }
  };
});
