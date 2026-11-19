/** 原组合为 Rental 标准注册供给同一数据库、当前空间成员和配置实例。
 * 仅在宿主选择标准目录时组合，不改变原接口或为存量租户补造 Core 授权。 */
import type { Prisma } from "@prisma/client";
import type { CoreDeploymentAvailability } from "@rental-os/core-host";
import { composeRentalPlatformHost } from "@rental-os/rental-core/platform-host";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import type { RentalCoreConfigRepository } from "../rental-core/rental-core-config.repository";
import type { SubscriptionService } from "../subscription/subscription.service";
import { originalCoreTermPolicy } from "./original-core-term";

export function composeOriginalRentalCore(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById" | "resolveTrustedWorkspacePrincipal">;
  configuration: Pick<RentalCoreConfigRepository, "loadWorkspaceSnapshot">;
  subscription: Pick<SubscriptionService, "readCategoryCommercialContext">;
  deployment: CoreDeploymentAvailability;
}) {
  return composeRentalPlatformHost<Prisma.TransactionClient>({ ...input,
    term: originalCoreTermPolicy(input.subscription) });
}
