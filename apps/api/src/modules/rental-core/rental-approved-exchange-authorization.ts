/** Core verifies original expense, prepared inspection and using-customer
 * receipts. The resulting authority is bound to one live transaction and cannot
 * be supplied as JSON, a UI flag or a permissive participant callback. */
import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { rentalExchangePreviewComparable, type ApplyRentalOrderChangeRequest, type EnterpriseBookingBasis, type EnterpriseExchangeIntent, type RentalExchangeInspectionConsent,
  type RentalExchangeInspectionPreparation, type RentalOrder, type RentalOrderChangePreview } from "@rental-os/shared";
import { EnterprisePolicyService } from "../enterprise/enterprise-policy.service";
import { getRequestUserId } from "../../common/request-identity";
import type { ApprovedExchangeBinding } from "./approved-exchange-transaction.ports";
import { exchangeInspectionCustomerMaterial, readExchangeInspectionConsent, type ExchangeInspectionConsentRow } from "./rental-exchange-inspection-consent.service";
import { requestFingerprint } from "./rental-idempotency.repository";
import { hasOriginalRentalCurrency } from "./rental-money";

interface ApprovalRow {
  tenantId: string; workspaceId: string; id: string; orderId: string; corporateCustomerId: string; applicantCustomerId: string;
  state: string; revision: number; expectedOrderUpdatedAt: string; requestFingerprint: string; previewFingerprint: string;
  request: EnterpriseExchangeIntent | string; preview: RentalOrderChangePreview | string; basis: EnterpriseBookingBasis | string; expiresAt: Date;
  approvedBy: string | null; reviewerMembershipId: string | null; reviewerMembershipUpdatedAt: Date | null;
  employeeConfirmationOperationKey: string | null; employeeConfirmedAt: Date | null; employeeConfirmationFingerprint: string | null;
}
export interface ApprovedExchangeAuthority { readonly kind: "verified_core_exchange" }
interface AuthorityFacts {
  tx: Prisma.TransactionClient; binding: ApprovedExchangeBinding; input: ApplyRentalOrderChangeRequest & { type: "post_pickup_exchange" };
  preparation: RentalExchangeInspectionPreparation; consent: RentalExchangeInspectionConsent;
  order: RentalOrder; previewHash: string; approvalHash: string;
}
const authorities = new WeakMap<ApprovedExchangeAuthority, AuthorityFacts>();
const decode = <T>(value: T | string): T => {
  try { return typeof value === "string" ? JSON.parse(value) as T : value; }
  catch { throw new ConflictException("原换货批准快照不可读取"); }
};
export function approvedExchangeComparablePreview(preview: RentalOrderChangePreview) {
  return rentalExchangePreviewComparable(preview);
}
const iso = (value: Date | null) => {
  if (value === null) return undefined;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ConflictException("原批准或费用确认时间不可核验");
  return value.toISOString();
};
const approvalHash = (row: ApprovalRow) => requestFingerprint({ id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, orderId: row.orderId,
  corporateCustomerId: row.corporateCustomerId, applicantCustomerId: row.applicantCustomerId, expectedOrderUpdatedAt: row.expectedOrderUpdatedAt,
  requestFingerprint: row.requestFingerprint, previewFingerprint: row.previewFingerprint, request: decode(row.request), preview: decode(row.preview), basis: decode(row.basis),
  expiresAt: iso(row.expiresAt), approvedBy: row.approvedBy, reviewerMembershipId: row.reviewerMembershipId,
  reviewerMembershipUpdatedAt: iso(row.reviewerMembershipUpdatedAt), employeeConfirmationOperationKey: row.employeeConfirmationOperationKey,
  employeeConfirmedAt: iso(row.employeeConfirmedAt), employeeConfirmationFingerprint: row.employeeConfirmationFingerprint });

