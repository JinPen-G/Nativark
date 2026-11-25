/** 企业预约、费用批准与商户委托的私有参加者。
 * 宿主供给原客户API、当前身份和同一业务事务；这些类型不授予读写权限。
 * 仅MySQL适配使用生成模型，公共Core清单与领域根出口不加载本链。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ClientRequestContext } from "./client-context";
import type { ClientCatalogResponse, ClientCreateOrderRequest } from "./client-contracts";
import type { CreateRentalOrderRequest, RentalOrder, RentalOrderExtension } from "./contracts";
import type { EnterpriseOrderOriginalResult } from "./enterprise-policy";
import type { ClientOrderExtensionRequest } from "./client-order-requests";
import type { ApprovedOrderTransaction } from "./approved-order-transaction.ports";
import type { ApprovedExchangeTransaction } from "./approved-exchange-ports";
import type { ApprovedExtensionBinding, EnterpriseExtensionPrice } from "./approved-extension-ports";
import type { RentalOrderConfirmationService } from "./mysql-order-confirmation";
import type { RentalCoreService } from "./mysql-core-runtime";
import type { RentalBusinessService } from "./mysql-business-runtime";
import type { RentalBusinessFactRepository } from "./mysql-business-facts";
import type { RentalExchangePreviewService } from "./mysql-exchange-preview";
import type { RentalExchangeInspectionPreparationService } from "./mysql-exchange-inspection-preparation";
import type { RentalIdempotencyRepository } from "./mysql-idempotency";
import type { RentalIdempotentActionService } from "./mysql-idempotent-actions";

export type RentalEnterpriseApprovedOrderTransaction = ApprovedOrderTransaction<Prisma.TransactionClient>;
export type RentalEnterpriseApprovedExchangeTransaction = ApprovedExchangeTransaction<Prisma.TransactionClient>;

export type RentalEnterpriseApprovalStorage = Pick<PrismaClient, "$queryRaw" | "$executeRaw" | "$transaction"
  | "organizationUnit" | "rentalFulfillmentLocation">;
export type RentalEnterpriseApprovalOrders = Pick<RentalOrderConfirmationService<Prisma.TransactionClient>,
  "assertOrderMatchesQuote" | "fingerprintOrderRequest" | "assertApprovedExecutionCanClose"
  | "createApprovedOrder" | "readOrderCreation">;
export type RentalEnterpriseApprovalCore = Pick<RentalCoreService<Prisma.TransactionClient>,
  "lockOrderForUpdate" | "listOrderExtensions" | "listOrderChanges" | "readBusinessContext">;
export type RentalEnterpriseApprovalBusiness = Pick<RentalBusinessService<Prisma.TransactionClient>, "refreshWorkspaceContext">;
export type RentalEnterpriseApprovalFacts = Pick<RentalBusinessFactRepository<Prisma.TransactionClient>, "findQuote">;
export type RentalEnterpriseApprovalPrices = Pick<RentalExchangePreviewService<Prisma.TransactionClient>, "choices" | "preview">;
export type RentalEnterpriseApprovalInspections = RentalExchangeInspectionPreparationService<Prisma.TransactionClient>;
export type RentalEnterpriseApprovalReceipts = Pick<RentalIdempotentActionService<Prisma.TransactionClient>, "executeInTransaction" | "readReceipt">;
export type RentalEnterpriseApprovalIdempotency = Pick<RentalIdempotencyRepository<Prisma.TransactionClient>, "find">;

interface AcceptedBooking { tenantId: string; workspaceId: string; customerId: string; request: CreateRentalOrderRequest }
export interface RentalEnterpriseBookingClient {
  prepareOrderSubmission(context: ClientRequestContext, input: ClientCreateOrderRequest): Promise<AcceptedBooking & {
    requestHash: string; execution: "not_submitted"; inventory: "not_reserved";
  }>;
  readEnterpriseOrderOriginal(context: ClientRequestContext, quoteId: string, operationKey: string): Promise<EnterpriseOrderOriginalResult>;
  readOrderSubmission(context: ClientRequestContext, accepted: AcceptedBooking, operationKey: string, committedOrderId?: string):
    ReturnType<RentalOrderConfirmationService<Prisma.TransactionClient>["readOrderCreation"]>;
  executeApprovedSubmission(context: ClientRequestContext, accepted: AcceptedBooking, operationKey: string, participant: RentalEnterpriseApprovedOrderTransaction):
    Promise<{ orderId: string; replayed: boolean }>;
}
export interface RentalEnterpriseExtensionClient {
  prepareEnterpriseExtension(context: ClientRequestContext, orderId: string, input: ClientOrderExtensionRequest, transaction: Prisma.TransactionClient):
    Promise<{ order: RentalOrder; priced: EnterpriseExtensionPrice }>;
  assertEnterpriseExtensionPrice(tenantId: string, order: RentalOrder, input: ClientOrderExtensionRequest, priced: EnterpriseExtensionPrice, transaction: Prisma.TransactionClient): Promise<void>;
  executeEnterpriseExtension(context: ClientRequestContext, orderId: string, input: ClientOrderExtensionRequest, priced: EnterpriseExtensionPrice, binding: ApprovedExtensionBinding, transaction: Prisma.TransactionClient):
    Promise<{ orderId: string; extensionId: string; extensionState: RentalOrderExtension["status"] }>;
  listExtensions(context: ClientRequestContext, orderId: string): Promise<RentalOrderExtension[]>;
}
export interface RentalEnterpriseExchangeClient {
  catalog(context: ClientRequestContext): Promise<ClientCatalogResponse>;
  getOrder(context: ClientRequestContext, orderId: string): Promise<{ id: string }>;
}
