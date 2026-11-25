/** 原Nest业务配置适配，供给当前Auth/ALS、品类锁、原事件和同一数据库事务。 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalBusinessConfigRepository as RentalMysqlBusinessConfigRepository, type RentalBusinessConfigStore as CoreBusinessConfigStore } from "@rental-os/rental-core/mysql-business-configuration";
import { PrismaService } from "../database/prisma.service";
import { getRequestIdentity, getRequestTenantId, getRequestWorkspaceId } from "../../common/request-identity";
import { assertScopedWrite, resolveScopeWorkspaceId } from "./workspace-scope";
import { lockActiveCategoryBinding } from "./category-active-write";
import { BUSINESS_FAILURE_OUTBOX, type BusinessFailureOutboxParticipant } from "../ai-native/business-events/prisma-business-failure-outbox";

export * from "@rental-os/rental-core/mysql-business-configuration";
export type RentalBusinessConfigStore = CoreBusinessConfigStore<Prisma.TransactionClient>;

@Injectable()
export class RentalBusinessConfigRepository extends RentalMysqlBusinessConfigRepository<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, @Optional() @Inject(BUSINESS_FAILURE_OUTBOX) failureEvents?: BusinessFailureOutboxParticipant) {
    super(prisma, {
      getRequestTenantId, getRequestWorkspaceId, getRequestIdentity,
      resolveWorkspaceId: resolveScopeWorkspaceId, assertScopedWrite,
      lockCategoryBinding: (transaction, tenantId, workspaceId, expected, categoryCode) => lockActiveCategoryBinding(transaction, tenantId, workspaceId, expected, categoryCode),
      openingConfiguration: failureEvents?.openingConfiguration?.bind(failureEvents)
    });
  }
}