async function verifyOriginalExpenseConfirmation(tx: Prisma.TransactionClient, row: ApprovalRow, revision: number) {
  const rows = await tx.$queryRaw<Array<{ actorUserId: string; target: string; requestHash: string; result: object | string }>>`SELECT actorUserId,target,requestHash,result
    FROM enterprise_portal_operations WHERE tenantId=${row.tenantId} AND operationKey=${row.employeeConfirmationOperationKey} LOCK IN SHARE MODE`;
  const receipt = rows[0], result = receipt && decode(receipt.result) as Record<string, unknown> | undefined;
  if (rows.length !== 1 || receipt.actorUserId !== `customer:${row.applicantCustomerId}` || receipt.target !== `exchange.expense.confirm:${row.id}`
    || typeof receipt.requestHash !== "string" || receipt.requestHash.length !== 64 || !/^[a-f0-9]{64}$/u.test(receipt.requestHash)
    || result?.id !== row.id || result.orderId !== row.orderId || result.workspaceId !== row.workspaceId || result.applicantCustomerId !== row.applicantCustomerId
    || result.operationKey !== row.employeeConfirmationOperationKey || result.confirmedAt !== iso(row.employeeConfirmedAt)
    || result.revision !== revision || result.scope !== "expense_only_not_inspection_or_execution") {
    throw new ConflictException("本人原费用确认收据缺失或与本次批准不同");
  }
}

async function approval(tx: Prisma.TransactionClient, policies: EnterprisePolicyService, binding: ApprovedExchangeBinding, order: RentalOrder,
  state: "approved" | "consumed", revision: number) {
  const snapshot = order.membershipSnapshot;
  if (order.id !== binding.orderId || order.tenantId !== binding.tenantId || snapshot?.bookingIdentity !== "enterprise_employee"
    || !snapshot.enterpriseContractAndPayer || !snapshot.corporateCustomerId || !snapshot.corporateMembershipId || !snapshot.personalCustomerId) {
    throw new ForbiddenException("本接点只执行原企业承担订单的本次换货批准");
  }
  const rows = await tx.$queryRaw<ApprovalRow[]>`SELECT * FROM enterprise_exchange_approvals WHERE tenantId=${binding.tenantId}
    AND workspaceId=${binding.workspaceId} AND orderId=${order.id} AND id=${binding.request.approvalId} FOR UPDATE`;
  const row = rows[0];
  if (rows.length !== 1 || row.tenantId !== binding.tenantId || row.workspaceId !== binding.workspaceId || row.id !== binding.request.approvalId
    || row.orderId !== order.id || row.corporateCustomerId !== snapshot.corporateCustomerId || row.applicantCustomerId !== snapshot.personalCustomerId
    || row.state !== state || row.revision !== revision || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt <= new Date()
    || row.expectedOrderUpdatedAt !== binding.request.expectedOrderUpdatedAt) throw new ConflictException("原换货批准、修订、订单或人员关联已变化");
  const current = await policies.revalidateOrderExpense(binding.tenantId, binding.workspaceId, order, tx);
  if (!current) throw new ForbiddenException("当前企业新支出政策缺少可信依据");
  policies.assertSameBasis(decode(row.basis), current);
  const original = decode(row.preview), request = decode(row.request);
  if (!original || !request || row.requestFingerprint !== requestFingerprint({ orderId: row.orderId, expected: row.expectedOrderUpdatedAt, exchange: request })
    || row.previewFingerprint !== requestFingerprint(original) || !Number.isFinite(original.additionalAmount) || original.additionalAmount <= 0
    || !hasOriginalRentalCurrency(order.currency, original.currency) || original.depositDelta !== 0 || original.preAuthDelta !== 0) {
    throw new ConflictException("本次换货批准缺少原金额/币种依据或尚不支持的保证金变化");
  }
  const confirmation = requestFingerprint({ approvalId: row.id, orderId: row.orderId, workspaceId: row.workspaceId, applicantCustomerId: row.applicantCustomerId,
    requestFingerprint: row.requestFingerprint, previewFingerprint: row.previewFingerprint, basis: decode(row.basis), approvedBy: row.approvedBy,
    reviewerMembershipId: row.reviewerMembershipId, reviewerMembershipUpdatedAt: row.reviewerMembershipUpdatedAt?.toISOString() });
  if (!row.employeeConfirmationOperationKey || !(row.employeeConfirmedAt instanceof Date) || !Number.isFinite(row.employeeConfirmedAt.getTime())
    || row.employeeConfirmationFingerprint !== confirmation || row.employeeConfirmedAt > new Date()) throw new ForbiddenException("本人尚未确认本次原费用明细，旧订单批准不能替代");
  await verifyOriginalExpenseConfirmation(tx, row, binding.request.expectedApprovalRevision);
  await policies.assertQuoteAmount(binding.tenantId, row.corporateCustomerId, snapshot.corporateMembershipId,
    { currency: original.currency, payableAmount: original.additionalAmount }, tx);
  await policies.assertReviewer(binding.tenantId, row.corporateCustomerId, row.applicantCustomerId, row.approvedBy,
    row.reviewerMembershipId, row.reviewerMembershipUpdatedAt, tx);
  return { row, original, request };
}

