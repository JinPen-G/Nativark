/** 原组合的工单接入薄适配；当前公共身份/授权/事务由示范Core标准宿主单源消费。 */
import type { Prisma } from "@prisma/client";
import type { CoreDeploymentAvailability } from "@rental-os/core-host";
import { composeTicketsPlatformHost } from "@rental-os/example-tickets-core/platform-host";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import type { SubscriptionService } from "../subscription/subscription.service";
import type { OperationLogService } from "../../common/operation-log.service";
import { originalCoreTermPolicy } from "./original-core-term";

export function composeOriginalTicketsHost(input: {
  database: PrismaService; users: Pick<PlatformRepository, "findUserById">;
  audit: Pick<OperationLogService, "recordCoreBusinessReceipt">;
  subscription: Pick<SubscriptionService, "readCategoryCommercialContext">; deployment: CoreDeploymentAvailability;
}) {
  return composeTicketsPlatformHost<Prisma.TransactionClient>({ ...input, term: originalCoreTermPolicy(input.subscription) });
}
