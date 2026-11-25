/** 原组合的薄适配：继续使用同一公共Core实现，订阅/审计及数据库由原服务明确提供。 */
import type { Prisma } from "@prisma/client";
import type { CoreDeployedCatalogue } from "@rental-os/core-host";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import type { SubscriptionService } from "../subscription/subscription.service";
import { composePlatformCoreScopeReader } from "@rental-os/platform-core-host/platform-core-scope";
import { originalCoreTermPolicy } from "./original-core-term";

export function composeOriginalCoreScopeReader(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  subscription: Pick<SubscriptionService, "readCategoryCommercialContext">;
  catalogue: CoreDeployedCatalogue;
}) {
  return composePlatformCoreScopeReader<Prisma.TransactionClient>({ ...input, term: originalCoreTermPolicy(input.subscription) });
}
