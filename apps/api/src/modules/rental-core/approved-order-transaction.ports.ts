import type { Prisma } from "@prisma/client";
import type { CreateRentalOrderRequest } from "@rental-os/shared";

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

export interface ApprovedOrderTransaction {
  authorize(binding: Readonly<ApprovedOrderBinding>): Promise<void>;
  recover(binding: Readonly<ApprovedOrderBinding>): Promise<string | null>;
  prepare(tx: Prisma.TransactionClient, binding: Readonly<ApprovedOrderBinding>): Promise<void>;
  commit(tx: Prisma.TransactionClient, binding: Readonly<ApprovedOrderBinding>, orderId: string): Promise<void>;
  replay(binding: Readonly<ApprovedOrderBinding>, orderId: string): Promise<void>;
}
