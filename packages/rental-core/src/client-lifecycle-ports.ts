/** 客户地址与本人注销的私有参加者。地址表、客户状态和Auth仍由宿主供给原实例。
 * 本MySQL存储视图不进入领域根合同，注销证明消费和后续状态处理保持原提交顺序。 */
import type { PrismaClient } from "@prisma/client";
import type { PlatformOperationLogService } from "@rental-os/platform-server/operation-log";
import type { ClientAccountClosurePreview } from "./client-contracts";
import type { ClientRequestContext } from "./client-context";
import type { RentalDeliveryServiceAreaPolicy } from "./contracts";

export type RentalClientAddressStorage = Pick<PrismaClient,
  "customerDeliveryAddress" | "clientOrderDeliverySnapshot" | "$transaction">;

export interface RentalClientDeliveryConfiguration {
  getBusinessSettings(tenantId: string): PromiseLike<{
    fulfillment: { deliveryServiceArea?: RentalDeliveryServiceAreaPolicy };
  }>;
}

export interface RentalClientClosureStorage<Transaction> {
  $transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
}

export interface RentalClientClosureAuthority<Transaction> {
  consumeClosureProof(transaction: Transaction, context: ClientRequestContext,
    loginIdentifier: string, verificationToken: string): Promise<void>;
  revokeSessions(tenantId: string, customerId: string): Promise<number>;
}

type CloseStatusRequest = { status: "closed"; reason: string; acknowledgedManualChecks: true };

export interface RentalClientClosureOperations {
  changeMembershipStatus(tenantId: string, customerId: string, input: CloseStatusRequest,
    operator: string): Promise<unknown>;
  changeAccountStatus(tenantId: string, customerId: string, input: CloseStatusRequest,
    operator: string): Promise<unknown>;
}

export interface RentalClientClosureGate {
  assertClosable(tenantId: string, customerId: string): Promise<Pick<ClientAccountClosurePreview,
    "closable" | "blockers" | "manualConfirmations">>;
}

export type RentalClientClosureAudit = Pick<PlatformOperationLogService, "record">;
