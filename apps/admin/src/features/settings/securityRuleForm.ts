import type {
  RentalDepositRule,
  RentalPreauthorizationRule,
  RentalRuleVersion,
} from "@rental-os/shared";

export interface NormalizedSecurityRules {
  deposit: RentalDepositRule;
  preauthorization: RentalPreauthorizationRule;
}

/**
 * 规则编辑器的提交规范化。
 *
 * 押金/预授权表单是长期编辑表单：用户从“每单固定”切到其他模式时，
 * Ant Design Form 可能仍保留已隐藏字段的值。服务端不能默默忽略这些值，
 * 所以提交前只保留当前模式真正消费的字段；必填字段缺失则继续交给服务端拒绝。
 */
export function normalizeSecurityRules(
  config: RentalRuleVersion["config"],
  supportsPreauthorization: boolean,
): NormalizedSecurityRules {
  const rawDeposit = config.deposit ?? { mode: "none" as const };
  const rawPreauthorization = supportsPreauthorization
    ? config.preauthorization ?? { mode: "none" as const }
    : { mode: "none" as const };

  const deposit: RentalDepositRule = {
    mode: rawDeposit.mode,
    ...(rawDeposit.maxAmount === undefined ? {} : { maxAmount: rawDeposit.maxAmount }),
    ...(rawDeposit.mode === "order_fixed" && rawDeposit.fixedAmount !== undefined
      ? { fixedAmount: rawDeposit.fixedAmount }
      : {}),
  };
  const preauthorization: RentalPreauthorizationRule = {
    mode: rawPreauthorization.mode,
    ...(rawPreauthorization.maxAmount === undefined ? {} : { maxAmount: rawPreauthorization.maxAmount }),
    ...(rawPreauthorization.mode === "order_fixed" && rawPreauthorization.fixedAmount !== undefined
      ? { fixedAmount: rawPreauthorization.fixedAmount }
      : {}),
    ...(rawPreauthorization.mode === "risk_surcharge" && rawPreauthorization.riskSurchargeAmount !== undefined
      ? { riskSurchargeAmount: rawPreauthorization.riskSurchargeAmount }
      : {}),
  };

  return { deposit, preauthorization };
}
