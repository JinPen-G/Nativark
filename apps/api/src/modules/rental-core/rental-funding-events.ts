import { BadRequestException, ConflictException } from "@nestjs/common";
import type {
  RentalFundingAction,
  RentalFundingEvent,
  RentalFundingInstrument
} from "@rental-os/shared";

/**
 * RULE-01B：模拟资金事件的余额推导与动作合法性（需求 4.4.7 line 527、4.6.3）。
 *
 * 抽成纯函数的理由：押金进的是**实收**、预授权是**冻结额度**，余额算错、或允许了不该允许的
 * 动作（把已释放的预授权又转扣一次）都直接影响客户资金。这类判定必须能脱离数据库逐条回放。
 *
 * 两条独立账：
 * - 押金余额 = 收取(initiate/append) − 抵扣(capture) − 退款(refund)。是当前实际持有的钱。
 * - 预授权余额 = 冻结(initiate/append) − 转扣(capture) − 释放(release)。是当前仍冻结的额度。
 * 失败(fail)只记事实、不动余额（需求 4.6.3：失败必须独立记录）。
 */

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export interface DepositLedger {
  collected: number;
  captured: number;
  refunded: number;
  balance: number;
}
export interface PreauthLedger {
  frozen: number;
  captured: number;
  released: number;
  balance: number;
}
export interface FundingLedgers {
  deposit: DepositLedger;
  preauthorization: PreauthLedger;
}

export interface PendingExtensionFundingRow {
  payableAmount: number;
  depositDelta: number;
  preAuthDelta: number;
}

export interface PendingExtensionFunding {
  payableAmount: number;
  depositAmount: number;
  preauthorizationAmount: number;
}

/**
 * 汇总尚未生效的续租资金要求。
 *
 * 即时续租在补款前不会推进订单的有效租期，但押金/预授权增量已经是本次
 * 申请要求收取或冻结的资金事实。统一从这里汇总，避免“租金能补、保证金
 * 却被当成 0”这种半完成状态。
 */
export function aggregatePendingExtensionFunding(
  rows: readonly PendingExtensionFundingRow[]
): PendingExtensionFunding {
  return {
    payableAmount: money(rows.reduce((sum, row) => sum + Number(row.payableAmount), 0)),
    depositAmount: money(rows.reduce((sum, row) => sum + Number(row.depositDelta), 0)),
    preauthorizationAmount: money(rows.reduce((sum, row) => sum + Number(row.preAuthDelta), 0))
  };
}

/** 哪些动作对哪个 instrument 合法。押金不能 release（实收的钱只能退款），预授权不能 refund。 */
const ALLOWED: Record<RentalFundingInstrument, ReadonlySet<RentalFundingAction>> = {
  rental: new Set<RentalFundingAction>(["initiate", "append", "refund", "fail"]),
  deposit: new Set<RentalFundingAction>(["initiate", "append", "capture", "refund", "fail"]),
  preauthorization: new Set<RentalFundingAction>(["initiate", "append", "capture", "release", "fail"])
};

export function assertActionApplies(instrument: RentalFundingInstrument, action: RentalFundingAction): void {
  if (!ALLOWED[instrument].has(action)) {
    if (instrument === "rental") throw new BadRequestException(`租金与费用不支持 ${action} 动作（只能登记收款、退款或失败）`);
    throw new BadRequestException(
      instrument === "deposit"
        ? `押金不支持 ${action} 动作（实收资金只能收取、抵扣、退款或标记失败，不能释放）`
        : `预授权不支持 ${action} 动作（冻结额度只能冻结、追加、转扣、释放或标记失败，不能退款）`
    );
  }
}

