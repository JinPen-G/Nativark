/** 租户第三方服务配置复用公共唯一合同，租赁退款请求保留原业务入口。 */
export * from "@rental-os/platform-contracts/tenant-integrations";

/** EXT-01D：真实支付退款申请。只允许引用订单资金事实形成的待退余额。 */
export interface CreatePaymentRefundRequest {
  amount: number;
  reason: string;
  idempotencyKey: string;
}
