/** Display protocol preparation for the operator workbench (not a renderer).
 * A presentation is untrusted code; material, human input, approval and business
 * receipts remain separate original records. No route or sandbox is enabled. */
import type { AiSceneRequestReadDraft } from './ai-scene-request-draft';
import type { AiTaskInputAnswerDraft, AiTaskInputContractDraft, AiTaskInputFieldIdDraft } from './ai-task-input-draft';
import type { AiExecutionScope, AiFactReference } from './ai-native';
import { AI_TASK_STEP_CODES, type AiTaskStepCode } from './ai-task-draft';
import type { AiApprovalApplicationReferenceDraft } from './ai-approval-application-draft';
import { AI_TASK_INPUT_FIELD_IDS_DRAFT } from './ai-task-input-draft';
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafRef as ref, leafText as text, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_WORKBENCH_DISPLAY_DRAFT_VERSION = 'ain-workbench-display-draft-1' as const;
/** Hard protocol ceilings, not new business limits. A future isolated runtime
 * must enforce its time/rate/depth limits independently before it can mount. */
export const AI_WORKBENCH_DISPLAY_LIMITS = Object.freeze({
  codeBytes: 65536, messageBytes: 32768, sourceReferences: 50,
  fieldAnswers: 8, renderMs: 2000, messagesPerMinute: 60, componentDepth: 32, tableRows: 200,
} as const);
export interface AiWorkbenchMaterialBindingDraft {
  conversationId: string; turnId: string; capabilityCode: string; capabilityVersion: string;
  original: AiSceneRequestReadDraft; taskId: string; inputFingerprint: string;
  materialRevision: number; materialHash: string;
}
export interface AiWorkbenchDisplayBindingDraft extends AiWorkbenchMaterialBindingDraft {
  presentationRevision: number;
}
/** The host rotates mount identifiers on replacement, switch and revocation.
 * They correlate messages; they are never credentials or business authority. */
export interface AiWorkbenchMountBindingDraft extends AiWorkbenchDisplayBindingDraft {
  instanceId: string; channelId: string;
}
export interface AiWorkbenchPresentationDraft {
  draftVersion: typeof AI_WORKBENCH_DISPLAY_DRAFT_VERSION;
  binding: AiWorkbenchDisplayBindingDraft;
  code: { language: 'html'; complete: true; source: string; sha256: string };
  generation: { runId: string; stepId: string; resultId: string; resultHash: string;
    promptVersion: string; displayApiVersion: string; isolationVersion: string };
  retention: { expiresAt: string; sourceExpiresAt: string; aclRevision: string; policyVersion: string };
  trust: 'untrusted_display_code'; execution: 'not_admitted';
}
interface MessageBase {
  draftVersion: typeof AI_WORKBENCH_DISPLAY_DRAFT_VERSION;
  binding: AiWorkbenchMountBindingDraft;
  sequence: number;
}
/** Sandbox input is only a candidate. There is intentionally no approve,
 * submit, cancel-task, navigate, fetch or arbitrary-tool message here. */
export type AiWorkbenchSandboxMessageDraft = MessageBase & (
  | { kind: 'ready' }
  | { kind: 'rendered' }
  | { kind: 'render_failed'; reason: 'invalid_code' | 'resource_limit' | 'unsupported' }
  | { kind: 'candidate_input'; fieldRevision: number; answers: AiTaskInputAnswerDraft[] }
  | { kind: 'request_source'; sourceId: string }
  | { kind: 'request_confirmation'; proposal: AiApprovalApplicationReferenceDraft }
);
/** Returned only by protocol checking: never a proof that the browser sandbox
 * is isolated, the code has executed safely, or the candidate is human input. */
export type AiWorkbenchMessageObservationDraft =
  | { kind: 'display_signal'; signal: 'ready' | 'rendered' | 'render_failed'; execution: 'not_attested' }
  | { kind: 'input_candidate'; answers: AiTaskInputAnswerDraft[]; source: 'sandbox_candidate'; humanChoice: 'not_attested'; next: 'trusted_host_review' }
  | { kind: 'source_request'; sourceId: string; authorization: 'required_at_original_reader' }
  | { kind: 'confirmation_request'; proposal: AiApprovalApplicationReferenceDraft; approval: 'not_granted'; next: 'original_proposal_review' };

/** Additive context protocol. The existing display/mount v1 wire stays intact;
 * these packets cannot be promoted to execution by a schema-valid candidate. */
