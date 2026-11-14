import type { CompleteFileUploadRequest, CreateFileUploadSessionRequest, FileAssetSummary, FileDownloadUrlSummary, FileUploadSessionSummary,
  StaffUploadObservationRequest, StaffUploadObservationResponse } from "@rental-os/shared";
import { newKey } from "../core/keys";
import { request } from "../core/http";
import { isStaffUploadObservationRequest, isStaffUploadObservationResponse, staffUploadObservationRoute } from "../components/ai-native/inspection-wire";

export type StaffUploadStage = 'registering' | 'reading_file' | 'uploading' | 'verifying' | 'completed';
export interface StaffUploadReference { operationKey: string; sessionId: string | null; fileAssetId: string | null;
  stage: StaffUploadStage }
export interface StaffUploadHooks {
  /** Client lifecycle checks do not replace the original server permission. */
  current?: () => boolean; operationKey?: string;
  onStage?: (stage: StaffUploadStage) => void;
  /** Minimal original locator only. Never pass a PUT URL or headers to storage. */
  onReference?: (reference: StaffUploadReference) => void;
  onAbort?: (abort: (() => void) | null) => void;
}
const assertCurrent = (hooks: StaffUploadHooks) => { if (hooks.current && !hooks.current()) throw new Error('当前页面已改变，原上传仅可按原引用核对'); };
/** The native package consumes the formal staff-upload-observation contract;
 * its fixed route and schemas come from the generated native registry. */
export async function observeOriginalStaffUpload(input: StaffUploadObservationRequest, hooks: StaffUploadHooks = {}): Promise<StaffUploadObservationResponse> {
  assertCurrent(hooks);
  if (!isStaffUploadObservationRequest(input)) throw new Error('原上传描述不可用');
  const selected = JSON.parse(JSON.stringify(input)) as StaffUploadObservationRequest;
  if ('idempotencyKey' in selected.reference) {
    // The original create endpoint stores the trimmed key. Match its raw
    // length check before comparing the server's canonical observation.
    const key = selected.reference.idempotencyKey;
    if (key.length > 191 || !key.trim()) throw new Error('原上传键不可用');
    selected.reference.idempotencyKey = key.trim();
  }
  const result: unknown = await request(staffUploadObservationRoute(), { method: 'POST', data: selected, replayAfterRefresh: false, timeoutMs: 15000 });
  assertCurrent(hooks);
  if (!isStaffUploadObservationResponse(result) || JSON.stringify(result.reference) !== JSON.stringify(selected.reference)) throw new Error('原上传观察不可核对');
  return result;
}
/** Explicit original completion only, after a current observation. It may
 * verify/freeze the original staged bytes; it never sends another PUT/file. */
export async function completeObservedStaffUpload(observation: StaffUploadObservationResponse, hooks: StaffUploadHooks): Promise<FileAssetSummary> {
  assertCurrent(hooks);
  if (!isStaffUploadObservationResponse(observation) || observation.state !== 'observed'
    || !['pending_upload','freeze_pending','completed'].includes(observation.session.status)
    || !['pending_upload','active'].includes(observation.session.fileStatus)) throw new Error('原上传不能继续核验');
  hooks.onStage?.('verifying'); assertCurrent(hooks);
  const asset = await request<FileAssetSummary>(`/uploads/sessions/${encodeURIComponent(observation.session.sessionId)}/complete`,
    { method: 'POST', data: {}, replayAfterRefresh: false, timeoutMs: 15000 });
  assertCurrent(hooks);
  if (asset.id !== observation.session.fileAssetId) throw new Error('原核验文件不匹配');
  return asset;
}

export interface LocalStaffImage {
  path: string;
  size: number;
  fileName: string;
  mimeType: string;
}

function readFile(path: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      success: (result) => {
        if (result.data instanceof ArrayBuffer) resolve(result.data);
        else reject(new Error("读取文件失败"));
      },
      fail: () => reject(new Error("读取文件失败，请重新选择"))
    });
  });
}

