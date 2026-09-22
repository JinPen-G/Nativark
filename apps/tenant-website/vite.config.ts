import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 4186, strictPort: true },
  preview: { port: 4186, strictPort: true },
});
