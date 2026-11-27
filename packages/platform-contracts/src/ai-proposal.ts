import type { AiAudience, AiExecutionContext, AiExecutionScope } from './ai-context';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafList as list,
  leafTime as time, type AiLeafSchemaDraft } from './ai-leaf-schema';

/** Original C05 records. The owning application supplies its published action
 * catalogue, business facts and transaction authority. */
export const AI_PROPOSAL_DRAFT_VERSION = 'ain-c05-draft-1' as const;
export const AI_PROPOSAL_TARGETS = Object.freeze(['order', 'quote', 'configuration', 'customer', 'inspection', 'category'] as const);
export type AiProposalTarget = typeof AI_PROPOSAL_TARGETS[number];
export interface AiProposalSnapshotRefDraft {
  recordId: string;
  revision: number;
  contentHash: string;
}
export interface AiProposalActionDraft<ToolCode extends string = string, Target extends string = AiProposalTarget> {
  actionId: string;
  toolCode: ToolCode;
  toolVersion: string;
  input: AiProposalSnapshotRefDraft;
  preview: AiProposalSnapshotRefDraft;
  target: { resourceType: Target; resourceId: string; version: string };
}
export interface AiProposalPayloadDraft<ToolCode extends string = string, Target extends string = AiProposalTarget> {
  contractVersion: typeof AI_PROPOSAL_DRAFT_VERSION;
  proposalId: string;
  taskId: string;
  revision: number;
  audience: Exclude<AiAudience, 'automation'>;
  scope: AiExecutionScope;
  actions: AiProposalActionDraft<ToolCode, Target>[];
  atomicity: 'single_action' | 'ordered_partial';
  failurePolicy: 'stop_and_reconcile';
  expiresAt: string;
}
export interface AiProposalRecordDraft<ToolCode extends string = string, Target extends string = AiProposalTarget> {
  payload: AiProposalPayloadDraft<ToolCode, Target>;
  payloadHash: string;
  status: 'pending_confirmation' | 'confirmed' | 'superseded' | 'cancelled' | 'expired';
}
/** What the human reviewed. Current actor and scope always come from the server. */
export interface AiProposalDecisionRequestDraft {
  contractVersion: typeof AI_PROPOSAL_DRAFT_VERSION;
  proposalId: string;
  proposalRevision: number;
  reviewedPayloadHash: string;
  decision: 'approve' | 'reject';
}
export type AiHumanApprovalActorDraft = Exclude<AiExecutionContext['actor'], { kind: 'automation' }>;
export interface AiApprovalRecordDraft {
  contractVersion: typeof AI_PROPOSAL_DRAFT_VERSION;
  approvalId: string;
  proposalId: string;
  proposalRevision: number;
  payloadHash: string;
  audience: Exclude<AiAudience, 'automation'>;
  scope: AiExecutionScope;
  actor: AiHumanApprovalActorDraft;
  decision: 'approved' | 'rejected';
  issuedAt: string;
  expiresAt: string;
}
interface Consumption {
  contractVersion: typeof AI_PROPOSAL_DRAFT_VERSION;
  approvalId: string;
  proposalId: string;
  proposalRevision: number;
  actionId: string;
  actionFingerprint: string;
  businessIdempotencyKey: string;
}
export type AiApprovalConsumptionDraft = Consumption & (
  | { status: 'reserved' }
  | { status: 'committed'; result: AiProposalSnapshotRefDraft }
  | { status: 'unknown'; retryable: false; nextAction: 'reconcile' }
  | { status: 'failed_no_effect'; nextAction: 'revalidate_or_manual' }
);
export type AiApprovalBindingCheckDraft = { valid: true } | { valid: false;
  reason: 'invalid_record' | 'proposal_inactive' | 'proposal_changed' | 'approval_rejected' | 'context_changed' | 'approval_expired' | 'action_missing' };

/** Produces the original closed C05 leaf set for an explicitly registered
 * catalogue. An empty or unknown catalogue cannot admit an action. */
