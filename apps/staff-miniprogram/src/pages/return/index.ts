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
import { attachInspectionPage, attachRemoteInspectionPage, hideInspectionPage, clearInspectionPage, openInspectionReceiptHistory } from "../../components/ai-native/inspection-page-binding";
import type { StaffInspectionHost, InspectionRecognitionReference } from "../../components/ai-native/inspection-host";
import { openInspectionTaskPage, openInspectionTaskResult, clearInspectionTaskPage, hideInspectionTaskPage,
  showInspectionTaskPage, captureInspectionPageWork, inspectionPageScopeKey, subscribeInspectionPageScope,
  type InspectionPageWorkContext, chooseInspectionPageImage, startInspectionPageRecording, stopInspectionPageRecording,
  uploadInspectionPageMedia, saveInspectionPageMediaDraft, recoverInspectionPageMedia, verifyInspectionPageUpload,
  clearInspectionPageMedia, cancelInspectionPageUpload } from '../../components/ai-native/inspection-task-page-binding';

/** 逐设备卡：一台可归还资源一张卡，卡内是本次归还的选择/数量与**逐台**勾选的 boolean 验收项。 */
interface ReturnAllocation { id: string; title: string; identifier: string; max: number; quantity: string; selected: boolean; fields: InspectionFieldRow[]; }

/** 归还时以订单费用行区分的异常费用（损坏/逾期/取消）。 */
const EXCEPTION_CHARGE_TYPES = ["damage", "overdue", "cancellation"];

