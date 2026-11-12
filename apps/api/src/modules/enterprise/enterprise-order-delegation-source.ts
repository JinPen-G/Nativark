/** Scoped original delegation records shared by source and Core policy consumers.
 * Authentication stays with callers; this module checks persisted integrity and exact lookup. */
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ENTERPRISE_ORDER_DELEGATION_SOURCE_VERSION } from "@rental-os/shared";
import type { EnterpriseOrderDelegationReceipt, EnterpriseOrderDelegationSource } from "@rental-os/shared";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import { enterpriseJson } from "./enterprise-command.service";

export type EnterpriseDelegationStored = { source: EnterpriseOrderDelegationSource; state: "issued" | "revoked" | "consumed"; revision: number;
  receipt?: EnterpriseOrderDelegationReceipt; receiptHash?: string };
export type EnterpriseDelegationRow = { operationKey: string; actorUserId: string; requestHash: string; target: string; result: EnterpriseDelegationStored | string };
export const enterpriseDelegationTarget = (quoteId: string) => `order.delegation.issue:${requestFingerprint({ quoteId })}`;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

export function readEnterpriseDelegationSource(row: EnterpriseDelegationRow, tenantId: string, key: string): EnterpriseDelegationStored {
  const record = enterpriseJson(row.result), source = record?.source, reference = source?.requestReference;
  if (!record || !source || source.version !== ENTERPRISE_ORDER_DELEGATION_SOURCE_VERSION || source.purpose !== "merchant_operator"
    || source.tenantId !== tenantId || source.delegationKey !== key || row.operationKey !== key || row.actorUserId !== `customer:${source.personalCustomerId}`
    || row.target !== enterpriseDelegationTarget(source.quoteId) || ![source.workspaceId, source.personalCustomerId, source.corporateCustomerId, source.corporateMembershipId, source.quoteId].every(id)
    || ![source.requestHash, source.requestContentHash, source.quoteHash, source.basisHash, source.integrityHash].every(hash)
    || !reference || typeof reference !== "object" || Array.isArray(reference) || Object.keys(reference).length !== 1
    || !("approvalId" in reference && id(reference.approvalId) || "quoteId" in reference && reference.quoteId === source.quoteId)
    || !source.request || source.request.customerId !== source.personalCustomerId || source.request.quoteId !== source.quoteId || source.request.customerType !== "personal"
    || !source.basis || source.basis.guaranteePayer !== "enterprise" || !["per_order", "without_per_order"].includes(source.basis.approvalMode)
    || !source.confirmation || source.confirmation.operationKey !== key || source.confirmation.customerId !== source.personalCustomerId
    || source.confirmation.noticeVersion !== source.basis.noticeVersion || source.confirmation.acknowledgedAt !== source.basis.acknowledgedAt
    || !Number.isFinite(Date.parse(source.confirmation.confirmedAt)) || !Number.isFinite(Date.parse(source.expiresAt))
    || !Number.isSafeInteger(record.revision) || record.revision < 1 || !["issued", "revoked", "consumed"].includes(record.state)
    || requestFingerprint({ ...source, integrityHash: undefined }) !== source.integrityHash || requestFingerprint(source.request) !== source.requestContentHash
    || requestFingerprint(source.basis) !== source.basisHash) throw new ConflictException("原委托源版本、完整性或原请求关联不可核对");
  if ((source.basis.approvalMode === "per_order") !== Boolean(source.approval) || source.approval && (source.approval.id !== ("approvalId" in reference ? reference.approvalId : undefined)
    || source.approval.requestHash !== source.requestHash || source.approval.quoteHash !== source.quoteHash || !Number.isSafeInteger(source.approval.revision))) throw new ConflictException("原委托批准引用不一致");
  if (record.state === "consumed") {
    const receipt = record.receipt;
    if (!receipt || receipt.state !== "consumed" || receipt.retryable !== false || receipt.delegationKey !== key || receipt.sourceHash !== source.integrityHash
      || receipt.tenantId !== tenantId || receipt.workspaceId !== source.workspaceId || receipt.personalCustomerId !== source.personalCustomerId
      || receipt.corporateCustomerId !== source.corporateCustomerId || receipt.quoteId !== source.quoteId || receipt.requestHash !== source.requestHash
      || receipt.coreIdempotencyKey !== key || !id(receipt.actorUserId) || !id(receipt.orderId) || !Number.isFinite(Date.parse(receipt.consumedAt))
      || requestFingerprint(receipt) !== record.receiptHash) throw new ConflictException("原委托消费收据不一致");
  } else if (record.receipt || record.receiptHash) throw new ConflictException("原委托状态与消费收据不一致");
  return record;
}

export async function readQuoteEnterpriseDelegation(tx: Prisma.TransactionClient, tenantId: string, quoteId: string) {
  const rows = await tx.$queryRaw<EnterpriseDelegationRow[]>`SELECT operationKey,actorUserId,requestHash,target,result FROM enterprise_portal_operations
    WHERE tenantId=${tenantId} AND target=${enterpriseDelegationTarget(quoteId)} LIMIT 2 FOR UPDATE`;
  if (rows.length > 1) throw new ConflictException("原报价存在多个委托源，须核对原键");
  const value = rows[0] && readEnterpriseDelegationSource(rows[0], tenantId, rows[0].operationKey);
  if (value && value.source.quoteId !== quoteId) throw new ConflictException("原报价与委托源定位不一致");
  return value;
}
