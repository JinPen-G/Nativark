/** 构建先核同一标准包/固定部署锁，再输出无凭据的清单。包代码不决定安装或授权。 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { CoreDeploymentLockSchema } from "@rental-os/core-contracts";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import { platformAdminVite } from "../../packages/platform-admin/config/vite";
import { apiProxyTarget, loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";

export default defineConfig(({ mode }) => {
  const env = loadViteEnvironment(mode, fileURLToPath(new URL(".", import.meta.url)), loadEnv, { offline: mode === "ai-offline" });
  if (!process.env.CORE_DEPLOYMENT_LOCK) throw new Error("工单后台构建须提供固定CORE_DEPLOYMENT_LOCK，与API使用同一标准包");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(process.env.CORE_DEPLOYMENT_LOCK, "utf8")));
  if (lock.cores.length !== 1 || lock.cores[0].manifest.id !== "example-tickets") throw new Error("工单后台只装配所选工单Core");
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(require.resolve("@rental-os/example-tickets-core")), "..");
  const { manifest } = requireCorePackagePin(root, lock.cores[0], lock.platform.versions);
  const platform = platformAdminVite(), virtual = "\0selected-core-manifest";
  return {
    envDir: false, envPrefix: [], define: publicEnvironmentDefinitions("admin", env),
    plugins: [...platform.plugins, { name: "selected-core-manifest",
      resolveId: (source: string) => source === "virtual:core-manifest" ? virtual : undefined,
      load: (id: string) => id === virtual ? `export default ${JSON.stringify(manifest)};` : undefined }, tailwindcss(), react()],
    css: { postcss: { plugins: platform.postcss } }, resolve: { alias: platform.alias },
    server: { port: Number(process.env.PORT ?? 5177), proxy: { "/api": { target: apiProxyTarget(env), changeOrigin: true } } }
  };
});
