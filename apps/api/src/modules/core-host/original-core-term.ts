/** 原订阅在调用方同一事务裁定新业务；公共Core适配不依赖Rental的商业目录或重新计费。 */
import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { PlatformCoreTermPolicy } from "@rental-os/platform-core-host";
import type { SubscriptionService } from "../subscription/subscription.service";

export function originalCoreTermPolicy(subscription: Pick<SubscriptionService, "readCategoryCommercialContext">): PlatformCoreTermPolicy<Prisma.TransactionClient> {
  return { async requireNewBusiness(transaction, tenantId) {
    const term = await subscription.readCategoryCommercialContext(tenantId, transaction, new Date(), []);
    if (!term.newBusinessAllowed) throw new ForbiddenException("租户订阅已到期，暂停新增Core业务");
  } };
}
