/** 租户第三方服务配置复用公共唯一合同，租赁退款请求保留原业务入口。 */
export * from "@rental-os/platform-contracts/tenant-integrations";


/** 原支付业务合同由 Rental Core 单源提供，保持旧各端导入路径。 */
export type { CreatePaymentRefundRequest } from "@rental-os/rental-core";