export function createAiProposalDraftSchemas(tools: readonly [string, ...string[]],
  targets: readonly [string, ...string[]] = AI_PROPOSAL_TARGETS): Record<string, AiLeafSchemaDraft> {
  for (const entries of [tools, targets]) {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 256 || new Set(entries).size !== entries.length
      || entries.some(code => typeof code !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(code)))
      throw new TypeError('Invalid proposal catalogue');
  }
  const version = choice(AI_PROPOSAL_DRAFT_VERSION);
  const revision = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
  const hash = { type: 'string', minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' };
  const tenantScope = { oneOf: [ref('AiTenantScope'), ref('AiWorkspaceScope')] };
  const humanIdentities = [
    { audience: choice('operator'), scope: ref('AiPlatformScope'), actor: obj({ kind: choice('saas_admin'), userId: id() }) },
    { audience: choice('operator', 'staff'), scope: tenantScope, actor: obj({ kind: choice('user'), userId: id() }) },
    { audience: choice('client'), scope: tenantScope, actor: obj({ kind: choice('customer'), customerId: id() }) }
  ];
  const payloadBase = { contractVersion: version, proposalId: id(), taskId: id(), revision, failurePolicy: choice('stop_and_reconcile'), expiresAt: time };
  const approvalBase = { contractVersion: version, approvalId: id(), proposalId: id(), proposalRevision: revision, payloadHash: hash,
    decision: choice('approved', 'rejected'), issuedAt: time, expiresAt: time };
  const consumption = { contractVersion: version, approvalId: id(), proposalId: id(), proposalRevision: revision, actionId: id(),
    actionFingerprint: hash, businessIdempotencyKey: id() };
  return {
    AiProposalSnapshotRefDraft: obj({ recordId: id(), revision, contentHash: hash }),
    AiProposalActionDraft: obj({ actionId: id(), toolCode: choice(...tools), toolVersion: id(), input: ref('AiProposalSnapshotRefDraft'),
      preview: ref('AiProposalSnapshotRefDraft'), target: obj({ resourceType: choice(...targets), resourceId: id(), version: id() }) }),
    AiProposalPayloadDraft: { oneOf: ['single_action', 'ordered_partial'].flatMap(atomicity => [
      obj({ ...payloadBase, atomicity: choice(atomicity), audience: choice('operator'), scope: ref('AiPlatformScope'),
        actions: list(ref('AiProposalActionDraft'), atomicity === 'single_action' ? 1 : 20, 1) }),
      obj({ ...payloadBase, atomicity: choice(atomicity), audience: choice('operator', 'staff', 'client'), scope: tenantScope,
        actions: list(ref('AiProposalActionDraft'), atomicity === 'single_action' ? 1 : 20, 1) })
    ]) },
    AiProposalRecordDraft: obj({ payload: ref('AiProposalPayloadDraft'), payloadHash: hash,
      status: choice('pending_confirmation', 'confirmed', 'superseded', 'cancelled', 'expired') }),
    AiProposalDecisionRequestDraft: obj({ contractVersion: version, proposalId: id(), proposalRevision: revision, reviewedPayloadHash: hash,
      decision: choice('approve', 'reject') }),
    AiApprovalRecordDraft: { oneOf: humanIdentities.map(identity => obj({ ...approvalBase, ...identity })) },
    AiApprovalConsumptionDraft: { oneOf: [
      obj({ ...consumption, status: choice('reserved') }),
      obj({ ...consumption, status: choice('committed'), result: ref('AiProposalSnapshotRefDraft') }),
      obj({ ...consumption, status: choice('unknown'), retryable: { type: 'boolean', const: false }, nextAction: choice('reconcile') }),
      obj({ ...consumption, status: choice('failed_no_effect'), nextAction: choice('revalidate_or_manual') })
    ] },
    AiApprovalBindingCheckDraft: { oneOf: [obj({ valid: { type: 'boolean', const: true } }), obj({ valid: { type: 'boolean', const: false },
      reason: choice('invalid_record', 'proposal_inactive', 'proposal_changed', 'approval_rejected', 'context_changed', 'approval_expired', 'action_missing') })] }
  };
}
