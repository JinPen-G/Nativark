/** Original staff HTTP contracts are consumed before projecting into local
 * display models. Neither projection nor a returned locator grants execution. */
import type { AiInspectionTarget, AiInspectionDraftReadRequest, AiStaffInspectionHostProjection,
  AiStaffInspectionHistoryRequest, AiStaffInspectionHistoryResponse,
  AiStaffInspectionReceiptHostRequest, AiStaffInspectionReceiptHostProjection, AiStaffInspectionSavedReference,
  AiInspectionManualHttpRequests, AiInspectionManualHttpResponses, AiInspectionLifecycleHttpRequests,
  AiInspectionLifecycleHttpResponses, AiInspectionResultReadResponse,
  AiInspectionSubmissionReadResponse, AiInspectionSubmissionSubmitResponse } from '@rental-os/shared';
import { validateInspectionWire } from './inspection-wire';
import { request } from '../../core/http';
import { contextVersion, currentSession } from '../../core/session';
import type { InspectionSubmissionObservation, InspectionRecognitionReference, InspectionRecognitionObservation, StaffInspectionHost, StaffInspectionReceiptHost } from './inspection-host';

type Requests = AiInspectionManualHttpRequests & AiInspectionLifecycleHttpRequests;
type Responses = AiInspectionManualHttpResponses & AiInspectionLifecycleHttpResponses;
const root = '/ai-native/inspection-assist/';
/** A valid wire shape is not evidence that the receipt belongs to our command.
 * Unavailable/absent receipts carry no result and never imply a retry grant. */
