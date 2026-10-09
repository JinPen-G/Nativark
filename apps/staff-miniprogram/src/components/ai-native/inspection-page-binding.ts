import { currentSession, contextVersion, sessionEvents } from "../../core/session";
import type { StaffInspectionHost } from "./inspection-host";

interface InspectionPage {
  data: { id: string };
  template?: { id: string };
  setData(patch: Record<string, unknown>): void;
  selectComponent(selector: string): WechatMiniprogram.Component.TrivialInstance | null;
}
const subscriptions = new WeakMap<object, () => void>();
export function clearInspectionPage(page: InspectionPage) {
  subscriptions.get(page)?.(); subscriptions.delete(page);
  page.selectComponent("#ai-inspection-assist")?.detachHost?.();
  page.setData({ aiInspectionVisible: false });
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
