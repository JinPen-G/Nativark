/** 原组合的薄适配：继续使用同一公共Core实现，订阅/审计及数据库由原服务明确提供。 */
import type { Prisma } from "@prisma/client";
import type { CoreDeployedCatalogue, CorePlatformRemovalSource } from "@rental-os/core-host";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import { composePlatformCoreRemovalReader } from "@rental-os/platform-core-host/platform-core-removal";

export function composeOriginalCoreRemovalReader(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  catalogue: CoreDeployedCatalogue;
  platform: CorePlatformRemovalSource;
}) {
  return composePlatformCoreRemovalReader<Prisma.TransactionClient>(input);
}
