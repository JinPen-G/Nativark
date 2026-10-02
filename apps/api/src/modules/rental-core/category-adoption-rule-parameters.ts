import { RENTAL_SECURITY_RISK_LEVELS, type RentalRuleConfig } from "@rental-os/shared";
import { validateSecurityRules } from "./rental-security-deposit";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Parameter checks for current/future tenant rules. Never normalize a stored
 * rule or substitute category defaults; omitted legacy sections remain omitted.
 * This is not the full adoption gate or validation of historical order rules. */
export function categoryAdoptionRuleParameterErrors(config: RentalRuleConfig): string[] {
  const errors: string[] = [];
  const threshold = (value: unknown, label: string, maximum: number) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum) errors.push(`${label}必须大于0且不超过${maximum}`);
  };
  if (config.pricing?.hourToDayEnabled) threshold(config.pricing.hourToDayThresholdHours, "时租转日阈值（小时）", 24);
  if (config.overdue.feeMode === "hourly_to_daily") {
    threshold(config.overdue.hourlyRatePercent, "逾时每小时日价比例（%）", 100);
    threshold(config.overdue.dailyAfterHours, "逾时转日阈值（小时）", 24);
  }
  // Explicit security sections use the same cross-field validator as rule
  // publication. Do not synthesize a legacy money obligation from missing data.
  for (const key of ["deposit", "preauthorization"] as const) {
    if (config[key] !== undefined && !object(config[key])) errors.push(`${key}规则结构不可读取`);
  }
  if ((config.deposit === undefined || object(config.deposit)) && (config.preauthorization === undefined || object(config.preauthorization))) {
    errors.push(...validateSecurityRules(config.deposit, config.preauthorization));
  }
  if (config.membershipSecurityReduction !== undefined) {
    if (!object(config.membershipSecurityReduction)) errors.push("会员保证金减免结构不可读取");
    else for (const [instrument, policy] of Object.entries(config.membershipSecurityReduction)) {
      if (!["deposit", "preauthorization"].includes(instrument) || !object(policy) || typeof policy.enabled !== "boolean") {
        errors.push("会员保证金减免类型或启用标志无效"); continue;
      }
      if (!policy.enabled) continue;
      if (!Array.isArray(policy.allowedRiskLevels) || policy.allowedRiskLevels.length === 0 || policy.allowedRiskLevels.some((level) => !RENTAL_SECURITY_RISK_LEVELS.includes(level))) errors.push("会员保证金减免必须指定合法风控等级");
      threshold(policy.maxReductionPercent, "会员保证金减免比例上限（%）", 100);
      if (typeof policy.maxReductionAmount !== "number" || !Number.isFinite(policy.maxReductionAmount) || policy.maxReductionAmount <= 0) errors.push("会员保证金单笔减免金额上限必须大于0");
    }
  }
  for (const [label, value, minimum, integer] of [
    ["支付占位时长", config.payment.unpaidHoldMinutes, 1, false],
    ["报价有效时长", config.payment.quoteValidityMinutes, 1, true],
    ["逾时宽限", config.overdue.graceMinutes, 0, false],
    ["逾时倍率", config.overdue.feeMultiplier, 0, false],
    ["免费取消提前时长", config.cancellation?.freeBeforeHours, 0, false]
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < minimum || (integer && (!Number.isInteger(value) || value > 1440)))) errors.push(`${label}参数无效`);
  }
  if (config.cancellation?.weatherExceptionEnabled) errors.push("天气免取消费尚未实现，不能作为可执行规则采用");
  if (config.damage !== undefined && (!object(config.damage) || config.damage.manualReviewRequired !== true)) errors.push("损坏费用必须保留人工核定");
  const noShow = config.cancellation?.noShow;
  if (noShow !== undefined) {
    if (!object(noShow) || !Number.isFinite(noShow.pickupGraceMinutes) || noShow.pickupGraceMinutes < 0 || !Number.isFinite(noShow.finalizationMinutes) || noShow.finalizationMinutes < 1 || !Number.isFinite(noShow.feeValue) || noShow.feeValue < 0 || (noShow.feeType === "percentage" && noShow.feeValue > 100)) errors.push("爽约宽限、确认时限或费用参数无效");
  }
  return errors;
}
