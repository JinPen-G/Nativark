/** Pure protocol checks for the future isolated workbench. Does not execute or
 * sanitize code, establish a conversation, authenticate a message, or dispatch
 * an action. Callers must verify the current origin/window/mount and authority;
 * accepting this shape is never sandbox admission or a human-input receipt. */
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_WORKBENCH_DISPLAY_SCHEMAS, AI_WORKBENCH_DISPLAY_LIMITS, AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS, validateAiTaskInputAnswersDraft,
  type AiTaskInputContractDraft, type AiWorkbenchDisplayBindingDraft, type AiWorkbenchMountBindingDraft,
  type AiWorkbenchPresentationDraft, type AiWorkbenchSandboxMessageDraft, type AiWorkbenchMessageObservationDraft,
  type AiApprovalApplicationReferenceDraft } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from './ai-task.repository';

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
for (const [name, schema] of Object.entries({ ...AI_WORKBENCH_DISPLAY_SCHEMAS,
  AiSceneRequestReadDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReadDraft,
  AiApprovalApplicationReferenceDraft: AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS.AiApprovalApplicationReferenceDraft })) {
  ajv.addSchema(schema, `#/components/schemas/${name}`);
}
const validate = (name: string, value: unknown) => ajv.getSchema(`#/components/schemas/${name}`)!(value) === true;
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);
const fail = () => { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); };

/** Source hash/UTF-8 completeness only. Malicious source can be structurally
 * valid and remains execution:not_admitted; only a verified isolated runtime
 * can make a later admission decision. Never parse/evaluate code here. */
export function inspectAiWorkbenchPresentation(value: unknown, expected: AiWorkbenchDisplayBindingDraft,
  lifetime: { now: string; sourceExpiresAt: string; aclRevision: string; policyVersion: string }): AiWorkbenchPresentationDraft {
  try {
    const copy = structuredClone(value);
    if (!validate('AiWorkbenchPresentationDraft', copy) || !validate('AiWorkbenchDisplayBindingDraft', expected)) return fail();
    const presentation = copy as AiWorkbenchPresentationDraft, retained = presentation.retention;
    const now = Date.parse(lifetime.now), sourceExpiry = Date.parse(lifetime.sourceExpiresAt), expiry = Date.parse(retained.expiresAt);
    if (![now, sourceExpiry, expiry].every(Number.isFinite) || expiry <= now || expiry > sourceExpiry
      || Date.parse(retained.sourceExpiresAt) !== sourceExpiry || retained.aclRevision !== lifetime.aclRevision
      || retained.policyVersion !== lifetime.policyVersion) return fail();
    if (!same(presentation.binding, expected) || Buffer.byteLength(presentation.code.source, 'utf8') > AI_WORKBENCH_DISPLAY_LIMITS.codeBytes
      || createHash('sha256').update(presentation.code.source, 'utf8').digest('hex') !== presentation.code.sha256) return fail();
    return presentation;
  } catch { return fail(); }
}

/** Server/host-owned current inputs, not fields a sandbox can submit. Each
 * observation must use a freshly checked binding; sequence/rate reservation is
 * the host's responsibility. No capability or persistent approval is minted. */
export interface AiWorkbenchMessageContext {
  binding: AiWorkbenchMountBindingDraft;
  lastSequence: number;
  input?: { revision: number; contract: AiTaskInputContractDraft };
  sourceIds: readonly string[];
  proposals: readonly AiApprovalApplicationReferenceDraft[];
}
export function inspectAiWorkbenchMessage(value: unknown, current: AiWorkbenchMessageContext): AiWorkbenchMessageObservationDraft {
  try {
    const copy = structuredClone(value);
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > AI_WORKBENCH_DISPLAY_LIMITS.messageBytes
      || !validate('AiWorkbenchSandboxMessageDraft', copy) || !validate('AiWorkbenchMountBindingDraft', current.binding)
      || !Number.isSafeInteger(current.lastSequence) || current.lastSequence < 0) return fail();
    const message = copy as AiWorkbenchSandboxMessageDraft;
    if (!same(message.binding, current.binding) || message.sequence !== current.lastSequence + 1) return fail();
    switch (message.kind) {
      case 'ready': case 'rendered': case 'render_failed':
        return { kind: 'display_signal', signal: message.kind, execution: 'not_attested' };
      case 'candidate_input':
        if (!current.input || message.fieldRevision !== current.input.revision
          || !validateAiTaskInputAnswersDraft(current.input.contract, message.answers)) return fail();
        return { kind: 'input_candidate', answers: message.answers, source: 'sandbox_candidate', humanChoice: 'not_attested', next: 'trusted_host_review' };
      case 'request_source':
        if (current.sourceIds.length > AI_WORKBENCH_DISPLAY_LIMITS.sourceReferences || !current.sourceIds.includes(message.sourceId)) return fail();
        return { kind: 'source_request', sourceId: message.sourceId, authorization: 'required_at_original_reader' };
      case 'request_confirmation':
        if (!current.proposals.some(proposal => same(proposal, message.proposal))) return fail();
        return { kind: 'confirmation_request', proposal: message.proposal, approval: 'not_granted', next: 'original_proposal_review' };
    }
  } catch { return fail(); }
}
