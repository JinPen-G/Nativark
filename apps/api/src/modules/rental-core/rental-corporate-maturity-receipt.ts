/** Decodes one original financially determined debt maturity and its audit.
 * No authorization, IO, transactions, current terms or due-date calculation.
 * The full original receipt stays server-side; enterprise projections select
 * their permitted fields separately and never expose free reasons/keys. */
import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { CustomerCorporateCreditLedger, OperationLog } from "@prisma/client";
import type { CustomerCorporateCreditMaturityReceipt } from "@rental-os/shared";

export const CORPORATE_CREDIT_MATURITY_ACTION = "corporate.credit.maturity";
export const CORPORATE_CREDIT_MATURITY_AUDIT_BINDING_VERSION = "corporate-credit-maturity-audit-1";

export type CorporateCreditMaturityAudit = Pick<OperationLog,
  "id" | "tenantId" | "workspaceId" | "rentalOrderId" | "action" | "userId" | "createdAt" | "detail">;
export type CorporateCreditMaturityDebt = Pick<CustomerCorporateCreditLedger,
  "id" | "tenantId" | "customerId" | "workspaceId" | "orderId" | "entryType" | "currency" | "receivableDelta">;

export interface CorporateCreditMaturityEvidence {
  receipt: CustomerCorporateCreditMaturityReceipt;
  audit: { id: string; actorUserId: string; createdAt: string;
    bindingVersion: typeof CORPORATE_CREDIT_MATURITY_AUDIT_BINDING_VERSION | "legacy_original_audit" };
}

/** Preserve the original JSON.stringify tuple bytes and audit ID namespace. */
export function corporateCreditMaturityAuditId(tenantId: string, customerId: string, ledgerId: string) {
  return createHash("sha256").update(JSON.stringify([CORPORATE_CREDIT_MATURITY_ACTION, tenantId, customerId, ledgerId])).digest("hex");
}

const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
function invalid(reason: string): never {
  throw new ConflictException(`债权到期依据与原账不匹配，须财务核对（${reason}）`);
}

/** Existing rows keep their declared time separately from the original audit
 * time. Application/DB clocks were independent, so legacy equality is not
 * invented. A present binding version is always checked, including null. */
export function readCorporateCreditMaturityEvidence(log: CorporateCreditMaturityAudit,
  ledger: CorporateCreditMaturityDebt): CorporateCreditMaturityEvidence {
  if (!log || !ledger) invalid("原审计或债权缺失");
  const detail = log.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) invalid("原核定正文缺失");
  const delta = ledger.receivableDelta;
  if (!delta || typeof delta.isFinite !== "function" || typeof delta.gt !== "function"
    || typeof delta.eq !== "function" || typeof delta.toFixed !== "function") invalid("原债权金额缺失");
  if (!text(ledger.tenantId) || !text(ledger.customerId) || !text(ledger.id) || !text(ledger.workspaceId) || !text(ledger.orderId)
    || !["settle", "adjust"].includes(ledger.entryType) || !text(ledger.currency)
    || !delta.isFinite() || !delta.gt(0) || !delta.eq(delta.toFixed(2))) invalid("原正债权或金额精度无效");
  if (log.id !== corporateCreditMaturityAuditId(ledger.tenantId, ledger.customerId, ledger.id)
    || log.action !== CORPORATE_CREDIT_MATURITY_ACTION || log.tenantId !== ledger.tenantId || log.workspaceId !== ledger.workspaceId
    || log.rentalOrderId !== ledger.orderId || detail.ledgerId !== ledger.id || detail.customerId !== ledger.customerId
    || detail.currency !== ledger.currency || detail.amount !== ledger.receivableDelta.toFixed(2)) invalid("原审计与债权主体不一致");
  if (!text(detail.dueAt) || !Number.isFinite(Date.parse(detail.dueAt)) || !text(detail.basisRef)
    || !text(detail.reason) || !text(detail.idempotencyKey) || !text(detail.recordedBy)
    || !text(detail.recordedAt) || !Number.isFinite(Date.parse(detail.recordedAt))) invalid("原核定依据或操作缺失");
  if (!text(log.userId) || log.userId !== detail.recordedBy) invalid("原核定操作人不可核验");
  if (!(log.createdAt instanceof Date) || !Number.isFinite(log.createdAt.getTime())) invalid("原审计时间不可核验");
  const createdAt = log.createdAt.toISOString();
  const versioned = Object.hasOwn(detail, "auditBindingVersion");
  if (versioned && detail.auditBindingVersion !== CORPORATE_CREDIT_MATURITY_AUDIT_BINDING_VERSION) invalid("审计绑定版本不可核验");
  if (versioned && detail.recordedAt !== createdAt) invalid("新核定时间与原审计不一致");
  return {
    receipt: { ledgerId: ledger.id, orderId: ledger.orderId, currency: ledger.currency, dueAt: detail.dueAt,
      basisRef: detail.basisRef, reason: detail.reason, idempotencyKey: detail.idempotencyKey,
      recordedBy: detail.recordedBy, recordedAt: detail.recordedAt },
    audit: { id: log.id, actorUserId: log.userId, createdAt,
      bindingVersion: versioned ? CORPORATE_CREDIT_MATURITY_AUDIT_BINDING_VERSION : "legacy_original_audit" }
  };
}
