/** 原Nest核心配置适配，提供当前身份/范围、原配置事件和同一数据库事务。 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalCoreConfigRepository as RentalMysqlCoreConfigRepository, type RentalConfigStore as CoreConfigStore } from "@rental-os/rental-core/mysql-core-configuration";
import { PrismaService } from "../database/prisma.service";
import { getRequestTenantId, getRequestWorkspaceId, getRequestStaffLocationIds, staffLocationWhere } from "../../common/request-identity";
import { assertScopedWrite, resolveScopeWorkspaceId } from "./workspace-scope";
import { BUSINESS_FAILURE_OUTBOX, type BusinessFailureOutboxParticipant } from "../ai-native/business-events/prisma-business-failure-outbox";

export * from "@rental-os/rental-core/mysql-core-configuration";
export type RentalConfigTx = Prisma.TransactionClient;
export type RentalConfigStore = CoreConfigStore<Prisma.TransactionClient>;

@Injectable()
export class RentalCoreConfigRepository extends RentalMysqlCoreConfigRepository<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, @Optional() @Inject(BUSINESS_FAILURE_OUTBOX) failureEvents?: BusinessFailureOutboxParticipant) {
    super(prisma, {
      getRequestTenantId, getRequestWorkspaceId, getRequestStaffLocationIds, staffLocationWhere,
      resolveWorkspaceId: resolveScopeWorkspaceId, assertScopedWrite,
      openingConfiguration: failureEvents?.openingConfiguration?.bind(failureEvents)
    });
  }
}
