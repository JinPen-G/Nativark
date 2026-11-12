/** Binds the current pickup/return page to explicit media intake and the
 * original inspection draft. Original host reads decide scope; no task,
 * candidate or client field grants permission to submit a Core inspection. */
import type { AiInspectionResultReadRequest, RentalOrder, RentalInspectionTemplate, AiInspectionTarget,
  AiInspectionEvidenceRef, AiInspectionDraftCreateRequest, StaffUploadObservationRequest,
  StaffUploadObservationResponse } from '@rental-os/shared';
import { currentSession, contextVersion, sessionEvents } from '../../core/session';
import { readStaffInspectionHistory, createStaffInspectionTransportHost } from './inspection-transport';
import { chooseInspectionHistoryItem, attachRemoteInspectionPage } from './inspection-page-binding';
import { validateInspectionWire, isStaffUploadObservationRequest } from './inspection-wire';
import { createStaffInspectionTaskApi } from '../../api/ai-inspection-tasks';
import { uploadStaffImage, observeOriginalStaffUpload, completeObservedStaffUpload, type StaffUploadReference } from '../../api/uploads';
import { readStorage, writeStorage, removeStorage } from '../../core/storage';
import { newKey } from '../../core/keys';

interface Page {
  data: { id: string; signatureFileAssetId?: string; groups?: Array<{ allocationId: string }>;
    allocations?: Array<{ id: string }> };
  order?: RentalOrder; template?: RentalInspectionTemplate;
  setData(value: Record<string, unknown>, callback?: () => void): void;
  selectComponent(selector: string): WechatMiniprogram.Component.TrivialInstance | null;
  inspectionPageShown?: boolean; inspectionPageEpoch?: number; inspectionLoadedScope?: string;
  currentHandoverKey?(): string;
}
export interface InspectionPageWorkContext { orderId: string; scopeKey: string; current(): boolean }
/** Page identity only. The server still owns media/inspection authorization. */
export function inspectionPageScopeKey(): string {
  const session = currentSession();
  return session ? JSON.stringify([session.tenant.tenantId, session.currentWorkspaceId, session.user.id, contextVersion()]) : '';
}
export function subscribeInspectionPageScope(changed: () => void): () => void { return sessionEvents.on(changed); }
/** Capture before a camera/dialog/network await. A later render of the same
 * page may contain another order/template and cannot receive the old result. */
