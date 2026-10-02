import { z } from "zod";
import { AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_CODES, type AiExecutionContext, type AiExecutionScope, type AiProposalPayloadDraft, type AiApprovalBindingCheckDraft } from "@rental-os/shared";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const time = z.string().max(40).datetime({ offset: true });
const audience = z.enum(["operator", "staff", "client"]);
const scope: z.ZodType<AiExecutionScope> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("platform") }).strict(),
  z.object({ kind: z.literal("tenant"), tenantId: id }).strict(),
  z.object({ kind: z.literal("workspace"), tenantId: id, workspaceId: id }).strict()
]);
const actor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saas_admin"), userId: id }).strict(),
  z.object({ kind: z.literal("user"), userId: id }).strict(),
  z.object({ kind: z.literal("customer"), customerId: id }).strict()
]);
const snapshot = z.object({ recordId: id, revision, contentHash: hash }).strict();
const action = z.object({
  actionId: id, toolCode: z.enum(AI_TOOL_CODES), toolVersion: id, input: snapshot, preview: snapshot,
  target: z.object({ resourceType: z.enum(["order", "quote", "configuration", "customer", "inspection", "category"]), resourceId: id, version: id }).strict()
}).strict();
const payloadSchema = z.object({
  contractVersion: z.literal(AI_PROPOSAL_DRAFT_VERSION), proposalId: id, taskId: id, revision, audience, scope,
  actions: z.array(action).min(1).max(20), atomicity: z.enum(["single_action", "ordered_partial"]),
  failurePolicy: z.literal("stop_and_reconcile"), expiresAt: time
}).strict().refine(value => value.atomicity !== "single_action" || value.actions.length === 1)
  .refine(value => new Set(value.actions.map(item => item.actionId)).size === value.actions.length)
  .refine(value => value.scope.kind !== "platform" || value.audience === "operator") satisfies z.ZodType<AiProposalPayloadDraft>;
const recordSchema = z.object({ payload: payloadSchema, payloadHash: hash, status: z.enum(["pending_confirmation", "confirmed", "superseded", "cancelled", "expired"]) }).strict();
const approvalSchema = z.object({
  contractVersion: z.literal(AI_PROPOSAL_DRAFT_VERSION), approvalId: id, proposalId: id, proposalRevision: revision,
  payloadHash: hash, audience, scope, actor, decision: z.enum(["approved", "rejected"]), issuedAt: time, expiresAt: time
}).strict();
const identitySchema = z.object({ audience, scope, actor }).refine(value => {
  if (value.actor.kind === "saas_admin") return value.audience === "operator" && value.scope.kind === "platform";
  if (value.scope.kind === "platform") return false;
  return value.actor.kind === "customer" ? value.audience === "client" : value.audience === "operator" || value.audience === "staff";
});
const scopeKey = (value: AiExecutionScope) => JSON.stringify(value.kind === "platform" ? [value.kind]
  : value.kind === "tenant" ? [value.kind, value.tenantId] : [value.kind, value.tenantId, value.workspaceId]);
const deny = (reason: Extract<AiApprovalBindingCheckDraft, { valid: false }>["reason"]): AiApprovalBindingCheckDraft => ({ valid: false, reason });

/** Strictly validate before using Core's canonical fingerprint; do not silently hash a lossy JSON value. */
export function fingerprintAiProposalDraft(payload: unknown): string {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error("AI_INVALID_PROPOSAL");
  return requestFingerprint(parsed.data);
}

/**
 * Checks a persisted approval's binding, NOT business permission or single consumption.
 * Caller must still reauthorize, resolve immutable input/preview records, compare their hashes,
 * check Core state and atomically reserve/consume this action in the business transaction.
 */
export function checkAiApprovalBindingDraft(proposal: unknown, approval: unknown, currentContext: AiExecutionContext, actionId: string, now: string): AiApprovalBindingCheckDraft {
  const p = recordSchema.safeParse(proposal), a = approvalSchema.safeParse(approval);
  const current = identitySchema.safeParse(currentContext), clock = time.safeParse(now);
  if (!p.success || !a.success || !current.success || !clock.success || !id.safeParse(actionId).success) return deny("invalid_record");
  if (p.data.status !== "confirmed") return deny("proposal_inactive");
  if (a.data.decision !== "approved") return deny("approval_rejected");
  const payload = p.data.payload;
  if (requestFingerprint(payload) !== p.data.payloadHash || a.data.payloadHash !== p.data.payloadHash
    || a.data.proposalId !== payload.proposalId || a.data.proposalRevision !== payload.revision) return deny("proposal_changed");
  if (a.data.audience !== payload.audience || current.data.audience !== payload.audience
    || scopeKey(a.data.scope) !== scopeKey(payload.scope) || scopeKey(current.data.scope) !== scopeKey(payload.scope)
    || JSON.stringify(a.data.actor) !== JSON.stringify(current.data.actor)) return deny("context_changed");
  const nowMs = Date.parse(clock.data), expiresMs = Date.parse(a.data.expiresAt), issuedMs = Date.parse(a.data.issuedAt);
  if (issuedMs > nowMs || issuedMs >= expiresMs || expiresMs <= nowMs
    || Date.parse(payload.expiresAt) <= nowMs || expiresMs > Date.parse(payload.expiresAt)) return deny("approval_expired");
  if (!payload.actions.some(item => item.actionId === actionId)) return deny("action_missing");
  return { valid: true };
}
