/** 双 Core 构建核定同一部署锁与两实际标准包，浏览器仅取得已核定清单。 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  CoreDeploymentLockSchema,
  checkCoreCombination,
  checkPlatformDataCapabilities,
  coreDeploymentHostVersions,
} from "@rental-os/core-contracts";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import { platformAdminVite } from "@rental-os/platform-admin/vite";
import { apiProxyTarget, loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";

export default defineConfig(({ mode }) => {
  const env = loadViteEnvironment(mode, fileURLToPath(new URL(".", import.meta.url)), loadEnv,
    { offline: mode === "ai-offline" });
  if (!process.env.CORE_DEPLOYMENT_LOCK) {
    throw new Error("双 Core 后台构建须提供与 API 相同的 CORE_DEPLOYMENT_LOCK");
  }
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(process.env.CORE_DEPLOYMENT_LOCK, "utf8")));
  const rental = lock.cores.find(pin => pin.manifest.id === "rental");
  const tickets = lock.cores.find(pin => pin.manifest.id === "example-tickets");
  if (lock.cores.length !== 2 || !rental || !tickets) {
    throw new Error("双 Core 后台须显式选择 Rental 和工单两个标准包");
  }
  const host = coreDeploymentHostVersions(lock);
  const issues = [
    ...checkPlatformDataCapabilities(lock),
    ...checkCoreCombination(lock.cores.map(pin => pin.manifest), host).issues,
  ];
  if (issues.length) {
    throw new Error(issues.map(issue => `${issue.field} ${issue.message}`).join("\n"));
  }
  const require = createRequire(import.meta.url);
  const rentalRoot = resolve(dirname(require.resolve("@rental-os/rental-core")), "..");
  const ticketsRoot = resolve(dirname(require.resolve("@rental-os/example-tickets-core")), "..");
  const manifests = {
    rental: requireCorePackagePin(rentalRoot, rental, host).manifest,
    tickets: requireCorePackagePin(ticketsRoot, tickets, host).manifest,
  };
  const platform = platformAdminVite();
  const virtual = "\0selected-multi-core-manifests";
  return {
    envDir: false,
    envPrefix: [],
    define: publicEnvironmentDefinitions("admin", env),
    plugins: [
      ...platform.plugins,
      {
        name: "selected-multi-core-manifests",
        resolveId: (source: string) => source === "virtual:core-manifests" ? virtual : undefined,
        load: (id: string) => id === virtual ? `export default ${JSON.stringify(manifests)};` : undefined,
      },
      tailwindcss(),
      react(),
    ],
    css: { postcss: { plugins: platform.postcss } },
    resolve: { alias: platform.alias },
    server: {
      port: Number(process.env.PORT ?? 5179),
      proxy: { "/api": { target: apiProxyTarget(env), changeOrigin: true } },
    },
  };
});
