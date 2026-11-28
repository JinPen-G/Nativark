import { defineConfig } from "vite";
// 认证与 API 由原宿主显式装配；模板构建不读取环境文件、不自动设代理或启服务。
export default defineConfig({ envDir: false, build: { outDir: "dist" } });
