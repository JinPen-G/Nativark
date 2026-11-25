/** 原Nest核心事实接线：供给当前Auth/ALS、空间/组织范围、检查事件及同一数据库事务。 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalCoreFactRepository as RentalMysqlCoreFactRepository,
  requestRentalOrderVisibilityWhere as rentalOrderVisibilityWhere,
  type RentalCoreFactStore as CoreFactStore } from "@rental-os/rental-core/mysql-core-facts";
import { PrismaService } from "../database/prisma.service";
import { BUSINESS_FAILURE_OUTBOX, type BusinessFailureOutboxParticipant } from "../ai-native/business-events/prisma-business-failure-outbox";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { enabledOrganizationSubtreeIds } from "../../common/organization-location-scope";
import { getRequestDataScope, getRequestIdentity, getRequestLocationIds, getRequestUserId, getRequestWorkspaceId } from "../../common/request-identity";

export * from "@rental-os/rental-core/mysql-core-facts";
export type RentalFactTx = Prisma.TransactionClient;
export type RentalCoreFactStore = CoreFactStore<Prisma.TransactionClient>;

/** 保留原零参数可见性入口，始终从同一服务端当前上下文读取。 */
export function requestRentalOrderVisibilityWhere() {
  return rentalOrderVisibilityWhere({ getRequestDataScope, getRequestLocationIds, getRequestUserId });
}

@Injectable()
export class RentalCoreFactRepository extends RentalMysqlCoreFactRepository<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, @Optional() @Inject(BUSINESS_FAILURE_OUTBOX) failureEvents?: BusinessFailureOutboxParticipant) {
    super(prisma, { getRequestDataScope, getRequestIdentity, getRequestLocationIds, getRequestUserId, getRequestWorkspaceId,
      resolveWorkspaceId: resolveScopeWorkspaceId, enabledOrganizationSubtreeIds, events: failureEvents });
  }
}
