import { currentSession, contextVersion, sessionEvents } from "../../core/session";
import type { StaffInspectionHost, StaffInspectionReceiptHost, InspectionRecognitionReference } from "./inspection-host";
import { createStaffInspectionTransportHost, createStaffInspectionReceiptHost, readStaffInspectionHistory } from './inspection-transport';

interface InspectionPage {
  data: { id: string };
  template?: { id: string; version?: string };
  setData(patch: Record<string, unknown>): void;
  selectComponent(selector: string): WechatMiniprogram.Component.TrivialInstance | null;
}
const subscriptions = new WeakMap<object, () => void>();
const remoteLoads = new WeakMap<object, object>();
export function clearInspectionPage(page: InspectionPage) {
  remoteLoads.delete(page);
  subscriptions.get(page)?.(); subscriptions.delete(page);
  page.selectComponent("#ai-inspection-assist")?.detachHost?.();
  page.setData({ aiInspectionVisible: false, aiInspectionHistoryLoading: false, aiInspectionHistoryMessage: "" });
}
export function hideInspectionPage(page: InspectionPage) {
  remoteLoads.delete(page);
  page.selectComponent('#ai-inspection-assist')?.hostHide?.();
  page.setData({ aiInspectionHistoryLoading: false });
}
async function chooseHistoryItem(labels: string[], current: () => boolean): Promise<number | null> {
  let offset = 0;
  while (current() && offset < labels.length) {
    const items = labels.slice(offset, offset + 5), more = offset + 5 < labels.length;
    const selected = await new Promise<number | null>(resolve => wx.showActionSheet({
      itemList: more ? [...items, '下一组'] : items, success: result => resolve(result.tapIndex), fail: () => resolve(null) }));
    if (!current() || selected === null || !Number.isInteger(selected) || selected < 0 || selected > items.length) return null;
    if (more && selected === items.length) { offset += 5; continue; }
    return selected < items.length ? offset + selected : null;
  }
  return null;
}
export async function openInspectionReceiptHistory(page: InspectionPage, stage: 'pickup' | 'return') {
  if (remoteLoads.has(page)) return false;
  clearInspectionPage(page);
  const ticket = {}, orderId = page.data.id, version = contextVersion(), session = currentSession();
  if (!session || !orderId) return false;
  const current = () => {
    const now = currentSession();
    return remoteLoads.get(page) === ticket && page.data.id === orderId && contextVersion() === version
      && now?.user.id === session.user.id && now?.tenant.tenantId === session.tenant.tenantId && now?.currentWorkspaceId === session.currentWorkspaceId;
  };
  remoteLoads.set(page, ticket); page.setData({ aiInspectionHistoryLoading: true });
  try {
    let after: string | undefined;
    while (current()) {
      const history = await readStaffInspectionHistory({ orderId, stage, limit: 5, ...(after ? { after } : {}) });
      if (!current()) return false;
      if (!history.items.length) { page.setData({ aiInspectionHistoryMessage: '未找到本人可见的历史草稿；不创建或提交新检查。' }); return false; }
      const labels = history.items.map((item, index) => `${index + 1}. ${item.draftId.slice(-12)} / v${item.revision} / ${item.status}`);
      if (history.nextAfter) labels.push('更多历史草稿');
      const index = await chooseHistoryItem(labels, current);
      if (index === null || !current()) return false;
      if (index === history.items.length && history.nextAfter) { after = history.nextAfter; continue; }
      const item = history.items[index];
      if (!item) return false;
      const choice = await chooseHistoryItem(['只核对原检查提交收据', ...item.recognitionSaves.map((ref, index) =>
        `${index + 1}. 保存 ${ref.operationId.slice(-12)} / 原版本 ${ref.expectedRevision}`)], current);
      if (choice === null || !current()) return false;
      const recognitionSave = choice > 0 ? item.recognitionSaves[choice - 1] : undefined;
      const host = await createStaffInspectionReceiptHost({ ...item.target, draftId: item.draftId, mode: 'receipt_only',
        ...(recognitionSave ? { recognitionSave } : {}) });
      if (!current()) return false;
      const attached = attachReceiptInspectionPage(page, host, stage);
      if (attached) page.setData({ aiInspectionHistoryMessage: item.recognitionSavesTruncated
        ? '只列出有界扫描内已证明的保存引用；其余记录请人工核对。'
        : item.recognitionReceipt === 'manual_reconcile' ? '没有可证明的识别保存关联；不重新识别或回填旧记录。' : '' });
      return attached;
    }
  } catch { if (current()) page.setData({ aiInspectionHistoryMessage: '历史收据不可用，请在原人工流程核对。' }); }
  finally { if (remoteLoads.get(page) === ticket) { remoteLoads.delete(page); page.setData({ aiInspectionHistoryLoading: false }); } }
  return false;
}
export function attachReceiptInspectionPage(page: InspectionPage, host: StaffInspectionReceiptHost, stage: 'pickup' | 'return') {
  clearInspectionPage(page);
  const session = currentSession(), version = contextVersion();
  if (!session || host.mode !== 'receipt_only' || host.serverEnabled !== true || host.context.audience !== 'staff'
    || host.context.tenantId !== session.tenant.tenantId || host.context.workspaceId !== session.currentWorkspaceId
    || host.context.ownerId !== session.user.id || host.target.orderId !== page.data.id || host.target.stage !== stage) return false;
  const target = { ...host.target }, context = { ...host.context }, component = page.selectComponent('#ai-inspection-assist');
  if (typeof component?.attachReceiptHost !== 'function') return false;
  const current = () => { const now = currentSession(); return contextVersion() === version && page.data.id === target.orderId
    && now?.tenant.tenantId === context.tenantId && now?.currentWorkspaceId === context.workspaceId && now?.user.id === context.ownerId && host.current() === true; };
  try {
    if (!current()) return false;
    subscriptions.set(page, sessionEvents.on(() => clearInspectionPage(page)));
    component.attachReceiptHost({ ...host, context, target, current });
    if (!current()) { clearInspectionPage(page); return false; }
    page.setData({ aiInspectionVisible: true }); void component.hostShow?.();
    return true;
  } catch { clearInspectionPage(page); return false; }
}
/** Explicit application invocation only. Never enabled by an onLoad query,
 * import, show, storage flag or a model-generated object. */
