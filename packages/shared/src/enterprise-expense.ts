/** Additional enterprise spending is bound to an original Core preview, not an old
 * booking approval. Approval/creation/payment remain separate business stages. */
import type { ClientCatalogResponse, ClientOrderExtensionRequest, ClientQuoteServiceRequest } from "./client";
import { RENTAL_SERVICE_BILLING_UNITS, type RentalOrderExtensionPreview, type RentalQuoteServiceSnapshot } from "./core";
import type { EnterpriseChangeRequest } from "./enterprise-workflows";
export interface EnterpriseExtensionEligibility {
  orderId: string;
  expectedOrderUpdatedAt: string;
  approvalRequired: boolean;
  corporateCustomerId?: string;
}
export interface RequestEnterpriseExtensionApproval extends EnterpriseChangeRequest {
  orderId: string;
  expectedOrderUpdatedAt: string;
  extension: ClientOrderExtensionRequest;
}
export type EnterpriseExtensionService = Pick<RentalQuoteServiceSnapshot, "serviceId" | "serviceName" | "serviceVersion" | "quantity" | "amount" | "billingUnit"
  | "scheduledStartAt" | "scheduledEndAt" | "serviceLocationId" | "termsVersion" | "terms" | "requiredByRule">;
export type EnterpriseExtensionServiceDetails = { state: "available"; items: EnterpriseExtensionService[] } | { state: "unavailable" };

/** Preserve the original service facts, including an observed empty collection. */
export function enterpriseExtensionServiceDetails(value: unknown): EnterpriseExtensionServiceDetails {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row)
    || ["serviceId", "serviceName", "serviceVersion", "serviceLocationId", "termsVersion", "terms"].some(field => typeof row[field] !== "string")
    || !row.serviceId || !row.serviceName || !row.serviceVersion || !row.termsVersion || !Number.isSafeInteger(row.quantity) || row.quantity < 1
    || !Number.isFinite(row.amount) || !RENTAL_SERVICE_BILLING_UNITS.includes(row.billingUnit) || typeof row.requiredByRule !== "boolean"
    || typeof row.scheduledStartAt !== "string" || typeof row.scheduledEndAt !== "string"
    || !Number.isFinite(Date.parse(row.scheduledStartAt)) || !Number.isFinite(Date.parse(row.scheduledEndAt))
    || Date.parse(row.scheduledStartAt) >= Date.parse(row.scheduledEndAt))) return { state: "unavailable" };
  return { state: "available", items: value.map(row => ({ serviceId: row.serviceId, serviceName: row.serviceName, serviceVersion: row.serviceVersion,
    quantity: row.quantity, amount: row.amount, billingUnit: row.billingUnit, scheduledStartAt: row.scheduledStartAt,
    scheduledEndAt: row.scheduledEndAt, serviceLocationId: row.serviceLocationId, termsVersion: row.termsVersion, terms: row.terms, requiredByRule: row.requiredByRule })) };
}

/** New selection intent uses the original published customer catalog. Core owns eligibility and pricing. */
export function enterpriseExtensionServiceRequests(value: unknown, catalog: Pick<ClientCatalogResponse, "services" | "locations">): ClientQuoteServiceRequest[] {
  if (!Array.isArray(value) || value.length > 100 || !Array.isArray(catalog.services) || !Array.isArray(catalog.locations)
    || value.some(row => !row || typeof row !== "object" || Array.isArray(row)
      || Object.keys(row).some(field => !["serviceId", "quantity", "scheduledStartAt", "scheduledEndAt", "serviceLocationId"].includes(field))
      || !catalog.services.some(service => service.enabled && service.id === row.serviceId)
      || !Number.isSafeInteger(row.quantity) || row.quantity < 1
      || row.serviceLocationId !== undefined && !catalog.locations.some(location => location.status === "enabled" && location.id === row.serviceLocationId)
      || (row.scheduledStartAt !== undefined || row.scheduledEndAt !== undefined)
        && (typeof row.scheduledStartAt !== "string" || typeof row.scheduledEndAt !== "string"
          || !Number.isFinite(Date.parse(row.scheduledStartAt)) || !Number.isFinite(Date.parse(row.scheduledEndAt))
          || Date.parse(row.scheduledStartAt) >= Date.parse(row.scheduledEndAt)))) throw new Error("须重新核对原公开服务、数量、独立时段和地点 / Review published services, quantities, time ranges and locations");
  return value.map(row => ({ serviceId: row.serviceId, quantity: row.quantity,
    ...(row.scheduledStartAt !== undefined ? { scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt } : {}),
    ...(row.serviceLocationId !== undefined ? { serviceLocationId: row.serviceLocationId } : {}) }));
}
export function enterpriseExtensionServiceSelectionKey(services: ClientQuoteServiceRequest[], catalog: ClientCatalogResponse): string {
  const selected = enterpriseExtensionServiceRequests(services, catalog);
  return JSON.stringify({ tenantCode: catalog.tenantCode, workspaceCode: catalog.workspace.workspaceCode, timeZone: catalog.timeZone,
    services: selected.map(request => ({ request, service: catalog.services.find(service => service.id === request.serviceId),
      location: request.serviceLocationId ? catalog.locations.find(location => location.id === request.serviceLocationId) : undefined })) });
}

