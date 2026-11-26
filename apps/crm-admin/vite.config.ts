/** 构建只选择实际已安装的 CRM 标准包，核同一部署锁和完整字节后向浏览器发布无凭据清单。 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { CoreDeploymentLockSchema } from "@rental-os/core-contracts";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import { platformAdminVite } from "@rental-os/platform-admin/vite";
import { apiProxyTarget, loadViteEnvironment, publicEnvironmentDefinitions } from "../../config/environment.cjs";

export default defineConfig(({ mode }) => {
  const env = loadViteEnvironment(mode, fileURLToPath(new URL(".", import.meta.url)), loadEnv, { offline: mode === "ai-offline" });
  const lockFile = process.env.CORE_DEPLOYMENT_LOCK?.trim();
  if (!lockFile) throw new Error("CRM 后台构建须提供 CORE_DEPLOYMENT_LOCK，与 CRM API 使用同一固定标准包和部署锁");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(lockFile, "utf8")));
  if (lock.cores.length !== 1 || lock.cores[0].manifest.id !== "crm" || lock.cores[0].manifest.scope.kind !== "tenant" || lock.dataCapabilities?.length)
    throw new Error("本后台宿主只装配 CRM Core，不选择其他 Core 或数据能力");
  const require = createRequire(import.meta.url);
  const packageRoot = resolve(dirname(require.resolve("@rental-os/crm-core")), "..");
  const { root, manifest } = requireCorePackagePin(packageRoot, lock.cores[0], lock.platform.versions);
  if (!manifest.entries.admin || resolve(require.resolve("@rental-os/crm-core/admin")) !== resolve(root, manifest.entries.admin))
    throw new Error("CRM 后台正式出口与已核定清单入口不一致");
  const port = Number(process.env.PORT ?? 5180);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT 须为有效的后台开发端口");
  const platform = platformAdminVite(), virtual = "\0crm-core-manifest";
  return {
    envDir: false,
    publicDir: platform.publicDir,
    envPrefix: [],
    define: publicEnvironmentDefinitions("admin", env),
    plugins: [...platform.plugins, { name: "crm-core-manifest",
      resolveId: (source: string) => source === "virtual:crm-core-manifest" ? virtual : undefined,
      load: (id: string) => id === virtual ? `export default ${JSON.stringify(manifest)};` : undefined
    }, tailwindcss(), react()],
    css: { postcss: { plugins: platform.postcss } },
    resolve: { alias: platform.alias, extensions: platform.extensions },
    server: { port, proxy: { "/api": { target: apiProxyTarget(env), changeOrigin: true } } }
  };
});
