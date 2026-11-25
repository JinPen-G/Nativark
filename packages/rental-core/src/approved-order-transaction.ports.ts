/** 原订单批准与商户委托的同事务参与合同。只关联原输入、原键及消费结果，当前权限由原参加者核验。
 * 事务由宿主实例化，合同不携带Prisma/框架类型；字段相同或JSON复制不能取得Core封存来源。 */
import type { CreateRentalOrderRequest } from "./contracts";

declare const merchantDelegationProofBrand: unique symbol;

/** Server-only proof injected by Core from its sealed single-submission source.
 * A matching K/request fingerprint alone never grants merchant delegation.
 * Runtime consumers must use Core's sealed-proof check; a cast or JSON clone
 * does not acquire provenance from this compile-time marker. */
export interface ApprovedOrderMerchantDelegation {
  readonly [merchantDelegationProofBrand]: true;
  version: "enterprise-order-delegation-1";
  purpose: "merchant_operator";
  delegationKey: string;
  sourceHash: string;
  basisHash: string;
  requestHash: string;
  quoteId: string;
  expectedRevision: number;
  personalCustomerId: string;
  corporateCustomerId: string;
  actorUserId: string;
}

export interface ApprovedOrderBinding {
  tenantId: string;
  workspaceId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  request: CreateRentalOrderRequest;
  /** Absent for original nondelegated approval flows; never copied from HTTP. */
  merchantDelegation?: Readonly<ApprovedOrderMerchantDelegation>;
}

export interface ApprovedOrderTransaction<TTransaction> {
  authorize(binding: Readonly<ApprovedOrderBinding>): Promise<void>;
  recover(binding: Readonly<ApprovedOrderBinding>): Promise<string | null>;
  prepare(tx: TTransaction, binding: Readonly<ApprovedOrderBinding>): Promise<void>;
  commit(tx: TTransaction, binding: Readonly<ApprovedOrderBinding>, orderId: string): Promise<void>;
  replay(binding: Readonly<ApprovedOrderBinding>, orderId: string): Promise<void>;
}