export interface EnterpriseExtensionApprovalView {
  id: string;
  corporateCustomerId: string;
  applicantCustomerId: string;
  workspaceId: string;
  orderId: string;
  expectedOrderUpdatedAt: string;
  state: "pending" | "approved" | "rejected" | "withdrawn" | "expired" | "consumed" | "closed";
  revision: number;
  expiresAt: string;
  reason: string;
  preview: Pick<RentalOrderExtensionPreview, "originalEndAt" | "newEndAt" | "rentalAmount" | "serviceAmount" | "depositDelta" | "preAuthDelta" | "payableAmount" | "currency" | "settlementMode" | "paymentRequired"> & {
    chargeLines: Array<Pick<RentalOrderExtensionPreview["chargeLines"][number], "code" | "name" | "type" | "amount">>;
    services?: EnterpriseExtensionServiceDetails;
  };
  extensionId?: string;
  closedOperationKey?: string;
}
export interface DecideEnterpriseExtensionApproval extends EnterpriseChangeRequest {
  decision: "approve" | "reject" | "withdraw";
}
export interface SubmitEnterpriseExtensionApproval extends EnterpriseChangeRequest {
  approvalId: string;
  confirm: true;
}
export interface CloseEnterpriseExtensionExecution extends EnterpriseChangeRequest {
  originalOperationKey: string;
  confirm: true;
}
export interface CloseEnterpriseExtensionRequest extends EnterpriseChangeRequest {
  expectedRevision: 0;
  confirm: true;
}
export type EnterpriseExpenseRequestOriginalResult<Approval extends { id: string; orderId: string; workspaceId: string; applicantCustomerId: string }> =
  | { state: "not_recorded"; retryable: false }
  | { state: "observed"; approval: Approval; retryable: false }
  | { state: "closed"; orderId: string; workspaceId: string; workspaceCode: string; applicantCustomerId: string; closedOperationKey: string; retryable: false };
export type EnterpriseExtensionRequestOriginalResult = EnterpriseExpenseRequestOriginalResult<EnterpriseExtensionApprovalView>;
/** Original-key and closure-key receipts are separate; neither authorizes a new rental. */
export type EnterpriseExtensionRequestClosureReceipt = {
  orderId: string; workspaceId: string; workspaceCode: string; applicantCustomerId: string;
  originalOperationKey: string; closureOperationKey: string; retryable: false;
} & ({ state: "closed" } | { state: "observed"; approvalId: string });
export type EnterpriseExtensionRecoveryResult = EnterpriseExtensionOriginalResult | Extract<EnterpriseExtensionRequestOriginalResult, { state: "closed" }>;
export function enterpriseExpenseRequestMatches(result: EnterpriseExpenseRequestOriginalResult<{ id: string; orderId: string; workspaceId: string; applicantCustomerId: string }>, orderId: string, key: string, customerId: string, workspaceCode: string): boolean {
  if (result.retryable !== false) return false;
  if (result.state === "closed") return result.orderId === orderId && result.closedOperationKey === key && result.applicantCustomerId === customerId
    && Boolean(result.workspaceId) && result.workspaceCode === workspaceCode;
  return result.state === "observed" && Boolean(result.approval.id) && result.approval.orderId === orderId && result.approval.applicantCustomerId === customerId && Boolean(result.approval.workspaceId);
}
export function enterpriseExpenseRequestClosureMatches(result: EnterpriseExpenseRequestOriginalResult<{ id: string; orderId: string; workspaceId: string; applicantCustomerId: string }>, receipt: Record<string, unknown> | undefined, key: string, closureKey: string): boolean {
  if (!receipt || receipt.retryable !== false || receipt.originalOperationKey !== key || receipt.closureOperationKey !== closureKey) return false;
  const subject = result.state === "observed" ? result.approval : result.state === "closed" ? result : undefined;
  return Boolean(subject && receipt.orderId === subject.orderId && receipt.workspaceId === subject.workspaceId && receipt.applicantCustomerId === subject.applicantCustomerId
    && (result.state === "closed" ? receipt.state === "closed" && receipt.workspaceCode === result.workspaceCode : result.state === "observed" && receipt.state === "observed" && receipt.approvalId === result.approval.id));
}
export const enterpriseExtensionRequestMatches = enterpriseExpenseRequestMatches;
export const enterpriseExtensionRequestClosureMatches = enterpriseExpenseRequestClosureMatches;
export interface EnterpriseExtensionOriginalResult {
  approval: EnterpriseExtensionApprovalView;
  original: { state: "not_submitted" | "closed"; retryable: false } | { state: "observed"; extensionId: string; extensionState: string; retryable: false };
  retryable: false;
}
