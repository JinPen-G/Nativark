import { ConflictException } from "@nestjs/common";
import type {
  RentalDepositRule,
  RentalPreauthorizationRule,
  RentalSecurityReduction
} from "@store-rental/shared";

const DEPOSIT_MODES = new Set<RentalDepositRule["mode"]>(["none", "fixed", "price_multiple", "order_fixed"]);
const PREAUTH_MODES = new Set<RentalPreauthorizationRule["mode"]>(["none", "fixed", "price_multiple", "order_fixed", "risk_surcharge"]);

/**
 * RULE-01B：押金与预授权的独立计算（需求 4.4.7）。
 *
 * 抽成纯函数的理由与优惠/服务相同：「这笔押金/预授权凭什么算这么多」必须逐条回放，
 * 且押金进的是**实收**、预授权是**冻结额度**，两者算错都直接影响客户资金，不是可下次
 * 修好的展示问题。四个品类共用同一套算法，因此这里不出现任何品类编码分支。
 *
 * 三条硬规则：
 * 1. 押金与预授权各自独立取数、独立封顶，可同时非零（需求 4.4.7）。
 * 2. 先按各商品行计算求和，再应用订单级上限（需求 4.4.7：先逐行求和再封顶）。
 * 3. 行租金倍数以该行**日期价格与封顶处理后的租金**为基数——调用方传进来的 lineRental
 *    已是这个口径，本模块不再自己算租金。
 *
 * 本模块**不**触碰优惠：优惠券、积分、营销余额不得抵扣押金或预授权（需求 4.4.10），
 * 因此这里根本不接收任何优惠入参。
 */

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** 每个商品行参与押金/预授权计算所需的最小事实。 */
export interface SecurityLineInput {
  groupName: string;
  quantity: number;
  /** 该行日期价格与封顶处理后的租金（倍数基数）。 */
  lineRental: number;
  /** 费率上的每件固定押金。 */
  depositUnit: number;
  /** 费率上的押金倍数。 */
  depositMultiple: number;
  /** 费率上的每件固定预授权额度（缺省回落到押金字段由调用方处理）。 */
  preAuthUnit: number;
  /** 费率上的预授权倍数（缺省回落到押金倍数由调用方处理）。 */
  preAuthMultiple: number;
}

export interface SecurityComputation {
  amount: number;
  basis: string[];
}

export interface SecurityComputationResult {
  deposit: SecurityComputation;
  preauthorization: SecurityComputation;
}

/**
 * RULE-01B：校验押金/预授权规则的跨字段约束。
 *
 * DTO 只能校验字段自身的类型和范围，无法阻止运营把「每单固定」漏填金额，
 * 或把不会被当前模式消费的字段一起保存。后者尤其危险：配置表面保存成功，
 * 报价时却静默忽略，运营看到的规则和客户实际承担的资金义务不一致。
 *
 * 返回错误文本而不是直接抛异常，便于配置服务统一使用 BadRequestException，
 * 也便于纯函数测试覆盖所有模式组合。
 */
export function validateSecurityRules(
  depositRule?: RentalDepositRule,
  preauthRule?: RentalPreauthorizationRule
): string[] {
  const errors: string[] = [];
  validateNumericField(depositRule?.maxAmount, "押金上限", errors);
  validateNumericField(depositRule?.fixedAmount, "押金每单固定金额", errors);
  validateNumericField(preauthRule?.maxAmount, "预授权上限", errors);
  validateNumericField(preauthRule?.fixedAmount, "预授权每单固定金额", errors);
  validateNumericField(preauthRule?.riskSurchargeAmount, "预授权风险附加额", errors);

  if (depositRule) {
    if (!DEPOSIT_MODES.has(depositRule.mode)) {
      errors.push(`押金 mode 无效：${String(depositRule.mode)}`);
    }
    if (depositRule.mode === "order_fixed" && depositRule.fixedAmount === undefined) {
      errors.push("押金选择每单固定时必须填写 fixedAmount");
    }
    if (depositRule.mode !== "order_fixed" && depositRule.fixedAmount !== undefined) {
      errors.push("押金 fixedAmount 仅能用于 order_fixed 模式");
    }
  }

  if (preauthRule) {
    if (!PREAUTH_MODES.has(preauthRule.mode)) {
      errors.push(`预授权 mode 无效：${String(preauthRule.mode)}`);
    }
    if (preauthRule.mode === "order_fixed" && preauthRule.fixedAmount === undefined) {
      errors.push("预授权选择每单固定时必须填写 fixedAmount");
    }
    if (preauthRule.mode !== "order_fixed" && preauthRule.fixedAmount !== undefined) {
      errors.push("预授权 fixedAmount 仅能用于 order_fixed 模式");
    }
    if (preauthRule.mode === "risk_surcharge" && preauthRule.riskSurchargeAmount === undefined) {
      errors.push("预授权选择风险附加时必须填写 riskSurchargeAmount");
    }
    if (preauthRule.mode !== "risk_surcharge" && preauthRule.riskSurchargeAmount !== undefined) {
      errors.push("预授权 riskSurchargeAmount 仅能用于 risk_surcharge 模式");
    }
  }

  return errors;
}

