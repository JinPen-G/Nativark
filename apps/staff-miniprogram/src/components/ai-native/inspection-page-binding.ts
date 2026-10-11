import { currentSession, contextVersion, sessionEvents } from "../../core/session";
import type { StaffInspectionHost } from "./inspection-host";
import { createStaffInspectionTransportHost } from './inspection-transport';

interface InspectionPage {
  data: { id: string };
  template?: { id: string };
  setData(patch: Record<string, unknown>): void;
  selectComponent(selector: string): WechatMiniprogram.Component.TrivialInstance | null;
}
const subscriptions = new WeakMap<object, () => void>();
const remoteLoads = new WeakMap<object, object>();
export function clearInspectionPage(page: InspectionPage) {
  remoteLoads.delete(page);
  subscriptions.get(page)?.(); subscriptions.delete(page);
  page.selectComponent("#ai-inspection-assist")?.detachHost?.();
  page.setData({ aiInspectionVisible: false });
}
export function hideInspectionPage(page: InspectionPage) {
  remoteLoads.delete(page);
  page.selectComponent('#ai-inspection-assist')?.hostHide?.();
}
/** Explicit application invocation only. Never enabled by an onLoad query,
 * import, show, storage flag or a model-generated object. */
export async function attachRemoteInspectionPage(page: InspectionPage, reference: { allocationId: string; draftId: string },
  stage: 'pickup' | 'return', signatureFileAssetId?: string) {
  clearInspectionPage(page);
  const ticket = {}, orderId = page.data.id, templateId = page.template?.id, version = contextVersion();
  if (!templateId || !orderId) return false;
  remoteLoads.set(page, ticket);
  try {
    const host = await createStaffInspectionTransportHost({ orderId, templateId, stage,
      allocationId: reference.allocationId, draftId: reference.draftId }, signatureFileAssetId);
    if (remoteLoads.get(page) !== ticket || contextVersion() !== version || page.data.id !== orderId || page.template?.id !== templateId) return false;
    attachInspectionPage(page, host, stage);
    return true;
  } catch { return false; /* Ordinary manual page remains available. */ }
  finally { if (remoteLoads.get(page) === ticket) remoteLoads.delete(page); }
}
/** Future trusted host injection only; no URL/storage switch or invented HTTP endpoint. */
export function attachInspectionPage(page: InspectionPage, host: StaffInspectionHost, stage: "pickup" | "return") {
  clearInspectionPage(page);
  const session = currentSession(), version = contextVersion();
  if (!session || host?.serverEnabled !== true || host.context.audience !== "staff"
    || host.context.tenantId !== session.tenant.tenantId || host.context.workspaceId !== session.currentWorkspaceId
    || host.context.ownerId !== session.user.id || host.target.orderId !== page.data.id
    || host.target.stage !== stage || host.target.templateId !== page.template?.id) return;
  const target = { ...host.target }, context = { ...host.context }, draftId = host.draftId;
  const component = page.selectComponent("#ai-inspection-assist");
  if (typeof component?.attachHost !== "function") return;
  const current = () => {
    const now = currentSession();
    return contextVersion() === version && now?.tenant.tenantId === context.tenantId && now?.user.id === context.ownerId
      && now?.currentWorkspaceId === context.workspaceId && page.data.id === target.orderId
      && page.template?.id === target.templateId && host.current() === true;
  };
  subscriptions.set(page, sessionEvents.on(() => clearInspectionPage(page)));
  component.attachHost({ ...host, context, target, draftId, current });
  page.setData({ aiInspectionVisible: true });
  void page.selectComponent("#ai-inspection-assist")?.hostShow?.();
}