export async function verifyApprovedExchange(tx: Prisma.TransactionClient, policies: EnterprisePolicyService, binding: ApprovedExchangeBinding,
  order: RentalOrder, preview: RentalOrderChangePreview, preparation: RentalExchangeInspectionPreparation) {
  const { row, original, request } = await approval(tx, policies, binding, order, "approved", binding.request.expectedApprovalRevision);
  const choice = { orderLineId: preparation.exchange.orderLineId, allocationId: preparation.exchange.allocationId,
    replacementItemGroupId: preparation.exchange.replacementItemGroupId, priceBasis: preparation.exchange.priceBasis,
    ...(preparation.exchange.replacementAssetId ? { replacementAssetId: preparation.exchange.replacementAssetId } : {}),
    ...(request.replacementPricingGroupId ? { replacementPricingGroupId: preparation.exchange.replacementPricingGroupId } : {}) };
  if (preparation.id !== binding.request.preparationId || preparation.workspaceId !== binding.workspaceId || preparation.orderId !== binding.orderId
    || preparation.actorUserId !== binding.actorUserId || preparation.expectedOrderUpdatedAt !== binding.request.expectedOrderUpdatedAt
    || requestFingerprint(preparation) !== binding.request.preparationHash || preparation.exchange.originalDisposition !== "return_to_warehouse"
    || requestFingerprint(choice) !== requestFingerprint(request)
    || requestFingerprint(approvedExchangeComparablePreview(preview)) !== requestFingerprint(approvedExchangeComparablePreview(original))) {
    throw new ConflictException("当前换货意图、检查或价格与原批准不同，须重新核对");
  }
  const consents = await tx.$queryRaw<ExchangeInspectionConsentRow[]>`SELECT * FROM rental_exchange_inspection_consents
    WHERE tenantId=${binding.tenantId} AND workspaceId=${binding.workspaceId} AND orderId=${binding.orderId}
      AND customerId=${row.applicantCustomerId} AND id=${binding.request.consentId} AND operationKey=${binding.request.consentOperationKey} LOCK IN SHARE MODE`;
  if (consents.length !== 1) throw new ForbiddenException("缺少本人对本次具体检查和交付的原同意");
  const consent = readExchangeInspectionConsent(consents[0], { ...binding, customerId: row.applicantCustomerId });
  const material = exchangeInspectionCustomerMaterial(preparation, row.applicantCustomerId, binding.request.preparationHash);
  if (consent.id !== binding.request.consentId || consent.operationKey !== binding.request.consentOperationKey || consent.preparationId !== preparation.id
    || consent.preparationHash !== binding.request.preparationHash || consent.materialHash !== material.materialHash
    || consent.expectedOrderUpdatedAt !== binding.request.expectedOrderUpdatedAt || Date.parse(consent.confirmedAt) < Date.parse(preparation.createdAt)
    || Date.parse(consent.confirmedAt) > Date.now()) throw new ForbiddenException("本人检查同意与原材料或订单修订不同");
  const resultFor = (side: "original_return" | "replacement_pickup") => {
    const templates = preparation.templates.filter(row => row.side === side), results = preparation.inspections.filter(row => row.side === side);
    if (templates.length !== 1 || results.length !== 1 || templates[0].template.id !== results[0].templateId
      || templates[0].template.version !== results[0].templateVersion) throw new ConflictException("本次原执行只支持每侧唯一检查模板，不能合并或漏验");
    const values: Record<string, unknown> = structuredClone(results[0].results);
    for (const field of templates[0].template.fields.filter(field => field.type === "photo")) {
      if (typeof values[field.code] === "string") values[field.code] = [values[field.code]];
    }
    return { template: templates[0].template, values };
  };
  const returned = resultFor("original_return"), pickup = resultFor("replacement_pickup"), exchange = preview.exchange;
  if (!exchange?.pickupInspection || !exchange.executionBasis) throw new ConflictException("当前换货缺少原替换交付依据");
  const input: ApplyRentalOrderChangeRequest & { type: "post_pickup_exchange" } = { type: "post_pickup_exchange", ...preparation.exchange,
    expectedUpdatedAt: binding.request.expectedOrderUpdatedAt, reason: binding.request.reason.trim(), customerConfirmed: true,
    serviceConfirmationHash: exchange.serviceConfirmationHash,
    inspectionSnapshot: { customerConfirmed: true, attachments: (preparation.acceptedMedia ?? []).filter(row => row.side === "original_return").map(row => row.fileAssetId),
      exceptions: preparation.exceptions.map(({ code, description }) => ({ code, description })) },
    replacementPickupInspection: { templateId: pickup.template.id, templateVersion: pickup.template.version, confirmationHash: exchange.pickupInspection.confirmationHash,
      customerConfirmed: true, results: pickup.values } };
  const authority: ApprovedExchangeAuthority = Object.freeze({ kind: "verified_core_exchange" });
  authorities.set(authority, { tx, binding: structuredClone(binding), input: structuredClone(input), preparation: structuredClone(preparation),
    consent: structuredClone(consent), order: structuredClone(order), previewHash: requestFingerprint(preview), approvalHash: approvalHash(row) });
  return { authority, input, returnedResults: returned.values };
}

