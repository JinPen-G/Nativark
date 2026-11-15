/** 原组合的薄适配：继续使用同一公共Core实现，订阅/审计及数据库由原服务明确提供。 */
import type { Prisma } from "@prisma/client";
import type { CoreDeployedCatalogue } from "@rental-os/core-host";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import { composePlatformCoreSessionReader } from "@rental-os/platform-core-host/platform-core-session";

export function composeOriginalCoreSessionReader(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  catalogue: CoreDeployedCatalogue;
}) {
  return composePlatformCoreSessionReader<Prisma.TransactionClient>(input);
}
