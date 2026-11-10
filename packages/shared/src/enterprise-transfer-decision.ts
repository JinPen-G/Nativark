/** Original transfer K/C resolution, not authority, rollback inference or an undo operation. */
import type { EnterpriseChangeRequest } from "./enterprise-workflows";
export interface CloseEnterpriseTransferDecisionRequest extends EnterpriseChangeRequest { confirm: true }
export interface EnterpriseTransferDecisionResolution {
  version: 1;
  purpose: "administrator_transfer_resolution";
  outcome: "observed" | "closed";
  tenantId: string;
  corporateCustomerId: string;
  applicantCustomerId: string;
  transferId: string;
  originalOperationKey: string;
  closureOperationKey: string;
  decision: { id: string; state: "approved" | "rejected"; revision: number };
  retryable: false;
}
type Binding = Pick<EnterpriseTransferDecisionResolution, "transferId" | "applicantCustomerId" | "originalOperationKey" | "closureOperationKey"> & Partial<Pick<EnterpriseTransferDecisionResolution, "tenantId">>;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const reference = (value: unknown, max: number): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= max;
/** Validate the named server evidence against an original reference; callers still use original Auth. */
export function enterpriseTransferDecisionResolutionMatches(value: unknown, binding: Binding): value is EnterpriseTransferDecisionResolution {
  if (!object(value) || value.version !== 1 || value.purpose !== "administrator_transfer_resolution" || value.retryable !== false
      || !["observed", "closed"].includes(value.outcome as string) || !reference(value.tenantId, 191) || !reference(value.corporateCustomerId, 191)
      || !reference(value.applicantCustomerId, 191) || !reference(value.transferId, 191) || !reference(value.originalOperationKey, 128) || !reference(value.closureOperationKey, 128)
      || value.originalOperationKey === value.closureOperationKey || !object(value.decision) || value.decision.id !== value.transferId
      || typeof value.decision.state !== "string" || !["approved", "rejected"].includes(value.decision.state)
      || typeof value.decision.revision !== "number" || !Number.isSafeInteger(value.decision.revision) || value.decision.revision < 2
      || value.outcome === "closed" && value.decision.state !== "rejected") return false;
  return value.transferId === binding.transferId && value.applicantCustomerId === binding.applicantCustomerId
    && value.originalOperationKey === binding.originalOperationKey && value.closureOperationKey === binding.closureOperationKey
    && (binding.tenantId === undefined || value.tenantId === binding.tenantId);
}
