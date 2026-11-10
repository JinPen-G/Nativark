import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时把 /api 代理到本地 API（默认 127.0.0.1:3000，可用 VITE_API_TARGET 覆盖），
// 让官网直接消费租户客户端公开接口 /api/client/v1/*，无需 CORS。
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  // Shared is a linked CommonJS workspace package; Vite must prebundle its
  // public entry instead of serving raw CommonJS as a browser ES module.
  optimizeDeps: { include: ['@rental-os/shared'] },
  server: { port: 4186, strictPort: true, proxy: { '/api': { target: apiTarget, changeOrigin: true } } },
  preview: { port: 4186, strictPort: true, proxy: { '/api': { target: apiTarget, changeOrigin: true } } },
});
