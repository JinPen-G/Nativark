/** Customer workflow writes are single-dispatch. Durable recovery stores only the
 * original key/path/state, never input or credentials; cancellation is not rollback. */
import { useEffect, useRef, useState } from "react";
import { ENTERPRISE_PORTAL_ACTIONS, enterpriseExchangeInspectionConsentSnapshot, enterpriseExpenseRequestMatches, enterpriseExpenseRequestClosureMatches, enterpriseTransferDecisionResolutionMatches, type RentalExchangeInspectionConsent, type RentalExchangeInspectionConsentOriginal, type EnterpriseTransferDecisionResolution, type EnterpriseExchangeRequestOriginalResult, type EnterpriseExtensionRequestOriginalResult, type EnterpriseOperationResult, type EnterpriseInviteCreated } from "@rental-os/shared";
import { customerSessionGeneration } from "@rental-os/web-client";
import { useEnterprise } from "./enterprise-session";

type Command = { path: string; input: object; method?: "POST" | "PUT"; originalTarget?: string };
type Pending = { key: string; path: string; body: string; state: "unknown" | "committed"; originalTarget?: string; closureKey?: string };
type Slot = { pending?: Pending; busy: boolean; tenantCode: string; generation: string };
// In-memory input freezes dispatch; durable storage holds no application/invitation body.
const unresolved = new Map<string, Slot>();
const allowsOriginalTarget = (path: string) => ["/enterprise/extension-approvals/submit", "/enterprise/extension-approvals", "/enterprise/exchange-approvals"].includes(path)
  || /^\/enterprise\/exchange-approvals\/[a-zA-Z0-9_%~-]+\/expense-confirmation$/u.test(path)
  || /^\/enterprise\/orders\/[A-Za-z0-9._:%~-]+\/exchange-inspection-consents$/u.test(path);
const inspectionConsentTarget = (path: string): string | undefined => {
  if (!path.includes("exchange-inspection-consents")) return undefined;
  const match = /^\/enterprise\/orders\/([A-Za-z0-9._:%~-]+)\/exchange-inspection-consents$/u.exec(path);
  let orderId: string | undefined;
  try { orderId = match && decodeURIComponent(match[1]) || undefined; } catch { /* Invalid encoded references remain blocked. */ }
  if (!orderId || !/^[A-Za-z0-9._:-]{1,191}$/u.test(orderId)) throw new Error("原检查同意路径不可核对，保留原键");
  return orderId;
};
const inspectionConsentScopeMatches = (scope: string, orderId: string) => {
  const prefix = `exchange-approvals:inspection:${orderId}:`;
  return scope.startsWith(prefix) && /^[A-Za-z0-9._:-]{1,191}$/u.test(scope.slice(prefix.length));
};
// Only registered original paths can select a narrower receipt reader.
const policySaveTarget = (path: string): { corporateId: string; membershipId?: string } | undefined => {
  if (!/^\/enterprise\/corporates\/[^/]+\/(?:members\/[^/]+\/)?policy(?:\/|$)/u.test(path)) return undefined;
  const match = /^\/enterprise\/corporates\/([a-zA-Z0-9_-]{1,191})\/(?:members\/([a-zA-Z0-9_-]{1,191})\/)?policy$/u.exec(path);
  if (!match) throw new Error("原政策保存路径无法精确核对，保留原引用 / Original policy-save reference unavailable");
  return { corporateId: match[1], membershipId: match[2] };
};
const policySaveOriginalPath = (target: NonNullable<ReturnType<typeof policySaveTarget>>, key: string) =>
  `/enterprise/corporates/${encodeURIComponent(target.corporateId)}${target.membershipId ? `/members/${encodeURIComponent(target.membershipId)}` : ""}/policy/save-operations/${encodeURIComponent(key)}`;
