/** 原组合的薄适配：继续使用同一公共Core实现，订阅/审计及数据库由原服务明确提供。 */
import type { Prisma } from "@prisma/client";
import type { CoreDeploymentAvailability } from "@rental-os/core-host";
import type { CoreServerRegistration } from "@rental-os/core-contracts";
import type { OperationLogService } from "../../common/operation-log.service";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import type { SubscriptionService } from "../subscription/subscription.service";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { composePlatformCoreBindings } from "@rental-os/platform-core-host/platform-core-bindings";
import { originalCoreTermPolicy } from "./original-core-term";

export function composeOriginalCoreBindings(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  audit: Pick<OperationLogService, "recordCoreBindingReceipt">;
  subscription: Pick<SubscriptionService, "readCategoryCommercialContext">;
  deployment: CoreDeploymentAvailability;
  registrations: ReadonlyMap<string, CoreServerRegistration>;
  /** 有容器的Core由自身适配在同一原事务核定容器归属及可初始化范围。 */
  authorizeContainer?(transaction: Prisma.TransactionClient, user: SystemUserRow,
    scope: import("@rental-os/core-contracts").CoreScopeReference): Promise<void>;
}) {
  return composePlatformCoreBindings<Prisma.TransactionClient>({ ...input, term: originalCoreTermPolicy(input.subscription) });
}
