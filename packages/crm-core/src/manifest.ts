/** 来源在发行时注入真实固定提交；清单只声明本包已提供的入口及配置权限。 */
import { CoreManifestSchema, type CoreManifest } from "@rental-os/core-contracts";
import { CRM_CORE_ID, CRM_CORE_VERSION, CRM_DATA_VERSION, CRM_DATA_READABLE } from "./contracts";
export function createCrmManifest(source: CoreManifest["source"]): CoreManifest {
  return CoreManifestSchema.parse({
    manifestVersion: 1, id: CRM_CORE_ID, name: "销售 CRM", description: "独立销售 CRM Core：首次配置、持久化与原操作核对",
    author: "Zelo contributors", version: CRM_CORE_VERSION, source, license: "MIT",
    compatibility: { platform: { minInclusive: "0.1.17", maxExclusive: "0.2.0" },
      contract: { minInclusive: "0.1.1", maxExclusive: "0.2.0" } },
    runtime: { node: { minInclusive: "22.12.0", maxExclusive: "25.0.0" } },
    entries: { server: "dist/index.js", admin: "admin/index.tsx", openapi: "openapi.json" },
    permissions: [{ resource: "settings", action: "manage", name: "管理 CRM 业务配置" }],
    scope: { kind: "tenant" },
    data: { version: CRM_DATA_VERSION, readable: CRM_DATA_READABLE, migrations: [
      { id: "crm.initial", file: "migrations/001-crm.sql", sha256: "907309f837281f087c72f25675ddd129054b66f85edf69b2fd69cf07646f7a28" }
    ] },
    requires: [],
    assets: ["package.json", ...["contracts", "ports", "service", "server", "manifest", "http", "nest", "openapi", "mysql", "platform-host", "package", "metadata"].map(name => `dist/${name}.js`),
      ...["index", "contracts", "ports", "service", "server", "manifest", "http", "nest", "openapi", "mysql", "platform-host", "package", "metadata"].map(name => `dist/${name}.d.ts`)]
  });
}
