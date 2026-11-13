/** Uses the original page's upload, signature and Core-submit lifecycle.
 * This leaf only binds original keys, saved employee-value review and receipt
 * recovery. No model output, guessed receipt or alternate submission route. */
import { readFulfillmentReceipt } from '../../api/orders';
import { completeObservedStaffUpload, observeOriginalStaffUpload } from '../../api/uploads';
import { confirmDialog } from '../../core/ui';
import { createInspectionHandoverSession, type InspectionHandoverSession } from './inspection-handover-session';
import { prepareInspectionHumanForm, type InspectionFormPage, type InspectionHumanFormPlan,
  type InspectionHumanFormPreview, type InspectionHumanHandoff } from './inspection-human-form';
import { captureInspectionPageWork, inspectionPageScopeKey, type InspectionPageWorkContext } from './inspection-task-page-binding';
import { attachRemoteInspectionPage } from './inspection-page-binding';
import { validateInspectionWire } from './inspection-wire';
import type { AiInspectionResultReadRequest, RentalOrder } from '@rental-os/shared';

export interface InspectionHandoverPage extends InspectionFormPage {
  data: InspectionFormPage['data'] & { busy: boolean; uploading: boolean; signatureFileAssetId: string;
    signatureDrawn: boolean; signaturePending: boolean; fulfillmentPending: boolean; fulfillmentUnavailable: boolean };
  order?: RentalOrder;
  inspectionPageShown: boolean; inspectionPageEpoch: number; inspectionLoadedScope: string;
  setData(value: Record<string, unknown>): void;
  selectComponent(id: string): WechatMiniprogram.Component.TrivialInstance | null;
  invalidateInspectionSignature(): void;
}
interface Binding { stage: 'pickup' | 'return'; originalAction: string; session: InspectionHandoverSession }
const bindings = new WeakMap<object, Binding>();
const attachments = new WeakMap<object, object>();
const plans = new WeakMap<object, { work: InspectionPageWorkContext; plan: InspectionHumanFormPlan }>();
export const emptyInspectionHandover = () => ({ fulfillmentPending: false, fulfillmentUnavailable: false,
  fulfillmentCanRead: false, fulfillmentMessage: '', signaturePending: false, signatureCanRecover: false,
  humanFormPreview: null as InspectionHumanFormPreview | null });

export function handoverPageSession(page: InspectionHandoverPage, stage: 'pickup' | 'return', originalKey: () => string,
  originalAction: string): InspectionHandoverSession {
  let binding = bindings.get(page);
  if (!binding || binding.stage !== stage || !binding.session.current()
    || binding.originalAction !== originalAction && !binding.session.hasOriginal()) {
    bindings.delete(page);
    try {
      const orderId = page.data.id, scopeKey = inspectionPageScopeKey();
      if (!orderId || !scopeKey || !page.inspectionPageShown) throw Error('当前交接身份不可用');
      const ticket = {}; attachments.set(page, ticket);
      const current = () => attachments.get(page) === ticket && page.inspectionPageShown && page.data.id === orderId && inspectionPageScopeKey() === scopeKey;
      // The persistent original key belongs to this live page/scope, independent
      // of a refreshed template or already-advanced order status.
      const work = { orderId, current };
      binding = { stage, originalAction, session: createInspectionHandoverSession(work.orderId, stage, work.current, originalKey, originalAction) };
      bindings.set(page, binding);
    } catch (error) {
      page.setData({ fulfillmentUnavailable: true, fulfillmentCanRead: false, fulfillmentMessage: '原交接定位不可用，已停止新提交。' });
      throw error;
    }
  }
  return binding.session;
}

export function restoreInspectionHandover(page: InspectionHandoverPage, stage: 'pickup' | 'return', originalKey: () => string,
  originalAction: string): void {
  try { showInspectionHandover(page, handoverPageSession(page, stage, originalKey, originalAction)); }
  catch { page.setData({ fulfillmentUnavailable: true, fulfillmentCanRead: false,
    fulfillmentMessage: '原交接定位不可用，已停止新提交；原表单仍可查看。' }); }
}

