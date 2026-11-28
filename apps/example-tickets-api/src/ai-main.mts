/** 显式工单+公共AI宿主：同一数据库、原Guard/ALS与生命周期，只装配单个受控工单工具。
 * 不创建模型、权益、发布或角色；真实数据账/物理结构在每个原事务内复验。
 */
import "reflect-metadata";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { CoreDeploymentLockSchema, checkPlatformDataCapabilities, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { readPlatformDataCapabilityPackage } from "@rental-os/core-contracts/platform-data-package";
import { readPublicAiDataPackage } from "@rental-os/ai-native-data/public-data-package";
import { createPublicAiMysqlDataPlan } from "@rental-os/ai-native-data/public-mysql-data";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "@rental-os/platform-api/database";
import { PlatformAuthService, SecretBox, SubscriptionService, PLATFORM_AUTH_DATA_STORE } from "@rental-os/platform-server";
import { TicketsHttpModule } from "@rental-os/example-tickets-core/nest";
import { createTicketsAiStatus, TicketAiRouteStateSchema } from "@rental-os/example-tickets-core";
import { createTicketsAiRequests, TicketsAiHttpModule, createTicketsAiHttpContribution, createTicketsAiOpenApi,
  withTicketsAiRequest, type TicketsAiHttpRequest, type TicketsAiRequests } from "@rental-os/example-tickets-core/ai";
import { bootstrapTickets } from "./main.js";
import { ticketsApplicationModule, type TicketsAssembly } from "./app.module.js";

export function selectTicketsAiApplication(value: CoreDeploymentLock, directory: string) {
  const lock = CoreDeploymentLockSchema.parse(value), selected = lock.dataCapabilities?.[0];
  if (!isAbsolute(directory) || lock.cores.length !== 1 || lock.cores[0].manifest.id !== "example-tickets"
    || lock.cores[0].manifest.entries.ai !== "dist-ai/index.mjs" || lock.dataCapabilities?.length !== 1
    || selected?.id !== "ai-native" || checkPlatformDataCapabilities(lock).length)
    throw new Error("可选工单AI需要同一完整AI工单包、单公共AI数据包和兼容部署锁");
  const { files } = readPlatformDataCapabilityPackage(directory, selected);
  const { contribution } = readPublicAiDataPackage(files, selected);
  const plan = { ...createPublicAiMysqlDataPlan(contribution), capabilityId: selected.id };
  // 这些模型名来自已逐字节核定的正式schema；不以三个存在的delegate冒充完整所选Client。
  const delegates = [...contribution.schema.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gmu)]
    .map(match => match[1][0].toLowerCase() + match[1].slice(1));
  if (!delegates.length) throw new Error("公共AI固定schema缺少模型声明");
  return ticketsApplicationModule(lock, {
    capabilities: { http: createTicketsAiHttpContribution(), data: [plan], files: new Map([[selected.id, files]]) },
    openapi: createTicketsAiOpenApi(),
    business({ platformServer, dependencies, assembledToken }) {
      const requestsToken = Symbol("tickets.ai.selected-requests");
      @Module({ imports: [platformServer, dependencies, PlatformDatabaseModule], providers: [{ provide: requestsToken,
        inject: [assembledToken, PlatformDatabaseClient, PLATFORM_AUTH_DATA_STORE, PlatformAuthService, SecretBox, SubscriptionService],
        useFactory: (assembly: TicketsAssembly, database: PlatformDatabaseClient, originalDatabase: object,
          auth: PlatformAuthService, secrets: SecretBox, subscriptions: SubscriptionService) => {
          if (database !== originalDatabase || delegates.some(name => !Object.hasOwn(database, name)
            || typeof Reflect.get(database, name)?.findFirst !== "function"))
            throw new Error("工单AI须与原Auth共用已选公共AI Client，不能使用另一连接池或普通平台Client");
          return createTicketsAiRequests({ database, auth, secrets, subscriptions, tickets: assembly.tickets,
            principals: assembly.tickets.principals, assertDataAvailable: (tx: Pick<Prisma.TransactionClient, "$queryRaw">) =>
              assembly.requireDataCapabilityAvailable("ai-native", tx) });
        } }], exports: [requestsToken] })
      class TicketsAiRequestsModule {}
      return {
        business: TicketsHttpModule.registerFactory({ imports: [dependencies, TicketsAiRequestsModule], inject: [assembledToken, requestsToken],
          useFactory: (assembly: TicketsAssembly, requests: TicketsAiRequests) => ({ ...assembly.tickets, aiStatus: {
            read: (principal, ticketId, query, raw) => withTicketsAiRequest(raw as TicketsAiHttpRequest, signal =>
              createTicketsAiStatus({ service: assembly.tickets.service, builtin: { async read({ ticketId, taskId }) {
                return TicketAiRouteStateSchema.parse(await requests.consume("status", raw as TicketsAiHttpRequest,
                  { ticketId, ...(taskId ? { taskId } : {}) }, signal));
              } } }).read(principal, ticketId, query))
          } }) }),
        additional: [TicketsAiHttpModule.register({ imports: [TicketsAiRequestsModule], inject: [requestsToken],
          useFactory: (requests: TicketsAiRequests) => requests })]
      };
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void bootstrapTickets(lock => selectTicketsAiApplication(lock, process.env.PLATFORM_AI_DATA_PACKAGE_DIR ?? ""));
