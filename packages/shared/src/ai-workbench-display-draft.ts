/** Display protocol preparation for the operator workbench (not a renderer).
 * A presentation is untrusted code; material, human input, approval and business
 * receipts remain separate original records. No route or sandbox is enabled. */
import type { AiSceneRequestReadDraft } from './ai-scene-request-draft';
import type { AiTaskInputAnswerDraft } from './ai-task-input-draft';
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

const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const material = { conversationId: id(), turnId: id(), capabilityCode: id(), capabilityVersion: id(),
  original: ref('AiSceneRequestReadDraft'), taskId: id(), inputFingerprint: hash, materialRevision: integer(1, 4294967294), materialHash: hash };
const binding = { ...material, presentationRevision: integer(1, 4294967294) };
const base = { draftVersion: choice(AI_WORKBENCH_DISPLAY_DRAFT_VERSION), binding: ref('AiWorkbenchMountBindingDraft'), sequence: integer(1, 4294967294) };
const answers = list(object({ fieldId: choice(...AI_TASK_INPUT_FIELD_IDS_DRAFT), value: { oneOf: [text(2048), integer(1, 1000000)] } }),
  AI_WORKBENCH_DISPLAY_LIMITS.fieldAnswers, 1);
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
