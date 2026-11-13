/** Pure protocol checks for the future isolated workbench. Does not execute or
 * sanitize code, establish a conversation, authenticate a message, or dispatch
 * an action. Callers must verify the current origin/window/mount and authority;
 * accepting this shape is never sandbox admission or a human-input receipt. */
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_WORKBENCH_DISPLAY_SCHEMAS, AI_WORKBENCH_DISPLAY_LIMITS, AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS, AI_WORKBENCH_CONTEXT_SCHEMAS, AI_TASK_INPUT_DRAFT_SCHEMAS,
  AI_SCOPE_DRAFT_SCHEMAS, AI_WORKBENCH_DISPLAY_HTTP_SCHEMAS, isAiTaskInputContractDraft, validateAiTaskInputAnswersDraft,
  type AiWorkbenchContextDraft, type AiWorkbenchFieldMaterialDraft, type AiWorkbenchHostDraft,
  type AiWorkbenchControlIntentDraft, type AiWorkbenchControlObservationDraft,
  type AiTaskInputContractDraft, type AiWorkbenchDisplayBindingDraft, type AiWorkbenchMountBindingDraft,
  type AiWorkbenchPresentationDraft, type AiWorkbenchSandboxMessageDraft, type AiWorkbenchMessageObservationDraft,
  type AiApprovalApplicationReferenceDraft, type AiWorkbenchDisplayMaterialDraft } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from './ai-task.repository';
import { AI_NATIVE_COMPONENT_SCHEMAS } from '../../contracts/ai-native-schemas';

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
for (const [name, schema] of Object.entries({ ...AI_NATIVE_COMPONENT_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS,
  ...AI_TASK_INPUT_DRAFT_SCHEMAS, ...AI_WORKBENCH_DISPLAY_SCHEMAS, ...AI_WORKBENCH_CONTEXT_SCHEMAS, ...AI_WORKBENCH_DISPLAY_HTTP_SCHEMAS,
  AiSceneRequestReadDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReadDraft,
  AiApprovalApplicationReferenceDraft: AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS.AiApprovalApplicationReferenceDraft })) {
  ajv.addSchema(schema, `#/components/schemas/${name}`);
}
const validate = (name: string, value: unknown) => ajv.getSchema(`#/components/schemas/${name}`)!(value) === true;
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);
const fail = () => { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); };

/** Closed transport packet only. The producer separately rechecks current
 * sources, registered versions and time; valid JSON never grants admission. */
export function inspectAiWorkbenchDisplayMaterial(value: unknown): AiWorkbenchDisplayMaterialDraft {
  try {
    const copy = structuredClone(value) as AiWorkbenchDisplayMaterialDraft;
    if (!validate('AiWorkbenchDisplayMaterialDraft', copy) || Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072
      || !same(copy.context.binding, Object.fromEntries(Object.entries(copy.presentation.binding).filter(([key]) => key !== 'presentationRevision')))
      || copy.context.purpose !== 'display' || copy.fieldMaterial && !same(copy.fieldMaterial.binding, copy.context.binding)) return fail();
    const summary = copy.authoritativeSummary;
    if (summary && (!same(summary.binding, copy.presentation.binding)
      || summary.runId !== copy.presentation.generation.runId || summary.resultId !== copy.presentation.generation.resultId
      || !summary.text.trim() || Buffer.byteLength(summary.text, 'utf8') > 32768)) return fail();
    const retained = copy.presentation.retention, structuralTime = new Date(Date.parse(retained.expiresAt) - 1).toISOString();
    inspectAiWorkbenchContext(copy.context, copy.context, structuralTime);
    if (copy.fieldMaterial) inspectAiWorkbenchFieldMaterial(copy.fieldMaterial, copy.fieldMaterial, structuralTime);
    inspectAiWorkbenchPresentation(copy.presentation, copy.presentation.binding, { now: structuralTime,
      sourceExpiresAt: retained.sourceExpiresAt, aclRevision: retained.aclRevision, policyVersion: retained.policyVersion });
    return copy;
  } catch { return fail(); }
}

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

/** Current is a freshly authorized original projection, not a model-selected
 * history/prompt. Equality prevents a caller laundering a different version or
 * dropping persistent input/unknown constraints through a context packet. */
export function inspectAiWorkbenchContext(value: unknown, current: AiWorkbenchContextDraft, now: string): AiWorkbenchContextDraft {
  try {
    const copy = structuredClone(value) as AiWorkbenchContextDraft;
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072 || !validate('AiWorkbenchContextDraft', copy)
      || !validate('AiWorkbenchContextDraft', current) || !same(copy, current)
      || copy.capability.code !== copy.binding.capabilityCode || copy.capability.version !== copy.binding.capabilityVersion
      || !Number.isFinite(Date.parse(now)) || Date.parse(copy.history.expiresAt) <= Date.parse(now)) return fail();
    return copy;
  } catch { return fail(); }
}