function validateNumericField(value: number | undefined, label: string, errors: string[]) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    errors.push(`${label}必须是大于等于 0 的有限数字`);
  }
}

/**
 * 逐行求和 → 加订单级固定/风险项 → 订单级封顶。返回金额与逐条依据说明。
 *
 * `order_fixed` 与 `risk_surcharge` 的订单级项**只加一次**，绝不进逐行循环——
 * 否则会随行数或数量被放大，与「每单固定」的语义相悖（变异测试专门盯这条）。
 */
export function computeSecurityAmounts(
  lines: readonly SecurityLineInput[],
  depositRule: RentalDepositRule,
  preauthRule: RentalPreauthorizationRule
): SecurityComputationResult {
  const deposit = accumulate(
    lines,
    depositRule.mode,
    {
      perItem: (line) => line.depositUnit * line.quantity,
      perItemLabel: (line) => `${line.groupName} 固定 ${line.depositUnit} × ${line.quantity}`,
      multiple: (line) => line.lineRental * line.depositMultiple,
      multipleLabel: (line) => `${line.groupName} 租金 ${line.lineRental} × ${line.depositMultiple} 倍`,
      orderFixed: depositRule.fixedAmount ?? 0,
      riskSurcharge: 0
    },
    depositRule.maxAmount
  );
  const preauthorization = accumulate(
    lines,
    preauthRule.mode,
    {
      perItem: (line) => line.preAuthUnit * line.quantity,
      perItemLabel: (line) => `${line.groupName} 固定 ${line.preAuthUnit} × ${line.quantity}`,
      multiple: (line) => line.lineRental * line.preAuthMultiple,
      multipleLabel: (line) => `${line.groupName} 租金 ${line.lineRental} × ${line.preAuthMultiple} 倍`,
      orderFixed: preauthRule.fixedAmount ?? 0,
      riskSurcharge: preauthRule.mode === "risk_surcharge" ? (preauthRule.riskSurchargeAmount ?? 0) : 0
    },
    preauthRule.maxAmount
  );
  return { deposit, preauthorization };
}

interface AccumulatorSpec {
  perItem: (line: SecurityLineInput) => number;
  perItemLabel: (line: SecurityLineInput) => string;
  multiple: (line: SecurityLineInput) => number;
  multipleLabel: (line: SecurityLineInput) => string;
  orderFixed: number;
  riskSurcharge: number;
}

function accumulate(
  lines: readonly SecurityLineInput[],
  mode: RentalDepositRule["mode"] | RentalPreauthorizationRule["mode"],
  spec: AccumulatorSpec,
  maxAmount?: number
): SecurityComputation {
  if (mode === "none") return { amount: 0, basis: [] };

  const basis: string[] = [];
  let gross = 0;

  // 每单固定：整单一笔，与行数、数量无关。不进逐行循环。
  if (mode === "order_fixed") {
    gross = spec.orderFixed;
    basis.push(`每单固定 ${spec.orderFixed}`);
  } else {
    // 每件固定 / 行租金倍数 / 风险附加：都先逐行计算。
    for (const line of lines) {
      if (mode === "price_multiple" || mode === "risk_surcharge") {
        gross += spec.multiple(line);
        basis.push(spec.multipleLabel(line));
      } else {
        gross += spec.perItem(line);
        basis.push(spec.perItemLabel(line));
      }
    }
    // 风险附加：在按行租金倍数求和之上再加一笔订单级风险缓冲。
    if (mode === "risk_surcharge" && spec.riskSurcharge > 0) {
      gross += spec.riskSurcharge;
      basis.push(`风险附加 ${spec.riskSurcharge}`);
    }
  }

  let amount = money(gross);
  // 订单级上限在**逐行求和之后**应用（需求 4.4.7）。
  if (maxAmount !== undefined && amount > maxAmount) {
    amount = money(maxAmount);
    basis.push(`订单上限封顶 ${maxAmount}`);
  }
  return { amount, basis };
}

/**
 * 应用押金/预授权减免（需求 4.4.7 line 526）。减免必须引用可信事实并由服务端算出目标金额，
 * 因此这里**只接受已由服务端依据 fact 计算好的 reducedTo**，且校验它不为负、不超过原额。
 * 客户端直接把最终金额塞进来的路径由调用方在受理减免请求时挡掉（见服务层）。
 */
export function applySecurityReduction(originalAmount: number, reduction: RentalSecurityReduction): number {
  if (!Number.isFinite(reduction.reducedTo)) {
    throw new ConflictException("减免目标金额无效");
  }
  if (reduction.reducedTo < 0) {
    throw new ConflictException("减免后的金额不能为负");
  }
  if (reduction.reducedTo > originalAmount) {
    throw new ConflictException("减免只能调低金额，不能高于原应收/冻结额");
  }
  return money(reduction.reducedTo);
}
