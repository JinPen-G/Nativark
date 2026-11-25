/** 原 Nest 审计 provider，唯一 Prisma 数据源供给 Rental 审计表的窄存储端口。 */
import { Injectable } from "@nestjs/common";
import { CapabilityHookRepository as RentalCapabilityHookRepository } from "@rental-os/rental-core/capability-audit";
import { PrismaService } from "../database/prisma.service";

export type { CapabilityHookSubjectType, CapabilityHookAuditRow } from "@rental-os/rental-core/capability-audit";

@Injectable()
export class CapabilityHookRepository extends RentalCapabilityHookRepository {
  constructor(prisma: PrismaService) {
    super({
      capabilityHookAuditEntry: {
        createMany: (input) => prisma.capabilityHookAuditEntry.createMany(input),
        findMany: (input) => prisma.capabilityHookAuditEntry.findMany(input)
      }
    });
  }
}
