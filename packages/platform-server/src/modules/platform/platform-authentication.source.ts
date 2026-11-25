/** 公共认证读取原平台账号、会话、安全配置和审计；没有Rental初始化或业务范围依赖。 */
import type { SystemSecurityBaselineConfig } from "@rental-os/platform-contracts";
import { readPlatformSecurityBaseline } from "./platform-security-baseline";
import { PlatformIdentityRepository } from "./platform-identity.repository";
import type { PlatformAuthenticationSource } from "../auth/auth-session.service";

export class PlatformAuthenticationRepository
  extends PlatformIdentityRepository
  implements PlatformAuthenticationSource
{
  findTenantByIdForAuth(id: string) {
    return this.getTenantIdentity(id);
  }

  getSecurityBaseline(): Promise<SystemSecurityBaselineConfig> {
    return readPlatformSecurityBaseline(this.prisma);
  }

  async recordSecurityAudit(input: {
    tenantId?: string;
    tenantCode?: string;
    action: string;
    operator: string;
    targetId?: string;
    detail: string;
  }) {
    const tenantId =
      input.tenantId ??
      (input.tenantCode ? (await this.findTenantByCode(input.tenantCode))?.tenantId : undefined);
    // 无可核定租户时沿原审计语义不落库，不能把未知主体归入演示租户。
    if (!tenantId) return;
    await this.prisma.operationLog.create({
      data: {
        tenantId,
        action: input.action,
        detail: {
          operator: input.operator,
          targetType: "auth",
          targetId: input.targetId,
          detail: input.detail,
        },
      },
    });
  }
}
