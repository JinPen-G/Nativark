import { AI_PROPOSAL_DRAFT_VERSION } from "./ai-proposal-draft";
import { AI_TOOL_CODES } from "./ai-native";
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafList as list, leafTime as time, type AiLeafSchemaDraft } from "./ai-gateway-draft-schemas";
const version = choice(AI_PROPOSAL_DRAFT_VERSION);
const revision = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const hash = { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" };
const tenantScope = { oneOf: [ref("AiTenantScope"), ref("AiWorkspaceScope")] };
const humanIdentities = [
  { audience: choice("operator"), scope: ref("AiPlatformScope"), actor: obj({ kind: choice("saas_admin"), userId: id() }) },
  { audience: choice("operator", "staff"), scope: tenantScope, actor: obj({ kind: choice("user"), userId: id() }) },
  { audience: choice("client"), scope: tenantScope, actor: obj({ kind: choice("customer"), customerId: id() }) }
];
const payloadBase = { contractVersion: version, proposalId: id(), taskId: id(), revision, failurePolicy: choice("stop_and_reconcile"), expiresAt: time };
const approvalBase = { contractVersion: version, approvalId: id(), proposalId: id(), proposalRevision: revision, payloadHash: hash, decision: choice("approved", "rejected"), issuedAt: time, expiresAt: time };
const consumption = { contractVersion: version, approvalId: id(), proposalId: id(), proposalRevision: revision, actionId: id(), actionFingerprint: hash, businessIdempotencyKey: id() };
export const AI_PROPOSAL_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiProposalSnapshotRefDraft: obj({ recordId: id(), revision, contentHash: hash }),
  AiProposalActionDraft: obj({ actionId: id(), toolCode: choice(...AI_TOOL_CODES), toolVersion: id(), input: ref("AiProposalSnapshotRefDraft"), preview: ref("AiProposalSnapshotRefDraft"), target: obj({ resourceType: choice("order", "quote", "configuration", "customer", "inspection", "category"), resourceId: id(), version: id() }) }),
  AiProposalPayloadDraft: { oneOf: ["single_action", "ordered_partial"].flatMap(atomicity => [
    obj({ ...payloadBase, atomicity: choice(atomicity), audience: choice("operator"), scope: ref("AiPlatformScope"), actions: list(ref("AiProposalActionDraft"), atomicity === "single_action" ? 1 : 20, 1) }),
    obj({ ...payloadBase, atomicity: choice(atomicity), audience: choice("operator", "staff", "client"), scope: tenantScope, actions: list(ref("AiProposalActionDraft"), atomicity === "single_action" ? 1 : 20, 1) })
  ]) },
  AiProposalRecordDraft: obj({ payload: ref("AiProposalPayloadDraft"), payloadHash: hash, status: choice("pending_confirmation", "confirmed", "superseded", "cancelled", "expired") }),
  AiProposalDecisionRequestDraft: obj({ contractVersion: version, proposalId: id(), proposalRevision: revision, reviewedPayloadHash: hash, decision: choice("approve", "reject") }),
  AiApprovalRecordDraft: { oneOf: humanIdentities.map(identity => obj({ ...approvalBase, ...identity })) },
  AiApprovalConsumptionDraft: { oneOf: [
    obj({ ...consumption, status: choice("reserved") }),
    obj({ ...consumption, status: choice("committed"), result: ref("AiProposalSnapshotRefDraft") }),
    obj({ ...consumption, status: choice("unknown"), retryable: { type: "boolean", const: false }, nextAction: choice("reconcile") }),
    obj({ ...consumption, status: choice("failed_no_effect"), nextAction: choice("revalidate_or_manual") })
  ] },
  AiApprovalBindingCheckDraft: { oneOf: [obj({ valid: { type: "boolean", const: true } }), obj({ valid: { type: "boolean", const: false }, reason: choice("invalid_record", "proposal_inactive", "proposal_changed", "approval_rejected", "context_changed", "approval_expired", "action_missing") })] }
};
