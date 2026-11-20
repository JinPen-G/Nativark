/** 构建核对与 API 同一固定部署锁和 Rental 标准包，向浏览器提供已核定清单。 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { CoreDeploymentLockSchema, coreDeploymentHostVersions } from "@rental-os/core-contracts";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import { rentalHostLegacyApiRoutes } from "@rental-os/rental-api/openapi";
import { platformAdminVite } from "@rental-os/platform-admin/vite";
import { apiProxyTarget, loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";

export default defineConfig(({ mode }) => {
  const env = loadViteEnvironment(mode, fileURLToPath(new URL(".", import.meta.url)), loadEnv,
    { offline: mode === "ai-offline" });
  if (!process.env.CORE_DEPLOYMENT_LOCK) throw new Error("Rental 后台构建须提供与 API 相同的 CORE_DEPLOYMENT_LOCK");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(process.env.CORE_DEPLOYMENT_LOCK, "utf8")));
  if (lock.cores.length !== 1 || lock.cores[0].manifest.id !== "rental")
    throw new Error("Rental 后台只装配所选 Rental Core");
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(require.resolve("@rental-os/rental-core")), "..");
  const { manifest } = requireCorePackagePin(root, lock.cores[0], coreDeploymentHostVersions(lock), rentalHostLegacyApiRoutes());
  const platform = platformAdminVite();
  const virtual = "\0selected-rental-manifest";
  return {
    envDir: false,
    envPrefix: [],
    define: publicEnvironmentDefinitions("admin", env),
    plugins: [
      ...platform.plugins,
      {
        name: "selected-rental-manifest",
        resolveId: (source: string) => source === "virtual:core-manifest" ? virtual : undefined,
        load: (id: string) => id === virtual ? `export default ${JSON.stringify(manifest)};` : undefined,
      },
      tailwindcss(),
      react(),
    ],
    css: { postcss: { plugins: platform.postcss } },
    resolve: { alias: platform.alias },
    server: {
      port: Number(process.env.PORT ?? 5178),
      proxy: { "/api": { target: apiProxyTarget(env), changeOrigin: true } },
    },
  };
});