Page({
  behaviors: [themeBehavior],
  data: { aiInspectionRecording: false, aiInspectionMediaBusy: false, aiInspectionMediaReady: false, aiInspectionCanUpload: false, aiInspectionCanSaveDraft: false, aiInspectionCanRecoverMedia: false, aiInspectionCanVerifyUpload: false, aiInspectionMediaMessage: '', aiInspectionTaskVisible: false, aiInspectionTaskLoading: false, aiInspectionTaskMessage: "", aiInspectionVisible: false, aiInspectionHistoryLoading: false, aiInspectionHistoryMessage: "", view: loadingState() as ViewState, id: "", orderNo: "", customer: "", phone: "", period: "", itemLabel: "物品", pickupLabel: "领取", returnLabel: "归还", returnLocation: "", allocations: [] as ReturnAllocation[], sharedFields: [] as InspectionFieldRow[], hasBulk: false, templateName: "", noTemplate: false, currency: "", feeRent: 0, feeException: 0, feeOther: 0, feeFinal: 0, busy: false, uploading: false, signatureWidth: 320, signatureHeight: 150, signatureDrawn: false, signatureFileAssetId: "", error: "" },
  order: undefined as RentalOrder | undefined,
  template: undefined as RentalInspectionTemplate | undefined,
  boolCodes: [] as string[],
  signatureContext: undefined as WechatMiniprogram.CanvasContext | undefined,
  signatureDrawing: false,
  inspectionPageShown: false,
  inspectionPageEpoch: 0,
  inspectionLoadedScope: '',
  inspectionContextUnsubscribe: undefined as (() => void) | undefined,
  inspectionUploadAbort: undefined as (() => void) | undefined,
  clearInspectionContext() {
    this.inspectionPageEpoch++; clearInspectionPageMedia(this); this.inspectionUploadAbort?.(); this.inspectionUploadAbort = undefined;
    this.order = undefined; this.template = undefined; this.boolCodes = []; this.inspectionLoadedScope = '';
    this.signatureDrawing = false; this.signatureContext = undefined;
    clearInspectionPage(this); clearInspectionTaskPage(this);
    this.setData({ orderNo: '', customer: '', phone: '', period: '', sharedFields: [], busy: false, uploading: false,
      signatureDrawn: false, signatureFileAssetId: '', templateName: '', noTemplate: true, error: '', aiInspectionRecording: false, aiInspectionMediaBusy: false, aiInspectionMediaReady: false, aiInspectionCanUpload: false, aiInspectionCanSaveDraft: false, aiInspectionCanRecoverMedia: false, aiInspectionCanVerifyUpload: false, aiInspectionMediaMessage: '', allocations: [], currency: '', feeRent: 0, feeException: 0, feeOther: 0, feeFinal: 0 });
  },
  attachInspectionHost(host: StaffInspectionHost) { attachInspectionPage(this, host, "return"); },
  attachRemoteInspectionHost(reference: { allocationId: string; draftId: string }, recognitionReference?: InspectionRecognitionReference) {
    return attachRemoteInspectionPage(this, reference, 'return', this.data.signatureFileAssetId || undefined, recognitionReference);
  },
  onInspectionHistory() { return openInspectionReceiptHistory(this, 'return'); },
  onInspectionImage() { return chooseInspectionPageImage(this, 'return'); },
  onInspectionRecord() { return startInspectionPageRecording(this, 'return'); },
  onInspectionCancelUpload() { cancelInspectionPageUpload(this); },
  onInspectionStopRecord() { stopInspectionPageRecording(this); },
  onInspectionUploadMedia() { return uploadInspectionPageMedia(this, 'return'); },
  onInspectionSaveMediaDraft() { return saveInspectionPageMediaDraft(this, 'return'); },
  onInspectionRecoverMedia() { return recoverInspectionPageMedia(this, 'return'); },
  onInspectionVerifyUpload() { return verifyInspectionPageUpload(this, 'return'); },
  onInspectionTask() { return openInspectionTaskPage(this,'return'); },
  onInspectionTaskResult(event: WechatMiniprogram.CustomEvent) { return openInspectionTaskResult(this,'return',event.detail?.reference); },
  onHide() { this.inspectionPageShown = false; this.inspectionPageEpoch++; this.inspectionUploadAbort?.(); this.inspectionUploadAbort = undefined;
    stopInspectionPageRecording(this, true); cancelInspectionPageUpload(this); hideInspectionPage(this); hideInspectionTaskPage(this); this.setData({ uploading: false, busy: false, aiInspectionRecording: false, aiInspectionMediaBusy: false }); },
  onUnload() { this.inspectionPageShown = false; this.clearInspectionContext(); this.inspectionContextUnsubscribe?.(); this.inspectionContextUnsubscribe = undefined; },
  onLoad(query: Record<string, string>) { this.inspectionPageShown = false; this.clearInspectionContext(); const width = Math.max(240, wx.getSystemInfoSync().windowWidth - 48); this.setData({ id: query.id ?? "", signatureWidth: width }); },
  onShow() {
    this.inspectionPageShown = true;
    if (!isSignedIn()) { this.clearInspectionContext(); this.inspectionPageShown = false; relaunch(ROUTES.login); return; }
    if (!this.inspectionContextUnsubscribe) this.inspectionContextUnsubscribe = subscribeInspectionPageScope(() => {
      if (this.inspectionLoadedScope === inspectionPageScopeKey()) return;
      this.clearInspectionContext(); if (this.inspectionPageShown && isSignedIn()) void this.load();
    });
    if (this.inspectionLoadedScope !== inspectionPageScopeKey()) this.clearInspectionContext();
    void this.selectComponent('#ai-inspection-assist')?.hostShow?.(); showInspectionTaskPage(this);
    if (!this.order) void this.load();
  },
  async load() {
    let work: InspectionPageWorkContext;
    this.inspectionPageEpoch++;
    try { work = captureInspectionPageWork(this, true); } catch { return; }
    if (!this.data.id) { this.setData({ view: blockedState("缺少订单编号", "请从订单详情重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const [order, templates, context] = await Promise.all([getOrder(work.orderId), listInspectionTemplates("return", work.orderId), loadContext()]);
      if (!work.current()) return;
      if (order.id !== work.orderId) throw new Error('原订单引用不一致');
      if (order.status !== "renting") { this.setData({ view: blockedState("当前不能办理归还", `订单当前状态：${order.status}`) }); return; }
      if (!can("rental-os:order:return")) { this.setData({ view: blockedState("无归还权限", "请联系管理员授权") }); return; }
      this.order = order; this.inspectionLoadedScope = work.scopeKey;
      this.template = templates.find((row) => row.enabled && row.categoryCode === order.categoryCode);
      const allRows = inspectionRows(this.template);
      const boolRows = allRows.filter((row) => row.type === "boolean");
      const sharedFields = allRows.filter((row) => row.type !== "boolean");
      this.boolCodes = boolRows.map((row) => row.code);
      const idLabel = terms().identifierLabel;
      const allocations: ReturnAllocation[] = order.allocations.filter((row) => row.status === "picked_up").map((row) => { const line = order.lines.find((entry) => entry.id === row.orderLineId); return { id: row.id, title: row.metadata?.itemGroupName ?? line?.itemGroupName ?? row.itemGroupId ?? terms().itemGroupLabel, identifier: row.assetNo ? `${idLabel} ${row.assetNo}` : `×${row.quantity}`, max: row.quantity, quantity: String(row.quantity), selected: true, fields: boolRows.map((field) => ({ ...field })) }; });
      const timeZone = context.locations.find((row) => row.id === order.returnLocationId)?.timezone ?? "Asia/Shanghai";
      const feeException = (order.chargeLines ?? []).filter((row) => EXCEPTION_CHARGE_TYPES.includes(row.type)).reduce((sum, row) => sum + row.amount, 0);
      const feeRent = order.rentalAmount ?? 0;
      const feeFinal = order.finalPayableAmount ?? 0;
      this.setData({ view: readyState(), orderNo: order.orderNo, customer: order.customerName, phone: maskPhone(order.contactPhone), period: formatBusinessRange(order.startAt, order.effectiveEndAt ?? order.endAt, timeZone), itemLabel: terms().itemLabel, pickupLabel: terms().pickupLabel, returnLabel: terms().returnLabel, returnLocation: order.returnLocationName ?? order.fulfillmentLocationName, allocations, sharedFields, hasBulk: boolRows.length > 0, templateName: this.template?.name ?? "无需检查模板", noTemplate: !this.template, currency: order.currency ?? "", feeRent, feeException, feeOther: feeFinal - feeRent - feeException, feeFinal, error: "" }, () => { if (work.current()) this.initSignatureCanvas(); });
    } catch (error) { if (work.current()) this.setData({ view: errorState(error) }); }
  },
  onToggleAllocation(event: WechatMiniprogram.SwitchChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`allocations[${index}].selected`]: Boolean(event.detail.value), error: "" }); },
  onQuantity(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`allocations[${index}].quantity`]: String(event.detail.value ?? ""), error: "" }); },
  onFieldInput(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`sharedFields[${index}].value`]: String(event.detail.value ?? ""), error: "" }); },
  onFieldBool(event: WechatMiniprogram.SwitchChange) { const ai = Number(event.currentTarget.dataset.ai); const fi = Number(event.currentTarget.dataset.fi); this.setData({ [`allocations[${ai}].fields[${fi}].checked`]: Boolean(event.detail.value), error: "" }); },
  onFieldSelect(event: WechatMiniprogram.PickerChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`sharedFields[${index}].value`]: this.data.sharedFields[index]?.options[Number(event.detail.value)] ?? "", error: "" }); },
  onBulkPass() { const allocations = this.data.allocations.map((row) => ({ ...row, fields: row.fields.map((field) => ({ ...field, checked: true })) })); this.setData({ allocations, error: "" }); },
  initSignatureCanvas() { this.signatureContext = wx.createCanvasContext("returnSignature", this); },
  currentHandoverKey() { return actionKey("return.handover", this.data.id, "handover"); },
  onChooseEvidencePhoto(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index), field = this.data.sharedFields[index];
    if (!Number.isInteger(index) || !field || field.type !== 'photo' || this.data.uploading || field.photos.length >= 5) return;
    let work: InspectionPageWorkContext;
    try { work = captureInspectionPageWork(this); } catch { return; }
    const fieldCode = field.code;
    wx.chooseImage({ count: 5 - field.photos.length, sourceType: ['camera', 'album'], sizeType: ['compressed'], success: result => {
      if (!work.current() || this.data.sharedFields[index]?.code !== fieldCode) return;
      void this.uploadInspectionPhotos(index, result.tempFiles.map(file => ({ path: file.path, size: file.size })), work);
    }, fail: () => { if (work.current()) this.setData({ error: '相机或相册不可用，可继续原人工检查' }); } });
  },
  async uploadInspectionPhotos(index: number, files: Array<{ path: string; size: number }>, original?: InspectionPageWorkContext) {
    let work: InspectionPageWorkContext;
    try { work = original ?? captureInspectionPageWork(this); } catch { return; }
    const fieldCode = this.data.sharedFields[index]?.code;
    const current = () => work.current() && this.data.sharedFields[index]?.code === fieldCode;
    if (!fieldCode || !current()) return;
    this.setData({ uploading: true, error: '' });
    try {
      const handoverBatchId = this.currentHandoverKey();
      for (const file of files) {
        if (!current()) return;
        const mimeType = /\.png$/i.test(file.path) ? 'image/png' : /\.webp$/i.test(file.path) ? 'image/webp' : 'image/jpeg';
        const asset = await uploadStaffImage({ path: file.path, size: file.size, fileName: `return-evidence-${Date.now()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`, mimeType,
          businessType: 'rental_order', businessId: work.orderId, uploadScene: 'return-evidence', metadata: { handoverStage: 'return', handoverBatchId } },
          { current, onAbort: abort => { this.inspectionUploadAbort = abort ?? undefined; } });
        if (!current()) return;
        const photos = [...(this.data.sharedFields[index]?.photos ?? []), { id: asset.id, path: file.path }];
        this.setData({ [`sharedFields[${index}].photos`]: photos });
      }
    } catch (error) { if (current()) this.setData({ error: describeError(error).message }); }
    finally { if (current()) { this.inspectionUploadAbort = undefined; this.setData({ uploading: false }); } }
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
    const work = captureInspectionPageWork(this);
    if (this.data.signatureFileAssetId) return this.data.signatureFileAssetId;
    if (!this.data.signatureDrawn) throw new Error("请让客户在签名框内完成现场签字");
    const filePath = await new Promise<string>((resolve, reject) => wx.canvasToTempFilePath({ canvasId: "returnSignature", fileType: "png", width: this.data.signatureWidth, height: this.data.signatureHeight, destWidth: this.data.signatureWidth, destHeight: this.data.signatureHeight, success: (result) => resolve(result.tempFilePath), fail: () => reject(new Error("导出签字图片失败，请重签")) }, this));
    if (!work.current()) throw new Error('原签名导出后页面已改变');
    const size = await new Promise<number>((resolve, reject) => wx.getFileSystemManager().getFileInfo({ filePath, success: (result) => resolve(result.size), fail: () => reject(new Error("读取签字图片失败")) }));
    if (!work.current()) throw new Error('原签名读取后页面已改变');
    const asset = await uploadStaffImage({ path: filePath, size, fileName: `handover-signature-${Date.now()}.png`, mimeType: "image/png", businessType: "rental_order", businessId: work.orderId, uploadScene: "handover-signature", metadata: { handoverStage: "return", handoverBatchId: batchId } }, { current: work.current, onAbort: abort => { this.inspectionUploadAbort = abort ?? undefined; } });
    if (!work.current()) throw new Error('原签名上传后页面已改变');
    this.setData({ signatureFileAssetId: asset.id });
    return asset.id;
  },
  /** 逐设备勾选合并回订单级 results：boolean 项本次归还的设备全部勾选才算通过（AND）；数值/文本/选择/照片仍是订单级一份。 */
  collectResults(selectedIds: string[]): { results: Record<string, unknown>; error?: string } {
    const results: Record<string, unknown> = {};
    const selected = this.data.allocations.filter((row) => selectedIds.includes(row.id));
    for (const code of this.boolCodes) results[code] = selected.length > 0 && selected.every((row) => { const field = row.fields.find((entry) => entry.code === code); return Boolean(field && field.checked); });
    const shared = inspectionResults(this.data.sharedFields);
    if (shared.error) return { results, error: shared.error };
    Object.assign(results, shared.results);
    return { results };
  },
  async onSubmit() {
    if (this.data.busy || this.data.uploading || !this.order) return;
    let work: InspectionPageWorkContext;
    try { work = captureInspectionPageWork(this); } catch { return; }
    const template = this.template;
    const items: Array<{ allocationId: string; quantity: number }> = [];
    for (const row of this.data.allocations) {
      if (!row.selected) continue;
      const quantity = Number(row.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > row.max) { this.setData({ error: `${row.title}归还数量须为 1～${row.max} 的整数` }); return; }
      items.push({ allocationId: row.id, quantity });
    }
    if (!items.length) { this.setData({ error: "请至少选择一项归还资源" }); return; }
    const partial = items.length !== this.data.allocations.length || items.some((item) => item.quantity !== this.data.allocations.find((row) => row.id === item.allocationId)?.max);
    const { results, error } = this.collectResults(items.map((item) => item.allocationId));
    if (error) { this.setData({ error }); return; }
    if (!await confirmDialog({ title: partial ? "确认分批归还" : "确认整单归还", content: partial ? "本次仅归还选定数量，其余资源继续在租。" : "提交后订单将进入结算，请先核对资源和检查结果。" })) return;
    if (!work.current()) return;
    const action = "return.handover";
    const key = this.currentHandoverKey();
    this.setData({ busy: true, error: "" });
    let lockToken: string | undefined;
    try {
      if (!work.current()) return;
      const lock = await operationLock(work.orderId, { action: "acquire" });
      lockToken = lock.token;
      if (!lockToken) throw new Error("未取得交接操作锁，请稍后重试");
      if (!work.current()) return;
      const handoverSignatureFileAssetId = await this.uploadSignature(key);
      if (!work.current()) return;
      if (template) await createInspection(work.orderId, { templateId: template.id, results, handoverSignatureFileAssetId, ...(partial ? { returnItems: items, returnBatchNo: key } : {}) }, { idempotencyKey: key, operationToken: lockToken });
      else if (partial) await partialReturn(work.orderId, { items, batchNo: key, handoverSignatureFileAssetId }, { idempotencyKey: key, operationToken: lockToken });
      else await handover(work.orderId, "return", { idempotencyKey: key, operationToken: lockToken, handoverSignatureFileAssetId });
      if (!work.current()) return;
      releaseActionKey(action, work.orderId);
      toast(partial ? "本批归还已记录" : "归还交接已完成", { icon: "success" });
      relaunch(buildUrl(ROUTES.order, { id: work.orderId }));
    } catch (caught) { if (work.current()) this.setData({ error: describeError(caught).message }); }
    finally { if (lockToken && work.current()) await operationLock(work.orderId, { action: "release", token: lockToken }).catch(() => undefined); if (work.current()) this.setData({ busy: false }); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.return, { id: this.data.id }) })) void this.load(); }
});
