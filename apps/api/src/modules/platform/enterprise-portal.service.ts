/** 原组合企业门户provider，复用Rental开通、动作授权与原审计收据。 */
import { Injectable } from "@nestjs/common";
import { EnterprisePortalService as RentalEnterprisePortalService } from "@rental-os/rental-core/mysql-enterprise-portal";
import { PrismaService } from "../database/prisma.service";
export * from "@rental-os/rental-core/mysql-enterprise-portal";

@Injectable()
export class EnterprisePortalService extends RentalEnterprisePortalService {
  constructor(prisma: PrismaService) { super(prisma); }
}
