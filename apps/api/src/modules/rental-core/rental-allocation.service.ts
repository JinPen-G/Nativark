/** 原Nest配货入口，供给同一数据库、事实、核心及可选失败事件。
 * 原初始化/销毁钩子由Rental单源继承；宿主只登记一个扫描执行者。 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalAllocationService as CoreAllocation } from "@rental-os/rental-core/mysql-allocation";
export type { RentalRecordedFulfillmentIssueSource } from "@rental-os/rental-core/mysql-allocation";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreFactRepository } from "./rental-core-fact.repository";
import { RentalCoreService } from "./rental-core.service";
import { BUSINESS_FAILURE_OUTBOX, type BusinessFailureOutboxParticipant } from "../ai-native/business-events/prisma-business-failure-outbox";

@Injectable()
export class RentalAllocationService extends CoreAllocation<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, facts: RentalCoreFactRepository, core: RentalCoreService,
    @Optional() @Inject(BUSINESS_FAILURE_OUTBOX) failureEvents?: BusinessFailureOutboxParticipant) {
    super(prisma, facts, core, failureEvents);
  }
}
