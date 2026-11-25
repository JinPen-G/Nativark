/** Rental资金事实的私有MySQL视图与宿主接点；保留原事务和授权来源，不派发外部支付。 */
import type { Prisma } from "@prisma/client";
import type { RentalFundingEvent } from "./contracts";
import type { RentalFactIdentity } from "./fact-request-context";

export type RentalFundingTransaction = Pick<Prisma.TransactionClient,
  "$queryRaw" | "rentalOrder" | "rentalFundingEvent" | "rentalOfflinePaymentRegistration"
  | "businessWorkspace" | "rentalPaymentIntent" | "rentalOrderExtension" | "operationLog" | "fileAsset">;

export interface RentalFundingStorage<TTransaction extends RentalFundingTransaction> extends RentalFundingTransaction {
  $transaction<T>(
    run: (transaction: TTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" | "RepeatableRead"; maxWait?: number; timeout?: number }
  ): PromiseLike<T>;
}

export interface RentalFundingIdentity extends RentalFactIdentity {
  isPlatformAdmin?: boolean;
  staffApi?: boolean;
  permissions?: readonly string[];
  locationScope?: { mode: "all" | "selected"; locationIds: string[] };
}

export interface RentalFundingRequestContext {
  /** 返回原完整已验证对象；指纹复验涵盖其全部字段，不按接口字段投影。 */
  getRequestIdentity(): RentalFundingIdentity | undefined;
  /** 每次按原当前角色与地点/组织范围生成，不缓存为持续授权。 */
  requestRentalOrderVisibilityWhere(): Prisma.RentalOrderWhereInput;
}

export interface RentalFundingOrderReference {
  membershipSnapshot?: unknown;
  payerSubjectCustomerId?: string | null;
  contractSubjectCustomerId?: string | null;
  currency?: string;
}

/** 原企业应收域处理回款分配与现金核销；分配不冒充现金，缺接点时沿原规则拒绝。 */
export interface RentalFundingReceivables<TTransaction extends RentalFundingTransaction> {
  corporatePaid(
    tenantId: string, workspaceId: string, orderId: string,
    order: RentalFundingOrderReference, transaction?: TTransaction
  ): PromiseLike<number>;
  reconcileCash(
    tenantId: string, workspaceId: string, orderId: string,
    event: RentalFundingEvent, events: readonly RentalFundingEvent[], transaction: TTransaction
  ): PromiseLike<unknown>;
}