const policySaveResultMatches = (value: unknown, target: NonNullable<ReturnType<typeof policySaveTarget>>, originalRead = false) => {
  const row = value as { corporateCustomerId?: unknown; scopeKey?: unknown; revision?: unknown } | null;
  return row && !Array.isArray(row) && (originalRead ? row.corporateCustomerId === target.corporateId : row.corporateCustomerId === undefined || row.corporateCustomerId === target.corporateId)
    && row.scopeKey === (target.membershipId ? `member:${target.membershipId}` : "company")
    && typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 1;
};
const managementWithdrawalTarget = (path: string) => {
  if (!path.startsWith("/enterprise/management-requests/")) return undefined;
  const match = /^\/enterprise\/management-requests\/([a-zA-Z0-9_-]{1,191})\/withdraw$/u.exec(path);
  if (!match) throw new Error("原管理申请撤回路径无法精确核对，保留原引用 / Original management-withdrawal path unavailable");
  return match[1];
};
const managementWithdrawalOriginalPath = (id: string, key: string) => `/enterprise/management-requests/${encodeURIComponent(id)}/withdraw-operations/${encodeURIComponent(key)}`;
const managementSaveTarget = (path: string) => {
  if (!/^\/enterprise\/corporates\/[^/]+\/management-requests(?:\/|$)/u.test(path)) return undefined;
  const match = /^\/enterprise\/corporates\/([a-zA-Z0-9_-]{1,191})\/management-requests$/u.exec(path);
  if (!match) throw new Error("原管理申请保存路径无法精确核对，保留原引用 / Original management-save path unavailable");
  return match[1];
};
const managementSaveOriginalPath = (corporateId: string, key: string) => `/enterprise/corporates/${encodeURIComponent(corporateId)}/management-requests/save-operations/${encodeURIComponent(key)}`;
const managementSaveResultMatches = (value: unknown, corporateId: string, originalRead = false) => {
  const row = value as { corporateCustomerId?: unknown; id?: unknown; state?: unknown; revision?: unknown; effect?: unknown } | null;
  return row && !Array.isArray(row) && (originalRead ? row.corporateCustomerId === corporateId : row.corporateCustomerId === undefined || row.corporateCustomerId === corporateId)
    && typeof row.id === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(row.id) && (row.state === "draft" || row.state === "pending")
    && typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 1 && row.effect === "review_only_no_business_change";
};
const managementSaveInputMatches = (value: unknown, body: string) => {
  const row = value as { id?: unknown; state?: unknown; revision?: unknown } | null;
  let input: { requestId?: unknown; expectedRevision?: unknown; submit?: unknown } | null;
  try { input = JSON.parse(body); } catch { return false; }
  return row && input && !Array.isArray(input) && (input.requestId === undefined || row.id === input.requestId)
    && typeof input.expectedRevision === "number" && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0
    && row.revision === input.expectedRevision + 1 && typeof input.submit === "boolean" && row.state === (input.submit ? "pending" : "draft");
};
const rentalHandoffTarget = (path: string) => {
  if (!path.startsWith("/enterprise/orders/") || !path.includes("handoff-requests")) return undefined;
  const match = /^\/enterprise\/orders\/([a-zA-Z0-9_-]{1,191})\/handoff-requests$/u.exec(path);
  if (!match) throw new Error("原交接申请路径不可核对，保留原键 / Original rental-handoff path unavailable");
  return match[1];
};
const rentalHandoffResultMatches = (value: unknown, orderId: string) => {
  const row = value as { id?: unknown; orderId?: unknown; state?: unknown; revision?: unknown; effect?: unknown } | null;
  return row && !Array.isArray(row) && Object.keys(row).length === 5 && typeof row.id === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(row.id)
    && row.orderId === orderId && row.state === "pending" && row.revision === 1 && row.effect === "request_only_no_business_change";
};
const rentalHandoffWithdrawalTarget = (path: string) => {
  if (!path.startsWith("/enterprise/handoff-requests/")) return undefined;
  const match = new RegExp("^/enterprise/handoff-requests/([a-zA-Z0-9_-]{1,191})/withdraw$", "u").exec(path);
  if (!match) throw new Error("原交接撤回路径不可核对，保留原键");
  return match[1];
};
const rentalHandoffWithdrawalMatches = (value: unknown, id: string, body?: string) => {
  const row = value as { id?: unknown; orderId?: unknown; state?: unknown; revision?: unknown; effect?: unknown } | null;
  if (!row || Array.isArray(row) || Object.keys(row).length !== 5 || row.id !== id || typeof row.orderId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(row.orderId)
    || row.state !== "withdrawn" || row.revision !== 2 || row.effect !== "request_only_no_business_change") return false;
  if (!body) return true;
  try { const input = JSON.parse(body), material = JSON.parse(input.materialKey); return input.expectedRevision === 1 && input.confirm === true && material.id === id && material.orderId === row.orderId; } catch { return false; }
};
const applicationSaveTarget = (path: string) => path === "/enterprise/applications";
const applicationSaveResultMatches = (value: unknown) => {
  const row = value as { id?: unknown; state?: unknown; revision?: unknown } | null;
  return row && !Array.isArray(row) && typeof row.id === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(row.id)
    && typeof row.state === "string" && ["draft", "pending", "supplement_required"].includes(row.state)
    && typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 1;
};
const applicationWithdrawalTarget = (path: string) => {
  if (!path.startsWith("/enterprise/applications/")) return undefined;
  const match = /^\/enterprise\/applications\/([a-zA-Z0-9_-]{1,191})\/withdraw$/u.exec(path);
  if (!match) throw new Error("原企业申请撤回路径无法精确核对，保留原引用 / Original application withdrawal reference unavailable");
  return match[1];
};
const joinSubmissionTarget = (path: string) => {
  if (path === "/enterprise/join") return true;
  if (path.startsWith("/enterprise/join/")) throw new Error("原加入提交路径无法精确核对，保留原引用 / Original join submission reference unavailable");
  return false;
};
const joinSubmissionResultMatches = (value: unknown) => {
  const row = value as { id?: unknown; membershipId?: unknown; state?: unknown; revision?: unknown; code?: unknown; inviteCode?: unknown } | null;
  const id = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
  return row && !Array.isArray(row) && row.code === undefined && row.inviteCode === undefined && (row.state === "pending" && id(row.id)
    && typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 1 || row.state === "already_member" && id(row.membershipId)
    || row.state === "invite_unavailable" || row.state === "agreement_unavailable");
};
const joinReviewTarget = (path: string) => {
  if (!/^\/enterprise\/corporates\/[^/]+\/join-requests\//u.test(path)) return undefined;
  const match = /^\/enterprise\/corporates\/([a-zA-Z0-9_-]{1,191})\/join-requests\/([a-zA-Z0-9_-]{1,191})\/decision$/u.exec(path);
  if (!match) throw new Error("原加入审核路径无法精确核对，保留原引用 / Original join-review reference unavailable");
  return { corporateId: match[1], requestId: match[2] };
};
const joinReviewResultMatches = (value: unknown, target: NonNullable<ReturnType<typeof joinReviewTarget>>) => {
  const row = value as { id?: unknown; state?: unknown; revision?: unknown } | null;
  return row && !Array.isArray(row) && row.id === target.requestId && typeof row.state === "string" && ["approved", "rejected"].includes(row.state)
    && typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 2;
};
const joinWithdrawalTarget = (path: string) => {
  if (!path.startsWith("/enterprise/join-requests/")) return undefined;
  const match = /^\/enterprise\/join-requests\/([a-zA-Z0-9_-]{1,191})\/withdraw$/u.exec(path);
  if (!match) throw new Error("原加入申请撤回路径无法精确核对，保留原引用 / Original withdrawal reference unavailable");
  return match[1];
};
const workflowWithdrawalResultMatches = (value: unknown, id: string) => {
  const row = value as { id?: unknown; state?: unknown; revision?: unknown } | null;
  return row && !Array.isArray(row) && row.id === id && row.state === "withdrawn" && typeof row.revision === "number"
    && Number.isSafeInteger(row.revision) && row.revision >= 2;
};
const inviteCreationTarget = (path: string) => {
  if (!/^\/enterprise\/corporates\/[^/]+\/invites(?:\/|$)/u.test(path)) return undefined;
  const match = /^\/enterprise\/corporates\/([a-zA-Z0-9_-]{1,191})\/invites$/u.exec(path);
  if (match) return match[1];
  if (/^\/enterprise\/corporates\/[a-zA-Z0-9_-]{1,191}\/invites\/[a-zA-Z0-9_-]{1,191}\/revoke$/u.test(path)) return undefined;
  throw new Error("原邀请创建路径无法精确核对，保留原引用 / Original invite-creation reference unavailable");
};
const inviteRevocationTarget = (path: string) => {
  if (!/^\/enterprise\/corporates\/[^/]+\/invites\/[^/]+\/revoke(?:\/|$)/u.test(path)) return undefined;
  const match = /^\/enterprise\/corporates\/([a-zA-Z0-9_-]{1,191})\/invites\/([a-zA-Z0-9_-]{1,191})\/revoke$/u.exec(path);
  if (!match) throw new Error("原邀请停用路径无法精确核对，保留原引用 / Original invite-revocation reference unavailable");
  return { corporateId: match[1], inviteId: match[2] };
};
const inviteRevocationResultMatches = (value: unknown, target: NonNullable<ReturnType<typeof inviteRevocationTarget>>) => {
  const row = value as { id?: unknown; status?: unknown; revision?: unknown; code?: unknown } | null;
  return row && !Array.isArray(row) && row.id === target.inviteId && row.status === "revoked" && typeof row.revision === "number"
    && Number.isSafeInteger(row.revision) && row.revision >= 2 && row.code === undefined;
};
const inviteCreationResultMatches = (value: unknown, corporateId: string, allowFirstCode = false) => {
  const row = value as Partial<EnterpriseInviteCreated> | null, invite = row?.invite;
  const utc = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  return row && !Array.isArray(row) && row.codeRetrievableAgain === false && invite && typeof invite === "object" && !Array.isArray(invite)
    && typeof invite.id === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(invite.id) && invite.corporateCustomerId === corporateId
    && invite.status === "active" && invite.revision === 1 && invite.used === 0 && Number.isSafeInteger(invite.maxUses) && invite.maxUses >= 1
    && utc(invite.createdAt) && utc(invite.expiresAt) && Date.parse(invite.expiresAt) > Date.parse(invite.createdAt)
    && (row.code === undefined || allowFirstCode && typeof row.code === "string" && /^[a-zA-Z0-9_-]{43}$/u.test(row.code));
};
const transferDecisionTarget = (path: string) => {
  if (!path.startsWith("/enterprise/transfers/")) return undefined;
  const match = /^\/enterprise\/transfers\/([a-zA-Z0-9_-]{1,191})\/decision$/u.exec(path);
  if (!match) throw new Error("原交接路径无法精确核对，保留原引用 / Original transfer reference unavailable");
  return match[1];
};
const transferInitiationTarget = (path: string) => {
  if (!path.startsWith("/enterprise/corporates/") || !path.includes("/transfers")) return undefined;
  const match = /^\/enterprise\/corporates\/([a-zA-Z0-9_-]{1,191})\/transfers$/u.exec(path);
  if (!match) throw new Error("原交接发起路径无法精确核对，保留原引用 / Original initiation reference unavailable");
  return match[1];
};
const transferInitiationResultMatches = (value: unknown) => {
  const row = value as { id?: unknown; state?: unknown; revision?: unknown } | null;
  return row && !Array.isArray(row) && typeof row.id === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(row.id)
    && row.state === "pending" && row.revision === 1;
};
const administratorChangeTarget = (path: string) => {
  if (!/^\/enterprise\/corporates\/[^/]+\/members\/[^/]+\/administrator(?:\/|$)/u.test(path)) return undefined;
  const match = /^\/enterprise\/corporates\/([a-zA-Z0-9_-]{1,191})\/members\/([a-zA-Z0-9_-]{1,191})\/administrator$/u.exec(path);
  if (!match) throw new Error("原管理员变更路径无法精确核对，保留原引用 / Original administrator-change reference unavailable");
  return { corporateId: match[1], membershipId: match[2] };
};
const administratorChangeResultMatches = (value: unknown, target: NonNullable<ReturnType<typeof administratorChangeTarget>>) => {
  const row = value as { membershipId?: unknown; role?: unknown; actions?: unknown; updatedAt?: unknown; revision?: unknown } | null;
  return row && !Array.isArray(row) && row.membershipId === target.membershipId && typeof row.role === "string" && ["admin", "employee"].includes(row.role)
    && Array.isArray(row.actions) && row.actions.length <= ENTERPRISE_PORTAL_ACTIONS.length && new Set(row.actions).size === row.actions.length
    && row.actions.every(action => typeof action === "string" && ENTERPRISE_PORTAL_ACTIONS.some(registered => registered === action))
    && (row.role !== "employee" || row.actions.length === 0) && (row.actions.length === 0 || row.actions.includes("portal:enter"))
    && typeof row.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 1
    && typeof row.updatedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.updatedAt)
    && Number.isFinite(Date.parse(row.updatedAt)) && new Date(row.updatedAt).toISOString() === row.updatedAt;
};
const memberChangeTarget = (path: string) => {
  if (!path.startsWith("/enterprise/corporates/") || !path.includes("/members/")) return undefined;
  const match = /^\/enterprise\/corporates\/([a-zA-Z0-9_-]{1,191})\/members\/([a-zA-Z0-9_-]{1,191})$/u.exec(path);
  if (match) return { corporateId: match[1], membershipId: match[2] };
  // Existing registered administrator/policy/own-exit commands keep their own readers.
  if (/^\/enterprise\/corporates\/[a-zA-Z0-9_-]{1,191}\/members\/[a-zA-Z0-9_-]{1,191}\/(administrator|policy|exit)$/u.test(path)) return undefined;
  throw new Error("原成员变更路径无法精确核对，保留原引用 / Original member-change reference unavailable");
};
const memberChangeResultMatches = (result: unknown, target: NonNullable<ReturnType<typeof memberChangeTarget>>) => {
  const row = result as { membershipId?: unknown; status?: unknown; updatedAt?: unknown } | null;
  return row && !Array.isArray(row) && row.membershipId === target.membershipId && typeof row.status === "string" && ["active", "suspended", "exited"].includes(row.status)
    && typeof row.updatedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.updatedAt)
    && Number.isFinite(Date.parse(row.updatedAt)) && new Date(row.updatedAt).toISOString() === row.updatedAt;
};
const memberExitTarget = (path: string) => {
  if (!path.startsWith("/enterprise/corporates/") || !path.includes("/members/") || !path.includes("/exit")) return undefined;
  const match = /^\/enterprise\/corporates\/([a-zA-Z0-9_-]{1,191})\/members\/([a-zA-Z0-9_-]{1,191})\/exit$/u.exec(path);
  if (!match) throw new Error("原退出路径无法精确核对，保留原引用 / Original exit reference unavailable");
  return { corporateId: match[1], membershipId: match[2] };
};
const memberExitResultMatches = (result: unknown, target: NonNullable<ReturnType<typeof memberExitTarget>>) => {
  const row = result as { membershipId?: unknown; status?: unknown; updatedAt?: unknown } | null;
  return row && row.membershipId === target.membershipId && row.status === "exited" && typeof row.updatedAt === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.updatedAt) && Number.isFinite(Date.parse(row.updatedAt))
    && new Date(row.updatedAt).toISOString() === row.updatedAt;
};
const storedReference = (pending: Pending) => ({ key: pending.key, path: pending.path, state: pending.state, ...(pending.originalTarget ? { originalTarget: pending.originalTarget } : {}), ...(pending.closureKey ? { closureKey: pending.closureKey } : {}) });
function readReference(key: string): Pending | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error("原操作引用不可读取，不能重新派发 / Original reference unavailable"); }
  if (!value || typeof value.key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.key)
    || typeof value.path !== "string" || !/^\/enterprise\/[a-zA-Z0-9_/%-]+$/u.test(value.path) && !inspectionConsentTarget(value.path) || value.path.length > 600
    || value.originalTarget !== undefined && (!allowsOriginalTarget(value.path) || typeof value.originalTarget !== "string" || !value.originalTarget || value.originalTarget.length > 191)
    || value.closureKey !== undefined && ((!transferDecisionTarget(value.path) && (!["/enterprise/extension-approvals", "/enterprise/exchange-approvals"].includes(value.path) || !value.originalTarget)) || typeof value.closureKey !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.closureKey) || value.closureKey === value.key)
    || !["unknown", "committed"].includes(value.state)) throw new Error("原操作引用不可读取，不能重新派发 / Original reference unavailable");
  return { key: value.key, path: value.path, state: value.state, body: "", originalTarget: value.originalTarget, closureKey: value.closureKey };
}
function rememberReference(key: string, pending: Pending) {
  const value = JSON.stringify(storedReference(pending));
  localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw new Error("原操作引用未可靠保存，未发送新命令 / Original reference was not saved");
}
function forgetReference(key: string) {
  localStorage.removeItem(key);
  if (localStorage.getItem(key) !== null) throw new Error("原操作已完成但引用尚未清除，仅可继续回读 / Original reference still retained");
}
const sessionChanged = () => new Error("身份已变化，原操作已隔离；不能在新身份重发 / Identity changed; the original operation is isolated");
export function workflowError(error: unknown) { return error instanceof Error ? error.message : "操作失败 / Operation failed"; }

