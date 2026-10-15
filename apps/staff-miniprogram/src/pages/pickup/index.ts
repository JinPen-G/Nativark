import type { RentalInspectionTemplate, RentalOrder } from "@rental-os/shared";
import { createInspection, getOrder, getOrderFunding, handover, listInspectionTemplates, operationLock } from "../../api/orders";
import { listItemGroups } from "../../api/context";
import { loadContext, terms } from "../../core/context";
import { describeError } from "../../core/errors";
import { inspectionResults, inspectionRows, type InspectionFieldRow } from "../../core/inspection-form";
import { resolveImage } from "../../core/images";
import { actionKey, releaseActionKey } from "../../core/keys";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, isSignedIn } from "../../core/session";
import { itemGroupCover, maskPhone } from "../../core/presenters";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessRange } from "../../core/time";
import { ROUTES, buildUrl, confirmDialog, relaunch, toast } from "../../core/ui";
import { uploadStaffImage } from "../../api/uploads";
import { attachInspectionPage, attachRemoteInspectionPage, hideInspectionPage, clearInspectionPage, openInspectionReceiptHistory } from "../../components/ai-native/inspection-page-binding";
import type { StaffInspectionHost, InspectionRecognitionReference } from "../../components/ai-native/inspection-host";

/** 逐设备分组：每台参与本次交接的资源一张卡，卡内只放**逐台**勾选的 boolean 检查项。 */
interface DeviceGroup { allocationId: string; itemGroupId: string; title: string; identifier: string; imagePath: string; fields: InspectionFieldRow[]; }
/** 交接门禁项（需求 §4.3）：能前端判断的判断，判断不了的明确标注由服务端提交时校验，绝不伪造“全部通过”。 */
interface GateItem { key: string; label: string; tone: string; status: string; hint: string; }

const PICKUP_ALLOCATION_STATUSES = ["pre_assigned", "locked", "allocated"];
const RESERVATION_DEAD = ["released", "expired", "cancelled"];

