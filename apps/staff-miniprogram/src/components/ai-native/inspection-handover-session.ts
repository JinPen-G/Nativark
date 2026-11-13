/** Keeps the original manual handover and signature-upload locators before
 * any write. Unknowns permit original reads only; TTL and changing form values
 * never replace a pending Core operation. The original page still submits. */
import type { StaffUploadObservationFile, StaffUploadObservationRequest, StaffFulfillmentReceiptQuery } from '@rental-os/shared';
import type { StaffUploadReference } from '../../api/uploads';
import { STORAGE_KEYS, writeStorage } from '../../core/storage';
import { newKey } from '../../core/keys';
import { contextVersion, currentSession } from '../../core/session';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
export type InspectionHandoverOperation = 'inspection' | 'pickup' | 'return' | 'partial_return';
type Owner = { tenantId: string; workspaceId: string; ownerId: string; orderId: string; stage: 'pickup' | 'return' };
interface SignatureUpload {
  file: StaffUploadObservationFile;
  reference: StaffUploadReference;
}
interface HandoverLocator {
  version: 'staff-original-handover-1'; owner: Owner; key: string;
  originalAction: string;
  phase: 'ready' | 'unknown' | 'observed'; operation: InspectionHandoverOperation | null;
  templateId: string | null;
  signature: SignatureUpload | null; signatureFileAssetId: string | null;
}
export interface InspectionHandoverView {
  available: boolean; pending: boolean; operation: InspectionHandoverOperation | null;
  signaturePending: boolean; signatureFileAssetId: string; signatureFormCurrent: boolean; completed: boolean;
}
export interface InspectionHandoverSession {
  current(): boolean;
  hasOriginal(): boolean;
  snapshot(): InspectionHandoverView;
  key(): string;
  receiptQuery(): StaffFulfillmentReceiptQuery | null;
  signature(): SignatureUpload | null;
  signatureObservation(): StaffUploadObservationRequest | null;
  beginSignature(file: StaffUploadObservationFile, reference: StaffUploadReference): void;
  observeSignature(reference: StaffUploadReference): void;
  completeSignature(fileAssetId: string): void;
  invalidateForm(): void;
  clearSignature(): void;
  markSubmitted(operation: InspectionHandoverOperation, templateId?: string): void;
  observeSubmitted(key: string, operation: InspectionHandoverOperation): void;
  finish(key: string): void;
}

function parse(value: unknown, owner: Owner): HandoverLocator {
  if (!object(value) || !exact(value, ['version', 'owner', 'key', 'originalAction', 'phase', 'operation', 'templateId', 'signature', 'signatureFileAssetId'])
    || value.version !== 'staff-original-handover-1' || !same(value.owner, owner) || !id(value.key)
    || ![`${owner.stage}.handover`, ...(owner.stage === 'pickup' ? ['pickup.inspection'] : [])].includes(String(value.originalAction))
    || !['ready', 'unknown', 'observed'].includes(String(value.phase))
    || value.operation !== null && !['inspection', 'pickup', 'return', 'partial_return'].includes(String(value.operation))
    || value.phase !== 'ready' && value.operation === null || value.phase === 'ready' && value.operation !== null
    || (value.operation === 'inspection' ? !id(value.templateId) : value.templateId !== null)
    || value.operation === 'partial_return' && owner.stage !== 'return'
    || value.operation === 'pickup' && owner.stage !== 'pickup' || value.operation === 'return' && owner.stage !== 'return'
    || value.signatureFileAssetId !== null && !id(value.signatureFileAssetId)) throw Error('原交接定位不可用，已停止新提交');
  if (value.signature !== null) {
    const signature = value.signature;
    if (!object(signature) || !exact(signature, ['file', 'reference']) || !object(signature.file) || !object(signature.reference)) throw Error('原签名上传定位不可用');
    const file = signature.file, reference = signature.reference;
    if (!exact(file, ['businessModule', 'businessType', 'businessId', 'fileName', 'mimeType', 'sizeBytes', 'uploadScene', 'metadata'])
      || file.businessModule !== 'rental-core' || file.businessType !== 'rental_order' || file.businessId !== owner.orderId
      || file.uploadScene !== 'handover-signature' || file.mimeType !== 'image/png'
      || typeof file.fileName !== 'string' || file.fileName.length > 180 || !file.fileName
      || !Number.isSafeInteger(file.sizeBytes) || Number(file.sizeBytes) < 1 || Number(file.sizeBytes) > 20971520
      || !object(file.metadata) || !exact(file.metadata, ['handoverStage', 'handoverBatchId'])
      || file.metadata.handoverStage !== owner.stage || file.metadata.handoverBatchId !== value.key
      || !exact(reference, ['operationKey', 'sessionId', 'fileAssetId', 'stage']) || !id(reference.operationKey)
      || reference.sessionId !== null && !id(reference.sessionId) || reference.fileAssetId !== null && !id(reference.fileAssetId)
      || !['registering', 'reading_file', 'uploading', 'verifying', 'completed'].includes(String(reference.stage))) throw Error('原签名上传定位不可用');
    if (value.signatureFileAssetId !== null && reference.fileAssetId !== value.signatureFileAssetId) throw Error('原签名文件不一致');
  } else if (value.signatureFileAssetId !== null) throw Error('原签名来源不可用');
  if (value.phase !== 'ready' && !value.signatureFileAssetId) throw Error('原交接签名来源不可用');
  return copy(value) as unknown as HandoverLocator;
}