export type OriginalMemberWorkflowReference = { storageKey: string; corporateId?: string; operationKey?: string; membershipId?: string; administrator?: boolean; scope?: "invites" | "join" | "join-review" | "applications" | "management-requests" | `policy:${string}`; policySave?: boolean; managementSave?: boolean; managementRequestId?: string; inviteId?: string; joinRequestId?: string; joinSubmission?: boolean; applicationId?: string; applicationSave?: boolean; recoverable: boolean };
type MemberReadOnlyRecovery = { originalCorporateId: string; originalOperationKey: string; originalPolicySave?: boolean; originalManagementSave?: boolean; originalManagementRequestId?: string; originalMembershipId?: string; originalAdministrator?: boolean; originalInviteId?: string; originalJoinRequestId?: string; originalJoinSubmission?: boolean; originalApplicationId?: string; originalApplicationSave?: boolean };
/** Discover only this customer's existing members slots in the current workspace.
 * Key names are enumerated; other owners' values are never read. Local references
 * select a registered GET, not authorization or evidence of a server commit. */
export function originalMemberWorkflowReferences(tenantCode: string, customerId: string, workspaceCode?: string): OriginalMemberWorkflowReference[] {
  return originalWorkflowReferences("members", tenantCode, customerId, workspaceCode);
}
export function originalInviteWorkflowReferences(tenantCode: string, customerId: string, workspaceCode?: string): OriginalMemberWorkflowReference[] {
  return originalWorkflowReferences("invites", tenantCode, customerId, workspaceCode);
}
export function originalJoinWorkflowReferences(tenantCode: string, customerId: string, workspaceCode?: string): OriginalMemberWorkflowReference[] {
  return originalWorkflowReferences("join", tenantCode, customerId, workspaceCode);
}
export function originalJoinReviewReferences(tenantCode: string, customerId: string, workspaceCode?: string): OriginalMemberWorkflowReference[] {
  return originalWorkflowReferences("join-review", tenantCode, customerId, workspaceCode);
}
export function originalApplicationWorkflowReferences(tenantCode: string, customerId: string, workspaceCode?: string): OriginalMemberWorkflowReference[] {
  return originalWorkflowReferences("applications", tenantCode, customerId, workspaceCode);
}
/** Policy scopes already include the member ID. Parse key names before reading values;
 * neither a different owner nor a rewritten path may select another policy slot. */
export function originalPolicyWorkflowReferences(tenantCode: string, customerId: string, workspaceCode?: string): OriginalMemberWorkflowReference[] {
  if (!tenantCode?.trim() || !customerId?.trim()) throw new Error("当前本人引用范围不可读取 / Current reference scope unavailable");
  const namespace = "rental-os:enterprise-workflow:", names = new Set<string>();
  for (let index = 0, length = localStorage.length; index < length; index++) { const key = localStorage.key(index); if (key?.startsWith(namespace)) names.add(key); }
  const result: OriginalMemberWorkflowReference[] = [];
  for (const storageKey of [...names].sort()) {
    let parts: unknown;
    try { parts = JSON.parse(storageKey.slice(namespace.length)); } catch { continue; }
    if (!Array.isArray(parts) || parts.length !== 5 || typeof parts[0] !== "string" || !parts[0].startsWith("policy:")
      || parts[1] !== tenantCode || parts[2] !== customerId || parts[3] !== (workspaceCode ?? null) || storageKey !== namespace + JSON.stringify(parts)) continue;
    const scope = parts[0] as `policy:${string}`, corporateId = parts[4], unavailable: OriginalMemberWorkflowReference = { storageKey, scope, recoverable: false };
    if (typeof corporateId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(corporateId) || !/^policy:(?:[a-zA-Z0-9_-]{1,191})?$/u.test(scope)) { result.push(unavailable); continue; }
    try {
      const reference = readReference(storageKey), target = reference && policySaveTarget(reference.path);
      result.push(reference && !reference.closureKey && !reference.originalTarget && target?.corporateId === corporateId && scope === `policy:${target.membershipId ?? ""}`
        ? { storageKey, scope, corporateId, operationKey: reference.key, membershipId: target.membershipId, policySave: true, recoverable: true } : unavailable);
    } catch { result.push(unavailable); }
  }
  return result;
}
export function originalManagementWorkflowReferences(tenantCode: string, customerId: string, workspaceCode?: string): OriginalMemberWorkflowReference[] {
  return originalWorkflowReferences("management-requests", tenantCode, customerId, workspaceCode);
}
function originalWorkflowReferences(scope: "members" | "invites" | "join" | "join-review" | "applications" | "management-requests", tenantCode: string, customerId: string, workspaceCode?: string): OriginalMemberWorkflowReference[] {
  if (!tenantCode?.trim() || !customerId?.trim()) throw new Error("当前本人引用范围不可读取 / Current reference scope unavailable");
  const namespace = "rental-os:enterprise-workflow:", owner = [scope, tenantCode, customerId, workspaceCode ?? null];
  const prefix = namespace + JSON.stringify(owner).slice(0, -1) + ",";
  const names = new Set<string>();
  for (let index = 0, length = localStorage.length; index < length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) names.add(key);
  }
  return [...names].sort().map(storageKey => {
    const unavailable: OriginalMemberWorkflowReference = { storageKey, recoverable: false, ...(scope !== "members" ? { scope } : {}) };
    try {
      const parts: unknown = JSON.parse(storageKey.slice(namespace.length));
      if (!Array.isArray(parts) || parts.length !== 5 || parts.slice(0, 4).some((part, index) => part !== owner[index])
        || typeof parts[4] !== "string" || !((scope === "join" || scope === "applications" || scope === "management-requests") && parts[4] === "") && !/^[a-zA-Z0-9_-]{1,191}$/u.test(parts[4])
        || storageKey !== namespace + JSON.stringify(parts)) return unavailable;
      const corporateId = parts[4], reference = readReference(storageKey);
      if (!reference || reference.closureKey || reference.originalTarget) return { ...unavailable, corporateId };
      if (scope === "management-requests") {
        if (managementSaveTarget(reference.path) === corporateId) return { storageKey, corporateId, operationKey: reference.key, scope, managementSave: true, recoverable: true };
        const managementRequestId = managementWithdrawalTarget(reference.path);
        return managementRequestId ? { storageKey, corporateId, operationKey: reference.key, scope, managementRequestId, recoverable: true } : { ...unavailable, corporateId };
      }
      if (scope === "applications") {
        if (applicationSaveTarget(reference.path)) return { storageKey, corporateId, operationKey: reference.key, scope, applicationSave: true, recoverable: true };
        const applicationId = applicationWithdrawalTarget(reference.path);
        return applicationId ? { storageKey, corporateId, operationKey: reference.key, scope, applicationId, recoverable: true } : { ...unavailable, corporateId };
      }
      if (scope === "join-review") {
        const target = joinReviewTarget(reference.path);
        return target?.corporateId === corporateId ? { storageKey, corporateId, operationKey: reference.key, scope, joinRequestId: target.requestId, recoverable: true } : { ...unavailable, corporateId };
      }
      if (scope === "join") {
        if (joinSubmissionTarget(reference.path)) return { storageKey, corporateId, operationKey: reference.key, scope, joinSubmission: true, recoverable: true };
        const joinRequestId = joinWithdrawalTarget(reference.path);
        return joinRequestId ? { storageKey, corporateId, operationKey: reference.key, scope, joinRequestId, recoverable: true } : { ...unavailable, corporateId };
      }
      if (scope === "invites") {
        const revocation = inviteRevocationTarget(reference.path);
        if (revocation?.corporateId === corporateId) return { storageKey, corporateId, operationKey: reference.key, scope, inviteId: revocation.inviteId, recoverable: true };
        return inviteCreationTarget(reference.path) === corporateId
          ? { storageKey, corporateId, operationKey: reference.key, scope, recoverable: true } : { ...unavailable, corporateId };
      }
      const administrator = administratorChangeTarget(reference.path);
      if (administrator?.corporateId === corporateId) return { storageKey, corporateId, operationKey: reference.key, membershipId: administrator.membershipId, administrator: true, recoverable: true };
      const change = memberChangeTarget(reference.path);
      if (change?.corporateId === corporateId) return { storageKey, corporateId, operationKey: reference.key, membershipId: change.membershipId, recoverable: true };
      if (transferInitiationTarget(reference.path) !== corporateId) return { ...unavailable, corporateId };
      return { storageKey, corporateId, operationKey: reference.key, recoverable: true };
    } catch { return unavailable; }
  });
}

