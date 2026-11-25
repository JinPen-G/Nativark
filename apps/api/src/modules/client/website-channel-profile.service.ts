/** 原Nest渠道服务仅供给同一数据库、审计及外部适配，业务实现由Rental单源维护。 */
import { Injectable, Optional } from "@nestjs/common";
import { WebsiteChannelProfileService as RentalWebsiteChannelProfileService } from "@rental-os/rental-core/mysql-website-channel-profile";
import { OperationLogService } from "../../common/operation-log.service";
import { PrismaService } from "../database/prisma.service";
export { normalizeCustomDomain } from "@rental-os/rental-core/mysql-website-channel-profile";

@Injectable()
export class WebsiteChannelProfileService extends RentalWebsiteChannelProfileService {
  constructor(prisma: PrismaService,
    @Optional() operationLog?: OperationLogService) {
    super(prisma, operationLog);
  }
}