export function approvedExchangeEvidence(authority: ApprovedExchangeAuthority, tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  order: RentalOrder, preview: RentalOrderChangePreview, input: unknown, key: string) {
  const facts = authorities.get(authority);
  if (!facts || facts.tx !== tx || facts.binding.tenantId !== tenantId || facts.binding.workspaceId !== workspaceId || facts.binding.orderId !== order.id
    || facts.binding.actorUserId !== getRequestUserId()
    || facts.binding.coreIdempotencyKey !== key || facts.order.updatedAt !== order.updatedAt || facts.previewHash !== requestFingerprint(preview)
    || requestFingerprint(input) !== requestFingerprint(facts.input)) throw new ForbiddenException("换货批准不是本事务核验的原执行依据");
  return { preparation: structuredClone(facts.preparation), consent: structuredClone(facts.consent) };
}

export async function recheckApprovedExchange(authority: ApprovedExchangeAuthority, tx: Prisma.TransactionClient, policies: EnterprisePolicyService,
  state: "approved" | "consumed") {
  const facts = authorities.get(authority);
  if (!facts || facts.tx !== tx) throw new ForbiddenException("换货批准事务依据已失效");
  const { row } = await approval(tx, policies, facts.binding, facts.order, state,
    facts.binding.request.expectedApprovalRevision + (state === "consumed" ? 1 : 0));
  if (approvalHash(row) !== facts.approvalHash) throw new ConflictException("换货执行期间原批准或本人费用确认发生变化");
}

export function approvedExchangeOriginalFacts(authority: ApprovedExchangeAuthority, tx: Prisma.TransactionClient) {
  const facts = authorities.get(authority);
  if (!facts || facts.tx !== tx) throw new ForbiddenException("换货批准事务依据已失效");
  return { approvalHash: facts.approvalHash, consent: structuredClone(facts.consent) };
}

/** A consumed historical approval is evidence, not today's new-spend grant.
 * Recovery never checks its old TTL or reprices its already committed change. */
export async function verifyConsumedExchangeApproval(tx: Prisma.TransactionClient, binding: ApprovedExchangeBinding, expectedHash: string) {
  const rows = await tx.$queryRaw<ApprovalRow[]>`SELECT * FROM enterprise_exchange_approvals WHERE tenantId=${binding.tenantId}
    AND workspaceId=${binding.workspaceId} AND orderId=${binding.orderId} AND id=${binding.request.approvalId} LOCK IN SHARE MODE`;
  const row = rows[0];
  if (rows.length !== 1 || row.tenantId !== binding.tenantId || row.workspaceId !== binding.workspaceId || row.orderId !== binding.orderId
    || row.id !== binding.request.approvalId || row.state !== "consumed" || row.revision !== binding.request.expectedApprovalRevision + 1
    || approvalHash(row) !== expectedHash) throw new ConflictException("原换货批准消费关联缺失或不一致，不能重发");
  await verifyOriginalExpenseConfirmation(tx, row, binding.request.expectedApprovalRevision);
  return { applicantCustomerId: row.applicantCustomerId };
}
