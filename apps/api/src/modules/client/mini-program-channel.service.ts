/** 原Nest渠道服务仅供给同一数据库、审计及外部适配，业务实现由Rental单源维护。 */
import { Injectable, Optional } from "@nestjs/common";
import { MiniProgramChannelService as RentalMiniProgramChannelService } from "@rental-os/rental-core/mysql-mini-program-channel";
import { OperationLogService } from "../../common/operation-log.service";
import { PrismaService } from "../database/prisma.service";
import { SecretBox } from "../../common/secret-box";
import { WechatMiniProgramAdapter } from "./wechat-mini-program.adapter";

@Injectable()
export class MiniProgramChannelService extends RentalMiniProgramChannelService {
  constructor(prisma: PrismaService, secretBox: SecretBox, adapter: WechatMiniProgramAdapter,
    @Optional() operationLog?: OperationLogService) {
    super(prisma, secretBox, adapter, operationLog);
  }
}
