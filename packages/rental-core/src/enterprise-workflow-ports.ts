/** 企业待办与行政交接的私有参加者，只读取原批准和原订单材料。
 * 宿主传入同一业务实例与事务；这里只声明已使用的方法，不产生授权或重新执行业务。 */
import type { Prisma } from "@prisma/client";
import type { ClientRequestContext } from "./client-context";
import type { EnterpriseRentalHandoffMaterial } from "./enterprise-workflows";
import type { EnterpriseBookingApprovalView } from "./enterprise-policy";
import type { EnterpriseExtensionApprovalView } from "./enterprise-expense";
import type { EnterpriseExchangeApprovalView } from "./enterprise-exchange";

export interface RentalEnterpriseBookingApprovalReader {
  list(context: ClientRequestContext, corporateId?: string): Promise<EnterpriseBookingApprovalView[]>;
}

export interface RentalEnterpriseExtensionApprovalReader {
  list(context: ClientRequestContext, corporateId?: string): Promise<EnterpriseExtensionApprovalView[]>;
}

export interface RentalEnterpriseExchangeApprovalReader {
  list(context: ClientRequestContext, corporateId?: string): Promise<EnterpriseExchangeApprovalView[]>;
}

export interface RentalEnterpriseHandoffClient {
  rentalHandoffMaterial(context: ClientRequestContext, orderId: string, tx?: Prisma.TransactionClient): Promise<EnterpriseRentalHandoffMaterial>;
}
