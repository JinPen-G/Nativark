import type { AiInspectionTarget, AiInspectionDraftReadRequest, AiStaffInspectionHostProjection,
  AiInspectionReceiptLookup, RentalInspectionTemplate } from '@rental-os/shared';
import { request } from '../../core/http';
import { contextVersion, currentSession } from '../../core/session';
import type { InspectionHostDetail, InspectionSubmissionObservation, InspectionRecognitionReference, InspectionRecognitionObservation, StaffInspectionHost } from './inspection-host';

const root = '/ai-native/inspection-assist/';
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const sameTarget = (left: AiInspectionTarget, right: AiInspectionTarget) => ['orderId', 'allocationId', 'templateId', 'stage']
  .every(key => left?.[key as keyof AiInspectionTarget] === right[key as keyof AiInspectionTarget]);

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
  const projection = await request<AiStaffInspectionHostProjection>(root + 'host-read', { method: 'POST', data: input });
  if (!current() || projection?.serverEnabled !== true || projection.execution !== 'not_attested'
    || !sameTarget(projection.target, input) || projection.draftId !== input.draftId
    || !id(projection.actionId) || !Number.isSafeInteger(projection.revision) || projection.revision < 1
    || !id(projection.templateVersion) || !/^[a-f0-9]{64}$/u.test(projection.bindingFingerprint)
    || Object.keys(context).some(key => projection.context?.[key as keyof typeof context] !== context[key as keyof typeof context])
    || !projection.capabilities || ['edit', 'evidence', 'review', 'submit'].some(key => typeof projection.capabilities[key as keyof typeof projection.capabilities] !== 'boolean')) throw Error('inspection unavailable');
  const target: AiInspectionTarget = { orderId: input.orderId, allocationId: input.allocationId, templateId: input.templateId, stage: input.stage };
  const actionId = projection.actionId, capabilities = { ...projection.capabilities };
  async function call<T>(operation: string, body: unknown, writes = false): Promise<T> {
    if (!current()) throw Error('inspection context changed');
    const value = await request<T>(root + operation, { method: 'POST', data: JSON.parse(JSON.stringify(body)), replayAfterRefresh: !writes });
    if (!current()) throw Error('inspection context changed');
    return value;
  }
  const bound = (value: AiInspectionTarget & { draftId?: string }) => {
    if (!sameTarget(value, target) || value.draftId !== undefined && value.draftId !== input.draftId) throw Error('inspection binding changed');
    return value;
  };
  return { context, target, draftId: input.draftId, serverEnabled: true, current, actionId,
    ...(originalResult ? { recognition: {
      reference: { ...originalResult },
      read: () => call<InspectionRecognitionObservation>('result-read', originalResult),
      ...(capabilities.edit ? { save: (operationId: string) => call('result-save', { ...originalResult, operationId }, true) } : {}),
      reconcileSave: (operationId: string) => call<AiInspectionReceiptLookup>('result-save-receipt', { ...originalResult, operationId })
    } } : {}),
    ...(signatureFileAssetId ? { handoverSignatureFileAssetId: signatureFileAssetId } : {}),
    operationId: (kind, revision) => { if (!current() || !Number.isSafeInteger(revision) || revision < 1) throw Error('inspection context changed');
      return `${actionId}:${kind}:${revision}`; },
    templates: { read: value => call<{ bindingFingerprint: string; template: RentalInspectionTemplate }>('template-read', bound(value)) },
    drafts: { read: value => call<InspectionHostDetail>('draft-read', bound(value)),
      ...(capabilities.edit ? { edit: (value: Parameters<NonNullable<StaffInspectionHost['drafts']['edit']>>[0]) => call('draft-edit', bound(value), true) } : {}),
      ...(capabilities.edit && capabilities.evidence ? { replaceEvidence: (value: Parameters<NonNullable<StaffInspectionHost['drafts']['replaceEvidence']>>[0]) => call('evidence-replace', bound(value), true) } : {}),
      reconcileOperation: value => call<AiInspectionReceiptLookup>('draft-operation', { ...value, request: bound(value.request as AiInspectionTarget) }) },
    ...(capabilities.evidence ? { evidence: { fingerprint: (value, refs) => call<string>('evidence-fingerprint', { target: bound(value), refs }) } } : {}),
    submission: {
      ...(capabilities.review ? { prepareReview: (value: Parameters<NonNullable<NonNullable<StaffInspectionHost['submission']>['prepareReview']>>[0]) => call('submission-review', bound(value), true) } : {}),
      ...(capabilities.submit && signatureFileAssetId ? {
        prepare: (value: Parameters<NonNullable<NonNullable<StaffInspectionHost['submission']>['prepare']>>[0]) => call('submission-prepare', bound(value), true),
        submit: (value: Parameters<NonNullable<NonNullable<StaffInspectionHost['submission']>['submit']>>[0]) => call<InspectionSubmissionObservation>('submission-submit', bound(value), true) } : {}),
      reconcile: value => call<InspectionSubmissionObservation>('submission-read', bound(value)),
      reconcilePreparation: value => call('submission-preparation', { ...value, request: bound(value.request) }) },
  };
}
