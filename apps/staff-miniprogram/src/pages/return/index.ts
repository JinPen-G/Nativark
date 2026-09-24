import type { RentalInspectionTemplate, RentalOrder } from "@rental-os/shared";
import { createInspection, getOrder, handover, listInspectionTemplates, operationLock, partialReturn } from "../../api/orders";
import { loadContext, terms } from "../../core/context";
import { describeError } from "../../core/errors";
import { inspectionResults, inspectionRows, type InspectionFieldRow } from "../../core/inspection-form";
import { actionKey, releaseActionKey } from "../../core/keys";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, isSignedIn } from "../../core/session";
import { maskPhone } from "../../core/presenters";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessRange } from "../../core/time";
import { ROUTES, buildUrl, confirmDialog, relaunch, toast } from "../../core/ui";
import { uploadStaffImage } from "../../api/uploads";

interface ReturnAllocation { id: string; label: string; max: number; quantity: string; selected: boolean; }

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", orderNo: "", customer: "", phone: "", period: "", itemLabel: "物品", pickupLabel: "领取", returnLabel: "归还", returnLocation: "", allocations: [] as ReturnAllocation[], templateName: "", fields: [] as InspectionFieldRow[], noTemplate: false, busy: false, uploading: false, signatureWidth: 320, signatureHeight: 150, signatureDrawn: false, signatureFileAssetId: "", error: "" },
  order: undefined as RentalOrder | undefined,
  template: undefined as RentalInspectionTemplate | undefined,
  signatureContext: undefined as WechatMiniprogram.CanvasContext | undefined,
  signatureDrawing: false,
  onLoad(query: Record<string, string>) { const width = Math.max(240, wx.getSystemInfoSync().windowWidth - 48); this.setData({ id: query.id ?? "", signatureWidth: width }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } if (!this.order) void this.load(); },
  async load() {
    if (!this.data.id) { this.setData({ view: blockedState("缺少订单编号", "请从订单详情重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const [order, templates, context] = await Promise.all([getOrder(this.data.id), listInspectionTemplates("return"), loadContext()]);
      if (order.status !== "renting") { this.setData({ view: blockedState("当前不能办理归还", `订单当前状态：${order.status}`) }); return; }
      if (!can("rental-os:order:return", "rental-os:order:operate")) { this.setData({ view: blockedState("无归还权限", "请联系管理员授权") }); return; }
      this.order = order;
      this.template = templates.find((row) => row.enabled && row.categoryCode === order.categoryCode);
      const allocations = order.allocations.filter((row) => row.status === "picked_up").map((row) => ({ id: row.id, label: row.assetNo || order.lines.find((line) => line.id === row.orderLineId)?.itemGroupName || row.itemGroupId || "资源", max: row.quantity, quantity: String(row.quantity), selected: true }));
      const timeZone = context.locations.find((row) => row.id === order.returnLocationId)?.timezone ?? "Asia/Shanghai";
      this.setData({ view: readyState(), orderNo: order.orderNo, customer: order.customerName, phone: maskPhone(order.contactPhone), period: formatBusinessRange(order.startAt, order.effectiveEndAt ?? order.endAt, timeZone), itemLabel: terms().itemLabel, pickupLabel: terms().pickupLabel, returnLabel: terms().returnLabel, returnLocation: order.returnLocationName ?? order.fulfillmentLocationName, allocations, templateName: this.template?.name ?? "无需检查模板", fields: inspectionRows(this.template), noTemplate: !this.template, error: "" }, () => this.initSignatureCanvas());
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onToggleAllocation(event: WechatMiniprogram.SwitchChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`allocations[${index}].selected`]: Boolean(event.detail.value), error: "" }); },
  onQuantity(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`allocations[${index}].quantity`]: String(event.detail.value ?? ""), error: "" }); },
  onFieldInput(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${index}].value`]: String(event.detail.value ?? ""), error: "" }); },
  onFieldBool(event: WechatMiniprogram.SwitchChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${index}].checked`]: Boolean(event.detail.value), error: "" }); },
  onFieldSelect(event: WechatMiniprogram.PickerChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${index}].value`]: this.data.fields[index]?.options[Number(event.detail.value)] ?? "", error: "" }); },
  initSignatureCanvas() { this.signatureContext = wx.createCanvasContext("returnSignature", this); },
  currentHandoverKey() { return actionKey("return.handover", this.data.id, "handover"); },
  onChooseEvidencePhoto(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const field = this.data.fields[index];
    if (!field || this.data.uploading || field.photos.length >= 5) return;
    wx.chooseImage({ count: 5 - field.photos.length, sourceType: ["camera", "album"], sizeType: ["compressed"], success: (result) => { void this.uploadInspectionPhotos(index, result.tempFiles.map((file) => ({ path: file.path, size: file.size }))); } });
  },
  async uploadInspectionPhotos(index: number, files: Array<{ path: string; size: number }>) {
    this.setData({ uploading: true, error: "" });
    try {
      const handoverBatchId = this.currentHandoverKey();
      for (const file of files) {
        const mimeType = /\.png$/i.test(file.path) ? "image/png" : /\.webp$/i.test(file.path) ? "image/webp" : "image/jpeg";
        const asset = await uploadStaffImage({ path: file.path, size: file.size, fileName: `return-evidence-${Date.now()}.${mimeType === "image/png" ? "png" : "jpg"}`, mimeType, businessType: "rental_order", businessId: this.data.id, uploadScene: "return-evidence", metadata: { handoverStage: "return", handoverBatchId } });
        const photos = [...(this.data.fields[index]?.photos ?? []), { id: asset.id, path: file.path }];
        this.setData({ [`fields[${index}].photos`]: photos });
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
    this.setData({ signatureDrawn: true });
  },
  onSignatureEnd() { this.signatureDrawing = false; },
  onClearSignature() { this.signatureContext?.clearRect(0, 0, this.data.signatureWidth, this.data.signatureHeight); this.signatureContext?.draw(); this.setData({ signatureDrawn: false, signatureFileAssetId: "" }); },
  async uploadSignature(batchId: string) {
    if (this.data.signatureFileAssetId) return this.data.signatureFileAssetId;
    if (!this.data.signatureDrawn) throw new Error("请让客户在签名框内完成现场签字");
    const filePath = await new Promise<string>((resolve, reject) => wx.canvasToTempFilePath({ canvasId: "returnSignature", fileType: "png", width: this.data.signatureWidth, height: this.data.signatureHeight, destWidth: this.data.signatureWidth, destHeight: this.data.signatureHeight, success: (result) => resolve(result.tempFilePath), fail: () => reject(new Error("导出签字图片失败，请重签")) }, this));
    const size = await new Promise<number>((resolve, reject) => wx.getFileSystemManager().getFileInfo({ filePath, success: (result) => resolve(result.size), fail: () => reject(new Error("读取签字图片失败")) }));
    const asset = await uploadStaffImage({ path: filePath, size, fileName: `handover-signature-${Date.now()}.png`, mimeType: "image/png", businessType: "rental_order", businessId: this.data.id, uploadScene: "handover-signature", metadata: { handoverStage: "return", handoverBatchId: batchId } });
    this.setData({ signatureFileAssetId: asset.id });
    return asset.id;
  },
  async onSubmit() {
    if (this.data.busy || this.data.uploading || !this.order) return;
    const items: Array<{ allocationId: string; quantity: number }> = [];
    for (const row of this.data.allocations) {
      if (!row.selected) continue;
      const quantity = Number(row.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > row.max) { this.setData({ error: `${row.label}归还数量须为 1～${row.max} 的整数` }); return; }
      items.push({ allocationId: row.id, quantity });
    }
    if (!items.length) { this.setData({ error: "请至少选择一项归还资源" }); return; }
    const partial = items.length !== this.data.allocations.length || items.some((item) => item.quantity !== this.data.allocations.find((row) => row.id === item.allocationId)?.max);
    const { results, error } = inspectionResults(this.data.fields);
    if (error) { this.setData({ error }); return; }
    if (!await confirmDialog({ title: partial ? "确认分批归还" : "确认整单归还", content: partial ? "本次仅归还选定数量，其余资源继续在租。" : "提交后订单将进入结算，请先核对资源和检查结果。" })) return;
    const action = "return.handover";
    const key = this.currentHandoverKey();
    this.setData({ busy: true, error: "" });
    let lockToken: string | undefined;
    try {
      const lock = await operationLock(this.data.id, { action: "acquire" });
      lockToken = lock.token;
      if (!lockToken) throw new Error("未取得交接操作锁，请稍后重试");
      const handoverSignatureFileAssetId = await this.uploadSignature(key);
      if (this.template) await createInspection(this.data.id, { templateId: this.template.id, results, handoverSignatureFileAssetId, ...(partial ? { returnItems: items, returnBatchNo: key } : {}) }, { idempotencyKey: key, operationToken: lockToken });
      else if (partial) await partialReturn(this.data.id, { items, batchNo: key, handoverSignatureFileAssetId }, { idempotencyKey: key, operationToken: lockToken });
      else await handover(this.data.id, "return", { idempotencyKey: key, operationToken: lockToken, handoverSignatureFileAssetId });
      releaseActionKey(action, this.data.id);
      toast(partial ? "本批归还已记录" : "归还交接已完成", { icon: "success" });
      relaunch(buildUrl(ROUTES.order, { id: this.data.id }));
    } catch (caught) { this.setData({ error: describeError(caught).message }); }
    finally { if (lockToken) await operationLock(this.data.id, { action: "release", token: lockToken }).catch(() => undefined); this.setData({ busy: false }); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.return, { id: this.data.id }) })) void this.load(); }
});
