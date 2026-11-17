/** 原组合的行政交接provider，复用原客户材料与订单范围；Core、主体、资金和授权均沿原业务裁定。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseRentalHandoffService as RentalEnterpriseRentalHandoffService } from "@rental-os/rental-core/mysql-enterprise-rental-handoff";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseCommandService } from "./enterprise-command.service";
import { ClientApiService } from "../client/client-api.service";
import { RentalCoreFactRepository } from "../rental-core/rental-core-fact.repository";
export * from "@rental-os/rental-core/mysql-enterprise-rental-handoff";

@Injectable()
export class EnterpriseRentalHandoffService extends RentalEnterpriseRentalHandoffService {
  constructor(prisma: PrismaService, commands: EnterpriseCommandService, api: ClientApiService, facts: RentalCoreFactRepository) {
    super(prisma, commands, api, facts);
  }
}
