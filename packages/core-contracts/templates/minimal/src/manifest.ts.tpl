/** 发行时注入本 Core 的真实固定提交；生成模板时不伪造 Core 发行来源。 */
import { CoreManifestSchema, type CoreManifest } from "@rental-os/core-contracts";
import { CORE_ID, CORE_VERSION, DATA_VERSION, DATA_READABLE } from "./contracts";

export function createManifest(source: CoreManifest["source"]): CoreManifest {
  const modules = ["index", "contracts", "service", "server", "http", "admin", "manifest", "metadata"];
  return CoreManifestSchema.parse({
    manifestVersion: 1, id: CORE_ID, name: CORE_ID, description: "租户范围的最小 Core 开发起点",
    author: "{{PACKAGE_NAME}} contributors", version: CORE_VERSION, source, license: "MIT",
    compatibility: { platform: { minInclusive: "0.2.2", maxExclusive: "0.3.0" },
      contract: { minInclusive: "0.1.1", maxExclusive: "0.2.0" } },
    runtime: { node: { minInclusive: "22.12.0", maxExclusive: "25.0.0" } },
    entries: { server: "dist/index.js", admin: "dist/admin.js", openapi: "openapi.json" },
    permissions: [{ resource: "item", action: "read", name: "读取当前可见条目" }],
    scope: { kind: "tenant" }, requires: [],
    data: { version: DATA_VERSION, readable: DATA_READABLE, migrations: [
      { id: "items.initial", file: "migrations/001-items.sql", sha256: "MIGRATION_SHA256" }
    ] },
    assets: ["package.json", "core.scaffold.json", "tsconfig.json", ".gitignore", ".gitattributes", "scripts/package.cjs",
      ...modules.map(name => `src/${name}.ts`), ...modules.flatMap(name => [`dist/${name}.js`, `dist/${name}.d.ts`])]
  });
}
