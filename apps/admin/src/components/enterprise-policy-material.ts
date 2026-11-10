/** Bounded original-policy material/input projection shared by merchant and customer editors.
 * It preserves form transforms and independent arrays, never computes rental authority,
 * upper-bound intersections, credit or prices, and does not replace server validation. */
import { RentalCategoryCode, type EnterpriseScopePolicy, type EnterpriseScopePolicyView } from "@rental-os/shared";
import { enterprisePolicyPayload, type EnterprisePolicyForm } from "./EnterprisePolicyFields";

const unavailable = () => new Error("原政策材料、对象或修订不可用，请重新核对 / Original policy material, target or revision unavailable");
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 200 && new Set(value).size === value.length
  && value.every(id => typeof id === "string" && Boolean(id.trim()) && id.length <= 191);
export const copyEnterprisePolicy = (p?: EnterpriseScopePolicy): EnterpriseScopePolicy | undefined => {
  if (p === undefined) return undefined;
  if (!p || !ids(p.workspaceIds) || !ids(p.categoryCodes) || p.categoryCodes.some(code => !Object.values(RentalCategoryCode).some(registered => registered === code))
    || typeof p.personalPaymentAllowed !== "boolean" || typeof p.enterprisePaymentAllowed !== "boolean"
    || !["per_order", "without_per_order", "unconfigured"].includes(p.approvalMode)
    || typeof p.noticeVersion !== "string" || !p.noticeVersion.trim() || p.noticeVersion.length > 191
    || typeof p.noticeText !== "string" || !p.noticeText.trim() || p.noticeText.length > 4000
    || p.currency !== undefined && (typeof p.currency !== "string" || !/^[A-Z]{3}$/u.test(p.currency))
    || p.maxRequestAmount !== undefined && (typeof p.maxRequestAmount !== "string" || !/^\d{1,12}(?:\.\d{1,2})?$/u.test(p.maxRequestAmount) || !p.currency)
    || p.approvalLifetimeMinutes !== undefined && (!Number.isInteger(p.approvalLifetimeMinutes) || p.approvalLifetimeMinutes < 1 || p.approvalLifetimeMinutes > 10080)
    || p.approvalMode === "per_order" && p.approvalLifetimeMinutes === undefined) throw unavailable();
  return { workspaceIds: [...p.workspaceIds], categoryCodes: [...p.categoryCodes], personalPaymentAllowed: p.personalPaymentAllowed,
    enterprisePaymentAllowed: p.enterprisePaymentAllowed, approvalMode: p.approvalMode, noticeVersion: p.noticeVersion, noticeText: p.noticeText,
    maxRequestAmount: p.maxRequestAmount, currency: p.currency, approvalLifetimeMinutes: p.approvalLifetimeMinutes };
};
export const copyEnterprisePolicyView = (view?: EnterpriseScopePolicyView): EnterpriseScopePolicyView | undefined => {
  if (view === undefined) return undefined;
  if (!view || [view.revision, view.merchantRevision, view.companyRevision, view.employeeRevision].some(value => !Number.isSafeInteger(value) || value < 0)
    || !ids(view.effectiveWorkspaceIds) || !ids(view.effectiveCategoryCodes) || view.effectiveCategoryCodes.some(code => !Object.values(RentalCategoryCode).some(registered => registered === code)) || !Array.isArray(view.workspaces) || view.workspaces.length > 200
    || view.workspaces.some(row => !row || typeof row.id !== "string" || !row.id.trim() || row.id.length > 191 || typeof row.name !== "string" || !Object.values(RentalCategoryCode).some(registered => registered === row.categoryCode))) throw unavailable();
  return { revision: view.revision, merchantRevision: view.merchantRevision, companyRevision: view.companyRevision, employeeRevision: view.employeeRevision,
    merchant: copyEnterprisePolicy(view.merchant), company: copyEnterprisePolicy(view.company), employee: copyEnterprisePolicy(view.employee), effectiveWorkspaceIds: [...view.effectiveWorkspaceIds],
    effectiveCategoryCodes: [...view.effectiveCategoryCodes], workspaces: view.workspaces.map(row => ({ id: row.id, name: row.name, categoryCode: row.categoryCode })) };
};
const formFields = ["workspaceIds", "categoryCodes", "personalPaymentAllowed", "enterprisePaymentAllowed", "approvalMode", "noticeVersion", "noticeText", "maxRequestAmount", "currency", "approvalLifetimeMinutes", "reason"] as const;
export const captureEnterprisePolicyInput = (values: EnterprisePolicyForm) => {
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).some(field => !formFields.some(registered => registered === field))
    || !ids(values.workspaceIds) || !ids(values.categoryCodes) || typeof values.reason !== "string" || !values.reason.trim() || values.reason.length > 500
    || values.maxRequestAmount != null && typeof values.maxRequestAmount !== "string" || values.currency != null && typeof values.currency !== "string"
    || values.approvalLifetimeMinutes != null && !["number", "string"].includes(typeof values.approvalLifetimeMinutes)) throw unavailable();
  // Preserve the original trim/uppercase/lifetime transforms; copy arrays before they run.
  const policy = copyEnterprisePolicy(enterprisePolicyPayload({ ...values, workspaceIds: [...values.workspaceIds], categoryCodes: [...values.categoryCodes] }));
  if (!policy) throw unavailable();
  return { policy, reason: values.reason };
};
