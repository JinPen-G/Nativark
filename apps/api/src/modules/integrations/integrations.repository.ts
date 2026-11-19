/** 原 Nest 集成仓储入口，从同一 Prisma 实例供给 Rental 私有适配及公共台账。 */
import { Injectable } from "@nestjs/common";
import { MysqlRentalIntegrationRepository } from "@rental-os/rental-core/mysql-integrations";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class IntegrationsRepository extends MysqlRentalIntegrationRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
}
