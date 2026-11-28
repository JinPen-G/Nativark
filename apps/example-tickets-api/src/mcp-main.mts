/** 显式工单+纯读MCP宿主：唯一公共Client与原平台Auth，复用正式协议和同库数据观察。
 * 配置、MCP材料与部署锁都由启动方明确提供；无模型、AI数据、默认授权或自动迁移。
 */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { CoreDeploymentLockSchema, coreDeploymentHostVersions, checkPlatformDataCapabilities, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { readPlatformDataCapabilityPackage } from "@rental-os/core-contracts/platform-data-package";
import { createMcpMysqlDataPlan } from "@rental-os/mcp-server/mysql-data";
import { readMcpDataPackage } from "@rental-os/mcp-server/data-capability";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "@rental-os/platform-api/database";
import { PlatformAuthService, PLATFORM_AUTH_DATA_STORE } from "@rental-os/platform-server";
import { TicketsHttpModule } from "@rental-os/example-tickets-core/nest";
import { TICKETS_MCP_MIGRATION, createTicketsAiStatus, TicketAiRouteStateSchema } from "@rental-os/example-tickets-core";
import { createTicketsMcpApplication, createTicketsMcpDataPlan, TicketsMcpHttpModule, createTicketsMcpHttpContribution,
  createTicketsMcpOpenApi, createTicketsMcpClients, TicketsMcpConfigurationSchema, type TicketsMcpConfiguration, type TicketsMcpApplication } from "@rental-os/example-tickets-core/mcp";
import { bootstrapTickets } from "./main.js";
import { ticketsApplicationModule, type TicketsAssembly } from "./app.module.js";
import { requireTicketsDeploymentPackage } from "./deployment-package.js";
import { TicketsApplicationLifecycle } from "./lifecycle.js";
const require = createRequire(import.meta.url), selectedToken = Symbol("tickets.mcp.selected-application");

export function selectTicketsMcpApplication(value: CoreDeploymentLock, directory: string, configuration: TicketsMcpConfiguration) {
  const lock = CoreDeploymentLockSchema.parse(value), selected = lock.dataCapabilities?.[0], config = TicketsMcpConfigurationSchema.parse(configuration);
  if (!isAbsolute(directory) || lock.cores.length !== 1 || lock.cores[0].manifest.id !== "example-tickets"
    || lock.cores[0].manifest.entries.ai !== "dist-mcp/index-mcp.mjs" || lock.dataCapabilities?.length !== 1
    || selected?.id !== "mcp" || checkPlatformDataCapabilities(lock).length)
    throw new Error("工单MCP需要同一完整选装工单包、MCP材料与兼容锁");
  const { files } = readPlatformDataCapabilityPackage(directory, selected);
  const material = readMcpDataPackage(files, selected);
  if (material.schema.replace(/^\s*\/\/.*$/gm, "").trim()) throw new Error("当前工单MCP只接受原公共Client与无新增模型的MCP材料");
  const { manifest } = requireTicketsDeploymentPackage(lock.cores[0], coreDeploymentHostVersions(lock));
  const root = resolve(dirname(require.resolve("@rental-os/example-tickets-core")), "..");
  const coreData = createTicketsMcpDataPlan({ manifest, sql: readFileSync(resolve(root, TICKETS_MCP_MIGRATION.file)) });
  const plan = { ...createMcpMysqlDataPlan({ files, release: selected, tableCollation: config.tableCollation }), capabilityId: "mcp" };
  const clients = (assembly: TicketsAssembly, database: PlatformDatabaseClient, auth: PlatformAuthService) => createTicketsMcpClients({
    database, auth, origin: config.origin, principals: assembly.tickets.principals,
    assertDataAvailable: async native => { await assembly.requireCoreDataAvailable(native); await assembly.requireDataCapabilityAvailable("mcp", native); } });
  return ticketsApplicationModule(lock, {
    capabilities: { http: createTicketsMcpHttpContribution(), coreData, data: [plan], files: new Map([["mcp", files]]) },
    openapi: createTicketsMcpOpenApi(),
    managementAccess: (assembly, database, auth) => clients(assembly, database, auth).access,
    business({ platformServer, dependencies, lifecycle, assembledToken }) {
      @Module({ imports: [platformServer, dependencies, lifecycle, PlatformDatabaseModule], providers: [{ provide: selectedToken,
        inject: [assembledToken, PlatformDatabaseClient, PLATFORM_AUTH_DATA_STORE, PlatformAuthService, TicketsApplicationLifecycle],
        useFactory: (assembly: TicketsAssembly, database: PlatformDatabaseClient, original: object, auth: PlatformAuthService, life: TicketsApplicationLifecycle) => {
          const connectionLimit = Number(new URL(process.env.DATABASE_URL ?? "").searchParams.get("connection_limit"));
          if (database !== original || !Number.isSafeInteger(connectionLimit) || connectionLimit < 2)
            throw new Error("工单MCP须共用原Auth的公共Client并明确connection_limit>=2以容纳原计量短事务");
          const application = createTicketsMcpApplication({ database, auth, configuration: config, principals: assembly.tickets.principals,
            tickets: assembly.tickets, assertDataAvailable: async (native: Prisma.TransactionClient) => {
              await assembly.requireCoreDataAvailable(native); await assembly.requireDataCapabilityAvailable("mcp", native);
            } });
          life.attachProtocol(application.close); return application;
        } }], exports: [selectedToken] })
      class TicketsMcpRequestsModule {}
      return { business: TicketsHttpModule.registerFactory({ imports: [dependencies, TicketsMcpRequestsModule], inject: [assembledToken, selectedToken],
        useFactory: (assembly: TicketsAssembly, application: TicketsMcpApplication) => ({ ...assembly.tickets, aiStatus: {
          read: (principal, ticketId, query, raw) => createTicketsAiStatus({ service: assembly.tickets.service, mcp: {
            read: async () => TicketAiRouteStateSchema.parse(await application.consume("status", raw as { headers: { authorization?: unknown } },
              { ticketId }, AbortSignal.timeout(15000)))
          } }).read(principal, ticketId, query)
        } }) }),
        additional: [TicketsMcpHttpModule.register({ imports: [TicketsMcpRequestsModule, dependencies, platformServer, PlatformDatabaseModule],
          inject: [selectedToken], useFactory: (application: TicketsMcpApplication) => application,
          clients: { inject: [assembledToken, PlatformDatabaseClient, PlatformAuthService], useFactory: clients } })] };
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = process.env.TICKETS_MCP_CONFIGURATION;
  if (!config || !isAbsolute(config)) throw new Error("TICKETS_MCP_CONFIGURATION须为显式审核配置的绝对JSON路径");
  void bootstrapTickets(lock => selectTicketsMcpApplication(lock, process.env.PLATFORM_MCP_DATA_PACKAGE_DIR ?? "",
    TicketsMcpConfigurationSchema.parse(JSON.parse(readFileSync(config, "utf8")))), app => { app.use(app.get<TicketsMcpApplication>(selectedToken).http.middleware); });
}
