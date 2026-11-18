/** 原客服邮件注入入口。公共应用沿原账户权威、邮件配置、审计及同一宿主事务保存邮件和游标。 */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PlatformTenantSupportEmailService } from "@rental-os/platform-server/messaging";
import { OperationLogService } from "../../common/operation-log.service";
import { PrismaService } from "../database/prisma.service";
import { PlatformRepository } from "../platform/platform.repository";
import { TenantEmailRuntimeService } from "../integrations/tenant-email.runtime.service";

@Injectable()
export class TenantSupportEmailService extends PlatformTenantSupportEmailService<Prisma.TransactionClient> {
  constructor(
    prisma: PrismaService,
    accounts: PlatformRepository,
    emailRuntime: TenantEmailRuntimeService,
    audit: OperationLogService
  ) {
    super(prisma, accounts, emailRuntime, audit);
  }
}