Page({
  behaviors: [themeBehavior],
  data: { aiInspectionVisible: false, aiInspectionHistoryLoading: false, aiInspectionHistoryMessage: "", view: loadingState() as ViewState, id: "", orderNo: "", customer: "", phone: "", period: "", location: "", itemLabel: "物品", pickupLabel: "领取", groups: [] as DeviceGroup[], sharedFields: [] as InspectionFieldRow[], hasBulk: false, gates: [] as GateItem[], templateName: "", noTemplate: false, hasDeliveryAddress: false, deliveryLabel: "配送", deliveryRecipient: "", deliveryPhone: "", deliveryAddressText: "", busy: false, uploading: false, signatureWidth: 320, signatureHeight: 150, signatureDrawn: false, signatureFileAssetId: "", error: "" },
  order: undefined as RentalOrder | undefined,
  template: undefined as RentalInspectionTemplate | undefined,
  boolCodes: [] as string[],
  signatureContext: undefined as WechatMiniprogram.CanvasContext | undefined,
  signatureDrawing: false,
  attachInspectionHost(host: StaffInspectionHost) { attachInspectionPage(this, host, "pickup"); },
  attachRemoteInspectionHost(reference: { allocationId: string; draftId: string }, recognitionReference?: InspectionRecognitionReference) {
    return attachRemoteInspectionPage(this, reference, 'pickup', this.data.signatureFileAssetId || undefined, recognitionReference);
  },
  onInspectionHistory() { return openInspectionReceiptHistory(this, 'pickup'); },
  onHide() { hideInspectionPage(this); },
  onUnload() { clearInspectionPage(this); },
  onLoad(query: Record<string, string>) { clearInspectionPage(this); const width = Math.max(240, wx.getSystemInfoSync().windowWidth - 48); this.setData({ id: query.id ?? "", signatureWidth: width }); },
  onShow() { if (!isSignedIn()) { clearInspectionPage(this); relaunch(ROUTES.login); return; } void this.selectComponent("#ai-inspection-assist")?.hostShow?.(); if (!this.order) void this.load(); },
  async load() {
    if (!this.data.id) { this.setData({ view: blockedState("缺少订单编号", "请从订单详情重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const [order, templates, context, itemGroups, funding] = await Promise.all([getOrder(this.data.id), listInspectionTemplates("pickup", this.data.id), loadContext(), listItemGroups().catch(() => []), getOrderFunding(this.data.id).catch(() => undefined)]);
      if (order.status !== "ready_for_pickup") { this.setData({ view: blockedState("当前不能办理领取", `订单当前状态：${order.status}`) }); return; }
      if (!can("rental-os:order:pickup")) { this.setData({ view: blockedState("无领取权限", "请联系管理员授权") }); return; }
      this.order = order;
      this.template = templates.find((row) => row.enabled && row.categoryCode === order.categoryCode);
      const timeZone = context.locations.find((row) => row.id === order.fulfillmentLocationId)?.timezone ?? "Asia/Shanghai";
      const allRows = inspectionRows(this.template);
      const boolRows = allRows.filter((row) => row.type === "boolean");
      const sharedFields = allRows.filter((row) => row.type !== "boolean");
      this.boolCodes = boolRows.map((row) => row.code);
      const idLabel = terms().identifierLabel;
      const deviceAllocs = order.allocations.filter((row) => PICKUP_ALLOCATION_STATUSES.includes(row.status));
      const rawDevices = deviceAllocs.length
        ? deviceAllocs.map((row) => { const line = order.lines.find((entry) => entry.id === row.orderLineId); return { allocationId: row.id, itemGroupId: row.itemGroupId ?? line?.itemGroupId ?? "", title: row.metadata?.itemGroupName ?? line?.itemGroupName ?? terms().itemGroupLabel, identifier: row.assetNo ? `${idLabel} ${row.assetNo}` : `×${row.quantity}` }; })
        : order.lines.map((line) => ({ allocationId: line.id, itemGroupId: line.itemGroupId, title: line.itemGroupName, identifier: `×${line.quantity - (line.cancelledQuantity ?? 0)}` }));
      const groups: DeviceGroup[] = rawDevices.map((device) => ({ allocationId: device.allocationId, itemGroupId: device.itemGroupId, title: device.title, identifier: device.identifier, imagePath: "", fields: boolRows.map((row) => ({ ...row })) }));
      // 配送/上门类订单带收货地址快照：派送前需要知道送到哪；取还与送车到点类为空，仍只按门店显示。
      const delivery = order.deliveryAddressSnapshot;
      this.setData({ view: readyState(), orderNo: order.orderNo, customer: order.customerName, phone: maskPhone(order.contactPhone), period: formatBusinessRange(order.startAt, order.effectiveEndAt ?? order.endAt, timeZone), location: order.fulfillmentLocationName, hasDeliveryAddress: Boolean(delivery), deliveryLabel: terms().deliveryLabel ?? "配送", deliveryRecipient: delivery?.recipient ?? "", deliveryPhone: delivery?.phone || delivery?.phoneMasked || "", deliveryAddressText: delivery ? [delivery.province, delivery.city, delivery.district, delivery.detail].filter(Boolean).join(" ") : "", itemLabel: terms().itemLabel, pickupLabel: terms().pickupLabel, groups, sharedFields, hasBulk: boolRows.length > 0, gates: this.buildGates(order, funding), templateName: this.template?.name ?? "无需检查模板", noTemplate: !this.template, error: "" }, () => this.initSignatureCanvas());
      groups.forEach((group, index) => { const source = itemGroupCover(itemGroups.find((entry) => entry.id === group.itemGroupId)); if (source) void resolveImage(source).then((path) => { if (path && this.data.id === order.id && this.data.groups[index]?.allocationId === group.allocationId) this.setData({ [`groups[${index}].imagePath`]: path }); }); });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  /** 门禁核对：资源锁定与资金能从 order/funding 判断；资质与营业时段前端无法确定，标注由服务端提交时校验。 */
  buildGates(order: RentalOrder, funding: Awaited<ReturnType<typeof getOrderFunding>> | undefined): GateItem[] {
    const gates: GateItem[] = [];
    if (funding) {
      // 读服务端权威待收（含线上支付已入账、退款回冲、待补款续租），与提交时的 assertReadyForPickup 同源。
      const rentalOutstanding = funding.rental.due;
      const depositReady = funding.deposit.requiredAmount <= 0 || funding.deposit.collected - funding.deposit.refunded >= funding.deposit.requiredAmount;
      const preauthReady = funding.preauthorization.requiredAmount <= 0 || funding.preauthorization.frozen - funding.preauthorization.released >= funding.preauthorization.requiredAmount;
      const ready = rentalOutstanding <= 0.009 && depositReady && preauthReady;
      gates.push({ key: "funding", label: "资金到位", tone: ready ? "success" : "warning", status: ready ? "已收妥" : "待满足", hint: ready ? "租金与押金已按快照收妥" : "仍有应收未收齐，见订单资金区" });
    } else {
      gates.push({ key: "funding", label: "资金到位", tone: "neutral", status: "提交时校验", hint: "资金状态由服务端在提交时复核" });
    }
    const active = order.allocations.filter((row) => ["pre_assigned", "locked", "allocated", "picked_up"].includes(row.status));
    const required = order.reservations.filter((row) => !RESERVATION_DEAD.includes(row.status)).reduce((sum, row) => sum + Math.max(0, row.quantity - row.releasedQuantity), 0);
    const assigned = active.reduce((sum, row) => sum + row.quantity, 0);
    const locked = active.filter((row) => row.status !== "pre_assigned").reduce((sum, row) => sum + row.quantity, 0);
    const lockReady = required > 0 && assigned >= required && locked >= required;
    gates.push({ key: "resource", label: "资源锁定", tone: lockReady ? "success" : "warning", status: lockReady ? "已锁定" : "待锁定", hint: lockReady ? "本次交接资源已锁定就绪" : "存在未分配或未锁定资源" });
    gates.push({ key: "qualification", label: "资质证件", tone: "neutral", status: "提交时校验", hint: "由服务端按品类规则校验" });
    gates.push({ key: "business", label: "营业时段", tone: "neutral", status: "提交时校验", hint: "以营业时区与营业日历为准" });
    return gates;
  },
  onFieldInput(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`sharedFields[${index}].value`]: String(event.detail.value ?? ""), error: "" }); },
  onFieldBool(event: WechatMiniprogram.SwitchChange) { const gi = Number(event.currentTarget.dataset.gi); const fi = Number(event.currentTarget.dataset.fi); this.setData({ [`groups[${gi}].fields[${fi}].checked`]: Boolean(event.detail.value), error: "" }); },
  onFieldSelect(event: WechatMiniprogram.PickerChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`sharedFields[${index}].value`]: this.data.sharedFields[index]?.options[Number(event.detail.value)] ?? "", error: "" }); },
  onBulkPass() { const groups = this.data.groups.map((group) => ({ ...group, fields: group.fields.map((field) => ({ ...field, checked: true })) })); this.setData({ groups, error: "" }); },
  initSignatureCanvas() { this.signatureContext = wx.createCanvasContext("pickupSignature", this); },
  currentHandoverKey() { return actionKey(this.template ? "pickup.inspection" : "pickup.handover", this.data.id, "handover"); },
  onChooseEvidencePhoto(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const field = this.data.sharedFields[index];
    if (!field || this.data.uploading || field.photos.length >= 5) return;
    wx.chooseImage({ count: 5 - field.photos.length, sourceType: ["camera", "album"], sizeType: ["compressed"], success: (result) => { void this.uploadInspectionPhotos(index, result.tempFiles.map((file) => ({ path: file.path, size: file.size }))); } });
  },
  async uploadInspectionPhotos(index: number, files: Array<{ path: string; size: number }>) {
    this.setData({ uploading: true, error: "" });
    try {
      const handoverBatchId = this.currentHandoverKey();
      for (const file of files) {
        const mimeType = /\.png$/i.test(file.path) ? "image/png" : /\.webp$/i.test(file.path) ? "image/webp" : "image/jpeg";
        const asset = await uploadStaffImage({ path: file.path, size: file.size, fileName: `pickup-evidence-${Date.now()}.${mimeType === "image/png" ? "png" : "jpg"}`, mimeType, businessType: "rental_order", businessId: this.data.id, uploadScene: "pickup-evidence", metadata: { handoverStage: "pickup", handoverBatchId } });
        const photos = [...(this.data.sharedFields[index]?.photos ?? []), { id: asset.id, path: file.path }];
        this.setData({ [`sharedFields[${index}].photos`]: photos });
      }
    } catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ uploading: false }); }
  },
  onSignatureStart(event: WechatMiniprogram.TouchEvent) {
    const point = event.touches[0] as unknown as WechatMiniprogram.TouchCanvasDetail | undefined;
    if (!point || !this.signatureContext) return;
    this.signatureDrawing = true;
    this.signatureContext.beginPath();
    this.signatureContext.setStrokeStyle("#20242b");
    this.signatureContext.setLineWidth(3);
    this.signatureContext.setLineCap("round");
    this.signatureContext.setLineJoin("round");
    this.signatureContext.moveTo(point.x, point.y);
  },
  onSignatureMove(event: WechatMiniprogram.TouchEvent) {
    const point = event.touches[0] as unknown as WechatMiniprogram.TouchCanvasDetail | undefined;
    if (!point || !this.signatureDrawing || !this.signatureContext) return;
    this.signatureContext.lineTo(point.x, point.y);
    this.signatureContext.stroke();
    this.signatureContext.draw(true);
    if (!this.data.signatureDrawn) this.setData({ signatureDrawn: true });
  },
  onSignatureEnd() { this.signatureDrawing = false; },
  onClearSignature() { this.signatureContext?.clearRect(0, 0, this.data.signatureWidth, this.data.signatureHeight); this.signatureContext?.draw(); this.setData({ signatureDrawn: false, signatureFileAssetId: "" }); },
  async uploadSignature(batchId: string) {
    if (this.data.signatureFileAssetId) return this.data.signatureFileAssetId;
    if (!this.data.signatureDrawn) throw new Error("请让客户在签名框内完成现场签字");
    const filePath = await new Promise<string>((resolve, reject) => wx.canvasToTempFilePath({ canvasId: "pickupSignature", fileType: "png", width: this.data.signatureWidth, height: this.data.signatureHeight, destWidth: this.data.signatureWidth, destHeight: this.data.signatureHeight, success: (result) => resolve(result.tempFilePath), fail: () => reject(new Error("导出签字图片失败，请重签")) }, this));
    const size = await new Promise<number>((resolve, reject) => wx.getFileSystemManager().getFileInfo({ filePath, success: (result) => resolve(result.size), fail: () => reject(new Error("读取签字图片失败")) }));
    const asset = await uploadStaffImage({ path: filePath, size, fileName: `handover-signature-${Date.now()}.png`, mimeType: "image/png", businessType: "rental_order", businessId: this.data.id, uploadScene: "handover-signature", metadata: { handoverStage: "pickup", handoverBatchId: batchId } });
    this.setData({ signatureFileAssetId: asset.id });
    return asset.id;
  },
  /** 逐设备勾选合并回订单级 results：boolean 项全部设备都勾选才算通过（AND）；数值/文本/选择/照片仍是订单级一份。 */
  collectResults(): { results: Record<string, unknown>; error?: string } {
    const results: Record<string, unknown> = {};
    for (const code of this.boolCodes) results[code] = this.data.groups.length > 0 && this.data.groups.every((group) => { const field = group.fields.find((row) => row.code === code); return Boolean(field && field.checked); });
    const shared = inspectionResults(this.data.sharedFields);
    if (shared.error) return { results, error: shared.error };
    Object.assign(results, shared.results);
    return { results };
  },
  async onSubmit() {
    if (this.data.busy || this.data.uploading || !this.order) return;
    const { results, error } = this.collectResults();
    if (error) { this.setData({ error }); return; }
    if (!await confirmDialog({ title: "确认交付", content: "提交后订单将进入使用中，请先与客户当面核对资源及检查结果。" })) return;
    const action = this.template ? "pickup.inspection" : "pickup.handover";
    const key = this.currentHandoverKey();
    this.setData({ busy: true, error: "" });
    let lockToken: string | undefined;
    try {
      const lock = await operationLock(this.data.id, { action: "acquire" });
      lockToken = lock.token;
      if (!lockToken) throw new Error("未取得交接操作锁，请稍后重试");
      const handoverSignatureFileAssetId = await this.uploadSignature(key);
      if (this.template) await createInspection(this.data.id, { templateId: this.template.id, results, handoverSignatureFileAssetId }, { idempotencyKey: key, operationToken: lockToken });
      else await handover(this.data.id, "pickup", { idempotencyKey: key, operationToken: lockToken, handoverSignatureFileAssetId });
      releaseActionKey(action, this.data.id);
      toast("领取交接已完成", { icon: "success" });
      relaunch(buildUrl(ROUTES.order, { id: this.data.id }));
    } catch (caught) { this.setData({ error: describeError(caught).message }); }
    finally { if (lockToken) await operationLock(this.data.id, { action: "release", token: lockToken }).catch(() => undefined); this.setData({ busy: false }); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.pickup, { id: this.data.id }) })) void this.load(); }
});
