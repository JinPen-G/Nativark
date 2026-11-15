/** 原 Nest 恢复快照适配，配置、品类锁和业务事件沿原宿主及同一数据库提供。 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { RentalStateRepository as RentalMysqlStateRepository } from "@rental-os/rental-core/mysql-state";
import { PrismaService } from "../database/prisma.service";
import { lockActiveCategoryBinding } from "./category-active-write";
import { BUSINESS_FAILURE_OUTBOX, type BusinessFailureOutboxParticipant } from "../ai-native/business-events/prisma-business-failure-outbox";

export {
  RENTAL_CONFIGURATION_REVISION_MAX,
  readRentalConfigurationRevision,
  writeRentalCoreConfigurationSnapshot
} from "@rental-os/rental-core/mysql-state";

@Injectable()
export class RentalStateRepository extends RentalMysqlStateRepository<Prisma.TransactionClient> {
  constructor(
    prisma: PrismaService,
    config: ConfigService,
    @Optional() @Inject(BUSINESS_FAILURE_OUTBOX) failureEvents?: BusinessFailureOutboxParticipant
  ) {
    super({
      rentalCoreStateSnapshot: { findMany: () => prisma.rentalCoreStateSnapshot.findMany() },
      rentalBusinessStateSnapshot: {
        findMany: () => prisma.rentalBusinessStateSnapshot.findMany(),
        upsert: (input) => prisma.rentalBusinessStateSnapshot.upsert(input)
      },
      tenantRentalProfile: { findMany: (input) => prisma.tenantRentalProfile.findMany(input) },
      $transaction: (run, options) => prisma.$transaction(run, options)
    }, { get: <T>(name: string) => config.get<T>(name) }, {
      lockCategoryBinding: (transaction, tenantId, workspaceId, expected) => lockActiveCategoryBinding(transaction, tenantId, workspaceId, expected),
      openingConfiguration: failureEvents?.openingConfiguration?.bind(failureEvents)
    });
  }
}
