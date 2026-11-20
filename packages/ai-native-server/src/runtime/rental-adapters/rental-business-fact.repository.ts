/** 原Nest业务事实适配，提供当前空间/订单可见范围、原通知事件及同一数据源与事务。 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalBusinessFactRepository as RentalMysqlBusinessFactRepository, type RentalBusinessFactStore as BusinessFactStore } from "@rental-os/rental-core/mysql-business-facts";
import { PrismaService } from "./prisma.service";
import { resolveScopeWorkspaceId } from "@rental-os/rental-core/mysql-workspace-scope";
import { requestRentalOrderVisibilityWhere } from "./rental-core-fact.repository";
import { RentalCoreConfigRepository } from "./rental-core-config.repository";
import { BUSINESS_FAILURE_OUTBOX, type BusinessFailureOutboxParticipant } from "../business-events/prisma-business-failure-outbox";

export * from "@rental-os/rental-core/mysql-business-facts";
export type RentalBusinessFactTx = Prisma.TransactionClient;
export type RentalBusinessFactStore = BusinessFactStore<Prisma.TransactionClient>;

@Injectable()
export class RentalBusinessFactRepository extends RentalMysqlBusinessFactRepository<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, @Optional() @Inject(BUSINESS_FAILURE_OUTBOX) failureEvents?: BusinessFailureOutboxParticipant) {
    super(prisma, {
      resolveWorkspaceId: resolveScopeWorkspaceId, orderVisibilityWhere: requestRentalOrderVisibilityWhere,
      quoteConfiguration: new RentalCoreConfigRepository(prisma), events: failureEvents
    });
  }
}