function putFile(url: string, headers: Record<string, string>, data: ArrayBuffer, hooks: StaffUploadHooks): Promise<void> {
  return new Promise((resolve, reject) => {
    assertCurrent(hooks);
    const task = wx.request({
      url,
      method: "PUT",
      data,
      header: headers,
      timeout: 60000,
      responseType: "text",
      success: (result) => { if (hooks.current && !hooks.current()) { reject(new Error('原上传结果待核对，页面已改变')); return; } hooks.onAbort?.(null);
        result.statusCode >= 200 && result.statusCode < 300 ? resolve() : reject(new Error(`文件存储上传失败（${result.statusCode}）`)); },
      fail: () => { if (!hooks.current || hooks.current()) hooks.onAbort?.(null); reject(new Error("原文件上传结果待核对，请保留原引用")); }
    });
    hooks.onAbort?.(() => task.abort());
  });
}

export async function uploadStaffImage(input: {
  path: string;
  size: number;
  fileName: string;
  mimeType: string;
  businessType: "rental_order" | "rental_work_order";
  businessId: string;
  uploadScene: "pickup-evidence" | "return-evidence" | "handover-signature" | "work-order-evidence" | "offline-payment-proof";
  metadata?: Record<string, unknown>;
}, hooks: StaffUploadHooks = {}): Promise<FileAssetSummary> {
  assertCurrent(hooks);
  const operationKey = hooks.operationKey ?? newKey("staff-upload");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(operationKey)) throw new Error('原上传键不可用');
  let original: StaffUploadReference = { operationKey, sessionId: null, fileAssetId: null, stage: 'registering' };
  const stage = (value: StaffUploadStage) => {
    assertCurrent(hooks); original = { ...original, stage: value };
    hooks.onReference?.({ ...original }); hooks.onStage?.(value); assertCurrent(hooks);
  };
  stage('registering');
  const body: CreateFileUploadSessionRequest = {
    businessModule: "rental-core",
    businessType: input.businessType,
    businessId: input.businessId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.size,
    uploadScene: input.uploadScene,
    idempotencyKey: operationKey,
    metadata: { source: "staff-miniprogram", ...(input.metadata ?? {}) }
  };
  const session = await request<FileUploadSessionSummary>("/uploads/sessions", { method: "POST", data: body, replayAfterRefresh: false });
  assertCurrent(hooks);
  if (!session || typeof session.sessionId !== 'string' || !session.sessionId || typeof session.fileAssetId !== 'string'
    || !session.fileAssetId || !['provider','simulation'].includes(session.mode)
    || !['pending_upload','freeze_pending','completed'].includes(session.status)) throw new Error('原上传会话不可核对');
  original = { ...original, sessionId: session.sessionId, fileAssetId: session.fileAssetId };
  hooks.onReference?.({ ...original }); assertCurrent(hooks);
  if (session.status !== "completed") {
    if (session.mode === "provider" && session.status === 'pending_upload') {
      if (!session.uploadUrl) throw new Error("文件服务没有返回上传地址");
      stage('reading_file'); const data = await readFile(input.path); assertCurrent(hooks);
      if (data.byteLength !== input.size) throw new Error('本地文件已改变，请保留原上传引用');
      stage('uploading'); await putFile(session.uploadUrl, session.uploadHeaders ?? {}, data, hooks); assertCurrent(hooks);
    }
    stage('verifying');
    const completed = await request<FileAssetSummary>(`/uploads/sessions/${encodeURIComponent(session.sessionId)}/complete`, {
      method: "POST",
      data: {} satisfies CompleteFileUploadRequest, replayAfterRefresh: false
    });
    assertCurrent(hooks);
    if (completed.id !== session.fileAssetId) throw new Error('原上传文件引用不一致');
    stage('completed');
    return completed;
  }
  stage('verifying');
  const completed = await request<FileAssetSummary>(`/uploads/sessions/${encodeURIComponent(session.sessionId)}/complete`, { method: "POST", data: {}, replayAfterRefresh: false });
  assertCurrent(hooks);
  if (completed.id !== session.fileAssetId) throw new Error('原上传文件引用不一致');
  stage('completed'); return completed;
}

export async function staffUploadDownloadUrl(fileAssetId: string): Promise<string> {
  const result = await request<FileDownloadUrlSummary>(`/uploads/${encodeURIComponent(fileAssetId)}/download-url`);
  // 模拟存储只返回元数据接口地址，不是可供 <image> 读取的图片文件。
  return result.mode === "provider" ? result.downloadUrl : "";
}
