import type { RentalWorkOrder, RentalWorkOrderHistoryEntry } from "@rental-os/shared";
import { assignWorkOrder, getWorkOrder, reviewWorkOrder, startWorkOrder, submitWorkOrder, workOrderHistory } from "../../api/workOrders";
import { describeError } from "../../core/errors";
import { workOrderStatusLabel, workOrderStatusTone, workOrderTypeLabel } from "../../core/labels";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, currentSession, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, confirmDialog, navigate, relaunch, toast } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", workNo: "", type: "", status: "", tone: "neutral", reason: "", result: "", assignee: "", itemGroupId: "", locationId: "", quantity: 0, progressStep: 0, showProgress: true, progressLabels: ["待处理", "处理中", "待验收", "已完成"], canClaim: false, canStart: false, canSubmit: false, canReview: false, busy: false, error: "", history: [] as Array<{ id: string; action: string; detail: string; createdAt: string }> },
  workOrder: undefined as RentalWorkOrder | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    if (!can("rental-core:maintenance:view")) { this.setData({ view: blockedState("无工单查看权限", "请联系租户管理员") }); return; }
    if (!this.data.id) { this.setData({ view: blockedState("缺少工单编号", "请从工单列表重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const workOrder = await getWorkOrder(this.data.id);
      if (!workOrder) { this.setData({ view: blockedState("工单不可用", "工单不存在或不在当前经营空间") }); return; }
      this.workOrder = workOrder;
      const history = await workOrderHistory(workOrder.id).catch(() => [] as RentalWorkOrderHistoryEntry[]);
      const mine = workOrder.assigneeId === currentSession()?.user.id;
      this.setData({ view: readyState(), workNo: workOrder.workNo, type: workOrderTypeLabel(workOrder.type), status: workOrderStatusLabel(workOrder.status), tone: workOrderStatusTone(workOrder.status), reason: workOrder.reason, result: workOrder.result ?? "", assignee: workOrder.assigneeName ?? "未领取", itemGroupId: workOrder.itemGroupId, locationId: workOrder.locationId, quantity: workOrder.quantity, progressStep: ({ pending: 0, in_progress: 1, pending_review: 2, completed: 3 } as Record<string, number>)[workOrder.status] ?? 0, showProgress: workOrder.status !== "rejected" && workOrder.status !== "cancelled", canClaim: workOrder.status === "pending" && !workOrder.assigneeId && can("rental-core:maintenance:manage"), canStart: workOrder.status === "pending" && mine && can("rental-core:maintenance:manage"), canSubmit: workOrder.status === "in_progress" && mine && can("rental-core:maintenance:manage"), canReview: workOrder.status === "pending_review" && can("rental-core:maintenance:review"), history: history.map((row) => ({ id: row.id, action: row.action, detail: row.detail, createdAt: row.createdAt })) });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onResult(event: WechatMiniprogram.Input) { this.setData({ result: String(event.detail.value ?? ""), error: "" }); },
  async onClaim() {
    if (!this.data.canClaim || this.data.busy) return;
    const assigneeId = currentSession()?.user.id;
    if (!assigneeId) return;
    this.setData({ busy: true, error: "" });
    try { await assignWorkOrder(this.data.id, { assigneeId }); toast("已领取工单", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  async onStart() {
    if (!this.data.canStart || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try { await startWorkOrder(this.data.id); toast("已开始处理", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  async onSubmit() {
    if (!this.data.canSubmit || this.data.busy) return;
    const result = this.data.result.trim();
    if (!result) { this.setData({ error: "请填写处理结果" }); return; }
    this.setData({ busy: true, error: "" });
    try { await submitWorkOrder(this.data.id, { result, attachments: [] }); toast("已提交验收", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  async onReview(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canReview || this.data.busy) return;
    const decision = String(event.currentTarget.dataset.decision) === "approved" ? "approved" : "rejected";
    const confirmed = await confirmDialog({ title: decision === "approved" ? "验收通过" : "驳回工单", content: decision === "approved" ? "确认处理结果符合要求？" : "确认驳回并要求重新处理？", danger: decision === "rejected" });
    if (!confirmed) return;
    this.setData({ busy: true, error: "" });
    try { await reviewWorkOrder(this.data.id, { decision, reason: decision === "approved" ? "现场验收通过" : "现场验收不通过" }); toast("已处理", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  onOrder() { if (this.workOrder?.orderId) navigate(buildUrl(ROUTES.order, { id: this.workOrder.orderId })); },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.workOrder, { id: this.data.id }) })) void this.load(); }
});