function receiptMatches(command: unknown, response: unknown): boolean {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  if (!object(command) || !object(response)) return true;
  const original = object(command.request) ? command.request : command;
  const receipt = object(response.result) ? response.result : response;
  return ['draftId', 'inputId'].every(key => original[key] === undefined || receipt[key] === undefined || receipt[key] === original[key]);
}
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const revision = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1000;
const exact = (value: unknown, keys: string[]) => closed(value, keys) && Object.keys(value as object).length === keys.length;
function resultProjection(value: AiInspectionResultReadResponse, reference: InspectionRecognitionReference): InspectionRecognitionObservation {
  if (Object.entries(reference).some(([key, expected]) => value[key as keyof AiInspectionResultReadResponse] !== expected)) throw Error('inspection result unavailable');
  return { ...value };
}
function submissionProjection(value: AiInspectionSubmissionReadResponse | AiInspectionSubmissionSubmitResponse, draftId: string): InspectionSubmissionObservation {
  if (value.draftId !== draftId) throw Error('inspection receipt unavailable');
  return value.status === 'submitted' ? { status: value.status, inspectionId: value.inspectionId, draftLinked: value.draftLinked } : { status: value.status };
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const sameTarget = (left: AiInspectionTarget, right: AiInspectionTarget) => ['orderId', 'allocationId', 'templateId', 'stage']
  .every(key => left?.[key as keyof AiInspectionTarget] === right[key as keyof AiInspectionTarget]);

const closed = (value: unknown, keys: string[]) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));
const referenceKeys = ['orderId', 'allocationId', 'templateId', 'stage', 'draftId', 'inputId', 'taskId', 'resultId', 'expectedRevision', 'operationId'];
function savedReference(value: AiStaffInspectionSavedReference) {
  return closed(value, referenceKeys) && referenceKeys.filter(key => !['stage', 'expectedRevision'].includes(key))
    .every(key => id(value[key as keyof AiStaffInspectionSavedReference])) && ['pickup', 'return'].includes(value.stage)
    && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 1 && value.expectedRevision <= 999;
}
function receiptSession() {
  const session = currentSession(), version = contextVersion();
  if (!session) throw Error('inspection unavailable');
  const context = { tenantId: session.tenant.tenantId, workspaceId: session.currentWorkspaceId, ownerId: session.user.id, audience: 'staff' as const };
  const current = () => { const now = currentSession(); return contextVersion() === version && now?.tenant.tenantId === context.tenantId
    && now?.currentWorkspaceId === context.workspaceId && now?.user.id === context.ownerId; };
  const matches = (value: typeof context) => closed(value, Object.keys(context))
    && Object.entries(context).every(([key, expected]) => value[key as keyof typeof context] === expected);
  return { context, current, matches };
}
export async function readStaffInspectionHistory(value: AiStaffInspectionHistoryRequest): Promise<AiStaffInspectionHistoryResponse> {
  const input = { ...value }, session = receiptSession();
  if (!closed(input, ['orderId', 'stage', 'limit', 'after']) || !id(input.orderId) || !['pickup', 'return'].includes(input.stage)
    || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20 || input.after !== undefined && !id(input.after)) throw Error('inspection history unavailable');
  if (!validateInspectionWire('history-read', 'request', input)) throw Error('inspection history unavailable');
  const result = await request<AiStaffInspectionHistoryResponse>(root + 'history-read', { method: 'POST', data: input });
  if (!validateInspectionWire('history-read', 'response', result)) throw Error('inspection history unavailable');
  if (!session.current() || !closed(result, ['mode', 'context', 'items', 'nextAfter', 'semantics']) || result.mode !== 'history_selection'
    || result.semantics !== 'selection_not_execution_permission' || !session.matches(result.context)
    || !Array.isArray(result.items) || result.items.length > input.limit || result.nextAfter !== null && !id(result.nextAfter)
    || result.nextAfter !== null && (result.nextAfter === input.after || result.items[result.items.length - 1]?.draftId !== result.nextAfter)
    || result.items.some(item => !closed(item, ['draftId', 'target', 'revision', 'status', 'recognitionSaves', 'recognitionSavesTruncated', 'recognitionReceipt'])
      || !id(item.draftId) || !closed(item.target, ['orderId', 'allocationId', 'templateId', 'stage'])
      || item.target.orderId !== input.orderId || item.target.stage !== input.stage || !id(item.target.allocationId) || !id(item.target.templateId)
      || !Number.isSafeInteger(item.revision) || item.revision < 1 || item.revision > 1000
      || !['draft_saved', 'prepared', 'submission_unknown', 'submitted'].includes(item.status)
      || !Array.isArray(item.recognitionSaves) || item.recognitionSaves.length > 20 || typeof item.recognitionSavesTruncated !== 'boolean'
      || item.recognitionReceipt !== (item.recognitionSaves.length ? 'references_available' : 'manual_reconcile')
      || item.recognitionSaves.some(ref => !savedReference(ref) || ref.draftId !== item.draftId || !sameTarget(ref, item.target)))) throw Error('inspection history unavailable');
  return JSON.parse(JSON.stringify(result));
}
export async function createStaffInspectionReceiptHost(value: AiStaffInspectionReceiptHostRequest): Promise<StaffInspectionReceiptHost> {
  const input = JSON.parse(JSON.stringify(value)) as AiStaffInspectionReceiptHostRequest, session = receiptSession();
  if (!closed(input, ['mode', 'orderId', 'allocationId', 'templateId', 'stage', 'draftId', 'recognitionSave']) || input.mode !== 'receipt_only'
    || ![input.orderId, input.allocationId, input.templateId, input.draftId].every(id) || !['pickup', 'return'].includes(input.stage)
    || input.recognitionSave && (!savedReference(input.recognitionSave) || input.recognitionSave.draftId !== input.draftId || !sameTarget(input.recognitionSave, input))) throw Error('receipt host unavailable');
  if (!validateInspectionWire('receipt-host-read', 'request', input)) throw Error('receipt host unavailable');
  const result = await request<AiStaffInspectionReceiptHostProjection>(root + 'receipt-host-read', { method: 'POST', data: input });
  if (!validateInspectionWire('receipt-host-read', 'response', result)) throw Error('receipt host unavailable');
  if (!session.current() || !closed(result, ['mode', 'serverEnabled', 'context', 'target', 'draftId', 'recognitionSave', 'capabilities', 'semantics'])
    || result.mode !== 'receipt_only' || result.serverEnabled !== true || result.semantics !== 'receipts_only_not_execution_permission'
    || !session.matches(result.context) || !closed(result.target, ['orderId', 'allocationId', 'templateId', 'stage']) || !sameTarget(result.target, input)
    || result.draftId !== input.draftId || !closed(result.capabilities, ['recognitionReceipt', 'submissionReceipt'])
    || typeof result.capabilities.recognitionReceipt !== 'boolean' || typeof result.capabilities.submissionReceipt !== 'boolean'
    || result.capabilities.recognitionReceipt !== (result.recognitionSave !== null)
    || result.recognitionSave !== null && (!input.recognitionSave || !savedReference(result.recognitionSave)
      || Object.entries(input.recognitionSave).some(([key, expected]) => result.recognitionSave![key as keyof AiStaffInspectionSavedReference] !== expected))) throw Error('receipt host unavailable');
  const target = { orderId: input.orderId, allocationId: input.allocationId, templateId: input.templateId, stage: input.stage };
  const reference = result.recognitionSave ? { ...result.recognitionSave } : undefined;
  async function read<K extends keyof Requests>(operation: K, body: Requests[K]): Promise<Responses[K]> {
    if (!session.current()) throw Error('inspection context changed');
    if (!validateInspectionWire(operation, 'request', body)) throw Error('inspection input unavailable');
    const command = JSON.parse(JSON.stringify(body)) as Requests[K];
    const value = await request<Responses[K]>(root + operation, { method: 'POST', data: JSON.parse(JSON.stringify(command)) });
    if (!session.current() || !validateInspectionWire(operation, 'response', value) || !receiptMatches(command, value)) throw Error('inspection context or response changed');
    return value;
  }
  return { mode: 'receipt_only', serverEnabled: true, context: session.context, target, draftId: input.draftId, current: session.current,
    ...(reference ? { recognition: { reference: { ...reference }, read: () => read('result-save-receipt', reference) } } : {}),
    ...(result.capabilities.submissionReceipt ? { submission: { read: async () => submissionProjection(await read('submission-read', { ...target, draftId: input.draftId }), input.draftId) } } : {}) };
}

