/** 公共后台构建接点与本Core页面装配；只暴露已核清单，不读取.env或向浏览器传秘密。 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { CoreDeploymentLockSchema } from "@rental-os/core-contracts";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import { platformAdminVite } from "@rental-os/platform-admin/vite";

export default defineConfig(() => {
  if (!process.env.CORE_DEPLOYMENT_LOCK) throw new Error("后台构建/开发须提供与API相同的固定CORE_DEPLOYMENT_LOCK");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(process.env.CORE_DEPLOYMENT_LOCK, "utf8")));
  if (lock.cores.length !== 1 || lock.cores[0].manifest.id !== "{{CORE_ID}}" || lock.dataCapabilities?.length)
    throw new Error("后台只装配当前条目Core");
  const require = createRequire(import.meta.url), root = resolve(dirname(require.resolve("{{PACKAGE_NAME}}")), "..");
  const { manifest } = requireCorePackagePin(root, lock.cores[0], lock.platform.versions);
  const port = Number(process.env.ADMIN_PORT ?? 5177);
  const target = new URL(process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !["http:", "https:"].includes(target.protocol)
    || target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw new Error("后台端口或API代理来源无效");
  const platform = platformAdminVite(), virtual = "\0selected-core-manifest";
  return { root: fileURLToPath(new URL(".", import.meta.url)), envDir: false as const, envPrefix: [], publicDir: platform.publicDir,
    plugins: [...platform.plugins, { name: "selected-core-manifest",
      resolveId: (source: string) => source === "virtual:core-manifest" ? virtual : undefined,
      load: (id: string) => id === virtual ? `export default ${JSON.stringify(manifest)};` : undefined }, tailwindcss(), react()],
    css: { postcss: { plugins: platform.postcss } }, resolve: { alias: platform.alias, extensions: platform.extensions },
    server: { port, proxy: { "/api": { target: target.origin, changeOrigin: true } } }
  };
});
