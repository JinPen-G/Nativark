import type { RentalWorkOrder, RentalWorkOrderHistoryEntry } from "@rental-os/shared";
import { listItemGroups } from "../../api/context";
import { getAsset } from "../../api/assets";
import { getOrder } from "../../api/orders";
import { assignWorkOrder, getWorkOrder, reviewWorkOrder, startWorkOrder, submitWorkOrder, workOrderHistory } from "../../api/workOrders";
import { loadContext, terms } from "../../core/context";
import { describeError } from "../../core/errors";
import { resolveImage } from "../../core/images";
import { workOrderStatusLabel, workOrderStatusTone, workOrderTypeLabel } from "../../core/labels";
import { uploadStaffImage, staffUploadDownloadUrl } from "../../api/uploads";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { itemGroupCover, maskPhone } from "../../core/presenters";
import { can, currentSession, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessDateTime } from "../../core/time";
import { ROUTES, buildUrl, confirmDialog, navigate, promptDialog, relaunch, toast } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", workNo: "", type: "", assetLabel: "物品", serialLabel: "序列号", status: "", tone: "neutral", createdAt: "", orderId: "", orderNo: "", customerName: "", customerPhone: "", reason: "", result: "", assignee: "", itemGroupId: "", itemName: "", assetNo: "", assetSerialNo: "", imagePath: "", photos: [] as Array<{ id: string; path: string }>, evidenceToUpload: [] as Array<{ id: string; path: string; size: number; fileName: string; mimeType: string; assetId?: string }>, locationId: "", locationName: "", quantity: 0, progressStep: 0, showProgress: true, progressLabels: ["待处理", "处理中", "待验收", "已完成"], canClaim: false, canStart: false, canSubmit: false, canReview: false, busy: false, error: "", history: [] as Array<{ id: string; action: string; detail: string; createdAt: string }> },
  workOrder: undefined as RentalWorkOrder | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } if (!this.workOrder) void this.load(); },
  async load() {
    if (!can("rental-core:maintenance:view")) { this.setData({ view: blockedState("无工单查看权限", "请联系租户管理员") }); return; }
    if (!this.data.id) { this.setData({ view: blockedState("缺少工单编号", "请从工单列表重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const workOrder = await getWorkOrder(this.data.id);
      if (!workOrder) { this.setData({ view: blockedState("工单不可用", "工单不存在或不在当前经营空间") }); return; }
      this.workOrder = workOrder;
      const [history, groups, context] = await Promise.all([workOrderHistory(workOrder.id).catch(() => [] as RentalWorkOrderHistoryEntry[]), listItemGroups().catch(() => []), loadContext().catch(() => undefined)]);
      const group = groups.find((row) => row.id === workOrder.itemGroupId);
      const mine = workOrder.assigneeId === currentSession()?.user.id;
      const linkedOrder = workOrder.orderId ? await getOrder(workOrder.orderId).catch(() => undefined) : undefined;
      const asset = workOrder.assetId ? await getAsset(workOrder.assetId).catch(() => undefined) : undefined;
      const location = context?.locations.find((row) => row.id === workOrder.locationId);
      const timeZone = location?.timezone ?? "Asia/Shanghai";
      const photoRows = workOrder.attachments.map((path, index) => ({ id: `${index}-${path}`, path: path.startsWith("http") ? path : "" }));
      this.setData({ view: readyState(), workNo: workOrder.workNo, type: workOrderTypeLabel(workOrder.type), assetLabel: terms().assetLabel, serialLabel: terms().serialLabel, status: workOrderStatusLabel(workOrder.status), tone: workOrderStatusTone(workOrder.status), createdAt: formatBusinessDateTime(workOrder.createdAt, timeZone), orderId: workOrder.orderId ?? "", orderNo: linkedOrder?.orderNo ?? "", customerName: linkedOrder?.customerName ?? "", customerPhone: linkedOrder ? maskPhone(linkedOrder.contactPhone) : "", reason: workOrder.reason, result: workOrder.result ?? "", assignee: workOrder.assigneeName ?? "未领取", itemGroupId: workOrder.itemGroupId, itemName: group?.name ?? "", assetNo: asset?.assetNo ?? "", assetSerialNo: asset?.serialNo ?? "", imagePath: "", photos: photoRows, locationId: workOrder.locationId, locationName: location?.name ?? "—", quantity: workOrder.quantity, progressStep: ({ pending: 0, in_progress: 1, pending_review: 2, completed: 3 } as Record<string, number>)[workOrder.status] ?? 0, showProgress: workOrder.status !== "rejected" && workOrder.status !== "cancelled", canClaim: workOrder.status === "pending" && !workOrder.assigneeId && can("rental-core:maintenance:manage"), canStart: workOrder.status === "pending" && mine && can("rental-core:maintenance:manage"), canSubmit: workOrder.status === "in_progress" && mine && can("rental-core:maintenance:manage"), canReview: workOrder.status === "pending_review" && can("rental-core:maintenance:review"), history: history.map((row) => ({ id: row.id, action: row.action, detail: row.detail, createdAt: formatBusinessDateTime(row.createdAt, timeZone) })) });
      const cover = itemGroupCover(group);
      if (cover) void resolveImage(cover).then((path) => { if (path && this.data.id === workOrder.id) this.setData({ imagePath: path }); });
      photoRows.forEach((_path, index) => {
        const source = workOrder.attachments[index];
        const resolved = source.startsWith("file_")
          ? staffUploadDownloadUrl(source).then((url) => resolveImage(url))
          : resolveImage(source);
        void resolved.then((path) => { if (path && this.data.id === workOrder.id) this.setData({ [`photos[${index}].path`]: path }); }).catch(() => undefined);
      });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onResult(event: WechatMiniprogram.Input) { this.setData({ result: String(event.detail.value ?? ""), error: "" }); },
  onChooseEvidence() {
    const room = Math.max(0, 9 - this.data.evidenceToUpload.length);
    if (!room) return;
    wx.chooseImage({ count: room, sizeType: ["compressed"], sourceType: ["album", "camera"], success: (result) => {
      const additions = result.tempFiles.map((file, index) => {
        const path = file.path;
        const extension = path.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "jpg";
        const mimeType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
        return { id: `${Date.now()}-${index}-${file.size}`, path, size: file.size, fileName: `work-order-${Date.now()}-${index}.${extension}`, mimeType };
      });
      this.setData({ evidenceToUpload: [...this.data.evidenceToUpload, ...additions], error: "" });
    } });
  },
  onRemoveEvidence(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isInteger(index)) this.setData({ evidenceToUpload: this.data.evidenceToUpload.filter((_item, itemIndex) => itemIndex !== index) });
  },
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
    try {
      const uploaded = [...this.data.evidenceToUpload];
      for (let index = 0; index < uploaded.length; index += 1) {
        if (uploaded[index].assetId) continue;
        const file = uploaded[index];
        const asset = await uploadStaffImage({ path: file.path, size: file.size, fileName: file.fileName, mimeType: file.mimeType, businessType: "rental_work_order", businessId: this.data.id, uploadScene: "work-order-evidence" });
        uploaded[index] = { ...file, assetId: asset.id };
        this.setData({ evidenceToUpload: uploaded });
      }
      const attachments = [...(this.workOrder?.attachments ?? []), ...uploaded.map((file) => file.assetId).filter((id): id is string => Boolean(id))];
      await submitWorkOrder(this.data.id, { result, attachments });
      this.setData({ evidenceToUpload: [] });
      toast("已提交验收", { icon: "success" });
      await this.load();
    }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  async onReview(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canReview || this.data.busy) return;
    const decision = String(event.currentTarget.dataset.decision) === "approved" ? "approved" : "rejected";
    let reason: string;
    if (decision === "approved") {
      if (!await confirmDialog({ title: "验收通过", content: "确认处理结果符合要求？" })) return;
      reason = "现场验收通过";
    } else {
      const input = await promptDialog({ title: "驳回工单", placeholder: "请填写驳回原因与返工要求（必填）", confirmText: "驳回", danger: true });
      if (input === undefined) return;
      if (!input) { this.setData({ error: "驳回原因不能为空" }); return; }
      reason = input;
    }
    this.setData({ busy: true, error: "" });
    try { await reviewWorkOrder(this.data.id, { decision, reason }); toast("已处理", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  onOrder() { if (this.workOrder?.orderId) navigate(buildUrl(ROUTES.order, { id: this.workOrder.orderId })); },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.workOrder, { id: this.data.id }) })) void this.load(); }
});