function validFields(material: AiWorkbenchFieldMaterialDraft): boolean {
  if (!validate('AiWorkbenchFieldMaterialDraft', material)) return false;
  if (material.contract === null) return material.fields.length === 0;
  if (!isAiTaskInputContractDraft(material.contract) || material.fields.length !== material.contract.fields.length
    || new Set(material.fields.map(field => field.fieldId)).size !== material.fields.length
    || new Set(material.sources.map(source => source.sourceId)).size !== material.sources.length) return false;
  return material.fields.every(policy => {
    const field = material.contract!.fields.find(field => field.fieldId === policy.fieldId);
    if (!field || !material.sources.some(source => source.sourceId === policy.sourceId)) return false;
    return policy.defaultValue.status === 'unavailable' || validateAiTaskInputAnswersDraft({ ...material.contract,
      fields: [{ ...field, required: false }] }, [{ fieldId: policy.fieldId, value: policy.defaultValue.value }]);
  });
}
export function inspectAiWorkbenchFieldMaterial(value: unknown, current: AiWorkbenchFieldMaterialDraft, now: string): AiWorkbenchFieldMaterialDraft {
  try {
    const copy = structuredClone(value) as AiWorkbenchFieldMaterialDraft;
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072 || !validFields(copy) || !validFields(current) || !same(copy, current)
      || !Number.isFinite(Date.parse(now)) || Date.parse(copy.retention.expiresAt) <= Date.parse(now)) return fail();
    return copy;
  } catch { return fail(); }
}

/** Partial drafts preserve missing/invalid required input for original
 * preparation to clarify. Supplied values must still match editable original
 * fields. An attested receipt ID is accepted only from the host's verified set. */
export function inspectAiWorkbenchHostDraft(value: unknown, material: AiWorkbenchFieldMaterialDraft,
  previous: { draftId: string; revision: number } | null,
  humanReceipts: readonly { receiptId: string; binding: AiWorkbenchFieldMaterialDraft['binding']; fieldRevision: number; answers: AiWorkbenchHostDraft['answers'] }[] = []): AiWorkbenchHostDraft {
  try {
    const copy = structuredClone(value) as AiWorkbenchHostDraft;
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 32768 || !validate('AiWorkbenchHostDraft', copy) || !validFields(material)
      || !same(copy.binding, material.binding) || copy.fieldRevision !== material.fieldRevision
      || (previous ? copy.draftId !== previous.draftId || copy.revision !== previous.revision + 1 : copy.revision !== 1)) return fail();
    if (copy.inputOrigin.kind === 'original_human_receipt') {
      const receiptId = copy.inputOrigin.receiptId;
      if (!humanReceipts.some(receipt => receipt.receiptId === receiptId && receipt.fieldRevision === copy.fieldRevision
        && same(receipt.binding, copy.binding) && same(receipt.answers, copy.answers))) return fail();
    }
    if (copy.answers.length && (!material.contract || !validateAiTaskInputAnswersDraft({ ...material.contract,
      fields: material.contract.fields.filter(field => material.fields.some(policy => policy.fieldId === field.fieldId && policy.editable))
        .map(field => ({ ...field, required: false })) }, copy.answers))) return fail();
    return copy;
  } catch { return fail(); }
}

/** Only classifies an intent against trusted current state. No cancellation,
 * new call or preparation is executed here; unavailable adapters stay explicit. */
export function inspectAiWorkbenchControl(value: unknown, current: {
  binding: AiWorkbenchDisplayBindingDraft; unknownOriginalOperation: boolean;
  assembledControls: readonly AiWorkbenchControlIntentDraft['kind'][]; draft?: AiWorkbenchHostDraft;
}): AiWorkbenchControlObservationDraft {
  try {
    const copy = structuredClone(value) as AiWorkbenchControlIntentDraft;
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 32768 || !validate('AiWorkbenchControlIntentDraft', copy)
      || !validate('AiWorkbenchDisplayBindingDraft', current.binding) || !same(copy.binding, current.binding)
      || typeof current.unknownOriginalOperation !== 'boolean') return fail();
    if (copy.kind === 'reprepare' && (!current.draft || !same(copy.draft, current.draft)
      || !same(copy.draft.binding, Object.fromEntries(Object.entries(current.binding).filter(([key]) => key !== 'presentationRevision'))))) return fail();
    const base = { operationKey: copy.operationKey, execution: 'intent_only_not_dispatched', retryable: false } as const;
    if (current.unknownOriginalOperation) return { ...base, status: 'blocked', reason: 'unknown_original_operation', next: 'read_original_operation' };
    if (!current.assembledControls.includes(copy.kind)) return { ...base, status: 'unavailable', reason: 'original_host_not_assembled', next: 'manual_entry' };
    if (copy.kind === 'stop_reply') return { ...base, status: 'requires_original_host', kind: copy.kind,
      next: 'stop_delivery_not_task_cancellation', remoteStop: 'not_attested', usage: 'not_inferred' };
    if (copy.kind === 'reprepare') return { ...base, status: 'requires_original_host', kind: copy.kind,
      next: 'original_scene_preparation', approval: 'not_granted', previousMaterial: 'historical_not_combined_with_new_input' };
    return { ...base, status: 'requires_original_host', kind: copy.kind, next: 'original_gateway_admission',
      businessReplay: 'forbidden', accounting: 'original_gateway_and_cumulative_task_resources' };
  } catch { return fail(); }
}
