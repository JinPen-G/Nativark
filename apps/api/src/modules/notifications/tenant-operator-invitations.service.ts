/** 原运营邀请注入入口。公共应用沿原账户权威、配置及邮件运行时执行同事务授权与原键恢复。 */
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { PlatformTenantOperatorInvitationsService } from "@rental-os/platform-server/messaging";
import { PrismaService } from "../database/prisma.service";
import { PlatformRepository } from "../platform/platform.repository";
import { PlatformService } from "../platform/platform.service";
import { TenantIntegrationService } from "../integrations/tenant-integration.service";
import { TenantEmailRuntimeService } from "../integrations/tenant-email.runtime.service";

@Injectable()
export class TenantOperatorInvitationsService extends PlatformTenantOperatorInvitationsService<Prisma.TransactionClient> {
  constructor(
    prisma: PrismaService,
    config: ConfigService,
    platform: PlatformService,
    accounts: PlatformRepository,
    integrations: TenantIntegrationService,
    emailRuntime: TenantEmailRuntimeService
  ) {
    // 原 ORM 按 select 返回不同投影，窄重载分别保留模板名称和公开租户身份。
    function findTenant(query: { where: { id: string }; select: { name: true } }): PromiseLike<{ name: string } | null>;
    function findTenant(query: { where: { id: string }; select: { code: true; name: true; status: true } }): PromiseLike<{
      code: string; name: string; status: string;
    } | null>;
    function findTenant(query: { where: { id: string }; select: { name: true; code?: true; status?: true } }) {
      return prisma.tenant.findUnique(query);
    }
    super({
      user: prisma.user,
      tenant: { findUnique: findTenant },
      notificationSendLog: prisma.notificationSendLog,
      $queryRaw<Result>(query: Parameters<Prisma.TransactionClient["$queryRaw"]>[0], ...values: unknown[]) {
        return prisma.$queryRaw<Result>(query, ...values);
      },
      $executeRaw(query: Parameters<Prisma.TransactionClient["$executeRaw"]>[0], ...values: unknown[]) {
        return prisma.$executeRaw(query, ...values);
      },
      $transaction: (work, options) => prisma.$transaction(work, options)
    }, config, platform, accounts, integrations, emailRuntime);
  }
}
