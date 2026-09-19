import type { RentalEarlyReturnRule, RentalExtensionRule, RentalNoShowRule, RentalRuleConfig, RentalTaxRule } from "@rental-os/shared";
import { roundMoney } from "./rental-money";

/**
 * 后加进 `RentalRuleConfig` 的规则块的缺省值。
 *
 * 这两组都是**可选**的：`RentalRuleConfig` 就是报价与订单的 `ruleSnapshot`，
 * 既有快照里没有这些字段，历史订单必须继续按原快照复算。缺省值因此不是随便挑的，
 * 而是"等于新增字段之前的行为"。
 *
 * 单独成模块是为了让报价侧（RentalBusinessService）与订单侧（RentalCoreService）
 * 取到同一份缺省，否则两边各写一遍 `?? { … }`，缺省值迟早对不上。
 */

/**
 * 续租规则的缺省：允许续租、不限次数与天数、逾期补办续租强制先付款。
 *
 * 缺省必须是"允许"而不是"禁止"——续租是租赁的基本动作，若缺省成禁止，
 * 所有存量订单会在没有任何人改配置的情况下突然不能续租。
 */
export function effectiveExtensionRule(config: RentalRuleConfig): RentalExtensionRule {
  return config.extension ?? { enabled: true, forceImmediateWhenOverdue: true };
}

/**
 * 提前归还退款规则的缺省：**不退**。
 *
 * 与续租相反：需求 4.6.8 原文是「第一阶段固定租期订单提前归还默认不自动退租金」。
 * 缺省若成退款，存量订单会在没人改配置的情况下开始退钱。
 */
export function effectiveEarlyReturnRule(config: RentalRuleConfig): RentalEarlyReturnRule {
  return (
    config.earlyReturn ?? { mode: "none", minAdvanceHours: 0, refundPercent: 0, refundUndeliveredServices: false }
  );
}

/** 税规则的缺省：不计税。存量快照没有这一组，复算结果必须与新增字段之前一致。 */
export function effectiveTaxRule(config: RentalRuleConfig): RentalTaxRule {
  return config.tax ?? { rate: 0, inclusive: true };
}

/**
 * 爽约规则的缺省。
 *
 * `cancellation.noShow` 整组可缺省，缺省即**不启用**爽约处理；但即使启用了，早期快照里
 * `finalizationMinutes` 也可能缺失——此前 `listNoShowCandidateIds` 与 `confirmNoShowOrder`
 * 各写一遍 `?? 60`，这里收成一处。60 分钟必须等于新增缺省之前的行为，不得改动。
 */
export const DEFAULT_NO_SHOW_FINALIZATION_MINUTES = 60;

export function effectiveNoShowRule(config: RentalRuleConfig): RentalNoShowRule {
  const rule = config.cancellation?.noShow;
  return {
    enabled: rule?.enabled === true,
    pickupGraceMinutes: rule?.pickupGraceMinutes ?? 0,
    finalizationMinutes: rule?.finalizationMinutes ?? DEFAULT_NO_SHOW_FINALIZATION_MINUTES,
    feeType: rule?.feeType ?? "none",
    feeValue: rule?.feeValue ?? 0
  };
}

/**
 * 待支付保留时长（分钟）的缺省解析。
 *
 * `payment.unpaidHoldMinutes` 在契约里是必填，但快照里可能是 0/非法值（校验只在发布时做）。
 * 草稿订单没有软预占（例如纯服务单）时，到期判定只能靠 `createdAt + 本值`；这里给出的
 * 缺省 15 分钟等于报价侧种子规则的取值。
 */
export const DEFAULT_UNPAID_HOLD_MINUTES = 15;

export function effectiveUnpaidHoldRule(config: RentalRuleConfig): { unpaidHoldMinutes: number } {
  const minutes = Number(config.payment?.unpaidHoldMinutes);
  return { unpaidHoldMinutes: Number.isFinite(minutes) && minutes >= 1 ? minutes : DEFAULT_UNPAID_HOLD_MINUTES };
}

/**
 * 价内税的税额：`含税额 × r / (1 + r)`。
 *
 * 传进来的必须是**含税的应收**（报价用 `payableAmount`、订单用 `finalPayableAmount`），
 * 押金不要算进去——押金是代收的保证金，不是收入，不产生销项税。
 *
 * 税率为 0 或非有限值时返回 0，而不是抛错：规则整组缺省是合法状态，
 * 报价不该因为"没配税"而失败。
 */
export function inclusiveTaxAmount(taxIncludedAmount: number, rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(taxIncludedAmount) || taxIncludedAmount <= 0) return 0;
  return roundMoney((taxIncludedAmount * rate) / (1 + rate));
}