/** 从只追加事件流推导两条账的当前余额。事件顺序无关——各分量按动作求和。 */
export function deriveFundingLedgers(events: readonly RentalFundingEvent[]): FundingLedgers {
  const deposit: DepositLedger = { collected: 0, captured: 0, refunded: 0, balance: 0 };
  const preauth: PreauthLedger = { frozen: 0, captured: 0, released: 0, balance: 0 };
  for (const event of events) {
    if (event.action === "fail") continue; // 失败不改变余额
    if (event.instrument === "rental") continue;
    if (event.instrument === "deposit") {
      if (event.action === "initiate" || event.action === "append") deposit.collected += event.amount;
      else if (event.action === "capture") deposit.captured += event.amount;
      else if (event.action === "refund") deposit.refunded += event.amount;
    } else {
      if (event.action === "initiate" || event.action === "append") preauth.frozen += event.amount;
      else if (event.action === "capture") preauth.captured += event.amount;
      else if (event.action === "release") preauth.released += event.amount;
    }
  }
  deposit.collected = money(deposit.collected);
  deposit.captured = money(deposit.captured);
  deposit.refunded = money(deposit.refunded);
  deposit.balance = money(deposit.collected - deposit.captured - deposit.refunded);
  preauth.frozen = money(preauth.frozen);
  preauth.captured = money(preauth.captured);
  preauth.released = money(preauth.released);
  preauth.balance = money(preauth.frozen - preauth.captured - preauth.released);
  return { deposit, preauthorization: preauth };
}

/**
 * 校验一个新动作并返回该 instrument 在动作后的余额。不合法则抛错，绝不产出负余额或超额。
 *
 * - initiate：要求当前该 instrument 尚无余额（不能对同一订单重复发起，追加请用 append）。
 * - append：要求已发起（余额 > 0 或已有收取/冻结记录）。
 * - capture/refund/release：金额不得超过当前余额。
 * - fail：金额只作记录，余额不变。
 */
export function nextBalanceAfter(
  instrument: RentalFundingInstrument,
  action: RentalFundingAction,
  amount: number,
  ledgers: FundingLedgers
): number {
  assertActionApplies(instrument, action);
  if (action !== "fail") {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException("资金事件金额必须为正数");
    }
  }
  const isDeposit = instrument === "deposit";
  const ledger = isDeposit ? ledgers.deposit : ledgers.preauthorization;
  const originated = isDeposit ? ledgers.deposit.collected > 0 : ledgers.preauthorization.frozen > 0;

  switch (action) {
    case "initiate":
      if (originated) {
        throw new ConflictException(
          isDeposit ? "该订单押金已发起，追加请用 append" : "该订单预授权已冻结，追加请用 append"
        );
      }
      return money(amount);
    case "append":
      if (!originated) {
        throw new ConflictException(isDeposit ? "押金尚未发起，不能追加" : "预授权尚未冻结，不能追加");
      }
      return money(ledger.balance + amount);
    case "capture":
    case "refund":
    case "release":
      if (amount > ledger.balance + 1e-9) {
        throw new ConflictException(
          `${action} 金额 ${amount} 超过当前${isDeposit ? "押金" : "预授权"}余额 ${ledger.balance}`
        );
      }
      return money(ledger.balance - amount);
    case "fail":
      return money(ledger.balance); // 失败不动余额
    default:
      throw new BadRequestException(`未知资金动作 ${action as string}`);
  }
}

/** 应付与实收严格分离；负余额表示尚欠客户退款，不得当成已结清。 */
export function rentalPaymentBalance(payable: number, events: readonly RentalFundingEvent[]) {
  const collected = money(events.filter(e => e.instrument === "rental" && ["initiate", "append"].includes(e.action)).reduce((sum, e) => sum + e.amount, 0));
  const refunded = money(events.filter(e => e.instrument === "rental" && e.action === "refund").reduce((sum, e) => sum + e.amount, 0));
  const securityCaptured = money(events.filter(e => e.instrument !== "rental" && e.action === "capture").reduce((sum, e) => sum + e.amount, 0));
  return { payable, collected, refunded, securityCaptured, balance: money(payable - collected + refunded - securityCaptured) };
}
