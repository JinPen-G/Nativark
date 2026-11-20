import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { platformAdminVite } from "@rental-os/platform-admin/vite";
import { rentalClientVite } from "../../scripts/rental-client-vite";
import { loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
function customerBoundary(): Plugin {
  return { name: "enterprise-no-operator-runtime", enforce: "pre", configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.headers.accept?.includes("text/html") && /^\/(?:[a-zA-Z0-9_-]+\/)?enterprise(?:\/|\?|$)/.test(req.url ?? "")) req.url = "/enterprise-assets/index.html";
      next();
    });
  }, load(id) {
    if (/\/(?:admin|platform-admin)\/src\/(?:features\/(?:auth|copilot)|api\/|app\/(?:AppRouter|navigation)\.)/.test(id.replaceAll("\\", "/"))) {
      throw new Error(`Enterprise UI imported an operator runtime: ${id}`);
    }
  } };
}
export default defineConfig(({ command, mode }) => {
  const rental = rentalClientVite(at("../../"),
    command === "build" && !["development", "offline", "ai-offline"].includes(mode));
  const env = loadViteEnvironment(mode, at("."), loadEnv, { offline: mode === "offline" });
  const port = Number(env.ENTERPRISE_PORTAL_PORT ?? 4191);
  const platform = platformAdminVite();
  return {
  envDir: false,
  envPrefix: [],
  define: publicEnvironmentDefinitions("enterprisePortal", env),
  cacheDir: at("../../output/enterprise-offline/vite-cache"),
  base: "/enterprise-assets/",
  plugins: [customerBoundary(), ...rental.plugins, ...platform.plugins, tailwindcss(), react()],
  css: { postcss: { plugins: [...platform.postcss, ...rental.postcss] } },
  resolve: { dedupe: rental.dedupe, extensions: [".mjs", ".ts", ".tsx", ".js", ".jsx", ".json"], alias: [
    ...Object.entries(platform.alias).map(([find, replacement]) => ({ find, replacement })),
    ...Object.entries(rental.alias).filter(([find]) => find.startsWith("@rental-os/rental-core/"))
      .map(([find, replacement]) => ({ find, replacement })),
    { find: "@rental-os/shared", replacement: rental.alias["@rental-os/shared"] ?? at("../../packages/shared/src/index.ts") },
    { find: "@rental-os/web-client", replacement: rental.alias["@rental-os/web-client"] ?? at("../../packages/web-client/src/index.ts") },
    { find: "@enterprise", replacement: at("./src") }
  ] },
  build: { outDir: mode === "offline" ? at("../../output/enterprise-offline/build") : "dist", emptyOutDir: false,
    commonjsOptions: rental.commonjsOptions },
  server: { host: "127.0.0.1", port, strictPort: true },
  preview: { host: "127.0.0.1", port, strictPort: true }
  };
});