export function showInspectionHandover(page: InspectionHandoverPage, session: InspectionHandoverSession): void {
  if (!session.current()) return;
  try {
    const view = session.snapshot();
    page.setData({ fulfillmentPending: view.pending || view.completed, fulfillmentUnavailable: !view.available, fulfillmentCanRead: view.pending || view.completed,
    signaturePending: view.signaturePending, signatureCanRecover: view.available && view.signaturePending,
      signatureFileAssetId: view.signatureFormCurrent || view.pending || view.completed ? view.signatureFileAssetId : '',
      fulfillmentMessage: !view.available ? '原定位已变化，暂停提交；本页仍可读取已持有的原收据。'
        : view.pending ? '原交接提交结果待核对，只读取原收据。'
        : view.completed ? '已核对原交接提交收据。' : view.signaturePending ? '原签名上传待核对，不重复上传。'
        : view.signatureFileAssetId && !view.signatureFormCurrent ? '表单已重建，原签名不能用于当前值；请先清除原签名并重新现场签字。' : '' });
  } catch { page.setData({ fulfillmentUnavailable: true, fulfillmentCanRead: false, fulfillmentMessage: '原交接定位不可用，已停止新提交。' }); }
}

/** Rebuilding the original form withdraws its local signature witness only.
 * Upload/commit unknowns and their exact receipt references stay untouched. */
export function invalidateInspectionHandoverForm(page: InspectionHandoverPage): void {
  plans.delete(page);
  const session = bindings.get(page)?.session;
  if (session?.current()) session.invalidateForm();
  page.setData({ signatureDrawn: false, humanFormPreview: null });
  if (session?.current()) showInspectionHandover(page, session);
}

export function clearInspectionHandoverPage(page: InspectionHandoverPage): void {
  bindings.delete(page); attachments.delete(page); plans.delete(page); page.setData(emptyInspectionHandover());
}
export function hideInspectionHumanForm(page: InspectionHandoverPage): void {
  bindings.delete(page); attachments.delete(page); plans.delete(page); page.setData({ humanFormPreview: null });
}

/** Called by a separate click; never runs as part of page mounting or a read. */
export async function recoverInspectionSignature(page: InspectionHandoverPage, session: InspectionHandoverSession): Promise<void> {
  const work = captureInspectionPageWork(page, true), request = session.signatureObservation();
  if (!request || page.data.busy || page.data.uploading) return;
  page.setData({ uploading: true, error: '' });
  try {
    const observed = await observeOriginalStaffUpload(request, { current: () => work.current() && session.current() });
    if (!work.current() || !session.current()) return;
    if (observed.state !== 'observed') throw Error('尚未找到原签名上传，保留原键，不重复上传');
    const old = session.signature();
    if (!old) throw Error('原签名引用不可用');
    const reference = { ...old.reference, sessionId: observed.session.sessionId, fileAssetId: observed.session.fileAssetId,
      stage: observed.session.status === 'completed' ? 'completed' as const : 'verifying' as const };
    session.observeSignature(reference);
    const asset = await completeObservedStaffUpload(observed, { current: () => work.current() && session.current() });
    if (!work.current() || !session.current()) return;
    session.completeSignature(asset.id); showInspectionHandover(page, session);
  } catch (error) { if (work.current()) page.setData({ error: error instanceof Error ? error.message : '原签名上传仍待核对' }); }
  finally { if (work.current()) { page.setData({ uploading: false }); showInspectionHandover(page, session); } }
}

/** Exact original receipt read. Unknown is never permission to resend. */
export async function readInspectionHandoverReceipt(page: InspectionHandoverPage,
  session: InspectionHandoverSession): Promise<boolean> {
  const work = captureInspectionPageWork(page, true), query = session.receiptQuery(), operation = session.snapshot().operation;
  if (!query || !operation || page.data.busy || page.data.uploading) return false;
  page.setData({ busy: true, error: '' });
  try {
    const result = await readFulfillmentReceipt(work.orderId, query);
    if (!work.current() || !session.current()) return false;
    if (result.version !== 'staff-fulfillment-receipt-1' || result.execution !== 'read_only_no_submission'
      || result.automaticRetry !== false || result.original.orderId !== work.orderId
      || Object.entries(query).some(([key, value]) => result.original[key as keyof typeof result.original] !== value)) throw Error('原交接收据引用不可核对');
    if (result.state !== 'committed') { showInspectionHandover(page, session); return false; }
    if (result.receipt.orderId !== work.orderId || query.kind === 'inspection' && !result.receipt.inspectionId) throw Error('原检查收据不可核对');
    if (!session.snapshot().available) {
      page.setData({ fulfillmentPending: true, fulfillmentMessage: '已找到本页原提交收据；另一页定位已变化，保留该定位并读取原订单。' });
      return false;
    }
    session.observeSubmitted(query.operationKey, operation);
    session.finish(query.operationKey); showInspectionHandover(page, session);
    return true;
  } catch (error) { if (work.current()) page.setData({ error: error instanceof Error ? error.message : '原交接结果仍待核对' }); return false; }
  finally { if (work.current()) { page.setData({ busy: false }); showInspectionHandover(page, session); } }
}

