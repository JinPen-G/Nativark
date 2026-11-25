/** The enterprise owner participates in the original Core transaction. It may
 * recheck and consume its approval; it cannot supply price/inspection authority. */
import type { ExecuteApprovedRentalExchangeRequest, RentalApprovedExchangeReceipt } from "./index";

export interface ApprovedExchangeBinding {
  tenantId: string;
  workspaceId: string;
  orderId: string;
  actorUserId: string;
  coreIdempotencyKey: string;
  requestHash: string;
  request: ExecuteApprovedRentalExchangeRequest;
}
export interface ApprovedExchangeTransaction<TTransaction = unknown> {
  prepare(tx: TTransaction, binding: Readonly<ApprovedExchangeBinding>): Promise<void>;
  commit(tx: TTransaction, binding: Readonly<ApprovedExchangeBinding>, receipt: Readonly<RentalApprovedExchangeReceipt>): Promise<void>;
  replay(tx: TTransaction, binding: Readonly<ApprovedExchangeBinding>, receipt: Readonly<RentalApprovedExchangeReceipt>): Promise<void>;
}
