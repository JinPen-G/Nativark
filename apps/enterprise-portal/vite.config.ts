import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { motionPreferenceAdapter, motionPreferenceStyles } from "../admin/config/motionPreferenceAdapter";
import { nativeSidebarStyles } from "../admin/config/nativeSidebarStyles";
import { actionButtonIconAdapter } from "../admin/config/actionButtonIconAdapter";
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
function customerBoundary(): Plugin {
  return { name: "enterprise-no-operator-runtime", enforce: "pre", configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.headers.accept?.includes("text/html") && /^\/(?:[a-zA-Z0-9_-]+\/)?enterprise(?:\/|\?|$)/.test(req.url ?? "")) req.url = "/enterprise-assets/index.html";
      next();
    });
  }, load(id) {
    if (/\/admin\/src\/(?:features\/(?:auth|copilot)|api\/|app\/(?:AppRouter|navigation)\.)/.test(id.replaceAll("\\", "/"))) {
      throw new Error(`Enterprise UI imported an operator runtime: ${id}`);
    }
  } };
}
export default defineConfig(({ mode }) => ({
  envDir: false,
  cacheDir: at("../../output/enterprise-offline/vite-cache"),
  base: "/enterprise-assets/",
  plugins: [customerBoundary(), motionPreferenceAdapter(), actionButtonIconAdapter(), tailwindcss(), react()],
  css: { postcss: { plugins: [motionPreferenceStyles(), nativeSidebarStyles()] } },
  resolve: { extensions: [".mjs", ".ts", ".tsx", ".js", ".jsx", ".json"], alias: [
    { find: /^@\/components\/ui$/, replacement: at("../admin/src/components/ui/customer-entry.ts") },
    { find: "@/registry", replacement: at("../../packages/ui-arc/vendor/registry") },
    ...["motion-tokens", "media", "use-copy-feedback", "use-today"].map(name => ({ find: `@/lib/${name}`, replacement: at(`../../packages/ui-arc/vendor/lib/${name}.ts`) })),
    { find: "@rental-os/shared", replacement: at("../../packages/shared/src/index.ts") },
    { find: "@rental-os/web-client", replacement: at("../../packages/web-client/src/index.ts") },
    { find: "@enterprise", replacement: at("./src") },
    { find: "@", replacement: at("../admin/src") }
  ] },
  build: { outDir: mode === "offline" ? at("../../output/enterprise-offline/build") : "dist", emptyOutDir: false },
  server: { host: "127.0.0.1", port: 4191, strictPort: true },
  preview: { host: "127.0.0.1", port: 4191, strictPort: true }
}));
