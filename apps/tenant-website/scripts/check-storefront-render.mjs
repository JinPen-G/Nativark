// Offline component smoke test. No browser, network calls or real customer storage.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
await build({
  root, configFile: false, envFile: false, plugins: [react()], logLevel: 'error',
  build: {
    ssr: resolve(root, 'scripts/storefront-render-cases.tsx'),
    outDir: resolve(root, '.impeccable/checks/ssr'), emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'render-cases.mjs' } },
  },
});
const { verify } = await import(pathToFileURL(resolve(root, '.impeccable/checks/ssr/render-cases.mjs')).href);
await verify(root);