export function createInspectionHandoverSession(orderId: string, stage: 'pickup' | 'return', current: () => boolean,
  originalKey: () => string, originalAction: string): InspectionHandoverSession {
  const session = currentSession(), version = contextVersion();
  if (!session || !id(orderId) || !current()) throw Error('当前交接身份不可用');
  const owner: Owner = { tenantId: session.tenant.tenantId, workspaceId: session.currentWorkspaceId,
    ownerId: session.user.id, orderId, stage };
  const storageKey = `rental-os-staff:original-handover:${encodeURIComponent(JSON.stringify(owner))}`;
  const read = (): unknown => {
    try {
      const value: unknown = wx.getStorageSync(storageKey);
      return value === '' || value === null || value === undefined ? undefined : value;
    } catch { throw Error('原交接定位无法读取，已停止新提交'); }
  };
  let held = read(), locator = held === undefined ? null : parse(held, owner), finished: HandoverLocator | null = null;
  // A stored upload reference proves only the original upload. A reopened or
  // rebuilt form cannot inherit the customer's confirmation of its old values.
  // Keep this witness local; invalidating it never changes an unknown locator.
  let signatureFormCurrent = false;
  const active = () => {
    const now = currentSession();
    return current() && contextVersion() === version && now?.tenant.tenantId === owner.tenantId
      && now.currentWorkspaceId === owner.workspaceId && now.user.id === owner.ownerId;
  };
  const assert = () => { if (!active() || !same(read(), held)) throw Error('原交接定位已变化，请核对原操作'); };
  const persist = (next: HandoverLocator) => {
    assert(); const parsed = parse(next, owner); writeStorage(storageKey, parsed);
    if (!same(read(), parsed)) throw Error('未保留原交接定位，不发起提交');
    held = copy(parsed); locator = parsed;
  };
  const ensure = () => {
    assert();
    if (finished) throw Error('原交接已确认，请重新读取订单后办理下一批');
    if (!locator) persist({ version: 'staff-original-handover-1', owner, key: originalKey(), originalAction,
      phase: 'ready', operation: null, templateId: null, signature: null, signatureFileAssetId: null });
    return locator!;
  };
  const result: InspectionHandoverSession = {
    current: active,
    hasOriginal() { return Boolean(locator || finished); },
    snapshot() {
      if (!active()) throw Error('当前交接身份已变化');
      let available = true;
      try { assert(); } catch { available = false; }
      const observed = finished ?? locator;
      return { available, pending: observed?.phase === 'unknown', operation: observed?.operation ?? null,
        signaturePending: !!observed?.signature && !observed.signatureFileAssetId,
        signatureFileAssetId: observed?.signatureFileAssetId ?? '',
        signatureFormCurrent: signatureFormCurrent && !!observed?.signatureFileAssetId,
        completed: observed?.phase === 'observed' };
    },
    key() { return ensure().key; },
    receiptQuery() {
      if (!active()) throw Error('当前交接身份已变化');
      const observed = finished ?? locator;
      if (!observed?.operation) return null;
      const operationKey = observed.key;
      if (observed.operation === 'inspection') return { kind: 'inspection', stage, templateId: observed.templateId!, operationKey };
      if (observed.operation === 'partial_return') return { kind: 'partial_return', stage: 'return', operationKey };
      return { kind: 'handover', stage, operationKey };
    },
    signature() { assert(); return locator?.signature ? copy(locator.signature) : null; },
    signatureObservation() {
      assert(); return locator?.signature ? { reference: { idempotencyKey: locator.signature.reference.operationKey }, file: copy(locator.signature.file) } : null;
    },
    beginSignature(file, reference) {
      const old = ensure();
      if (old.phase !== 'ready' || old.signature) throw Error('请先核对原签名上传，不能重复上传');
      persist({ ...old, signature: { file: copy(file), reference: copy(reference) } });
      signatureFormCurrent = true;
    },
    observeSignature(reference) {
      const old = ensure(), previous = old.signature?.reference;
      if (!old.signature || !previous || old.phase !== 'ready' || reference.operationKey !== previous.operationKey
        || previous.sessionId !== null && reference.sessionId !== previous.sessionId
        || previous.fileAssetId !== null && reference.fileAssetId !== previous.fileAssetId) throw Error('原签名上传定位已变化');
      persist({ ...old, signature: { ...old.signature, reference: copy(reference) } });
    },
    completeSignature(fileAssetId) {
      const old = ensure();
      if (!old.signature || old.phase !== 'ready' || !id(fileAssetId) || old.signature.reference.fileAssetId !== fileAssetId) throw Error('原签名文件不可核对');
      persist({ ...old, signature: { ...old.signature, reference: { ...old.signature.reference, stage: 'completed' } }, signatureFileAssetId: fileAssetId });
    },
    invalidateForm() {
      if (!active()) throw Error('当前交接身份已变化');
      signatureFormCurrent = false;
    },
    clearSignature() {
      const old = ensure();
      if (old.phase !== 'ready' || old.signature && !old.signatureFileAssetId) throw Error('原签名或交接结果待核对，不能重签重发');
      persist({ ...old, signature: null, signatureFileAssetId: null });
      signatureFormCurrent = false;
    },
    markSubmitted(operation, templateId) {
      const old = ensure();
      if (old.phase !== 'ready' || !old.signatureFileAssetId) throw Error('原交接结果待核对或签名未上传');
      if (!signatureFormCurrent) throw Error('表单已重建，请先清除原签名并重新现场签字');
      persist({ ...old, phase: 'unknown', operation, templateId: templateId ?? null });
    },
    observeSubmitted(key, operation) {
      if (finished && active() && finished.key === key && finished.operation === operation) return;
      const old = ensure();
      if (old.key !== key || old.operation !== operation || !['unknown', 'observed'].includes(old.phase)) throw Error('原提交收据定位不一致');
      persist({ ...old, phase: 'observed' });
    },
    finish(key) {
      if (finished && active() && finished.key === key) return;
      assert();
      if (!locator || locator.phase !== 'observed' || locator.key !== key) throw Error('原交接结果尚不可确认');
      let originalKeys: unknown;
      try { originalKeys = wx.getStorageSync(STORAGE_KEYS.actionKeys); } catch { throw Error('原交接键尚不能清理'); }
      if (object(originalKeys)) {
        const slot = `${locator.originalAction}:${orderId}`, entry = originalKeys[slot];
        if (object(entry) && entry.key === key) {
          const remaining = copy(originalKeys); delete remaining[slot];
          if (!same(wx.getStorageSync(STORAGE_KEYS.actionKeys), originalKeys)) throw Error('原交接键已变化');
          writeStorage(STORAGE_KEYS.actionKeys, remaining);
          if (!same(wx.getStorageSync(STORAGE_KEYS.actionKeys), remaining)) throw Error('原交接键尚不能清理');
        }
      }
      // Delete only this exact observed locator. Competing tabs retain theirs.
      try { wx.removeStorageSync(storageKey); } catch { throw Error('原交接定位尚未完成清理'); }
      if (read() !== undefined) throw Error('原交接定位尚未完成清理');
      finished = copy(locator); held = undefined; locator = null;
    },
  };
  return Object.freeze(result);
}

/** Checks the existing action-key slot without TTL/fingerprint replacement.
 * A legacy key has no trustworthy unsent proof; preserve it and stop writes.
 * The caller persists the new key once in the private handover journal. */
export function createOriginalHandoverKey(action: string, orderId: string): string {
  let raw: unknown;
  try { raw = wx.getStorageSync(STORAGE_KEYS.actionKeys); } catch { throw Error('原交接键无法读取，不发起提交'); }
  if (raw !== '' && raw !== null && raw !== undefined && !object(raw)) throw Error('原交接键不可用');
  const keys = object(raw) ? raw : {}, slots = action.startsWith('pickup.')
    ? [`pickup.inspection:${orderId}`, `pickup.handover:${orderId}`] : [`return.handover:${orderId}`];
  if (slots.some(slot => Object.prototype.hasOwnProperty.call(keys, slot))) throw Error('已有旧交接键，请先核对原交接历史；不换键提交');
  return newKey(action.replace(/[^a-z0-9]+/gi, '-'));
}
