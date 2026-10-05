import type { Prisma } from "@prisma/client";
import type { CreateRentalOrderRequest } from "@rental-os/shared";

export interface ApprovedOrderBinding {
  tenantId: string;
  workspaceId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  request: CreateRentalOrderRequest;
}

export interface ApprovedOrderTransaction {
  authorize(binding: Readonly<ApprovedOrderBinding>): Promise<void>;
  recover(binding: Readonly<ApprovedOrderBinding>): Promise<string | null>;
  prepare(tx: Prisma.TransactionClient, binding: Readonly<ApprovedOrderBinding>): Promise<void>;
  commit(tx: Prisma.TransactionClient, binding: Readonly<ApprovedOrderBinding>, orderId: string): Promise<void>;
  replay(binding: Readonly<ApprovedOrderBinding>, orderId: string): Promise<void>;
}