export function captureInspectionPageWork(page: Page, loading = false): InspectionPageWorkContext {
  const scopeKey = inspectionPageScopeKey(), orderId = page.data.id, epoch = page.inspectionPageEpoch,
    templateId = page.template?.id, templateVersion = page.template?.version;
  if (!scopeKey || !orderId || page.inspectionPageShown !== true || epoch === undefined
    || !loading && (page.inspectionLoadedScope !== scopeKey || page.order?.id !== orderId)) throw Error('inspection_page_context_changed');
  return { orderId, scopeKey, current: () => page.inspectionPageShown === true && page.inspectionPageEpoch === epoch
    && page.data.id === orderId && inspectionPageScopeKey() === scopeKey
    && (loading || page.inspectionLoadedScope === scopeKey && page.order?.id === orderId
      && page.template?.id === templateId && page.template?.version === templateVersion) };
}
interface IntakeLocator {
  version: 'staff-inspection-intake-1'; target: AiInspectionTarget; templateVersion: string; bindingFingerprint: string;
  kind: 'image' | 'audio'; upload: StaffUploadReference; evidence: AiInspectionEvidenceRef | null;
  file: StaffUploadObservationRequest['file'];
  create: AiInspectionDraftCreateRequest | null; draftId: string | null;
  phase: 'upload_pending' | 'evidence_pending' | 'evidence_ready' | 'draft_pending' | 'draft_saved';
}
interface LocalMedia { path: string; size: number; fileName: string; mimeType: 'image/png' | 'image/jpeg' | 'audio/wav'; kind: 'image' | 'audio' }
interface IntakeRuntime {
  busy: boolean; recording: boolean; discardRecording: boolean; recorder?: WechatMiniprogram.RecorderManager;
  stopListener?: Parameters<WechatMiniprogram.RecorderManager['onStop']>[0]; errorListener?: () => void;
  local: LocalMedia | null; target: AiInspectionTarget | null; locator: IntakeLocator | null; key: string; held: unknown;
  work: InspectionPageWorkContext | null;
  observation?: StaffUploadObservationResponse; message?: string;
  abortUpload?: () => void;
}
const intakeStates = new WeakMap<object, IntakeRuntime>();
// Native RecorderManager has no listener-removal API in this host contract.
// Install one bounded dispatcher per manager and keep an owner only in flight.
const recorderOwners = new WeakMap<WechatMiniprogram.RecorderManager, { owner: IntakeRuntime | null }>();
function recorderOwner(recorder: WechatMiniprogram.RecorderManager) {
  let route = recorderOwners.get(recorder);
  if (!route) {
    route = { owner: null }; recorderOwners.set(recorder, route);
    const receiver = route;
    recorder.onStop(result => { const owner = receiver.owner; receiver.owner = null; owner?.stopListener?.(result); });
    recorder.onError(() => { const owner = receiver.owner; receiver.owner = null; owner?.errorListener?.(); });
  }
  return route;
}
const mediaLimit = 524288;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function intakeState(page: Page): IntakeRuntime {
  let state = intakeStates.get(page);
  if (!state) { state = { busy: false, recording: false, discardRecording: false, local: null, target: null,
    locator: null, key: '', held: undefined, work: null }; intakeStates.set(page, state); }
  return state;
}
function intakeKey(page: Page, stage: 'pickup' | 'return') {
  const session = currentSession();
  if (!session || !page.template) throw Error('当前检查对象不可用');
  return `rental-os-staff:inspection-intake:${encodeURIComponent(JSON.stringify([session.tenant.tenantId,
    session.currentWorkspaceId, session.user.id, page.data.id, page.template.id, stage]))}`;
}
function loadIntake(page: Page, stage: 'pickup' | 'return', state: IntakeRuntime) {
  const key = intakeKey(page, stage);
  if (state.key === key) return;
  state.local = null; state.target = null; state.locator = null; state.key = key;
  const raw = readStorage<unknown>(key); state.held = raw === undefined ? undefined : copy(raw);
  if (raw === undefined) return;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('原媒体草稿引用不可用');
  const row = raw as Record<string, unknown>;
  const keys = ['version','target','templateVersion','bindingFingerprint','kind','upload','file','evidence','create','draftId','phase'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(value => !keys.includes(value))
    || row.version !== 'staff-inspection-intake-1' || !validateInspectionWire('template-read','request',row.target)
    || typeof row.templateVersion !== 'string' || !row.templateVersion || typeof row.bindingFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/u.test(row.bindingFingerprint) || row.kind !== 'image' && row.kind !== 'audio'
    || !['upload_pending','evidence_pending','evidence_ready','draft_pending','draft_saved'].includes(String(row.phase))) throw Error('原媒体草稿引用不可用');
  const target = row.target as AiInspectionTarget, upload = row.upload as Record<string, unknown> | null;
  if (target.orderId !== page.data.id || target.templateId !== page.template?.id || target.stage !== stage
    || !upload || Object.keys(upload).sort().join(',') !== 'fileAssetId,operationKey,sessionId,stage'
    || typeof upload.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(upload.operationKey)
    || upload.sessionId !== null && typeof upload.sessionId !== 'string'
    || upload.fileAssetId !== null && typeof upload.fileAssetId !== 'string'
    || !['registering','reading_file','uploading','verifying','completed'].includes(String(upload.stage))
    || row.create !== null && !validateInspectionWire('draft-create','request',row.create)
    || row.draftId !== null && typeof row.draftId !== 'string') throw Error('原媒体草稿引用不可用');
  if (row.evidence !== null && (!validateInspectionWire('evidence-bind','response',row.evidence)
    || (row.evidence as AiInspectionEvidenceRef).attachmentId !== upload.fileAssetId)) throw Error('原附件引用不可用');
  const parsed = copy(row) as unknown as IntakeLocator;
  if (!isStaffUploadObservationRequest({ reference: { idempotencyKey: parsed.upload.operationKey }, file: parsed.file })
    || parsed.file.businessType !== 'rental_order' || parsed.file.businessId !== target.orderId || parsed.file.uploadScene !== `${target.stage}-evidence`
    || !['image/png','image/jpeg','audio/wav'].includes(parsed.file.mimeType) || parsed.file.sizeBytes > mediaLimit
    || parsed.file.metadata?.handoverStage !== target.stage || !parsed.file.metadata.handoverBatchId) throw Error('原文件描述不可用');
  if (parsed.create && (!equal(parsed.target, { orderId: parsed.create.orderId, allocationId: parsed.create.allocationId,
    templateId: parsed.create.templateId, stage: parsed.create.stage }) || parsed.create.bindingFingerprint !== parsed.bindingFingerprint
    || !parsed.evidence || !equal(parsed.create.evidence, [parsed.evidence]))) throw Error('原检查草稿请求不可用');
  state.locator = parsed; state.target = parsed.target;
}
function retainIntake(state: IntakeRuntime, next: IntakeLocator) {
  if (!state.work?.current() || !state.key || !equal(readStorage(state.key), state.held)) throw Error('原媒体引用已改变');
  const snapshot = copy(next); writeStorage(state.key, snapshot);
  if (!equal(readStorage(state.key), snapshot)) throw Error('未保留原媒体引用，不发起下一操作');
  state.held = snapshot; state.locator = snapshot;
}
function requiredIntake(state: IntakeRuntime): IntakeLocator {
  if (!state.locator) throw Error('原媒体引用丢失');
  return state.locator;
}
function showIntake(page: Page, state: IntakeRuntime, message?: string) {
  if (state.work && !state.work.current()) return;
  if (message !== undefined) state.message = message;
  const locator = state.locator;
  page.setData({ aiInspectionRecording: state.recording, aiInspectionMediaBusy: state.busy,
    aiInspectionMediaReady: Boolean(state.local), aiInspectionCanUpload: Boolean(state.local && !locator && !state.busy && !state.recording),
    aiInspectionCanSaveDraft: locator?.phase === 'evidence_ready' && !state.busy,
    aiInspectionCanRecoverMedia: Boolean(locator && !state.busy),
    aiInspectionCanVerifyUpload: Boolean(!state.busy && state.observation?.state === 'observed' && locator?.phase === 'upload_pending'),
    aiInspectionMediaMessage: state.message || (locator?.phase === 'draft_saved' ? '原 AI 检查草稿已保存；识别仍须明确启动'
      : locator?.phase === 'evidence_ready' ? '原附件已核对，请明确保存 AI 检查草稿'
      : locator ? '原上传或草稿待核对，不重新上传或换键提交'
      : state.local ? '本机材料已选定，尚未上传' : '图片限 PNG/JPEG、512KB；录音为 WAV、最长12秒，同一识别不混用') });
}
async function selectIntakeTarget(page: Page, stage: 'pickup' | 'return', state: IntakeRuntime) {
  const work = captureInspectionPageWork(page); state.work = work; loadIntake(page, stage, state);
  if (state.locator) {
    const original = state.locator;
    if (original.phase !== 'draft_saved' || !original.create || !original.draftId) throw Error('须先核对原上传或草稿，不能另选材料');
    // Selecting another material is a new human intent. Retire only an intake
    // whose original create receipt is observed; an unknown is never replaced.
    const receipt = await createStaffInspectionTaskApi(work).readDraftOperation({ kind: 'create', request: original.create });
    if (!work.current() || receipt.status !== 'found' || receipt.result.status !== 'draft_saved'
      || receipt.result.draftId !== original.draftId || receipt.result.inspectionId !== null
      || !equal(readStorage(state.key), state.held)) throw Error('原草稿保存尚不可核对，保留原材料引用');
    removeStorage(state.key);
    if (readStorage(state.key) !== undefined) throw Error('原材料引用尚未更新，请稍后再选取');
    state.locator = null; state.held = undefined; state.observation = undefined;
  }
  state.message = ''; state.local = null;
  const rows = stage === 'pickup' ? (page.data.groups ?? []).map(row => row.allocationId) : (page.data.allocations ?? []).map(row => row.id);
  const index = await chooseInspectionHistoryItem(rows.map(id => `本次${stage === 'pickup' ? '交付' : '归还'}资源 ${id.slice(-12)}`), work.current);
  if (index === null || !work.current() || !rows[index] || !page.template) throw Error('未选择当前分配资源');
  const target = { orderId: work.orderId, allocationId: rows[index], templateId: page.template.id, stage };
  state.target = target; return work;
}
export async function chooseInspectionPageImage(page: Page, stage: 'pickup' | 'return') {
  const state = intakeState(page); if (state.busy || state.recording) return;
  state.busy = true;
  try {
    const work = await selectIntakeTarget(page, stage, state);
    const file = await new Promise<{ path: string; size: number }>((resolve, reject) => wx.chooseImage({ count: 1,
      sourceType: ['camera','album'], sizeType: ['compressed'], success: value => {
        const selected = value.tempFiles[0]; if (!selected) reject(Error('未选择图片')); else resolve({ path: selected.path, size: selected.size });
      }, fail: () => reject(Error('相机或相册不可用，可继续人工检查')) }));
    if (!work.current()) return;
    const image = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => wx.getImageInfo({ src: file.path, success: resolve, fail: () => reject(Error('图片格式无法核对')) }));
    if (!work.current()) return;
    const mimeType = image.type === 'png' ? 'image/png' : image.type === 'jpeg' ? 'image/jpeg' : null;
    if (!mimeType || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > mediaLimit) throw Error('AI 图片只接 PNG/JPEG，单文件不超过512KB；其他材料可走原人工检查');
    state.local = { ...file, kind: 'image', mimeType, fileName: `${stage}-ai-evidence.${mimeType === 'image/png' ? 'png' : 'jpg'}` };
  } catch (error) { showIntake(page, state, error instanceof Error ? error.message : '原材料暂不可用'); }
  finally { state.busy = false; showIntake(page, state); }
}
export async function startInspectionPageRecording(page: Page, stage: 'pickup' | 'return') {
  const state = intakeState(page); if (state.busy || state.recording) return;
  state.busy = true;
  try {
    const work = await selectIntakeTarget(page, stage, state), recorder = wx.getRecorderManager();
    const route = recorderOwner(recorder);
    if (route.owner) throw Error('原录音尚未停止，请稍后再录制');
    state.recorder = recorder; state.discardRecording = false;
    state.stopListener = result => {
      state.recording = false;
      if (!work.current() || state.discardRecording) return;
      if (!Number.isSafeInteger(result.duration) || !Number.isSafeInteger(result.fileSize)
        || result.duration < 1 || result.duration > 12000 || result.fileSize < 1 || result.fileSize > mediaLimit) {
        showIntake(page, state, 'WAV录音不超过12秒/512KB；无法核对时继续人工检查'); return;
      }
      state.local = { path: result.tempFilePath, size: result.fileSize, kind: 'audio', mimeType: 'audio/wav', fileName: `${stage}-ai-evidence.wav` };
      showIntake(page, state);
    };
    state.errorListener = () => { state.recording = false; if (work.current()) showIntake(page, state, '录音权限或设备不可用，可继续人工检查'); };
    route.owner = state; state.recording = true;
    try { recorder.start({ format: 'wav', sampleRate: 16000, numberOfChannels: 1, duration: 12000 }); }
    catch (error) { route.owner = null; state.recording = false; throw error; }
  } catch (error) { showIntake(page, state, error instanceof Error ? error.message : '录音暂不可用'); }
  finally { state.busy = false; showIntake(page, state); }
}
export function stopInspectionPageRecording(page: Page, discard = false) {
  const state = intakeStates.get(page); if (!state?.recording) return;
  state.discardRecording = discard; state.recorder?.stop();
}
export function cancelInspectionPageUpload(page: Page) {
  const state = intakeStates.get(page); if (!state?.abortUpload) return;
  state.abortUpload(); state.abortUpload = undefined;
  showIntake(page, state, '本端上传已停止；原上传结果仍须按原引用核对');
}
export function clearInspectionPageMedia(page: Page) {
  const state = intakeStates.get(page); if (!state) return;
  // The native manager is shared. A finished recording on this page does not
  // authorize stopping another page's current recording.
  stopInspectionPageRecording(page, true); state.abortUpload?.(); state.abortUpload = undefined;
  state.local = null; intakeStates.delete(page);
}
async function readIntakeTemplate(page: Page, state: IntakeRuntime) {
  if (!state.work?.current() || !state.target || !page.template) throw Error('当前检查对象已改变');
  const api = createStaffInspectionTaskApi(state.work), value = await api.readTemplate(state.target), session = currentSession();
  if (!state.work.current() || !session || value.template.id !== state.target.templateId || value.template.version !== page.template.version
    || value.orderId !== state.target.orderId || value.allocationId !== state.target.allocationId || value.stage !== state.target.stage
    || value.owner.actorId !== session.user.id || value.scope.kind !== 'workspace' || value.scope.tenantId !== session.tenant.tenantId
    || value.scope.workspaceId !== session.currentWorkspaceId) throw Error('原检查模板或权限已改变');
  return value;
}
export async function uploadInspectionPageMedia(page: Page, stage: 'pickup' | 'return') {
  const state = intakeState(page); if (state.busy || state.recording || !state.local || state.locator || !state.target) return;
  state.work = captureInspectionPageWork(page); state.busy = true; showIntake(page, state, '核对原模板和上传范围');
  try {
    const template = await readIntakeTemplate(page, state), local = state.local, target = state.target;
    const operationKey = newKey('inspection-upload'), handoverBatchId = page.currentHandoverKey?.();
    if (!handoverBatchId) throw Error('原交接批次不可用');
    const file: StaffUploadObservationRequest['file'] = { businessModule: 'rental-core', businessType: 'rental_order',
      businessId: target.orderId, fileName: local.fileName, mimeType: local.mimeType, sizeBytes: local.size,
      uploadScene: stage === 'pickup' ? 'pickup-evidence' : 'return-evidence', metadata: { handoverStage: stage, handoverBatchId } };
    retainIntake(state, { version: 'staff-inspection-intake-1', target, templateVersion: template.template.version,
      bindingFingerprint: template.bindingFingerprint, kind: local.kind, upload: { operationKey, sessionId: null, fileAssetId: null, stage: 'registering' },
      file, evidence: null, create: null, draftId: null, phase: 'upload_pending' });
    const current = state.work.current;
    const asset = await uploadStaffImage({ path: local.path, size: local.size, fileName: local.fileName, mimeType: local.mimeType,
      businessType: 'rental_order', businessId: target.orderId, uploadScene: stage === 'pickup' ? 'pickup-evidence' : 'return-evidence',
      metadata: file.metadata }, { current, operationKey,
      onReference: reference => { if (!state.locator) throw Error('原上传定位丢失'); retainIntake(state, { ...state.locator, upload: reference }); },
      onAbort: abort => { state.abortUpload = abort ?? undefined; },
      onStage: value => showIntake(page, state, value === 'uploading' ? '原文件正在上传' : value === 'verifying' ? '核验原上传' : '准备原上传') });
    if (!current()) return;
    const uploaded = requiredIntake(state);
    if (asset.id !== uploaded.upload.fileAssetId) throw Error('原上传文件不匹配');
    state.local = null; retainIntake(state, { ...uploaded, phase: 'evidence_pending' });
    const evidence = await createStaffInspectionTaskApi(state.work).bindEvidence({ ...target, attachmentId: asset.id });
    if (!current() || evidence.attachmentId !== asset.id) return;
    retainIntake(state, { ...requiredIntake(state), evidence, phase: 'evidence_ready' }); state.message = '';
  } catch (error) { showIntake(page, state, error instanceof Error ? error.message : '原上传待核对，不重新派发'); }
  finally { state.busy = false; showIntake(page, state); }
}
export async function saveInspectionPageMediaDraft(page: Page, stage: 'pickup' | 'return') {
  const state = intakeState(page); if (state.busy || state.locator?.phase !== 'evidence_ready' || !state.locator.evidence) return;
  state.work = captureInspectionPageWork(page); state.busy = true;
  try {
    const template = await readIntakeTemplate(page, state), locator = state.locator;
    if (template.bindingFingerprint !== locator.bindingFingerprint || template.template.version !== locator.templateVersion) throw Error('原模板已改变，不能保存旧材料');
    const request: AiInspectionDraftCreateRequest = { ...locator.target, operationId: newKey('inspection-draft'),
      bindingFingerprint: locator.bindingFingerprint, results: {}, evidence: [locator.evidence!] };
    retainIntake(state, { ...locator, create: request, phase: 'draft_pending' });
    const saved = await createStaffInspectionTaskApi(state.work).createDraft(request);
    if (!state.work.current() || !state.locator || saved.status !== 'draft_saved' || saved.inspectionId !== null) throw Error('原草稿保存待核对');
    retainIntake(state, { ...state.locator, draftId: saved.draftId, phase: 'draft_saved' });
    await openInspectionTaskPage(page, stage);
  } catch (error) { showIntake(page, state, error instanceof Error ? error.message : '原草稿待核对，不换键保存'); }
  finally { state.busy = false; showIntake(page, state); }
}
export async function recoverInspectionPageMedia(page: Page, stage: 'pickup' | 'return') {
  const state = intakeState(page); if (state.busy || state.recording) return;
  state.work = captureInspectionPageWork(page); state.busy = true;
  try {
    loadIntake(page, stage, state); const locator = state.locator; if (!locator) return;
    const api = createStaffInspectionTaskApi(state.work);
    if (locator.phase === 'upload_pending') {
      const observation = await observeOriginalStaffUpload({ reference: { idempotencyKey: locator.upload.operationKey }, file: locator.file }, state.work);
      state.observation = observation;
      if (observation.state !== 'observed') throw Error('未观察到原上传，不代表未登记；保留原键继续核对');
      if (locator.upload.sessionId && locator.upload.sessionId !== observation.session.sessionId
        || locator.upload.fileAssetId && locator.upload.fileAssetId !== observation.session.fileAssetId) throw Error('原上传会话不匹配');
      if (observation.session.status !== 'completed' || observation.session.fileStatus !== 'active' || !observation.session.completedAt) {
        showIntake(page, state, '原上传尚未证实完成；可明确核验原会话，不发送另一次文件'); return;
      }
      retainIntake(state, { ...locator, upload: { ...locator.upload, sessionId: observation.session.sessionId,
        fileAssetId: observation.session.fileAssetId, stage: 'completed' }, phase: 'evidence_pending' });
    }
    if (state.locator?.phase === 'evidence_pending') {
      const original = state.locator;
      if (!original.upload.fileAssetId) throw Error('原附件引用缺失');
      const evidence = await api.bindEvidence({ ...original.target, attachmentId: original.upload.fileAssetId });
      retainIntake(state, { ...original, evidence, phase: 'evidence_ready' }); state.message = ''; return;
    }
    if (locator.phase === 'draft_pending') {
      if (!locator.create) throw Error('原草稿操作缺失');
      const receipt = await api.readDraftOperation({ kind: 'create', request: locator.create });
      if (receipt.status !== 'found' || receipt.result.status !== 'draft_saved' || receipt.result.inspectionId !== null) throw Error('原草稿结果尚未证实，不重新保存');
      retainIntake(state, { ...locator, draftId: receipt.result.draftId, phase: 'draft_saved' });
    }
    if (state.locator?.draftId) {
      const draft = await api.readDraft({ ...state.locator.target, draftId: state.locator.draftId });
      if (draft.templateVersion !== state.locator.templateVersion || draft.bindingFingerprint !== state.locator.bindingFingerprint) throw Error('原草稿材料已改变');
      await openInspectionTaskPage(page, stage);
    }
  } catch (error) { showIntake(page, state, error instanceof Error ? error.message : '原材料待核对'); }
  finally { state.busy = false; showIntake(page, state); }
}
export async function verifyInspectionPageUpload(page: Page, stage: 'pickup' | 'return') {
  const state = intakeState(page); if (state.busy || state.locator?.phase !== 'upload_pending' || state.observation?.state !== 'observed') return;
  state.work = captureInspectionPageWork(page); state.busy = true;
  try {
    loadIntake(page, stage, state);
    const locator = state.locator;
    // Re-read immediately before the explicitly requested original completion.
    const observation = await observeOriginalStaffUpload({ reference: { idempotencyKey: locator.upload.operationKey }, file: locator.file }, state.work);
    if (observation.state !== 'observed' || observation.descriptionHash !== state.observation.descriptionHash) throw Error('原上传描述已改变');
    const asset = await completeObservedStaffUpload(observation, state.work);
    retainIntake(state, { ...locator, upload: { ...locator.upload, sessionId: observation.session.sessionId,
      fileAssetId: asset.id, stage: 'completed' }, phase: 'evidence_pending' }); state.message = '';
  } catch (error) { showIntake(page, state, error instanceof Error ? error.message : '原上传核验待核对'); }
  finally { state.busy = false; showIntake(page, state); }
}
interface Binding {
  ticket: object; shown: boolean; current(): boolean; unsubscribe?: () => void;
  source?: { orderId: string; allocationId: string; templateId: string; stage: 'pickup' | 'return'; draftId: string };
}
const bindings = new WeakMap<object, Binding>();
export function clearInspectionTaskPage(page: Page): void {
  const old = bindings.get(page); bindings.delete(page); old?.unsubscribe?.();
  page.selectComponent('#ai-inspection-task')?.detachHost?.();
  page.setData({ aiInspectionTaskVisible: false, aiInspectionTaskLoading: false, aiInspectionTaskMessage: '' });
}
export function hideInspectionTaskPage(page: Page): void {
  const binding = bindings.get(page); if (binding) binding.shown = false;
  page.selectComponent('#ai-inspection-task')?.hostHide?.();
}
export function showInspectionTaskPage(page: Page): void {
  const binding = bindings.get(page); if (!binding) return;
  binding.shown = true;
  if (!binding.current()) { clearInspectionTaskPage(page); return; }
  void page.selectComponent('#ai-inspection-task')?.hostShow?.();
}
export async function openInspectionTaskPage(page: Page, stage: 'pickup' | 'return'): Promise<void> {
  if (bindings.get(page)?.source === undefined && bindings.has(page)) return;
  clearInspectionTaskPage(page);
  const session = currentSession(), version = contextVersion(), orderId = page.data.id,
    templateId = page.template?.id, templateVersion = page.template?.version;
  if (!session || !orderId || !templateId || page.order?.id !== orderId) {
    page.setData({ aiInspectionTaskMessage: '当前检查对象不可用，请继续原人工检查' }); return;
  }
  const ticket = {}, current = () => { const now = currentSession(), binding = bindings.get(page);
    return binding?.ticket === ticket && binding.shown && page.data.id === orderId && page.template?.id === templateId
      && page.template?.version === templateVersion
      && contextVersion() === version && now?.user.id === session.user.id && now?.tenant.tenantId === session.tenant.tenantId
      && now?.currentWorkspaceId === session.currentWorkspaceId;
  };
  const binding: Binding = { ticket, shown: true, current }; bindings.set(page,binding);
  binding.unsubscribe = sessionEvents.on(() => clearInspectionTaskPage(page));
  page.setData({ aiInspectionTaskLoading: true });
  try {
    let after: string | undefined;
    while (current()) {
      const history = await readStaffInspectionHistory({ orderId, stage, limit: 5, ...(after ? { after } : {}) });
      if (!current()) return;
      // The original pages project different shapes from their allocations.
      // Keep that mapping here; the server still checks the selected resource.
      const allocations = new Set(stage === 'pickup' ? (page.data.groups ?? []).map(row => row.allocationId)
        : (page.data.allocations ?? []).map(row => row.id));
      const items = history.items.filter(item => ['draft_saved','prepared'].includes(item.status)
        && item.target.templateId === templateId && allocations.has(item.target.allocationId));
      const labels = items.map(item => `原检查草稿 ${item.draftId.slice(-12)} · 版本 ${item.revision}`);
      if (history.nextAfter) labels.push('更多原检查草稿');
      if (!labels.length) { page.setData({ aiInspectionTaskMessage: '没有当前可用的原检查草稿；仍可继续人工检查或读取原历史收据' }); return; }
      const index = await chooseInspectionHistoryItem(labels,current);
      if (index === null || !current()) return;
      if (index === items.length && history.nextAfter) { after = history.nextAfter; continue; }
      const item = items[index]; if (!item) return;
      const source = { ...item.target, draftId: item.draftId };
      const original = await createStaffInspectionTransportHost(source,page.data.signatureFileAssetId || undefined);
      if (!current() || original.context.ownerId !== session.user.id || original.context.tenantId !== session.tenant.tenantId
        || original.context.workspaceId !== session.currentWorkspaceId || original.serverEnabled !== true) return;
      binding.source = source;
      const active = () => current() && original.current();
      page.setData({ aiInspectionTaskVisible: true, aiInspectionTaskMessage: '' }, () => {
        if (!active()) return;
        const component = page.selectComponent('#ai-inspection-task');
        if (typeof component?.attachHost !== 'function') return;
        component.attachHost({ context: { tenantId: original.context.tenantId, workspaceId: original.context.workspaceId,
          ownerId: original.context.ownerId, source, current: active } });
        void component.hostShow?.();
      });
      return;
    }
  } catch { if (current()) page.setData({ aiInspectionTaskMessage: '原检查任务入口暂不可用，请继续原人工检查' }); }
  finally { if (bindings.get(page) === binding) {
    page.setData({ aiInspectionTaskLoading: false });
    if (!binding.source) { bindings.delete(page); binding.unsubscribe?.(); }
  } }
}
export async function openInspectionTaskResult(page: Page, stage: 'pickup' | 'return', value: unknown): Promise<void> {
  const binding = bindings.get(page), expected = page.selectComponent('#ai-inspection-task')?.originalResultReference?.();
  if (!binding?.source || !binding.current() || !expected || JSON.stringify(value) !== JSON.stringify(expected)
    || !validateInspectionWire('result-read','request',value)) return;
  const reference = value as AiInspectionResultReadRequest;
  if (Object.entries(binding.source).some(([key, expected]) => reference[key as keyof AiInspectionResultReadRequest] !== expected)) return;
  await attachRemoteInspectionPage(page,{ allocationId: reference.allocationId, draftId: reference.draftId },stage,
    page.data.signatureFileAssetId || undefined,reference);
}