export async function previewInspectionHumanValues(page: InspectionHandoverPage, stage: 'pickup' | 'return'): Promise<void> {
  const work = captureInspectionPageWork(page);
  if (page.data.busy || page.data.uploading || page.data.signaturePending || page.data.fulfillmentPending || page.data.fulfillmentUnavailable) return;
  plans.delete(page); page.setData({ humanFormPreview: null, error: '' });
  const component = page.selectComponent('#ai-inspection-task') as { originalHumanValues?: () => Promise<InspectionHumanHandoff> } | null;
  if (typeof component?.originalHumanValues !== 'function') { page.setData({ error: '请先打开所选原检查草稿' }); return; }
  page.setData({ busy: true });
  try {
    const handoff = await component.originalHumanValues();
    if (!work.current()) return;
    const plan = prepareInspectionHumanForm(page, stage, handoff, work.current);
    plans.set(page, { work, plan }); page.setData({ humanFormPreview: plan.preview });
  } catch (error) { if (work.current()) page.setData({ error: error instanceof Error ? error.message : '原人工检查值暂不可用' }); }
  finally { if (work.current()) page.setData({ busy: false }); }
}

export async function adoptInspectionHumanValues(page: InspectionHandoverPage): Promise<void> {
  const ready = plans.get(page);
  if (!ready || !ready.work.current() || page.data.busy || page.data.uploading || page.data.signaturePending || page.data.fulfillmentPending || page.data.fulfillmentUnavailable) return;
  page.setData({ busy: true, error: '' });
  try {
    if (!ready.plan.preview.changes.length) return;
    const agreed = await confirmDialog({ title: '采用已核对人工值', content: '将所示人工值填入原检查表单。整单字段会影响本批检查；仍须客户签字及另行确认提交。' });
    if (!agreed || !ready.work.current() || plans.get(page) !== ready) return;
    await ready.plan.revalidate();
    if (!ready.work.current() || plans.get(page) !== ready) return;
    page.invalidateInspectionSignature();
    page.setData({ ...ready.plan.apply(), humanFormPreview: null }); plans.delete(page);
  } catch (error) { if (ready.work.current()) { plans.delete(page); page.setData({ humanFormPreview: null,
    error: error instanceof Error ? error.message : '人工检查值已变化，请重新核对' }); } }
  finally { if (ready.work.current()) page.setData({ busy: false }); }
}

export function cancelInspectionHumanValues(page: InspectionHandoverPage): void {
  plans.delete(page); page.setData({ humanFormPreview: null });
}

/** Changes to signed fields require a new explicit onsite signature. Pending
 * uploads and unknown Core writes cannot be replaced by editing the form. */
export function beginInspectionFormEdit(page: InspectionHandoverPage): boolean {
  try { captureInspectionPageWork(page); } catch { return false; }
  if (page.data.busy || page.data.uploading || page.data.signaturePending || page.data.fulfillmentPending || page.data.fulfillmentUnavailable) return false;
  const session = bindings.get(page)?.session;
  if (session) {
    if (!session.current()) return false;
    const view = session.snapshot();
    if (!view.available || view.pending || view.completed || view.signaturePending) { showInspectionHandover(page, session); return false; }
  }
  try { page.invalidateInspectionSignature(); cancelInspectionHumanValues(page); return true; }
  catch (error) { page.setData({ error: error instanceof Error ? error.message : '原签名待核对，请暂停修改' }); return false; }
}

/** Candidate review stays inside the existing draft. Final values go through
 * the page's original batch and signature, not the AI single-draft action ID. */
export async function openInspectionHumanReview(page: InspectionHandoverPage, stage: 'pickup' | 'return', value: unknown): Promise<void> {
  const work = captureInspectionPageWork(page), component = page.selectComponent('#ai-inspection-task') as {
    originalResultReference?: () => AiInspectionResultReadRequest | null } | null;
  const reference = component?.originalResultReference?.();
  if (!reference || !validateInspectionWire('result-read', 'request', value) || JSON.stringify(value) !== JSON.stringify(reference)
    || reference.orderId !== work.orderId || reference.stage !== stage || reference.templateId !== page.template?.id) return;
  await attachRemoteInspectionPage(page, { allocationId: reference.allocationId, draftId: reference.draftId }, stage, undefined, reference);
}
