/** Rental订单确认的私有MySQL视图与实际业务参加者。
 * 客户主体、可交易状态和企业政策使用同一原服务及调用方事务，不默认成功或从报价恢复今日授权。 */
import type { CustomerOrderSubjectInput, CustomerOrderSubjects, CustomerTransactability, RentalQuoteSnapshotV1 } from "./contracts";
import type { ApprovedOrderBinding } from "./approved-order-transaction.ports";
import type { RentalCoreRuntimeTransaction, RentalCoreMemberships } from "./core-runtime-ports";
import type { RentalBusinessRuntimeTransaction, RentalBusinessMemberships } from "./business-runtime-ports";

export type RentalOrderConfirmationTransaction = RentalCoreRuntimeTransaction & RentalBusinessRuntimeTransaction;
export type RentalOrderConfirmationStorage<TTransaction extends RentalOrderConfirmationTransaction> = TTransaction & {
  $transaction<TResult>(run: (transaction: TTransaction) => Promise<TResult>,
    options?: { isolationLevel: "ReadCommitted"; maxWait?: number; timeout?: number }): Promise<TResult>;
};

/** 服务器原建单来源的同事务权威。begin 在首个 Tenant 锁前进入，
 * revalidate 在订单、报价和幂等收据全部写入后执行；不签发批准或另开事务。 */
export interface RentalOrderCreationBinding {
  tenantId: string;
  workspaceId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  request: import("./contracts").CreateRentalOrderRequest;
}
export interface RentalOrderCreationParticipant<TTransaction> {
  begin(transaction: TTransaction, binding: Readonly<RentalOrderCreationBinding>): Promise<{
    revalidate(): Promise<void>;
  }>;
}

export interface RentalOrderSubjectResolver<TTransaction> {
  lockOrderSubjectCustomers(tenantId: string, customerIds: readonly string[], transaction: TTransaction): Promise<void>;
  resolveOrderSubjects(tenantId: string, orderCustomerId: string, at: string,
    input?: CustomerOrderSubjectInput, transaction?: TTransaction): Promise<CustomerOrderSubjects>;
}

export interface RentalOrderCustomerOperations<TTransaction> {
  assertTransactable(tenantId: string, workspaceId: string, customerId: string): Promise<CustomerTransactability>;
  assertTransactableForNewBusiness(tenantId: string, workspaceId: string, customerId: string,
    transaction: TTransaction): Promise<CustomerTransactability>;
}

export type RentalOrderConfirmationMemberships<TTransaction> = RentalCoreMemberships<TTransaction>
  & Pick<RentalBusinessMemberships<TTransaction>, "resolveBookingIdentity">;

export interface RentalOrderConfirmationEnterprisePolicies<TTransaction> {
  assertOrderCreation(tenantId: string, workspaceId: string, quote: RentalQuoteSnapshotV1,
    transaction: TTransaction, binding?: Readonly<ApprovedOrderBinding>): Promise<unknown>;
}