export function useOriginalWorkflowOperation(scope: string, recovery?: MemberReadOnlyRecovery) {
  const context = useEnterprise();
  const identity = context.identity;
  const readOnly = recovery !== undefined, originalOperationKey = recovery?.originalOperationKey, originalMembershipId = recovery?.originalMembershipId, originalInviteId = recovery?.originalInviteId, originalJoinRequestId = recovery?.originalJoinRequestId, originalApplicationId = recovery?.originalApplicationId;
  const operationCorporateId = recovery?.originalCorporateId ?? (scope === "rental-handoff" ? "" : context.selectedCorporateId), originalAdministrator = recovery?.originalAdministrator ?? false, originalJoinSubmission = recovery?.originalJoinSubmission ?? false, originalApplicationSave = recovery?.originalApplicationSave ?? false, originalPolicySave = recovery?.originalPolicySave ?? false;
  const originalManagementSave = recovery?.originalManagementSave ?? false, originalManagementRequestId = recovery?.originalManagementRequestId;
  const policyRecovery = originalPolicySave && scope === `policy:${originalMembershipId ?? ""}`;
  const recoveryError = readOnly && ((scope !== "members" && scope !== "invites" && scope !== "join" && scope !== "join-review" && scope !== "applications" && scope !== "management-requests" && !policyRecovery)
    || typeof originalManagementSave !== "boolean" || scope === "management-requests" && !originalManagementSave && originalManagementRequestId === undefined
    || scope !== "management-requests" && (originalManagementSave || originalManagementRequestId !== undefined)
    || originalManagementRequestId !== undefined && (originalManagementSave || typeof originalManagementRequestId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(originalManagementRequestId))
    || scope === "management-requests" && (originalPolicySave || originalMembershipId !== undefined || originalAdministrator || originalInviteId !== undefined || originalJoinRequestId !== undefined || originalJoinSubmission || originalApplicationId !== undefined || originalApplicationSave)
    || typeof originalPolicySave !== "boolean" || originalPolicySave && (!policyRecovery || originalAdministrator || originalInviteId !== undefined || originalJoinRequestId !== undefined || originalJoinSubmission || originalApplicationId !== undefined || originalApplicationSave) || scope === "invites" && (originalMembershipId !== undefined || originalAdministrator)
    || (scope === "join" || scope === "join-review") && (originalMembershipId !== undefined || originalInviteId !== undefined || originalAdministrator || !originalJoinSubmission && originalJoinRequestId === undefined)
    || typeof originalJoinSubmission !== "boolean" || originalJoinSubmission && (scope !== "join" || originalJoinRequestId !== undefined)
    || scope === "applications" && (!originalApplicationSave && originalApplicationId === undefined || originalMembershipId !== undefined || originalInviteId !== undefined || originalJoinRequestId !== undefined || originalAdministrator)
    || typeof originalApplicationSave !== "boolean" || originalApplicationSave && (scope !== "applications" || originalApplicationId !== undefined)
    || originalApplicationId !== undefined && (scope !== "applications" || typeof originalApplicationId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(originalApplicationId))
    || originalJoinRequestId !== undefined && ((scope !== "join" && scope !== "join-review") || typeof originalJoinRequestId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(originalJoinRequestId))
    || originalInviteId !== undefined && (scope !== "invites" || typeof originalInviteId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(originalInviteId))
    || !((scope === "join" || scope === "applications" || scope === "management-requests" && originalManagementRequestId !== undefined) && operationCorporateId === "") && !/^[a-zA-Z0-9_-]{1,191}$/u.test(operationCorporateId)
    || typeof originalOperationKey !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(originalOperationKey)
    || typeof originalAdministrator !== "boolean" || originalAdministrator && originalMembershipId === undefined
    || originalMembershipId !== undefined && (typeof originalMembershipId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(originalMembershipId))) ? "原成员只读引用无效 / Original read-only reference unavailable" : "";
  const recoveryBinding = JSON.stringify([originalOperationKey, originalMembershipId, originalAdministrator, originalInviteId, originalJoinRequestId, originalJoinSubmission, originalApplicationId, originalApplicationSave, originalPolicySave, originalManagementSave, originalManagementRequestId]);
  const latestRecoveryBinding = useRef(recoveryBinding); latestRecoveryBinding.current = recoveryBinding;
  const assertWritable = () => { if (readOnly) throw new Error("本人恢复入口只读，不能派发新命令 / Recovery is read-only"); };
  const owner = useRef(context); owner.current = context;
  const mounted = useRef(true);
  const [, render] = useState(0);
  const [failure, setFailure] = useState<{ scopeKey: string; message: string }>();
  const report = (error?: unknown) => {
    if (mounted.current && latestSlotKey.current === slotKey && owner.current.identity === identity) setFailure(error === undefined ? undefined : { scopeKey: slotKey, message: workflowError(error) });
  };
  const generation = customerSessionGeneration(context.tenantCode);
  // Permission revisions invalidate running callbacks, not the original receipt
  // reference. The same customer can re-read a committed command after losing grants.
  const slotKey = JSON.stringify([scope, context.tenantCode, context.session?.customer.customerId, generation, operationCorporateId]);
  const latestSlotKey = useRef(slotKey); latestSlotKey.current = slotKey;
  // Logout/new login discards visible material, without asserting the old operation rolled back.
  for (const [key, old] of unresolved) if (old.tenantCode === context.tenantCode && old.generation !== generation) unresolved.delete(key);
  // A read-only historical company selects the SAME original slot and Web Lock,
  // without changing the current enterprise selection or creating a new namespace.
  const storageKey = `rental-os:enterprise-workflow:${JSON.stringify([scope, context.tenantCode, context.session?.customer.customerId, context.session?.workspace?.workspaceCode, operationCorporateId])}`;
  const operationRef = useRef<Slot>({ busy: false, tenantCode: context.tenantCode, generation });
  let storageError = recoveryError;
  operationRef.current = unresolved.get(slotKey) ?? { busy: false, tenantCode: context.tenantCode, generation };
  const slot = operationRef.current;
  if (!slot.pending && context.session && !recoveryError) {
    try { const saved = readReference(storageKey); if (saved) { slot.pending = saved; unresolved.set(slotKey, slot); } }
    catch (error) { storageError = workflowError(error); }
  }
  const assertCurrent = () => {
    if (recoveryError) throw new Error(recoveryError);
    if (latestRecoveryBinding.current !== recoveryBinding) throw sessionChanged();
    if (!mounted.current || latestSlotKey.current !== slotKey || owner.current.identity !== identity || context.signal.aborted
      || customerSessionGeneration(context.tenantCode) !== generation || !context.session) throw sessionChanged();
  };
  const publish = () => { if (mounted.current && latestSlotKey.current === slotKey && owner.current.identity === identity) render(n => n + 1); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const read = async <T,>(path: string, signal?: AbortSignal) => {
    assertCurrent();
    const originalPath = originalManagementRequestId !== undefined ? managementWithdrawalOriginalPath(originalManagementRequestId, originalOperationKey!) : originalManagementSave ? managementSaveOriginalPath(operationCorporateId, originalOperationKey!) : originalPolicySave ? policySaveOriginalPath({ corporateId: operationCorporateId, membershipId: originalMembershipId }, originalOperationKey!) : scope === "applications" ? originalApplicationSave ? `/enterprise/applications/save-operations/${encodeURIComponent(originalOperationKey!)}` : `/enterprise/applications/${encodeURIComponent(originalApplicationId!)}/withdraw-operations/${encodeURIComponent(originalOperationKey!)}` : scope === "join-review" ? `/enterprise/corporates/${encodeURIComponent(operationCorporateId)}/join-requests/${encodeURIComponent(originalJoinRequestId!)}/decision-operations/${encodeURIComponent(originalOperationKey!)}` : scope === "join" ? originalJoinSubmission ? `/enterprise/join/request-operations/${encodeURIComponent(originalOperationKey!)}` : `/enterprise/join-requests/${encodeURIComponent(originalJoinRequestId!)}/withdraw-operations/${encodeURIComponent(originalOperationKey!)}` : scope === "invites"
      ? originalInviteId !== undefined ? `/enterprise/corporates/${encodeURIComponent(operationCorporateId)}/invites/${encodeURIComponent(originalInviteId)}/revoke-operations/${encodeURIComponent(originalOperationKey!)}`
        : `/enterprise/corporates/${encodeURIComponent(operationCorporateId)}/invites/create-operations/${encodeURIComponent(originalOperationKey!)}` : originalMembershipId !== undefined
      ? `/enterprise/corporates/${encodeURIComponent(operationCorporateId)}/members/${encodeURIComponent(originalMembershipId)}/${originalAdministrator ? "administrator/" : ""}change-operations/${encodeURIComponent(originalOperationKey!)}`
      : `/enterprise/corporates/${encodeURIComponent(operationCorporateId)}/transfers/request-operations/${encodeURIComponent(originalOperationKey!)}`;
    if (readOnly && path !== originalPath) throw new Error("本人恢复仅支持登记的原成员操作精确回读 / Only the registered original member-operation reader is available");
    const result = await context.read<T>(path, signal ? AbortSignal.any([signal, context.signal]) : context.signal);
    assertCurrent(); return result;
  };
  const finish = () => { forgetReference(storageKey); slot.pending = undefined; };
  const reserve = () => {
    assertCurrent(); assertWritable();
    // Another page/realm may have retained the same original scope since render.
    const saved = readReference(storageKey);
    if (saved && !slot.pending) { slot.pending = saved; unresolved.set(slotKey, slot); }
    if (storageError) throw new Error(storageError);
    const active = unresolved.get(slotKey);
    if (active?.busy || active?.pending) throw new Error("请先核对原操作，不能重新发送业务写入 / Read the original result before another write");
    slot.busy = true; unresolved.set(slotKey, slot); publish();
  };
  const run = async <T,>(prepare: () => Command | Promise<Command>, afterCommit: (value: T) => Promise<void>, onRevisionConflict?: () => Promise<void>) => {
    reserve();
    try {
      if (!navigator.locks?.request) throw new Error("缺少跨页面原操作协调能力，请勿提交 / Original operation coordination unavailable");
      return await navigator.locks.request(`${storageKey}:dispatch`, async () => {
      assertCurrent();
      const saved = readReference(storageKey);
      if (saved) { slot.pending = saved; publish(); throw new Error("请先核对原操作，不能重新发送业务写入 / Read the original result before another write"); }
      const command = await prepare(); assertCurrent();
      const inspectionOrderId = inspectionConsentTarget(command.path);
      if (inspectionOrderId && (!inspectionConsentScopeMatches(scope, inspectionOrderId) || !command.originalTarget
        || !/^[A-Za-z0-9._:-]{1,191}$/u.test(command.originalTarget) || command.method !== undefined && command.method !== "POST")) throw new Error("原检查同意对象或scope不一致，未创建原键");
      const exit = memberExitTarget(command.path), initiation = transferInitiationTarget(command.path), change = memberChangeTarget(command.path), administrator = administratorChangeTarget(command.path), invitation = inviteCreationTarget(command.path), revocation = inviteRevocationTarget(command.path), withdrawal = joinWithdrawalTarget(command.path), joinReview = joinReviewTarget(command.path), submission = joinSubmissionTarget(command.path), applicationWithdrawal = applicationWithdrawalTarget(command.path), applicationSave = applicationSaveTarget(command.path), policySave = policySaveTarget(command.path), managementSave = managementSaveTarget(command.path), managementWithdrawal = managementWithdrawalTarget(command.path), rentalHandoff = rentalHandoffTarget(command.path), rentalHandoffWithdrawal = rentalHandoffWithdrawalTarget(command.path);
      if (Boolean(rentalHandoff || rentalHandoffWithdrawal) !== (scope === "rental-handoff")) throw new Error("原交接申请scope不匹配，未创建原键 / Original rental-handoff scope mismatch");
      if ((invitation || revocation || withdrawal || joinReview || submission || applicationWithdrawal || applicationSave || managementSave || managementWithdrawal || rentalHandoff || rentalHandoffWithdrawal) && command.method !== undefined && command.method !== "POST") throw new Error("原邀请创建只支持登记 POST，未创建原键 / Original invite creation requires the registered POST");
      if (managementWithdrawal && scope !== "management-requests") throw new Error("原管理申请撤回 scope 不匹配，未创建原键 / Original management-withdrawal scope mismatch");
      if (managementSave && (scope !== "management-requests" || operationCorporateId !== managementSave)) throw new Error("原管理申请的企业与 scope 不匹配，未创建原键 / Original management-save scope mismatch");
      if (scope.startsWith("policy:") && !policySave) throw new Error("政策 scope 不支持此写路径，未创建原键 / Unsupported policy write path");
      if (policySave && (command.method !== "PUT" || scope !== `policy:${policySave.membershipId ?? ""}` || operationCorporateId !== policySave.corporateId)) throw new Error("原政策只支持登记对象与 scope 的 PUT，未创建原键 / Original policy requires its registered PUT and scope");
      if ((change || administrator) && command.method !== "PUT") throw new Error("原成员变更只支持登记 PUT，未创建原键 / Original member change requires the registered PUT");
      const pending: Pending = { key: crypto.randomUUID(), path: command.path, body: JSON.stringify(command.input), state: "unknown", originalTarget: command.originalTarget };
      if (pending.originalTarget !== undefined && (!allowsOriginalTarget(pending.path) || typeof pending.originalTarget !== "string" || !pending.originalTarget || pending.originalTarget.length > 191)) throw new Error("原续租目标引用无效");
      rememberReference(storageKey, pending);
      slot.pending = pending; publish();
      const sameNarrowReference = () => {
        const latest = readReference(storageKey);
        return latest && latest.key === pending.key && latest.path === pending.path && !latest.closureKey && !latest.originalTarget;
      };
      const sameInspectionReference = () => {
        const saved = readReference(storageKey);
        return saved && saved.key === pending.key && saved.path === pending.path && saved.originalTarget === pending.originalTarget && !saved.closureKey;
      };
      let value: T;
      try {
        assertCurrent();
        // Dispatch the frozen body once, never the form's later values or a pending operation again.
        value = await context.write<T>(pending.path, { ...JSON.parse(pending.body), operationKey: pending.key }, command.method);
        if (inspectionOrderId) {
          const consent = enterpriseExchangeInspectionConsentSnapshot(value, { orderId: inspectionOrderId,
            customerId: context.session!.customer.customerId, preparationId: pending.originalTarget!, operationKey: pending.key });
          const originalInput = JSON.parse(pending.body);
          if (!consent || consent.preparationHash !== originalInput.preparationHash || consent.materialHash !== originalInput.materialHash
            || consent.expectedOrderUpdatedAt !== originalInput.expectedOrderUpdatedAt) throw new Error("原检查同意结果与本次材料不一致，保留原键");
        }
        if (exit && !memberExitResultMatches(value, exit)) throw new Error("原退出结果缺少精确关系、状态或修订，保留原引用");
        if (initiation && !transferInitiationResultMatches(value)) throw new Error("原交接发起结果缺少原工作流、pending 或初始修订，保留原引用");
        if (change && !memberChangeResultMatches(value, change)) throw new Error("原成员变更结果缺少精确关系、状态或修订，保留原引用");
        if (administrator && !administratorChangeResultMatches(value, administrator)) throw new Error("原管理员变更结果缺少精确关系、动作或修订，保留原引用");
        if (invitation && !inviteCreationResultMatches(value, invitation, true)) throw new Error("原邀请创建结果无法精确核对，保留原引用");
        if (revocation && !inviteRevocationResultMatches(value, revocation)) throw new Error("原邀请停用结果无法精确核对，保留原引用");
        if (withdrawal && !workflowWithdrawalResultMatches(value, withdrawal)) throw new Error("原加入申请撤回结果无法精确核对，保留原引用");
        if (joinReview && !joinReviewResultMatches(value, joinReview)) throw new Error("原加入审核结果无法精确核对，保留原引用");
        if (submission && !joinSubmissionResultMatches(value)) throw new Error("原加入提交结果无法精确核对，保留原引用");
        if (applicationWithdrawal && !workflowWithdrawalResultMatches(value, applicationWithdrawal)) throw new Error("原企业申请撤回结果无法精确核对，保留原引用");
        if (applicationSave && !applicationSaveResultMatches(value)) throw new Error("原企业申请保存结果无法精确核对，保留原引用");
        if (policySave && !policySaveResultMatches(value, policySave)) throw new Error("原政策保存结果缺少精确对象或修订，保留原引用");
        if (managementSave && (!managementSaveResultMatches(value, managementSave) || !managementSaveInputMatches(value, pending.body))) throw new Error("原管理申请保存结果无法精确核对，保留原引用");
        if (managementWithdrawal && !workflowWithdrawalResultMatches(value, managementWithdrawal)) throw new Error("原管理申请撤回结果无法精确核对，保留原引用");
        if (rentalHandoffWithdrawal && !rentalHandoffWithdrawalMatches(value, rentalHandoffWithdrawal, pending.body)) throw new Error("原交接撤回结果不可核对，保留原键");
        if (rentalHandoff && !rentalHandoffResultMatches(value, rentalHandoff)) throw new Error("原交接创建结果不可核对，保留原键 / Original rental-handoff result unavailable");
        pending.state = "committed";
      } catch (error) {
        // This named 409 is the service's known pre-write CAS refusal, not a missing receipt inference.
        if ((error as { status?: number; code?: string })?.status === 409
          && (error as { code?: string }).code === "enterprise_revision_conflict") {
          assertCurrent();
          if ((policySave || managementSave || managementWithdrawal || rentalHandoff || rentalHandoffWithdrawal) && !sameNarrowReference()) throw new Error("原政策引用已变化，不能因冲突清除其他请求 / Original policy reference changed");
          finish();
          if (onRevisionConflict) { await onRevisionConflict(); assertCurrent(); }
        }
        throw error;
      }
      assertCurrent();
      if (inspectionOrderId && !sameInspectionReference()) throw new Error("原检查同意引用已变化，保留原键");
      if ((exit || initiation || change || administrator || invitation || revocation || withdrawal || joinReview || submission || applicationWithdrawal || applicationSave || policySave || managementSave || managementWithdrawal || rentalHandoff || rentalHandoffWithdrawal) && !sameNarrowReference()) throw new Error("原退出引用已变化，不能覆盖其他请求");
      rememberReference(storageKey, pending); publish();
      try { await afterCommit(value); assertCurrent(); }
      catch (error) { assertCurrent(); throw new Error(`已提交，后续读取失败；仅可刷新已提交结果 / Committed; refresh failed: ${workflowError(error)}`); }
      if (inspectionOrderId && !sameInspectionReference()) throw new Error("原检查同意引用已变化，保留原键");
      if ((exit || initiation || change || administrator || invitation || revocation || withdrawal || joinReview || submission || applicationWithdrawal || applicationSave || policySave || managementSave || managementWithdrawal || rentalHandoff || rentalHandoffWithdrawal) && !sameNarrowReference()) throw new Error("原退出引用已变化，不能清除其他请求");
      // A specific inspection has one customer consent. Keep its acknowledged
      // reference for remount and merchant handover instead of issuing another C.
      if (inspectionOrderId) { report(); return value; }
      finish(); report(); return value;
      });
    } catch (error) { report(error); throw error; }
    finally { slot.busy = false; if (!slot.pending) unresolved.delete(slotKey); publish(); }
  };
  const recover = async (afterCommit: (original?: EnterpriseOperationResult, path?: string) => Promise<void>) => {
    assertCurrent();
    const active = unresolved.get(slotKey);
    if (!active?.pending) return;
    if (active.busy) throw new Error("原操作仍在处理中 / Original operation is still in flight");
    active.busy = true; publish();
    try {
      if (!navigator.locks?.request) throw new Error("缺少原操作协调能力，只能保留引用 / Original coordination unavailable");
      return await navigator.locks.request(`${storageKey}:dispatch`, async () => {
      assertCurrent();
      const pending = active.pending;
      if (!pending) return;
      if (pending.closureKey) throw new Error("原申请结束须按专用精确回读核对");
      const saved = readReference(storageKey);
      if (saved && (saved.key !== pending.key || saved.closureKey !== pending.closureKey || saved.originalTarget !== pending.originalTarget || saved.path !== pending.path)) throw new Error("原操作引用已变化，不能覆盖当前请求 / Original reference changed");
      const transferId = transferDecisionTarget(pending.path), exit = memberExitTarget(pending.path), initiation = transferInitiationTarget(pending.path), change = memberChangeTarget(pending.path), administrator = administratorChangeTarget(pending.path), invitation = inviteCreationTarget(pending.path), revocation = inviteRevocationTarget(pending.path), withdrawal = joinWithdrawalTarget(pending.path), joinReview = joinReviewTarget(pending.path), submission = joinSubmissionTarget(pending.path), applicationWithdrawal = applicationWithdrawalTarget(pending.path), applicationSave = applicationSaveTarget(pending.path), policySave = policySaveTarget(pending.path), managementSave = managementSaveTarget(pending.path), managementWithdrawal = managementWithdrawalTarget(pending.path), rentalHandoff = rentalHandoffTarget(pending.path), rentalHandoffWithdrawal = rentalHandoffWithdrawalTarget(pending.path);
      if (Boolean(rentalHandoff || rentalHandoffWithdrawal) !== (scope === "rental-handoff")) throw new Error("原交接申请scope不匹配，保留原键 / Original rental-handoff scope mismatch");
      if (scope === "management-requests" && /^\/enterprise\/corporates\//u.test(pending.path) && !managementSave) throw new Error("原管理申请缺少专用保存路径，保留原引用 / Original management-save path unavailable");
      if (managementSave && (scope !== "management-requests" || managementSave !== operationCorporateId)) throw new Error("原管理申请企业与 storage scope 不匹配，保留原引用 / Original management-save scope mismatch");
      if (scope.startsWith("policy:") && !policySave) throw new Error("原政策缺少登记的精确路径，保留原引用 / Original policy path unavailable");
      if (policySave && (scope !== `policy:${policySave.membershipId ?? ""}` || policySave.corporateId !== operationCorporateId)) throw new Error("原政策对象与 storage scope 不匹配，保留原引用 / Original policy scope mismatch");
      const originalMember = originalAdministrator ? administrator : change;
      const readonlyInviteMatches = originalInviteId !== undefined
        ? Boolean(revocation && revocation.corporateId === operationCorporateId && revocation.inviteId === originalInviteId) : !revocation && invitation === operationCorporateId;
      const readonlyTargetMatches = originalManagementRequestId !== undefined ? managementWithdrawal === originalManagementRequestId : originalManagementSave ? managementSave === operationCorporateId : originalPolicySave ? Boolean(policySave && policySave.corporateId === operationCorporateId && policySave.membershipId === originalMembershipId) : scope === "applications" ? originalApplicationSave ? applicationSave : applicationWithdrawal === originalApplicationId : scope === "join-review" ? Boolean(joinReview && joinReview.corporateId === operationCorporateId && joinReview.requestId === originalJoinRequestId) : scope === "join" ? originalJoinSubmission ? submission : withdrawal === originalJoinRequestId : scope === "invites" ? readonlyInviteMatches : originalMembershipId !== undefined
        ? Boolean(originalMember && originalMember.corporateId === operationCorporateId && originalMember.membershipId === originalMembershipId)
        : !change && !administrator && initiation === operationCorporateId;
      if (readOnly && (pending.key !== originalOperationKey || !readonlyTargetMatches || pending.originalTarget || transferId || exit)) throw new Error("原成员引用已变化或缺少专用回读，保留原键 / Original member reference changed or has no dedicated reader");
      const matchesTransferReference = () => {
        const latest = readReference(storageKey);
        return latest && JSON.stringify(storedReference(latest)) === JSON.stringify(storedReference(pending));
      };
      if ((transferId || exit || initiation || change || administrator || invitation || revocation || withdrawal || joinReview || submission || applicationWithdrawal || applicationSave || policySave || managementSave || managementWithdrawal || rentalHandoff || rentalHandoffWithdrawal) && !matchesTransferReference()) throw new Error("原操作引用已变化，不能覆盖当前请求");
      let receipt: EnterpriseOperationResult | undefined;
      // Local markers do not prove server commit. Narrow transfer/exit readers
      // always follow the original owner/object/key, including a failed known-commit refresh.
      if (pending.state !== "committed" || !pending.body || transferId || exit || initiation || change || administrator || invitation || revocation || withdrawal || joinReview || submission || applicationWithdrawal || applicationSave || policySave || managementSave || managementWithdrawal || rentalHandoff || rentalHandoffWithdrawal) {
        const path = rentalHandoffWithdrawal ? `/enterprise/handoff-requests/${encodeURIComponent(rentalHandoffWithdrawal)}/withdraw-operations/${encodeURIComponent(pending.key)}` : rentalHandoff ? `/enterprise/orders/${encodeURIComponent(rentalHandoff)}/handoff-requests/create-operations/${encodeURIComponent(pending.key)}` : managementWithdrawal ? managementWithdrawalOriginalPath(managementWithdrawal, pending.key) : managementSave ? managementSaveOriginalPath(managementSave, pending.key) : policySave ? policySaveOriginalPath(policySave, pending.key) : applicationSave ? `/enterprise/applications/save-operations/${encodeURIComponent(pending.key)}` : applicationWithdrawal ? `/enterprise/applications/${encodeURIComponent(applicationWithdrawal)}/withdraw-operations/${encodeURIComponent(pending.key)}` : submission ? `/enterprise/join/request-operations/${encodeURIComponent(pending.key)}` : joinReview ? `/enterprise/corporates/${encodeURIComponent(joinReview.corporateId)}/join-requests/${encodeURIComponent(joinReview.requestId)}/decision-operations/${encodeURIComponent(pending.key)}` : withdrawal ? `/enterprise/join-requests/${encodeURIComponent(withdrawal)}/withdraw-operations/${encodeURIComponent(pending.key)}` : revocation ? `/enterprise/corporates/${encodeURIComponent(revocation.corporateId)}/invites/${encodeURIComponent(revocation.inviteId)}/revoke-operations/${encodeURIComponent(pending.key)}`
          : invitation ? `/enterprise/corporates/${encodeURIComponent(invitation)}/invites/create-operations/${encodeURIComponent(pending.key)}`
          : transferId ? `/enterprise/transfers/${encodeURIComponent(transferId)}/decision-operations/${encodeURIComponent(pending.key)}`
          : exit ? `/enterprise/corporates/${encodeURIComponent(exit.corporateId)}/members/${encodeURIComponent(exit.membershipId)}/exit-operations/${encodeURIComponent(pending.key)}`
          : administrator ? `/enterprise/corporates/${encodeURIComponent(administrator.corporateId)}/members/${encodeURIComponent(administrator.membershipId)}/administrator/change-operations/${encodeURIComponent(pending.key)}`
          : change ? `/enterprise/corporates/${encodeURIComponent(change.corporateId)}/members/${encodeURIComponent(change.membershipId)}/change-operations/${encodeURIComponent(pending.key)}`
          : initiation ? `/enterprise/corporates/${encodeURIComponent(initiation)}/transfers/request-operations/${encodeURIComponent(pending.key)}`
          : `/enterprise/operations/${encodeURIComponent(pending.key)}`;
        receipt = await read<EnterpriseOperationResult>(path);
        if (receipt.state !== "committed") throw new Error("尚未读到原收据，不代表未写入；保留原请求，不能重发 / No receipt yet is not proof of no write");
        if (transferId && (receipt.result?.id !== transferId || typeof receipt.result?.state !== "string" || !["approved", "rejected"].includes(receipt.result.state)
            || typeof receipt.result?.revision !== "number" || !Number.isSafeInteger(receipt.result.revision) || receipt.result.revision < 2)) throw new Error("原交接结果缺少精确绑定，保留原引用");
        if (exit && !memberExitResultMatches(receipt.result, exit)) throw new Error("原退出结果缺少精确绑定，保留原引用");
        if (initiation && !transferInitiationResultMatches(receipt.result)) throw new Error("原交接发起结果缺少精确原依据，保留原引用");
        if (change && !memberChangeResultMatches(receipt.result, change)) throw new Error("原成员变更结果缺少精确原依据，保留原引用");
        if (administrator && !administratorChangeResultMatches(receipt.result, administrator)) throw new Error("原管理员变更结果缺少精确原依据，保留原引用");
        if (invitation && !inviteCreationResultMatches(receipt.result, invitation)) throw new Error("原邀请创建收据缺少精确绑定，原码不能回读；保留原引用");
        if (revocation && !inviteRevocationResultMatches(receipt.result, revocation)) throw new Error("原邀请停用收据缺少精确绑定，保留原引用");
        if (withdrawal && !workflowWithdrawalResultMatches(receipt.result, withdrawal)) throw new Error("原加入申请撤回收据缺少精确绑定，保留原引用");
        if (joinReview && !joinReviewResultMatches(receipt.result, joinReview)) throw new Error("原加入审核收据缺少精确绑定，保留原引用");
        if (submission && !joinSubmissionResultMatches(receipt.result)) throw new Error("原加入提交收据缺少精确绑定，保留原引用");
        if (applicationWithdrawal && !workflowWithdrawalResultMatches(receipt.result, applicationWithdrawal)) throw new Error("原企业申请撤回收据缺少精确绑定，保留原引用");
        if (applicationSave && !applicationSaveResultMatches(receipt.result)) throw new Error("原企业申请保存收据缺少精确绑定，保留原引用");
        if (policySave && !policySaveResultMatches(receipt.result, policySave, true)) throw new Error("原政策保存收据缺少精确企业、对象或修订，保留原引用");
        if (managementSave && (!managementSaveResultMatches(receipt.result, managementSave, true) || pending.body && !managementSaveInputMatches(receipt.result, pending.body))) throw new Error("原管理申请保存收据缺少精确绑定，保留原引用");
        if (managementWithdrawal && !workflowWithdrawalResultMatches(receipt.result, managementWithdrawal)) throw new Error("原管理申请撤回收据缺少精确绑定，保留原引用");
        if (rentalHandoffWithdrawal && !rentalHandoffWithdrawalMatches(receipt.result, rentalHandoffWithdrawal, pending.body)) throw new Error("原交接撤回收据不可核对，保留原键");
        if (rentalHandoff && !rentalHandoffResultMatches(receipt.result, rentalHandoff)) throw new Error("原交接创建收据缺少精确绑定，保留原键 / Original rental-handoff receipt unavailable");
        if ((transferId || exit || initiation || change || administrator || invitation || revocation || withdrawal || joinReview || submission || applicationWithdrawal || applicationSave || policySave || managementSave || managementWithdrawal || rentalHandoff || rentalHandoffWithdrawal) && !matchesTransferReference()) throw new Error("原操作引用已变化，不能覆盖当前请求");
        pending.state = "committed"; publish();
      }
      rememberReference(storageKey, pending);
      await afterCommit(receipt, pending.path); assertCurrent();
      if ((transferId || exit || initiation || change || administrator || invitation || revocation || withdrawal || joinReview || submission || applicationWithdrawal || applicationSave || policySave || managementSave || managementWithdrawal || rentalHandoff || rentalHandoffWithdrawal) && !matchesTransferReference()) throw new Error("原操作引用已变化，不能清除其他请求");
      forgetReference(storageKey); active.pending = undefined; unresolved.delete(slotKey); report();
      return receipt;
      });
    } catch (error) {
      const failure = active.pending?.state === "committed"
        ? new Error(`已提交，后续读取失败；仅可刷新已提交结果 / Committed; refresh failed: ${workflowError(error)}`) : error;
      report(failure); throw failure;
    } finally { active.busy = false; publish(); }
  };
  const reconcileExpenseRequest = async <Result extends EnterpriseExtensionRequestOriginalResult | EnterpriseExchangeRequestOriginalResult>(kind: "extension" | "exchange", pending: Pending, afterRead: (result: Result) => Promise<void>) => {
    if (pending.path !== `/enterprise/${kind}-approvals` || !pending.originalTarget) throw new Error("原申请缺少精确订单引用，不能猜测封闭");
    const path = `/enterprise/orders/${encodeURIComponent(pending.originalTarget)}/${kind}-request-operations/${encodeURIComponent(pending.key)}`;
    const original = await read<Result>(path);
    if (!enterpriseExpenseRequestMatches(original, pending.originalTarget, pending.key, context.session!.customer.customerId, context.session!.workspace!.workspaceCode)) throw new Error("原申请仍待精确核对，不能重发");
    if (pending.closureKey) {
      const receipt = await read<EnterpriseOperationResult>(`/enterprise/operations/${encodeURIComponent(pending.closureKey)}`);
      if (receipt.state !== "committed" || !enterpriseExpenseRequestClosureMatches(original, receipt.result, pending.key, pending.closureKey)) throw new Error("原申请结束收据仍待核对，不能重发");
    }
    const saved = readReference(storageKey);
    if (!saved || saved.key !== pending.key || saved.closureKey !== pending.closureKey || saved.originalTarget !== pending.originalTarget || saved.path !== pending.path) throw new Error("原操作引用已变化，不能覆盖");
    await afterRead(original); assertCurrent();
    const latest = readReference(storageKey);
    if (!latest || JSON.stringify(storedReference(latest)) !== JSON.stringify(storedReference(pending))) throw new Error("原引用已变化，不覆盖其他结束请求");
    forgetReference(storageKey); slot.pending = undefined; unresolved.delete(slotKey); report();
    return original;
  };
  const requestOperation = async <Result extends EnterpriseExtensionRequestOriginalResult | EnterpriseExchangeRequestOriginalResult>(kind: "extension" | "exchange", reason: string | undefined, afterRead: (result: Result) => Promise<void>) => {
    assertCurrent();
    if (storageError || slot.busy || !slot.pending) throw new Error(storageError || "原申请仍在处理中或缺少引用");
    slot.busy = true; publish();
    try {
      if (!navigator.locks?.request) throw new Error("缺少原操作协调能力，只能保留引用");
      return await navigator.locks.request(`${storageKey}:dispatch`, async () => {
        assertCurrent(); const pending = readReference(storageKey);
        if (!pending || pending.path !== `/enterprise/${kind}-approvals` || !pending.originalTarget || pending.key !== slot.pending?.key) throw new Error("本人原申请引用不可核对");
        slot.pending = pending;
        if (reason !== undefined) {
          if (!reason.trim() || reason.length > 500 || pending.closureKey) throw new Error("须独立确认原申请；结束结果未知只能回读");
          const reference = { ...pending, closureKey: crypto.randomUUID() };
          rememberReference(storageKey, reference); slot.pending = reference; publish();
          await context.write(`/enterprise/orders/${encodeURIComponent(reference.originalTarget!)}/${kind}-request-operations/${encodeURIComponent(reference.key)}/close`, { operationKey: reference.closureKey, expectedRevision: 0, reason, confirm: true });
          assertCurrent();
          return reconcileExpenseRequest(kind, reference, afterRead);
        }
        return reconcileExpenseRequest(kind, pending, afterRead);
      });
    } catch (error) { report(error); throw error; }
    finally { slot.busy = false; publish(); }
  };
  const sameTransferReference = (pending: Pending) => {
    const saved = readReference(storageKey);
    return saved && JSON.stringify(storedReference(saved)) === JSON.stringify(storedReference(pending));
  };
  const reconcileTransferDecision = async (pending: Pending, afterRead: (result: EnterpriseTransferDecisionResolution) => Promise<void>) => {
    const id = transferDecisionTarget(pending.path);
    if (!id || !pending.closureKey || typeof enterpriseTransferDecisionResolutionMatches !== "function") throw new Error("原交接 K/C 或正式运行时缺失，保留原引用");
    if (!sameTransferReference(pending)) throw new Error("原交接 K/C 已变化，不能覆盖");
    const original = await read<EnterpriseOperationResult>(`/enterprise/transfers/${encodeURIComponent(id)}/decision-operations/${encodeURIComponent(pending.key)}`);
    const closure = await read<EnterpriseOperationResult>(`/enterprise/operations/${encodeURIComponent(pending.closureKey)}`);
    const binding = { transferId: id, applicantCustomerId: context.session!.customer.customerId, originalOperationKey: pending.key, closureOperationKey: pending.closureKey };
    if (original.state !== "committed" || closure.state !== "committed" || !enterpriseTransferDecisionResolutionMatches(closure.result, binding)) throw new Error("原交接 K/C 收据尚未精确核对，不能清键或重发");
    const resolution = closure.result;
    if (resolution.outcome === "closed") {
      if (!enterpriseTransferDecisionResolutionMatches(original.result, { ...binding, tenantId: resolution.tenantId }) || original.result.outcome !== "closed"
          || original.result.corporateCustomerId !== resolution.corporateCustomerId || original.result.decision.state !== resolution.decision.state || original.result.decision.revision !== resolution.decision.revision) throw new Error("原交接 K/C 封闭证据不一致");
    } else if (original.result?.id !== id || original.result.state !== resolution.decision.state || original.result.revision !== resolution.decision.revision) throw new Error("原交接 K/C 观察证据不一致");
    if (!sameTransferReference(pending)) throw new Error("原交接 K/C 已变化，不覆盖其他请求");
    await afterRead(resolution); assertCurrent();
    if (!sameTransferReference(pending)) throw new Error("原交接 K/C 已变化，不清除其他请求");
    forgetReference(storageKey); slot.pending = undefined; unresolved.delete(slotKey); report();
    return resolution;
  };
  const transferDecisionOperation = async (prepare: (() => { reason: string; expectedRevision: number }) | undefined, afterRead: (result: EnterpriseTransferDecisionResolution) => Promise<void>) => {
    assertCurrent();
    if (storageError || slot.busy || !slot.pending) throw new Error(storageError || "原交接仍处理中或缺少原引用");
    if (typeof enterpriseTransferDecisionResolutionMatches !== "function") throw new Error("正式交接运行时未齐，不能派发新拒绝");
    slot.busy = true; publish();
    try {
      if (!navigator.locks?.request) throw new Error("缺少原交接协调能力，保留原引用");
      return await navigator.locks.request(`${storageKey}:dispatch`, async () => {
        assertCurrent(); const pending = readReference(storageKey), id = pending && transferDecisionTarget(pending.path);
        if (!pending || !id || !slot.pending || JSON.stringify(storedReference(pending)) !== JSON.stringify(storedReference(slot.pending))) throw new Error("本人原交接引用已变化，不能派发或清键");
        slot.pending = pending;
        if (prepare) {
          if (pending.closureKey || pending.state !== "unknown") throw new Error("已有交接结果或 C 未决，只能读原证据");
          const values = prepare(); assertCurrent();
          if (!values.reason.trim() || values.reason.length > 500 || !Number.isSafeInteger(values.expectedRevision) || values.expectedRevision < 1) throw new Error("须先明确核对本条交接及拒绝原因");
          const reference = { ...pending, closureKey: crypto.randomUUID() };
          if (reference.closureKey === reference.key || !/^[a-zA-Z0-9_-]{1,128}$/u.test(reference.closureKey)) throw new Error("独立拒绝键无效，未发送");
          rememberReference(storageKey, reference); slot.pending = reference; publish();
          try {
            await context.write(`/enterprise/transfers/${encodeURIComponent(id)}/decision-operations/${encodeURIComponent(reference.key)}/close`, { operationKey: reference.closureKey, expectedRevision: values.expectedRevision, reason: values.reason.trim(), confirm: true });
          } catch (error) {
            const failure = error as { status?: number; code?: string };
            // Only the direct, named pre-write C refusal releases C. GET absence/503 never does.
            if (failure.status === 503 && failure.code === "enterprise_transfer_resolution_unavailable" || failure.status === 409 && failure.code === "enterprise_revision_conflict") {
              assertCurrent();
              if (!sameTransferReference(reference)) throw new Error("原 C 引用已变化，不能回退其他请求");
              const restored: Pending = { ...reference }; delete restored.closureKey;
              rememberReference(storageKey, restored); slot.pending = restored; publish();
            }
            throw error;
          }
          assertCurrent(); return reconcileTransferDecision(reference, afterRead);
        }
        return reconcileTransferDecision(pending, afterRead);
      });
    } catch (error) { report(error); throw error; }
    finally { slot.busy = false; publish(); }
  };
  const recoverInspectionConsent = async (afterRead: (consent: RentalExchangeInspectionConsent) => Promise<void>) => {
    assertCurrent();
    const pending = slot.pending, orderId = pending && inspectionConsentTarget(pending.path);
    if (!pending || !orderId || !inspectionConsentScopeMatches(scope, orderId) || !pending.originalTarget || slot.busy) throw new Error("原检查同意仍待核对，请保留原引用");
    slot.busy = true; publish();
    try {
      if (!navigator.locks?.request) throw new Error("原检查同意协调能力不可用");
      await navigator.locks.request(`${storageKey}:dispatch`, async () => {
        assertCurrent();
        const before = readReference(storageKey);
        if (!before || before.key !== pending.key || before.path !== pending.path || before.originalTarget !== pending.originalTarget || before.closureKey) throw new Error("原检查同意引用已变化");
        const result = await read<RentalExchangeInspectionConsentOriginal>(`${pending.path}/operations/${encodeURIComponent(pending.key)}`);
        const consent = result.state === "observed" && result.retryable === false ? enterpriseExchangeInspectionConsentSnapshot(result.consent,
          { orderId, customerId: context.session!.customer.customerId, preparationId: pending.originalTarget!, operationKey: pending.key }) : undefined;
        if (!consent) throw new Error("原检查同意尚无可核对收据，保留原键");
        await afterRead(consent); assertCurrent();
        const after = readReference(storageKey);
        if (!after || after.key !== pending.key || after.path !== pending.path || after.originalTarget !== pending.originalTarget || after.closureKey) throw new Error("原检查同意引用已变化");
        pending.state = "committed";
        rememberReference(storageKey, pending); publish(); report();
      });
    } catch (error) { report(error); throw error; }
    finally { slot.busy = false; publish(); }
  };
  let transferDecisionId: string | undefined, exitTarget: ReturnType<typeof memberExitTarget>, transferInitiationCorporateId: string | undefined, changeTarget: ReturnType<typeof memberChangeTarget>, administratorTarget: ReturnType<typeof administratorChangeTarget>, inviteCreationCorporateId: string | undefined, inviteRevocation: ReturnType<typeof inviteRevocationTarget>, joinWithdrawalId: string | undefined, joinReview: ReturnType<typeof joinReviewTarget>, joinSubmission = false, applicationWithdrawalId: string | undefined, applicationSave = false, policyTarget: ReturnType<typeof policySaveTarget>, managementSaveCorporateId: string | undefined, managementWithdrawalId: string | undefined;
  try { transferDecisionId = slot.pending && transferDecisionTarget(slot.pending.path); exitTarget = slot.pending && memberExitTarget(slot.pending.path); transferInitiationCorporateId = slot.pending && transferInitiationTarget(slot.pending.path); changeTarget = slot.pending && memberChangeTarget(slot.pending.path); administratorTarget = slot.pending && administratorChangeTarget(slot.pending.path); inviteCreationCorporateId = slot.pending && inviteCreationTarget(slot.pending.path); inviteRevocation = slot.pending && inviteRevocationTarget(slot.pending.path); joinWithdrawalId = slot.pending && joinWithdrawalTarget(slot.pending.path); joinReview = slot.pending && joinReviewTarget(slot.pending.path); joinSubmission = Boolean(slot.pending && joinSubmissionTarget(slot.pending.path)); applicationWithdrawalId = slot.pending && applicationWithdrawalTarget(slot.pending.path); applicationSave = Boolean(slot.pending && applicationSaveTarget(slot.pending.path)); policyTarget = slot.pending && policySaveTarget(slot.pending.path); managementSaveCorporateId = slot.pending && managementSaveTarget(slot.pending.path); managementWithdrawalId = slot.pending && managementWithdrawalTarget(slot.pending.path); } catch { /* Invalid references remain blocked; never infer a new target. */ }
  let rentalHandoffOrderId: string | undefined, rentalHandoffWithdrawalId: string | undefined;
  try { rentalHandoffOrderId = slot.pending && rentalHandoffTarget(slot.pending.path); rentalHandoffWithdrawalId = slot.pending && rentalHandoffWithdrawalTarget(slot.pending.path); } catch { /* Malformed original references remain blocked. */ }
  return { pending: slot.pending, busy: slot.busy, blocked: Boolean(storageError || slot.pending || slot.busy), rentalHandoffOrderId, rentalHandoffWithdrawalId, transferDecisionId, memberExitTarget: exitTarget, transferInitiationCorporateId, memberChangeTarget: changeTarget, administratorChangeTarget: administratorTarget, inviteCreationCorporateId, inviteRevocationTarget: inviteRevocation, joinWithdrawalId, joinReviewTarget: joinReview, joinSubmission, applicationWithdrawalId, applicationSave, policySaveTarget: policyTarget, managementSaveCorporateId, managementWithdrawalId,
    recoverTransferDecision: (afterRead: (result: EnterpriseTransferDecisionResolution) => Promise<void>) => transferDecisionOperation(undefined, afterRead),
    closeTransferDecision: async (prepare: () => { reason: string; expectedRevision: number }, afterRead: (result: EnterpriseTransferDecisionResolution) => Promise<void>) => { assertWritable(); return transferDecisionOperation(prepare, afterRead); },
    recoverExtensionRequest: (afterRead: (result: EnterpriseExtensionRequestOriginalResult) => Promise<void>) => requestOperation("extension", undefined, afterRead),
    closeExtensionRequest: async (reason: string, afterRead: (result: EnterpriseExtensionRequestOriginalResult) => Promise<void>) => { assertWritable(); return requestOperation("extension", reason, afterRead); },
    recoverExchangeRequest: (afterRead: (result: EnterpriseExchangeRequestOriginalResult) => Promise<void>) => requestOperation("exchange", undefined, afterRead),
    closeExchangeRequest: async (reason: string, afterRead: (result: EnterpriseExchangeRequestOriginalResult) => Promise<void>) => { assertWritable(); return requestOperation("exchange", reason, afterRead); },
    error: storageError || (failure?.scopeKey === slotKey ? failure.message : ""), run, recover, recoverInspectionConsent, read, assertCurrent };
}
