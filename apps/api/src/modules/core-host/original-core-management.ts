/** 原组合的薄适配：继续使用同一公共Core实现，订阅/审计及数据库由原服务明确提供。 */
import type { Prisma } from "@prisma/client";
import type { CoreDeploymentAvailability } from "@rental-os/core-host";
import type { OperationLogService } from "../../common/operation-log.service";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import { composePlatformCoreManagement } from "@rental-os/platform-core-host/platform-core-management";

export function composeOriginalCoreManagement(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  audit: Pick<OperationLogService, "recordCoreAccessReceipt">;
  deployment: CoreDeploymentAvailability;
}) {
  return composePlatformCoreManagement<Prisma.TransactionClient>(input);
}
