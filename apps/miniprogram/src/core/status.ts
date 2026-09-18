/**
 * 客户可理解的订单状态（需求 §9.2）。
 *
 * 这是**展示分组**，不是另一套状态机：输入是服务端的订单状态、资金事实与续租事实，
 * 输出是给客户看的主状态、副状态与可见的操作入口。操作入口只是“显示与否”，
 * 每个动作真正能否执行仍以服务端预览/提交的结果为准。
 */
export type StatusGroup = "payment" | "confirmation" | "pickup" | "renting" | "returning" | "completed" | "closed";
export type OrderFilterKey = "all" | "unpaid" | "pickup" | "renting" | "finished";
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export interface FundingFacts {
  rental: { payable: number; collected: number; refunded: number; balance: number; pendingExtensionAmount?: number };
  deposit?: { requiredAmount: number; collected: number; refunded: number; balance: number };
  preauthorization?: { requiredAmount: number; frozen: number; released: number; balance: number };
}

export interface OrderFacts {
  status: string;
  startAt?: string;
  endAt?: string;
  effectiveEndAt?: string;
  currency?: string;
  funding?: FundingFacts;
  /** 是否存在待补款的续租申请。 */
  pendingExtension?: boolean;
  /** 用于逾期判断的“现在”（服务端校准时钟）。 */
  now?: number;
}

export interface OrderAction {
  code: "pay" | "cancel" | "extend" | "guide" | "contact";
  label: string;
}

export interface OrderPresentation {
  group: StatusGroup;
  label: string;
  hint: string;
  sub: string[];
  tone: Tone;
  isFinal: boolean;
  actions: OrderAction[];
  primary?: OrderAction;
  /** 待补款金额（>0）或待退款金额（<0），未知资金事实时为 undefined。 */
  balance?: number;
}

/** 订单 Tab（设计稿：全部 / 待支付 / 待取货 / 租赁中 / 已完成）。 */
export const ORDER_FILTERS: Array<{ key: OrderFilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "unpaid", label: "待支付" },
  { key: "pickup", label: "待取货" },
  { key: "renting", label: "租赁中" },
  { key: "finished", label: "已完成" }
];

const CANCELLABLE = new Set(["draft", "reserved", "pickup_overdue", "ready_for_pickup"]);
const EXTENDABLE = new Set(["ready_for_pickup", "renting"]);

function fundingSub(facts: OrderFacts): string[] {
  const sub: string[] = [];
  const balance = facts.funding?.rental.balance;
  if (balance !== undefined) {
    if (balance > 0) sub.push("待补款");
    if (balance < 0) sub.push("待退款");
  }
  if (facts.pendingExtension) sub.push("续租处理中");
  const deposit = facts.funding?.deposit;
  if (deposit && deposit.requiredAmount > 0 && deposit.collected < deposit.requiredAmount) sub.push("押金待办理");
  return sub;
}

export function presentOrder(facts: OrderFacts): OrderPresentation {
  const status = String(facts.status ?? "").toLowerCase();
  const balance = facts.funding?.rental.balance;
  const owes = balance !== undefined && balance > 0;
  const now = facts.now ?? Date.now();
  const effectiveEnd = facts.effectiveEndAt ?? facts.endAt;
  const overdue = status === "renting" && effectiveEnd ? Date.parse(effectiveEnd) < now : false;
  const sub = fundingSub(facts);
  const actions: OrderAction[] = [];
  const push = (code: OrderAction["code"], label: string) => actions.push({ code, label });

  let group: StatusGroup;
  let label: string;
  let hint: string;
  let tone: Tone = "info";
  let isFinal = false;

  switch (status) {
    case "draft":
      group = owes || balance === undefined ? "payment" : "confirmation";
      label = balance === undefined ? "待支付" : group === "payment" ? "待支付" : "待商户确认";
      hint = balance === undefined ? "付款并经商户确认后安排设备；详情页显示实际待付金额" : group === "payment" ? "付款后商户开始为你安排设备" : "商户确认后即可安排取件";
      tone = "warning";
      break;
    case "reserved":
      group = "confirmation";
      label = "待商户确认";
      hint = owes ? "还有待付款项，付款后商户继续备货" : "商户正在核对与备货，备齐后会通知你";
      break;
    case "pickup_overdue":
      group = "pickup";
      label = "待取货（已逾期）";
      hint = "已超过约定领取时间，请尽快联系商户确认是否仍可领取";
      tone = "danger";
      break;
    case "ready_for_pickup":
      group = "pickup";
      label = "待取货";
      hint = "请按约定时间到指定门店领取；实物交接由商户在现场完成";
      break;
    case "renting":
      group = "renting";
      label = "租赁中";
      hint = overdue ? "已超过约定归还时间，请尽快归还或申请续租" : "请在约定时间前归还，需要延长可申请续租";
      tone = overdue ? "danger" : "info";
      break;
    case "return_inspection":
      group = "returning";
      label = "待归还检查";
      hint = "商户正在检查已归还的设备，检查结果会在这里更新";
      break;
    case "settling":
      group = "returning";
      label = "待结算";
      hint = owes ? "有待补款项，付清后订单可完成结算" : "商户正在结算费用与押金";
      break;
    case "completed":
      group = "completed";
      label = "已完成";
      hint = balance !== undefined && balance < 0 ? "订单已完成，退款正在处理" : "感谢使用，欢迎再次租用";
      tone = "success";
      isFinal = true;
      break;
    case "cancelled":
      group = "closed";
      label = "已取消";
      hint = owes ? "订单已取消，但仍有取消费或已发生费用待支付" : balance !== undefined && balance < 0 ? "订单已取消，退款待商户处理" : "订单已取消";
      tone = "neutral";
      isFinal = true;
      break;
    case "no_show":
      group = "closed";
      label = "已爽约";
      hint = owes ? "未按约领取，仍有费用待支付" : "未按约领取，订单已关闭";
      tone = "neutral";
      isFinal = true;
      break;
    default:
      group = "confirmation";
      label = status || "状态待更新";
      hint = "订单状态以商户系统为准";
      tone = "neutral";
  }

  if (owes) push("pay", "去付款");
  if (CANCELLABLE.has(status)) push("cancel", "取消订单");
  if (EXTENDABLE.has(status)) push("extend", "申请续租");
  if (["reserved", "ready_for_pickup", "pickup_overdue", "renting"].includes(status)) push("guide", "取还指引");
  push("contact", "联系商户");

  const primary = actions.find((action) => action.code === "pay")
    ?? actions.find((action) => action.code === "extend" && overdue)
    ?? actions.find((action) => action.code === "guide")
    ?? actions.find((action) => action.code === "extend");

  return { group, label, hint, sub, tone, isFinal, actions, primary, balance };
}

export function matchesFilter(presentation: OrderPresentation, filter: OrderFilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unpaid":
      return presentation.group === "payment" || (presentation.balance !== undefined && presentation.balance > 0 && !presentation.isFinal);
    case "pickup":
      return presentation.group === "confirmation" || presentation.group === "pickup";
    case "renting":
      return presentation.group === "renting" || presentation.group === "returning";
    case "finished":
      return presentation.group === "completed" || presentation.group === "closed";
    default:
      return true;
  }
}
