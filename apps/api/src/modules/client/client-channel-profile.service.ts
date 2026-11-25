/** 原Nest渠道服务仅供给同一数据库、审计及外部适配，业务实现由Rental单源维护。 */
import { Injectable, Optional } from "@nestjs/common";
import { ClientChannelProfileService as RentalClientChannelProfileService } from "@rental-os/rental-core/mysql-client-channel-profile";
import { OperationLogService } from "../../common/operation-log.service";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class ClientChannelProfileService extends RentalClientChannelProfileService {
  constructor(prisma: PrismaService,
    @Optional() operationLog?: OperationLogService) {
    super(prisma, operationLog);
  }
}
