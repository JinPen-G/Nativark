/** 构建时注入真实固定来源；不在源码里假造发布提交或声明尚未提供的页面/AI入口。 */
import { CoreManifestSchema, type CoreManifest } from "@rental-os/core-contracts";
import { TICKETS_CORE_ID, TICKETS_CORE_VERSION, TICKETS_DATA_VERSION } from "./contracts";

export function createTicketsManifest(source: CoreManifest["source"]): CoreManifest {
  const compatible = { minInclusive: "0.1.0", maxExclusive: "0.2.0" };
  return CoreManifestSchema.parse({
    manifestVersion: 1,
    id: TICKETS_CORE_ID,
    name: "轻量工单示范",
    description: "独立租户范围的创建、分派、处理和关闭工单，演示Core接入边界",
    author: "Nativark contributors",
    version: TICKETS_CORE_VERSION,
    source,
    license: "MIT",
    compatibility: { platform: compatible, contract: compatible },
    runtime: { node: { minInclusive: "22.12.0", maxExclusive: "25.0.0" } },
    entries: { server: "dist/index.js", openapi: "openapi.json" },
    permissions: [
      { resource: "ticket", action: "read", name: "读取本人可见工单" },
      { resource: "ticket", action: "read.all", name: "读取本租户全部工单" },
      { resource: "ticket", action: "create", name: "创建工单" },
      { resource: "ticket", action: "assign", name: "分派工单" },
      { resource: "ticket", action: "start", name: "开始处理工单" },
      { resource: "ticket", action: "close", name: "关闭工单" }
    ],
    scope: { kind: "tenant" },
    data: { version: TICKETS_DATA_VERSION, readable: compatible, migrations: [
      { id: "tickets.initial", file: "migrations/001-tickets.sql", sha256: "d9abd89fed3f18c3c6c6690062b15bc30de53e04eae6f69cf049d310a24e3330" }
    ] },
    requires: [],
    assets: ["package.json", ...["contracts", "service", "server", "manifest", "mysql", "http", "nest", "openapi", "metadata"].map(name => `dist/${name}.js`),
      ...["index", "contracts", "service", "server", "manifest", "mysql", "http", "nest", "openapi", "metadata"].map(name => `dist/${name}.d.ts`)]
  });
}