export async function attachRemoteInspectionPage(page: InspectionPage, reference: { allocationId: string; draftId: string },
  stage: 'pickup' | 'return', signatureFileAssetId?: string, recognitionReference?: InspectionRecognitionReference) {
  clearInspectionPage(page);
  const ticket = {}, orderId = page.data.id, templateId = page.template?.id, templateVersion = page.template?.version, version = contextVersion();
  if (!templateId || !orderId) return false;
  remoteLoads.set(page, ticket);
  try {
    const host = await createStaffInspectionTransportHost({ orderId, templateId, stage,
      allocationId: reference.allocationId, draftId: reference.draftId }, signatureFileAssetId, recognitionReference);
    if (remoteLoads.get(page) !== ticket || contextVersion() !== version || page.data.id !== orderId || page.template?.id !== templateId
      || page.template?.version !== templateVersion) return false;
    return attachInspectionPage(page, host, stage);
  } catch { return false; /* Ordinary manual page remains available. */ }
  finally { if (remoteLoads.get(page) === ticket) remoteLoads.delete(page); }
}
/** Future trusted host injection only; no URL/storage switch or invented HTTP endpoint. */
export function attachInspectionPage(page: InspectionPage, host: StaffInspectionHost, stage: "pickup" | "return"): boolean {
  clearInspectionPage(page);
  const session = currentSession(), version = contextVersion();
  if (!session || host?.serverEnabled !== true || host.context.audience !== "staff"
    || host.context.tenantId !== session.tenant.tenantId || host.context.workspaceId !== session.currentWorkspaceId
    || host.context.ownerId !== session.user.id || host.target.orderId !== page.data.id
    || host.target.stage !== stage || host.target.templateId !== page.template?.id) return false;
  const target = { ...host.target }, context = { ...host.context }, draftId = host.draftId, templateVersion = page.template?.version;
  const component = page.selectComponent("#ai-inspection-assist");
  if (typeof component?.attachHost !== "function") return false;
  const current = () => {
    const now = currentSession();
    return contextVersion() === version && now?.tenant.tenantId === context.tenantId && now?.user.id === context.ownerId
      && now?.currentWorkspaceId === context.workspaceId && page.data.id === target.orderId
      && page.template?.id === target.templateId && page.template?.version === templateVersion && host.current() === true;
  };
  try { if (!current()) return false; } catch { return false; }
  subscriptions.set(page, sessionEvents.on(() => clearInspectionPage(page)));
  component.attachHost({ ...host, context, target, draftId, current });
  try { if (!current()) { clearInspectionPage(page); return false; } }
  catch { clearInspectionPage(page); return false; }
  page.setData({ aiInspectionVisible: true });
  void page.selectComponent("#ai-inspection-assist")?.hostShow?.();
  return true;
}
