/** Bounded original application material for client feedback and merchant review.
 * Copies registered facts only; it grants no rights and does not validate business eligibility. */
import type { EnterpriseWorkflowView } from "@rental-os/shared";
const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
const utc = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fields = [["legalName", 191], ["region", 80], ["legalIdentifier", 191], ["contactName", 120], ["contactPhone", 32], ["email", 191], ["authorityStatement", 2000], ["agreementVersion", 191], ["existingCorporateCustomerId", 191], ["agreementAcknowledgedAt", 64]] as const;
export function copyEnterpriseApplicationMaterial(row: EnterpriseWorkflowView): EnterpriseWorkflowView | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row) || row.kind !== "corporate_application" || !reference(row.id) || !reference(row.applicantCustomerId)
    || !["draft", "pending", "supplement_required", "approved", "rejected", "withdrawn"].includes(row.state) || !Number.isSafeInteger(row.revision) || row.revision < 1
    || !utc(row.createdAt) || !utc(row.updatedAt) || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)
    || row.corporateCustomerId !== undefined && !reference(row.corporateCustomerId)
    || row.decisionReason !== undefined && (typeof row.decisionReason !== "string" || row.decisionReason.length > 500)) return undefined;
  const payload: Record<string, unknown> = {};
  for (const [field, max] of fields) {
    const value = row.payload[field]; if (value === undefined) continue;
    if (typeof value !== "string" || value.length > max || field === "agreementAcknowledgedAt" && !utc(value)) return undefined;
    payload[field] = value;
  }
  if (row.payload.agreementAcknowledged !== undefined) {
    if (typeof row.payload.agreementAcknowledged !== "boolean") return undefined;
    payload.agreementAcknowledged = row.payload.agreementAcknowledged;
  }
  if (row.payload.evidenceFileIds !== undefined) {
    const ids = row.payload.evidenceFileIds;
    if (!Array.isArray(ids) || ids.length > 10 || new Set(ids).size !== ids.length || !ids.every(reference)) return undefined;
    payload.evidenceFileIds = [...ids];
  }
  return { id: row.id, kind: "corporate_application", state: row.state, revision: row.revision, applicantCustomerId: row.applicantCustomerId,
    corporateCustomerId: row.corporateCustomerId, createdAt: row.createdAt, updatedAt: row.updatedAt, decisionReason: row.decisionReason, payload };
}