/** Called explicitly by the existing page, never from import/show/load. The
 * current session is a local isolation check, not server-side authorization. */
export async function createStaffInspectionTransportHost(reference: AiInspectionDraftReadRequest,
  signatureFileAssetId?: string, recognitionReference?: InspectionRecognitionReference): Promise<StaffInspectionHost> {
  const input = { ...reference }, session = currentSession(), version = contextVersion();
  const originalResult = recognitionReference ? { ...recognitionReference } : undefined;
  if (!session || !id(input.orderId) || !id(input.allocationId) || !id(input.templateId) || !id(input.draftId)
    || !['pickup', 'return'].includes(input.stage) || signatureFileAssetId !== undefined && !id(signatureFileAssetId)) throw Error('inspection unavailable');
  if (originalResult && (!sameTarget(originalResult, input) || originalResult.draftId !== input.draftId
    || !id(originalResult.inputId) || !id(originalResult.taskId) || !id(originalResult.resultId)
    || !Number.isSafeInteger(originalResult.expectedRevision) || originalResult.expectedRevision < 1 || originalResult.expectedRevision > 999
    || Object.keys(originalResult).some(key => !['orderId', 'allocationId', 'templateId', 'stage', 'draftId', 'inputId', 'taskId', 'resultId', 'expectedRevision'].includes(key)))) throw Error('inspection unavailable');
  const context = { tenantId: session.tenant.tenantId, workspaceId: session.currentWorkspaceId,
    ownerId: session.user.id, audience: 'staff' as const };
  const current = () => { const now = currentSession(); return contextVersion() === version && now?.tenant.tenantId === context.tenantId
    && now?.currentWorkspaceId === context.workspaceId && now?.user.id === context.ownerId; };
  if (!validateInspectionWire('host-read', 'request', input)) throw Error('inspection unavailable');
  const projection = await request<AiStaffInspectionHostProjection>(root + 'host-read', { method: 'POST', data: input });
  if (!validateInspectionWire('host-read', 'response', projection)) throw Error('inspection unavailable');
  if (!current() || projection?.serverEnabled !== true || projection.execution !== 'not_attested'
    || !sameTarget(projection.target, input) || projection.draftId !== input.draftId
    || !id(projection.actionId) || !Number.isSafeInteger(projection.revision) || projection.revision < 1
    || !id(projection.templateVersion) || !/^[a-f0-9]{64}$/u.test(projection.bindingFingerprint)
    || Object.keys(context).some(key => projection.context?.[key as keyof typeof context] !== context[key as keyof typeof context])
    || !projection.capabilities || ['edit', 'evidence', 'review', 'submit'].some(key => typeof projection.capabilities[key as keyof typeof projection.capabilities] !== 'boolean')) throw Error('inspection unavailable');
  const target: AiInspectionTarget = { orderId: input.orderId, allocationId: input.allocationId, templateId: input.templateId, stage: input.stage };
  const actionId = projection.actionId, capabilities = { ...projection.capabilities };
  async function call<K extends keyof Requests>(operation: K, body: Requests[K], writes = false): Promise<Responses[K]> {
    if (!current()) throw Error('inspection context changed');
    if (!validateInspectionWire(operation, 'request', body)) throw Error('inspection input unavailable');
    const command = JSON.parse(JSON.stringify(body)) as Requests[K];
    const value = await request<Responses[K]>(root + operation, { method: 'POST', data: JSON.parse(JSON.stringify(command)), replayAfterRefresh: !writes });
    if (!current() || !validateInspectionWire(operation, 'response', value) || !receiptMatches(command, value)) throw Error('inspection context or response changed');
    return value;
  }
  const bound = <T extends AiInspectionTarget & { draftId?: string }>(value: T): T => {
    if (!sameTarget(value, target) || value.draftId !== undefined && value.draftId !== input.draftId) throw Error('inspection binding changed');
    return value;
  };
  return { context, target, draftId: input.draftId, serverEnabled: true, current, actionId,
    ...(originalResult ? { recognition: {
      reference: { ...originalResult },
      read: async () => resultProjection(await call('result-read', originalResult), originalResult),
      ...(capabilities.edit ? { save: (operationId: string) => call('result-save', { ...originalResult, operationId }, true) } : {}),
      reconcileSave: (operationId: string) => call('result-save-receipt', { ...originalResult, operationId })
    } } : {}),
    ...(signatureFileAssetId ? { handoverSignatureFileAssetId: signatureFileAssetId } : {}),
    operationId: (kind, revision) => { if (!current() || !Number.isSafeInteger(revision) || revision < 1) throw Error('inspection context changed');
      return `${actionId}:${kind}:${revision}`; },
    templates: { read: async value => {
      const result = await call('template-read', bound(value));
      if (!exact(result, ['scope', 'owner', 'audience', 'orderId', 'allocationId', 'assetId', 'stage', 'template', 'allocationStatus', 'bindingFingerprint', 'status', 'semantics'])
        || result.scope.kind !== 'workspace' || result.scope.tenantId !== context.tenantId || result.scope.workspaceId !== context.workspaceId
        || result.owner.actorKind !== 'user' || result.owner.actorId !== context.ownerId || result.audience !== 'staff'
        || result.orderId !== target.orderId || result.allocationId !== target.allocationId || result.stage !== target.stage
        || !id(result.assetId) || result.template.id !== target.templateId || result.template.stage !== target.stage || result.template.enabled !== true
        || !id(result.template.version) || !Array.isArray(result.template.fields) || result.template.fields.length > 100 || !hash(result.bindingFingerprint)
        || result.status !== 'template_ready' || result.semantics !== 'read_projection_not_inspection_or_action_authorization') throw Error('inspection template unavailable');
      return { bindingFingerprint: result.bindingFingerprint, template: result.template };
    } },
    drafts: { read: async value => {
      const result = await call('draft-read', bound(value));
      if (!exact(result, ['draftId', 'revision', 'status', 'target', 'assetId', 'templateVersion', 'bindingFingerprint', 'state', 'inspectionId', 'recognitionEvidence', 'candidateReviews'])
        || result.draftId !== input.draftId || !sameTarget(result.target, target) || !revision(result.revision)
        || !['draft_saved', 'prepared', 'submission_unknown', 'submitted'].includes(result.status) || !id(result.assetId)
        || !id(result.templateVersion) || !hash(result.bindingFingerprint) || result.inspectionId !== null && !id(result.inspectionId)
        || result.recognitionEvidence !== 'caller_supplied_not_model_execution_proof') throw Error('inspection draft unavailable');
      return { draftId: result.draftId, revision: result.revision, status: result.status, target: result.target,
        templateVersion: result.templateVersion, bindingFingerprint: result.bindingFingerprint, state: result.state,
        candidateReviews: result.candidateReviews };
    },
      ...(capabilities.edit ? { edit: (value: Parameters<NonNullable<StaffInspectionHost['drafts']['edit']>>[0]) => call('draft-edit', bound(value), true) } : {}),
      ...(capabilities.edit && capabilities.evidence ? { replaceEvidence: (value: Parameters<NonNullable<StaffInspectionHost['drafts']['replaceEvidence']>>[0]) => call('evidence-replace', bound(value), true) } : {}),
      reconcileOperation: value => value.kind === 'edit'
        ? call('draft-operation', { kind: 'edit', request: bound(value.request as Requests['draft-edit']) })
        : call('draft-operation', { kind: 'evidence', request: bound(value.request as Requests['evidence-replace']) }) },
    ...(capabilities.evidence ? { evidence: { fingerprint: (value, refs) => call('evidence-fingerprint', { target: bound(value), refs }) } } : {}),
    submission: {
      ...(capabilities.review ? { prepareReview: (value: Parameters<NonNullable<NonNullable<StaffInspectionHost['submission']>['prepareReview']>>[0]) => call('submission-review', bound(value), true) } : {}),
      ...(capabilities.submit && signatureFileAssetId ? {
        prepare: (value: Parameters<NonNullable<NonNullable<StaffInspectionHost['submission']>['prepare']>>[0]) => call('submission-prepare', bound(value), true),
        submit: async (value: Parameters<NonNullable<NonNullable<StaffInspectionHost['submission']>['submit']>>[0]) =>
          submissionProjection(await call('submission-submit', bound(value), true), input.draftId) } : {}),
      reconcile: async value => submissionProjection(await call('submission-read', bound(value)), input.draftId),
      reconcilePreparation: value => call('submission-preparation', { ...value, request: bound(value.request) }) },
  };
}