export const AI_WORKBENCH_CONTEXT_DRAFT_VERSION = 'ain-workbench-context-draft-1' as const;
export type AiWorkbenchPromptProvenanceDraft =
  | { status: 'recorded'; source: 'original_registered_plan'; referenceId: string; version: string; sha256: string }
  | { status: 'unavailable'; reason: 'not_recorded' | 'source_unavailable' | 'version_not_supported' };
export interface AiWorkbenchContextDraft {
  draftVersion: typeof AI_WORKBENCH_CONTEXT_DRAFT_VERSION;
  binding: AiWorkbenchMaterialBindingDraft; scope: AiExecutionScope;
  purpose: 'explanation' | 'display' | 'reprepare';
  capability: { code: string; version: string; prompt: AiWorkbenchPromptProvenanceDraft; tools: AiTaskStepCode[] };
  history: { coverage: 'bounded_authorized_references'; references: Array<{
    kind: 'turn' | 'task' | 'input' | 'knowledge'; id: string; version: string; sha256: string }>;
    persistentConstraints: { humanInputReceipts: string[]; pendingInputRequests: string[]; unknownOperations: string[] };
    expiresAt: string; aclRevision: string; policyVersion: string };
  authority: 'none_reauthorize_before_consumption';
}
export interface AiWorkbenchFieldPolicyDraft {
  fieldId: AiTaskInputFieldIdDraft; editable: boolean; sourceId: string;
  defaultValue: { status: 'unavailable' } | { status: 'provided'; value: string | number };
}
/** Rules and defaults come from original business input preparation. Code can
 * propose values but cannot introduce a field, change a rule or calculate money. */
export interface AiWorkbenchFieldMaterialDraft {
  draftVersion: typeof AI_WORKBENCH_CONTEXT_DRAFT_VERSION;
  binding: AiWorkbenchMaterialBindingDraft; fieldRevision: number;
  contract: AiTaskInputContractDraft | null; fields: AiWorkbenchFieldPolicyDraft[];
  sources: Array<{ sourceId: string; reference: AiFactReference }>;
  retention: { expiresAt: string; aclRevision: string; policyVersion: string };
  authority: 'original_business_rules_not_model_rules';
}
/** This is a host-owned unsubmitted draft. Revision is local CAS, not a saved
 * quote/input receipt. A human claim needs a separately verified original record. */
export interface AiWorkbenchHostDraft {
  draftVersion: typeof AI_WORKBENCH_CONTEXT_DRAFT_VERSION;
  binding: AiWorkbenchMaterialBindingDraft; fieldRevision: number;
  draftId: string; revision: number; answers: AiTaskInputAnswerDraft[];
  inputOrigin: { kind: 'candidate'; humanChoice: 'not_attested' }
    | { kind: 'original_human_receipt'; receiptId: string };
  status: 'unsubmitted'; preparation: 'not_attempted'; approval: 'not_granted';
}
export type AiWorkbenchControlIntentDraft = {
  draftVersion: typeof AI_WORKBENCH_CONTEXT_DRAFT_VERSION;
  binding: AiWorkbenchDisplayBindingDraft; operationKey: string;
} & (
  | { kind: 'stop_reply' }
  | { kind: 'reformat' }
  | { kind: 'regenerate_explanation' }
  | { kind: 'reprepare'; draft: AiWorkbenchHostDraft }
);
export type AiWorkbenchControlObservationDraft = { operationKey: string; execution: 'intent_only_not_dispatched'; retryable: false } & (
  | { status: 'blocked'; reason: 'unknown_original_operation'; next: 'read_original_operation' }
  | { status: 'unavailable'; reason: 'original_host_not_assembled'; next: 'manual_entry' }
  | { status: 'requires_original_host'; kind: 'stop_reply'; next: 'stop_delivery_not_task_cancellation'; remoteStop: 'not_attested'; usage: 'not_inferred' }
  | { status: 'requires_original_host'; kind: 'reformat' | 'regenerate_explanation'; next: 'original_gateway_admission'; businessReplay: 'forbidden'; accounting: 'original_gateway_and_cumulative_task_resources' }
  | { status: 'requires_original_host'; kind: 'reprepare'; next: 'original_scene_preparation'; approval: 'not_granted'; previousMaterial: 'historical_not_combined_with_new_input' }
);
export type AiWorkbenchInvalidationDraft = {
  draftVersion: typeof AI_WORKBENCH_CONTEXT_DRAFT_VERSION; binding: AiWorkbenchDisplayBindingDraft;
} & (
  | { reason: 'material_changed' | 'input_changed'; next: 'reread_and_reconfirm'; codeExecution: 'not_admitted' }
  | { reason: 'scope_changed' | 'authority_revoked' | 'source_erased'; next: 'withdraw_content'; codeExecution: 'not_admitted' }
  | { reason: 'display_version_disabled' | 'render_failed' | 'resource_limit'; next: 'currently_authorized_facts_only'; codeExecution: 'not_admitted' }
);

