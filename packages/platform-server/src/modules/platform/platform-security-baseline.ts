/** 原登录/密码/脱敏安全配置的公共默认、合并、数值校验和平台主体读取。保存由公共管理事务执行。 */
import { BadRequestException } from "@nestjs/common";
import type { SystemSecurityBaselineConfig } from "@rental-os/platform-contracts";
import type { PlatformAuthDataStore } from "./platform-auth-data-store";

export const PLATFORM_SECURITY_TENANT_ID = "tenant_platform";

export async function readPlatformSecurityBaseline(source: Pick<PlatformAuthDataStore, "systemParameterSet">): Promise<SystemSecurityBaselineConfig> {
  const row = await source.systemParameterSet.findFirst({
    where: { tenantId: PLATFORM_SECURITY_TENANT_ID, module: "system-rules", status: "EFFECTIVE" },
    orderBy: { versionNo: "desc" }
  });
  const content = row?.content as { security?: Partial<SystemSecurityBaselineConfig> } | undefined;
  return normalizeSecurityBaseline(content?.security);
}

export function validateSecurityBaseline(input?: Partial<SystemSecurityBaselineConfig>) {
  const security = normalizeSecurityBaseline(input);
  const numbers = [security.loginRateLimit.maxFailures, security.loginRateLimit.windowMinutes, security.loginRateLimit.lockMinutes,
    security.passwordPolicy.minLength, security.passwordPolicy.expireDays];
  if (numbers.some(value => !Number.isFinite(value) || value < 0))
    throw new BadRequestException("系统参数中的数字配置不能为负数");
}

export function defaultSecurityBaseline(): SystemSecurityBaselineConfig {
  return {
    loginRateLimit: {
      enabled: true,
      maxFailures: 5,
      windowMinutes: 10,
      lockMinutes: 15,
    },
    passwordPolicy: {
      minLength: 8,
      requireLetter: true,
      requireNumber: true,
      disallowDefaultPassword: true,
      expireDays: 90,
    },
    masking: {
      phone: true,
      identityNo: true,
      driverLicenseNo: true,
      email: false,
      apiKey: true,
    },
    secondConfirmation: {
      enabled: true,
      actions: [
        "system.user.reset-password",
        "system.role.delete",
        "rental-os.order.close",
        "rental-os.fee.waive",
        "rental-os.vehicle.disable",
      ],
    },
  };
}

export function normalizeSecurityBaseline(
  input?: Partial<SystemSecurityBaselineConfig>,
): SystemSecurityBaselineConfig {
  const defaults = defaultSecurityBaseline();
  return {
    loginRateLimit: {
      ...defaults.loginRateLimit,
      ...(input?.loginRateLimit ?? {}),
    },
    passwordPolicy: {
      ...defaults.passwordPolicy,
      ...(input?.passwordPolicy ?? {}),
    },
    masking: {
      ...defaults.masking,
      ...(input?.masking ?? {}),
    },
    secondConfirmation: {
      ...defaults.secondConfirmation,
      ...(input?.secondConfirmation ?? {}),
      actions: input?.secondConfirmation?.actions ?? defaults.secondConfirmation.actions,
    },
  };
}
