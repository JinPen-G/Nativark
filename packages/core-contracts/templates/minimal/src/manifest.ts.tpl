/** 发行时注入本 Core 的真实固定提交；生成模板时不伪造 Core 发行来源。 */
import { CoreManifestSchema, type CoreManifest } from "@rental-os/core-contracts";
import { CORE_ID, CORE_VERSION, DATA_VERSION, DATA_READABLE } from "./contracts";

export const MIGRATIONS = [{ id: "items.initial", file: "migrations/001-items.sql", sha256: "MIGRATION_SHA256" }];
export function createManifest(source: CoreManifest["source"]): CoreManifest {
  const modules = ["index", "contracts", "service", "server", "http", "openapi", "nest", "mysql", "data-plan", "platform-host", "manifest", "metadata"];
  const hostModules = ["assembly", "app.module", "deployment-package", "lifecycle", "main", "prepare-deployment"];
  return CoreManifestSchema.parse({
    manifestVersion: 1, id: CORE_ID, name: CORE_ID, description: "租户范围的本人条目与持久化开发模板",
    author: "{{PACKAGE_NAME}} contributors", version: CORE_VERSION, source, license: "MIT",
    compatibility: { platform: { minInclusive: "0.2.2", maxExclusive: "0.4.0" },
      contract: { minInclusive: "0.1.1", maxExclusive: "0.2.0" } },
    runtime: { node: { minInclusive: "22.12.0", maxExclusive: "25.0.0" } },
    entries: { server: "dist/index.js", admin: "admin/index.tsx", openapi: "openapi.json" },
    permissions: [{ resource: "item", action: "read", name: "读取本人条目与原回执" },
      { resource: "item", action: "create", name: "创建本人条目" }, { resource: "item", action: "update", name: "编辑本人条目" },
      { resource: "item", action: "archive", name: "归档本人条目" }],
    scope: { kind: "tenant" }, requires: [],
    data: { version: DATA_VERSION, readable: DATA_READABLE, migrations: MIGRATIONS },
    assets: ["package.json", "core.scaffold.json", "tsconfig.json", ".gitignore", ".gitattributes", "scripts/package.cjs",
      ...modules.map(name => `src/${name}.ts`), ...modules.flatMap(name => [`dist/${name}.js`, `dist/${name}.d.ts`]),
      "admin/index.tsx", "admin/tsconfig.json", "host/api/tsconfig.json", "host/admin/tsconfig.json", "host/admin/index.html",
      "host/admin/vite.config.mts", "host/admin/src/main.tsx", "host/admin/src/vite-env.d.ts",
      ...hostModules.flatMap(name => [`host/api/src/${name}.ts`, `host/api/dist/${name}.js`])]
  });
}
