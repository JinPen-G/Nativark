/** 原登录/密码/脱敏安全配置的公共默认值与合并规则，保存权限和持久化由调用方处理。 */
import type { SystemSecurityBaselineConfig } from "@rental-os/platform-contracts";

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
