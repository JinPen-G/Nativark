import type { RentalNoShowRule } from "./core";

/**
 * 未明确配置时的爽约处理默认值。
 *
 * 爽约费属于直接影响客户收费的规则，不能在新空间或草稿表单中隐式启用。
 * 返回新对象，避免调用方修改后污染其他规则版本。
 */
export function defaultRentalNoShowRule(): RentalNoShowRule {
  return {
    enabled: false,
    pickupGraceMinutes: 0,
    finalizationMinutes: 60,
    feeType: "none",
    feeValue: 0
  };
}
