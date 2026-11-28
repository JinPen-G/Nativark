/** 构建时注入真实固定来源；不在源码里假造发布提交或声明尚未提供的页面/AI入口。 */
import { CoreManifestSchema, type CoreManifest } from "@rental-os/core-contracts";
import { TICKETS_CORE_ID, TICKETS_CORE_VERSION, TICKETS_DATA_VERSION, TICKETS_DATA_READABLE } from "./contracts";

export const TICKETS_MCP_DATA_VERSION = "0.1.1";
export const TICKETS_MCP_MIGRATION = Object.freeze({ id: "tickets.mcp-tenant", file: "migrations/002-tenant-mcp.sql",
  sha256: "1da1049527b378e94149732f4478d7d07d1b0d7d0af01d533915d0b9fea1f2c5" });

/** 各选装材料通过完整清单和sha256区分；声明入口不授予运行权。 */
export function createTicketsManifest(source: CoreManifest["source"], options: { ai?: boolean; mcp?: boolean } = {}): CoreManifest {
  if (options.ai && options.mcp) throw new Error("内置任务和纯读取MCP须分别选择明确宿主；本候选不声明未装配的混合入口");
  const compatible = { minInclusive: "0.1.0", maxExclusive: "0.2.0" };
  return CoreManifestSchema.parse({
    manifestVersion: 1,
    id: TICKETS_CORE_ID,
    name: "轻量工单示范",
    description: "独立租户范围的创建、分派、处理和关闭工单，演示Core接入边界",
    author: "Zelo contributors",
    version: TICKETS_CORE_VERSION,
    source,
    license: "MIT",
    compatibility: {
      // 0.3安装入口沿用原公共合同、授权和迁移；0.4及以后须另行核定。
      platform: { minInclusive: "0.1.10", maxExclusive: "0.4.0" },
      contract: compatible
    },
    runtime: { node: { minInclusive: "22.12.0", maxExclusive: "25.0.0" } },
    entries: { server: "dist/index.js", openapi: "openapi.json", admin: "admin/index.tsx",
      ...(options.ai ? { ai: "dist-ai/index.mjs" } : options.mcp ? { ai: "dist-mcp/index-mcp.mjs" } : {}) },
    permissions: [
      { resource: "ticket", action: "read", name: "读取本人可见工单" },
      { resource: "ticket", action: "read.all", name: "读取本租户全部工单" },
      { resource: "ticket", action: "create", name: "创建工单" },
      { resource: "ticket", action: "assign", name: "分派工单" },
      { resource: "ticket", action: "start", name: "开始处理工单" },
      { resource: "ticket", action: "close", name: "关闭工单" }
    ],
    scope: { kind: "tenant" },
    data: { version: options.mcp ? TICKETS_MCP_DATA_VERSION : TICKETS_DATA_VERSION,
      readable: options.mcp ? { minInclusive: TICKETS_MCP_DATA_VERSION, maxExclusive: "0.2.0" } : TICKETS_DATA_READABLE, migrations: [
      { id: "tickets.initial", file: "migrations/001-tickets.sql", sha256: "d9abd89fed3f18c3c6c6690062b15bc30de53e04eae6f69cf049d310a24e3330" },
      ...(options.mcp ? [TICKETS_MCP_MIGRATION] : [])
    ] },
    requires: options.mcp ? [{ capability: "mcp", version: { minInclusive: "0.1.2", maxExclusive: "0.2.0" } }] : [],
    assets: ["package.json", ...["contracts", "service", "server", "manifest", "mysql", "http", "nest", "openapi", "metadata", "package", "platform-host", "ai-status", "ai-http"].map(name => `dist/${name}.js`),
      // 闭合浏览器DTO不依赖MCP运行时；同一后台构建可按已核清单决定是否呈现选装页。
      "dist/mcp-http.js", "dist/mcp-http.d.ts",
      ...["index", "contracts", "service", "server", "manifest", "mysql", "http", "nest", "openapi", "metadata", "package", "platform-host", "ai-status", "ai-http"].map(name => `dist/${name}.d.ts`),
      ...(options.ai ? ["index", "tickets-application", "tickets-authority", "tickets-approval", "tickets-publication", "tickets-plan",
        "tickets-runner", "tickets-results", "tickets-evidence", "tickets-start", "tickets-http"].flatMap(name =>
        [...(name === "index" ? [] : [`dist-ai/${name}.mjs`]), `dist-ai/${name}.d.mts`]) : []),
      ...(options.mcp ? ["index-mcp", "tickets-reads", "tickets-mcp-tenant", "tickets-mcp-read-host", "tickets-mcp-data", "tickets-mcp-application", "tickets-mcp-http", "tickets-mcp-clients"].flatMap(name =>
        [...(name === "index-mcp" ? [] : [`dist-mcp/${name}.mjs`]), `dist-mcp/${name}.d.mts`]) : [])]
  });
}