const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const material = { conversationId: id(), turnId: id(), capabilityCode: id(), capabilityVersion: id(),
  original: ref('AiSceneRequestReadDraft'), taskId: id(), inputFingerprint: hash, materialRevision: integer(1, 4294967294), materialHash: hash };
const binding = { ...material, presentationRevision: integer(1, 4294967294) };
const base = { draftVersion: choice(AI_WORKBENCH_DISPLAY_DRAFT_VERSION), binding: ref('AiWorkbenchMountBindingDraft'), sequence: integer(1, 4294967294) };
const answer = object({ fieldId: choice(...AI_TASK_INPUT_FIELD_IDS_DRAFT), value: { oneOf: [text(2048), integer(1, 1000000)] } });
const answers = list(answer, AI_WORKBENCH_DISPLAY_LIMITS.fieldAnswers, 1);
const contextVersion = choice(AI_WORKBENCH_CONTEXT_DRAFT_VERSION);
const contextBase = { draftVersion: contextVersion, binding: ref('AiWorkbenchMaterialBindingDraft') };
const controlBase = { draftVersion: contextVersion, binding: ref('AiWorkbenchDisplayBindingDraft'), operationKey: id() };
const controlObservation = { operationKey: id(), execution: choice('intent_only_not_dispatched'), retryable: { type: 'boolean', const: false } };
export const AI_WORKBENCH_CONTEXT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiWorkbenchPromptProvenanceDraft: { oneOf: [
    object({ status: choice('recorded'), source: choice('original_registered_plan'), referenceId: id(), version: id(), sha256: hash }),
    object({ status: choice('unavailable'), reason: choice('not_recorded', 'source_unavailable', 'version_not_supported') })] },
  AiWorkbenchContextDraft: object({ ...contextBase, scope: ref('AiExecutionScope'), purpose: choice('explanation', 'display', 'reprepare'),
    capability: object({ code: id(), version: id(), prompt: ref('AiWorkbenchPromptProvenanceDraft'), tools: { ...list(choice(...AI_TASK_STEP_CODES), 32), uniqueItems: true } }),
    history: object({ coverage: choice('bounded_authorized_references'), references: list(object({ kind: choice('turn', 'task', 'input', 'knowledge'),
      id: id(), version: id(), sha256: hash }), 50), persistentConstraints: object({ humanInputReceipts: list(id(), 50),
      pendingInputRequests: list(id(), 50), unknownOperations: list(id(), 50) }), expiresAt: time, aclRevision: id(), policyVersion: id() }),
    authority: choice('none_reauthorize_before_consumption') }),
  AiWorkbenchFieldPolicyDraft: object({ fieldId: choice(...AI_TASK_INPUT_FIELD_IDS_DRAFT), editable: { type: 'boolean' }, sourceId: id(),
    defaultValue: { oneOf: [object({ status: choice('unavailable') }), object({ status: choice('provided'), value: { oneOf: [text(2048), integer(1, 1000000)] } })] } }),
  AiWorkbenchFieldMaterialDraft: object({ ...contextBase, fieldRevision: integer(1, 4294967294),
    contract: { oneOf: [ref('AiTaskInputContractDraft'), { type: 'null' }] }, fields: list(ref('AiWorkbenchFieldPolicyDraft'), 8),
    sources: list(object({ sourceId: id(), reference: ref('AiFactReference') }), 50),
    retention: object({ expiresAt: time, aclRevision: id(), policyVersion: id() }), authority: choice('original_business_rules_not_model_rules') }),
  AiWorkbenchHostDraft: object({ ...contextBase, fieldRevision: integer(1, 4294967294), draftId: id(), revision: integer(1, 4294967294),
    answers: list(answer, 8), inputOrigin: { oneOf: [object({ kind: choice('candidate'), humanChoice: choice('not_attested') }),
      object({ kind: choice('original_human_receipt'), receiptId: id() })] }, status: choice('unsubmitted'), preparation: choice('not_attempted'), approval: choice('not_granted') }),
  AiWorkbenchControlIntentDraft: { oneOf: [object({ ...controlBase, kind: choice('stop_reply') }),
    object({ ...controlBase, kind: choice('reformat') }), object({ ...controlBase, kind: choice('regenerate_explanation') }),
    object({ ...controlBase, kind: choice('reprepare'), draft: ref('AiWorkbenchHostDraft') })] },
  AiWorkbenchControlObservationDraft: { oneOf: [
    object({ ...controlObservation, status: choice('blocked'), reason: choice('unknown_original_operation'), next: choice('read_original_operation') }),
    object({ ...controlObservation, status: choice('unavailable'), reason: choice('original_host_not_assembled'), next: choice('manual_entry') }),
    object({ ...controlObservation, status: choice('requires_original_host'), kind: choice('stop_reply'), next: choice('stop_delivery_not_task_cancellation'), remoteStop: choice('not_attested'), usage: choice('not_inferred') }),
    object({ ...controlObservation, status: choice('requires_original_host'), kind: choice('reformat', 'regenerate_explanation'), next: choice('original_gateway_admission'), businessReplay: choice('forbidden'), accounting: choice('original_gateway_and_cumulative_task_resources') }),
    object({ ...controlObservation, status: choice('requires_original_host'), kind: choice('reprepare'), next: choice('original_scene_preparation'), approval: choice('not_granted'), previousMaterial: choice('historical_not_combined_with_new_input') })] },
  AiWorkbenchInvalidationDraft: { oneOf: [object({ draftVersion: contextVersion, binding: ref('AiWorkbenchDisplayBindingDraft'),
    reason: choice('material_changed', 'input_changed'), next: choice('reread_and_reconfirm'), codeExecution: choice('not_admitted') }),
    object({ draftVersion: contextVersion, binding: ref('AiWorkbenchDisplayBindingDraft'), reason: choice('scope_changed', 'authority_revoked', 'source_erased'), next: choice('withdraw_content'), codeExecution: choice('not_admitted') }),
    object({ draftVersion: contextVersion, binding: ref('AiWorkbenchDisplayBindingDraft'), reason: choice('display_version_disabled', 'render_failed', 'resource_limit'), next: choice('currently_authorized_facts_only'), codeExecution: choice('not_admitted') })] },
};
export const AI_WORKBENCH_DISPLAY_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiWorkbenchMaterialBindingDraft: object(material),
  AiWorkbenchDisplayBindingDraft: object(binding),
  AiWorkbenchMountBindingDraft: object({ ...binding, instanceId: id(), channelId: id() }),
  AiWorkbenchPresentationDraft: object({ draftVersion: choice(AI_WORKBENCH_DISPLAY_DRAFT_VERSION), binding: ref('AiWorkbenchDisplayBindingDraft'),
    code: object({ language: choice('html'), complete: { type: 'boolean', const: true }, source: text(AI_WORKBENCH_DISPLAY_LIMITS.codeBytes), sha256: hash }),
    generation: object({ runId: id(), stepId: id(), resultId: id(), resultHash: hash, promptVersion: id(), displayApiVersion: id(), isolationVersion: id() }),
    retention: object({ expiresAt: time, sourceExpiresAt: time, aclRevision: id(), policyVersion: id() }),
    trust: choice('untrusted_display_code'), execution: choice('not_admitted') }),
  AiWorkbenchSandboxMessageDraft: { oneOf: [object({ ...base, kind: choice('ready') }), object({ ...base, kind: choice('rendered') }),
    object({ ...base, kind: choice('render_failed'), reason: choice('invalid_code', 'resource_limit', 'unsupported') }),
    object({ ...base, kind: choice('candidate_input'), fieldRevision: integer(1, 4294967294), answers }),
    object({ ...base, kind: choice('request_source'), sourceId: id() }),
    object({ ...base, kind: choice('request_confirmation'), proposal: ref('AiApprovalApplicationReferenceDraft') })] },
  AiWorkbenchMessageObservationDraft: { oneOf: [
    object({ kind: choice('display_signal'), signal: choice('ready', 'rendered', 'render_failed'), execution: choice('not_attested') }),
    object({ kind: choice('input_candidate'), answers, source: choice('sandbox_candidate'), humanChoice: choice('not_attested'), next: choice('trusted_host_review') }),
    object({ kind: choice('source_request'), sourceId: id(), authorization: choice('required_at_original_reader') }),
    object({ kind: choice('confirmation_request'), proposal: ref('AiApprovalApplicationReferenceDraft'), approval: choice('not_granted'), next: choice('original_proposal_review') })] }
};
