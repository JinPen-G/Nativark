/** Bounded copies of the formal review-only request for customer and operator consumers.
 * No business change, current authorization, credit calculation or file-download grant. */
import { ENTERPRISE_REVIEW_REQUEST_TYPES, RENTAL_CURRENCY_CODES, type EnterpriseManagementProposal, type EnterpriseManagementRequestView } from "@rental-os/shared";
const types = ENTERPRISE_REVIEW_REQUEST_TYPES;
const unavailable = () => new Error("原申请材料或输入已变化，请重新核对 / Original request material or input changed; review again");
const textValue = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const reference = (value: unknown): value is string => textValue(value, 191) && /^[a-zA-Z0-9_-]+$/u.test(value);
const references = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every(reference);
export function copyEnterpriseManagementRequest(value: EnterpriseManagementRequestView): EnterpriseManagementRequestView {
  if (!reference(value.id) || !reference(value.corporateCustomerId) || !reference(value.applicantCustomerId) || !types.includes(value.requestType)
    || !["draft", "pending", "supplement_required", "approved", "rejected", "withdrawn"].includes(value.state)
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || !textValue(value.objectRevision, 191) || !value.objectRevision.trim()
    || !textValue(value.reason, 500) || !references(value.evidenceFileIds, 10) || value.effect !== "review_only_no_business_change"
    || value.decisionReason !== null && !textValue(value.decisionReason, 500)
    || ![value.createdAt, value.updatedAt].every(date => textValue(date, 24) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString() === date)
    || !value.proposal || typeof value.proposal !== "object" || Array.isArray(value.proposal)) throw unavailable();
  const allowed = value.requestType === "profile_change" ? ["legalName", "registeredAddress", "email"] : value.requestType === "credit_change" ? ["requestedCreditLimit", "currency"]
    : value.requestType === "payment_proof" ? ["orderId", "workspaceId", "reportedAmount", "currency", "paymentPurpose"] : ["workspaceIds", "categoryCodes"];
  const proposal: EnterpriseManagementProposal = {};
  for (const [key, field] of Object.entries(value.proposal)) {
    if (field === undefined) continue;
    if (!allowed.includes(key)) throw unavailable();
    if (key === "workspaceIds" || key === "categoryCodes") {
      if (!references(field, 200)) throw unavailable();
      proposal[key] = [...field];
    } else {
      if (!textValue(field, key === "registeredAddress" ? 1000 : key === "currency" ? 3 : 191)) throw unavailable();
      Object.assign(proposal, { [key]: field });
    }
  }
  if (value.requestType === "payment_proof" && (![proposal.orderId, proposal.workspaceId].every(field => typeof field === "string" && /^[a-zA-Z0-9._:-]{1,191}$/u.test(field))
    || typeof proposal.reportedAmount !== "string" || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u.test(proposal.reportedAmount) || Number(proposal.reportedAmount) <= 0
    || !RENTAL_CURRENCY_CODES.some(code => code === proposal.currency) || proposal.paymentPurpose !== "rental_fee"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.objectRevision) || !Number.isFinite(Date.parse(value.objectRevision)))) throw unavailable();
  return { id: value.id, corporateCustomerId: value.corporateCustomerId, applicantCustomerId: value.applicantCustomerId, requestType: value.requestType, state: value.state,
    revision: value.revision, objectRevision: value.objectRevision, proposal, reason: value.reason, evidenceFileIds: [...value.evidenceFileIds], decisionReason: value.decisionReason,
    effect: value.effect, createdAt: value.createdAt, updatedAt: value.updatedAt };
}
