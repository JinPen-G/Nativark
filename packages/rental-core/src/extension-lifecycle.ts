/**
 * 续租申请的生命周期判据（需求 4.6.9）。
 *
 * 抽成纯函数是因为这两个判据**分散在三个文件里**：试算侧（rental-business.service）、
 * 申请侧（rental-core.service）与资金侧（rental-funding.service）。各写一遍的结果就是
 * Codex review #6 的前两条——试算说"不用补款"、资金侧却把它算进待收，两边对不上。
 */

/** 续租试算的金额部分，只取判断补款所需的四个字段。 */
export interface ExtensionPaymentInput {
  settlementMode: "immediate" | "monthly";
  payableAmount: number;
  depositDelta: number;
  preAuthDelta: number;
}

/**
 * 本次续租是否必须先补款才能生效。
 *
 * 押金与预授权差额同样算"要补的钱"：只看租金差额会让「租金不变、押金要补 100」的续租
 * 直接生效，那 100 从此收不回来——续租生效后押金应收额已经变了，却没有任何待收记录。
 *
 * 企业账期只豁免租赁费用补款，不豁免押金或预授权；所有直接生效路径仍须核对原资金缺口。
 */
export function extensionPaymentRequired(priced: ExtensionPaymentInput): boolean {
  return (priced.settlementMode === "immediate" && priced.payableAmount > 0)
    || priced.depositDelta > 0 || priced.preAuthDelta > 0;
}

/**
 * 订单处于该状态时，遗留的 `pending_payment` 续租是否还应计入待收金额。
 *
 * `settling` 起就不再计入：归还后 `payOrderExtension` 会因订单状态拒绝生效，那笔续租
 * 已经不可能成立，继续把它的应付算进待收等于给一笔不会发生的业务收钱，页面上还会出现
 * 一个点了必然失败的补款按钮。
 *
 * 大小写不敏感：Prisma 客户端返回枚举成员名（大写），库里存 `@map` 后的小写值，
 * 而领域对象用小写——同一个判据要能吃下这三种写法。
 */
export function pendingExtensionCountsAsDue(orderStatus: string): boolean {
  return !["settling", "completed", "cancelled"].includes(String(orderStatus).toLowerCase());
}
