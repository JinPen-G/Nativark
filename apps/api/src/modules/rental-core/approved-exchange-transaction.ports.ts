/** The enterprise owner participates in the original Core transaction. It may
 * recheck and consume its approval; it cannot supply price/inspection authority. */
import type { Prisma } from "@prisma/client";
import type { ExecuteApprovedRentalExchangeRequest, RentalApprovedExchangeReceipt } from "@rental-os/shared";

export interface ApprovedExchangeBinding {
  tenantId: string;
  workspaceId: string;
  orderId: string;
  actorUserId: string;
  coreIdempotencyKey: string;
  requestHash: string;
  request: ExecuteApprovedRentalExchangeRequest;
}
export interface ApprovedExchangeTransaction {
  prepare(tx: Prisma.TransactionClient, binding: Readonly<ApprovedExchangeBinding>): Promise<void>;
  commit(tx: Prisma.TransactionClient, binding: Readonly<ApprovedExchangeBinding>, receipt: Readonly<RentalApprovedExchangeReceipt>): Promise<void>;
  replay(tx: Prisma.TransactionClient, binding: Readonly<ApprovedExchangeBinding>, receipt: Readonly<RentalApprovedExchangeReceipt>): Promise<void>;
}
