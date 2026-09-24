import type { RentalFundingBalance, RentalInspectionRecord, RentalOrder, RentalOrderExtension, RentalOrderExtensionPreview } from "@rental-os/shared";
import { listItemGroups } from "../../api/context";
import { getCustomer } from "../../api/customers";
import { cancelOrder, confirmOrder, confirmNoShow, confirmOfflinePayment, createInternalOrderNote, expirePendingOrder, getOrder, getOrderFunding, listExtensions, listInspections, listInternalOrderNotes, listOfflinePaymentRegistrations, markPickupOverdue, operationLock, previewExtension, reReviewInspectionException, registerOfflinePayment, requestExtension, respondInspectionException, resumePickup, reviewExtensionRefund, reviewInspectionException, sendNoShowNotice, type RentalOrderInternalNote, type StaffOfflinePaymentRegistration } from "../../api/orders";
import { uploadStaffImage } from "../../api/uploads";
import { loadContext, terms } from "../../core/context";
import { describeError } from "../../core/errors";
import { isApiError } from "../../core/http";
import { resolveImage } from "../../core/images";
import { actionKey, releaseActionKey } from "../../core/keys";
import { allocationStatusLabel, fulfillmentModeLabel, orderStatusLabel, orderStatusTone } from "../../core/labels";
import { formatMoney } from "../../core/money";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { itemGroupCover, maskPhone } from "../../core/presenters";
import { can, canTenant, currentSession, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessDateTime, formatBusinessRange, splitInstant, todayInZone, zoneLabel, zonedToInstant } from "../../core/time";
import { ROUTES, buildUrl, callPhone, confirmDialog, copyText, navigate, promptDialog, relaunch, toast } from "../../core/ui";

/**
 * 写操作的错误收口：TIMEOUT / NETWORK / SERVER 结果不确定，禁止让用户重复提交（可能已在服务端生效）；
 * 其余错误照旧给出可执行的原因文案。所有处理层写动作成功后一律重新 getOrder 刷新。
 */
function unknownResultOr(error: unknown): string {
  if (isApiError(error, "TIMEOUT") || isApiError(error, "NETWORK") || isApiError(error, "SERVER")) {
    return "结果未知，请刷新，勿重复操作";
  }
  return describeError(error).message;
}

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", orderNo: "", status: "", tone: "neutral", createdAt: "", customer: "", phone: "", customerCompany: "", customerRegion: "", period: "", pickupLocation: "", returnLocation: "", mode: "", itemLabel: "物品", pickupLabel: "领取", returnLabel: "归还", identifierLabel: "编号", lines: [] as Array<{ id: string; name: string; quantity: number; imagePath: string; resources: Array<{ id: string; assetNo: string; quantity: number; statusLabel: string }> }>, totalQuantity: 0, amount: "", deposit: "", rentalAmount: "", discountAmount: "", serviceAmount: "", hasDiscount: false, hasService: false, hasActions: false, canConfirm: false, canAllocate: false, canPickup: false, canReturn: false, canCancel: false, canForceReleaseLock: false, operationLockOwner: "", operationLockExpiresAt: "", internalNotes: [] as RentalOrderInternalNote[], canAddInternalNote: false, internalNoteDraft: "", internalNotesBusy: false, showOfflinePayments: false, canRegisterOffline: false, canConfirmOffline: false, rentalOutstanding: 0, depositOutstanding: 0, rentalBalanceLabel: "—", depositBalanceLabel: "—", offlineRegistrations: [] as Array<StaffOfflinePaymentRegistration & { instrumentLabel: string; methodLabel: string; amountLabel: string }>, offlineInstrument: "rental" as "rental" | "deposit", offlineInstrumentOptions: ["租金 / 费用", "押金"], offlineMethodOptions: ["现金", "银行转账"], offlineMethodIndex: 0, offlineAmount: "", offlineReason: "现场线下收款", offlineEvidenceId: "", offlineEvidencePath: "", hasOfflineFunding: false, canExpirePending: false, canMarkOverdue: false, isPickupOverdue: false, noticeSent: false, noShowNoticeAtLabel: "", pickupOverdueAtLabel: "", canSendNoShowNotice: false, canConfirmNoShow: false, canResumePickup: false, canExtend: false, currentEndLabel: "", extendOpen: false, extendDate: "", extendTime: "", extendMinDate: "", extendZoneHint: "", extendBusy: false, extendPreviewReady: false, extendPreview: null as null | { newEndLabel: string; payableLabel: string; depositDeltaLabel: string; hasDepositDelta: boolean; preAuthDeltaLabel: string; hasPreAuthDelta: boolean; rentalLabel: string; serviceLabel: string; hasService: boolean; billableUnits: number; paymentRequired: boolean; monthly: boolean }, extensionReviews: [] as Array<{ id: string; sequence: number; newEndLabel: string; amountLabel: string }>, hasExtensionReviews: false, inspectionExceptions: [] as Array<{ inspectionId: string; index: number; key: string; stageLabel: string; description: string; suggestedLabel: string; approvedLabel: string; needsReview: boolean; disputed: boolean; customerReason: string }>, hasInspectionExceptions: false, reviewBusy: false, busy: false, error: "" },
  order: undefined as RentalOrder | undefined,
  extensions: [] as RentalOrderExtension[],
  inspections: [] as RentalInspectionRecord[],
  timeZone: "Asia/Shanghai",
  extPreview: undefined as RentalOrderExtensionPreview | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (!this.data.id) { this.setData({ view: blockedState("缺少订单编号", "请从订单列表重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const canReadInternalNotes = can("rental-os:order:view");
      const [order, context, groups, internalNotes] = await Promise.all([getOrder(this.data.id), loadContext(), listItemGroups().catch(() => []), canReadInternalNotes ? listInternalOrderNotes(this.data.id).catch(() => []) : Promise.resolve([] as RentalOrderInternalNote[])]);
      this.order = order;
      const operate = can("rental-os:order:operate");
      const feeReview = can("rental-os:order:fee-review");
      const timeZone = context.locations.find((row) => row.id === order.fulfillmentLocationId)?.timezone ?? "Asia/Shanghai";
      this.timeZone = timeZone;
      const lines = order.lines.map((line) => ({
        id: line.id,
        name: line.itemGroupName,
        quantity: Math.max(0, line.quantity - (line.cancelledQuantity ?? 0)),
        imagePath: "",
        resources: order.allocations.filter((allocation) => allocation.status !== "released" && allocation.orderLineId === line.id).map((allocation) => ({
          id: allocation.id,
          assetNo: allocation.assetNo ?? "",
          quantity: allocation.quantity,
          statusLabel: allocationStatusLabel(allocation.status)
        }))
      }));
      const canConfirm = order.status === "draft" && operate;
      const canAllocate = order.status === "reserved" && operate;
      // §2.3：取还与取消各按独立权限门控，不用 operate 兜底（缺权限按钮不出现，服务端仍独立校验）。
      const canPickup = order.status === "ready_for_pickup" && can("rental-os:order:pickup");
      const canReturn = order.status === "renting" && can("rental-os:order:return");
      const canCancel = ["draft", "reserved", "ready_for_pickup", "pickup_overdue"].includes(order.status) && can("rental-os:order:cancel");
      const activeOperationLock = order.assignment?.operationLock;
      const canForceReleaseLock = Boolean(activeOperationLock && activeOperationLock.ownerId !== currentSession()?.user.id && Date.parse(activeOperationLock.expiresAt) > Date.now() && can("rental-os:order:reassign"));
      const canRegisterOffline = can("rental-os:order:offline-payment");
      const canConfirmOffline = can("rental-os:order:settle");
      // 处理层动作门控（服务端仍独立校验状态与规则）。
      const nowMs = Date.now();
      // 待支付超时（pending_payment）：服务端仅接受草稿单且软预占已过保留期，据此判定是否显示。
      const softReservations = (order.reservations ?? []).filter((row) => row.status === "soft");
      const reservationExpired = softReservations.length > 0 && softReservations.every((row) => Boolean(row.expiresAt) && Date.parse(row.expiresAt!) <= nowMs);
      const canExpirePending = order.status === "draft" && operate && reservationExpired;
      // 爽约：已确认/待领取且过约定领取时间可标记逾期；进入 pickup_overdue 后可发通知/确认/恢复。
      const pastPickupTime = Number.isFinite(Date.parse(order.startAt)) && Date.parse(order.startAt) <= nowMs;
      const canMarkOverdue = ["reserved", "ready_for_pickup"].includes(order.status) && operate && pastPickupTime;
      const isPickupOverdue = order.status === "pickup_overdue";
      const noticeSent = Boolean(order.noShowNoticeAt);
      const canSendNoShowNotice = isPickupOverdue && operate && !noticeSent;
      const canConfirmNoShow = isPickupOverdue && operate && noticeSent;
      const canResumePickup = isPickupOverdue && operate;
      // 续租代办：租用中且未发生部分归还，且持有续租权限。
      const partiallyReturned = (order.allocations ?? []).some((row) => row.status === "returned");
      const canExtend = order.status === "renting" && !partiallyReturned && can("rental-os:order:extend");
      const currentEndAt = order.effectiveEndAt ?? order.endAt;
      this.setData({
        view: readyState(), orderNo: order.orderNo, status: orderStatusLabel(order.status), tone: orderStatusTone(order.status), createdAt: formatBusinessDateTime(order.createdAt, timeZone), customer: order.customerName, customerCompany: "", customerRegion: "",
        phone: maskPhone(order.contactPhone), period: formatBusinessRange(order.startAt, order.effectiveEndAt ?? order.endAt, timeZone),
        pickupLocation: order.fulfillmentLocationName, returnLocation: order.returnLocationName ?? order.fulfillmentLocationName, mode: fulfillmentModeLabel(order.fulfillmentMode),
        itemLabel: terms().itemLabel,
        pickupLabel: terms().pickupLabel, returnLabel: terms().returnLabel, identifierLabel: terms().identifierLabel,
        lines, totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
        amount: formatMoney(order.finalPayableAmount, order.currency), deposit: formatMoney(order.depositAmount, order.currency), rentalAmount: formatMoney(order.rentalAmount, order.currency), discountAmount: formatMoney(order.discountAmount, order.currency), serviceAmount: formatMoney(order.serviceAmount, order.currency), hasDiscount: order.discountAmount > 0, hasService: order.serviceAmount > 0,
        hasActions: canConfirm || canAllocate || canPickup || canReturn || canCancel,
        canConfirm, canAllocate, canPickup, canReturn, canCancel,
        canForceReleaseLock,
        operationLockOwner: activeOperationLock?.ownerName ?? "",
        operationLockExpiresAt: activeOperationLock ? formatBusinessDateTime(activeOperationLock.expiresAt, timeZone) : "",
        internalNotes,
        canAddInternalNote: operate,
        canRegisterOffline,
        canConfirmOffline,
        showOfflinePayments: canRegisterOffline || canConfirmOffline,
        canExpirePending,
        canMarkOverdue,
        isPickupOverdue,
        noticeSent,
        noShowNoticeAtLabel: order.noShowNoticeAt ? formatBusinessDateTime(order.noShowNoticeAt, timeZone) : "",
        pickupOverdueAtLabel: order.pickupOverdueAt ? formatBusinessDateTime(order.pickupOverdueAt, timeZone) : "",
        canSendNoShowNotice,
        canConfirmNoShow,
        canResumePickup,
        canExtend,
        currentEndLabel: formatBusinessDateTime(currentEndAt, timeZone),
        extendOpen: false,
        extendPreviewReady: false,
        extendPreview: null,
        extensionReviews: [],
        hasExtensionReviews: false,
        inspectionExceptions: [],
        hasInspectionExceptions: false
      });
      if (canRegisterOffline || canConfirmOffline) {
        const [funding, registrations] = await Promise.all([
          getOrderFunding(order.id).catch(() => undefined),
          listOfflinePaymentRegistrations(order.id).catch(() => [] as StaffOfflinePaymentRegistration[])
        ]);
        this.applyOfflinePayments(funding, registrations, order);
      }
      // 续租退款审核与检查异常费用复核都属费用复核权限；仅在可能已有相应记录的订单状态下拉取。
      this.extensions = [];
      this.inspections = [];
      this.extPreview = undefined;
      if (feeReview) {
        const needExtensions = ["ready_for_pickup", "renting", "return_inspection", "settling", "completed"].includes(order.status);
        const needInspections = ["renting", "return_inspection", "settling", "completed"].includes(order.status);
        const [extensions, inspections] = await Promise.all([
          needExtensions ? listExtensions(order.id).catch(() => [] as RentalOrderExtension[]) : Promise.resolve([] as RentalOrderExtension[]),
          needInspections ? listInspections(order.id).catch(() => [] as RentalInspectionRecord[]) : Promise.resolve([] as RentalInspectionRecord[])
        ]);
        if (this.data.id === order.id) this.applyReviews(extensions, inspections, order);
      }
      if (order.customerId && canTenant("rental-os:member:view", "rental-os:member:manage")) {
        void getCustomer(order.customerId).then((profile) => {
          if (this.data.id === order.id) this.setData({ customerCompany: profile.corporateName ?? "", customerRegion: profile.region ?? "" });
        }).catch(() => undefined);
      }
      order.lines.forEach((line, index) => {
        const source = itemGroupCover(groups.find((group) => group.id === line.itemGroupId));
        if (source) void resolveImage(source).then((path) => { if (path && this.data.id === order.id && this.data.lines[index]?.id === line.id) this.setData({ [`lines[${index}].imagePath`]: path }); });
      });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onCopy() { if (this.order) copyText(this.order.orderNo); },
  onCall() { callPhone(this.order?.contactPhone); },
  onCustomer() { if (this.order?.customerId) navigate(buildUrl(ROUTES.customer, { id: this.order.customerId })); },
  onPickup() { navigate(buildUrl(ROUTES.pickup, { id: this.data.id })); },
  onReturn() { navigate(buildUrl(ROUTES.return, { id: this.data.id })); },
  applyOfflinePayments(funding?: RentalFundingBalance, registrations: StaffOfflinePaymentRegistration[] = [], order?: RentalOrder) {
    const currentOrder = order ?? this.order;
    const rentalOutstanding = funding ? Math.max(0, funding.rental.balance + funding.rental.pendingExtensionAmount) : 0;
    const depositOutstanding = funding ? Math.max(0, funding.deposit.requiredAmount - funding.deposit.collected) : 0;
    const offlineRegistrations = registrations.map((row) => ({
      ...row,
      instrumentLabel: row.instrument === "deposit" ? "押金" : "租金 / 费用",
      methodLabel: row.paymentMethod === "offline_transfer" ? "银行转账" : "现金",
      amountLabel: formatMoney(row.amount, currentOrder?.currency ?? "CNY")
    }));
    const defaultAmount = this.data.offlineInstrument === "deposit" ? depositOutstanding : rentalOutstanding;
    this.setData({
      hasOfflineFunding: Boolean(funding),
      rentalOutstanding,
      depositOutstanding,
      rentalBalanceLabel: funding ? formatMoney(rentalOutstanding, currentOrder?.currency ?? "CNY") : "暂不可用",
      depositBalanceLabel: funding ? formatMoney(depositOutstanding, currentOrder?.currency ?? "CNY") : "暂不可用",
      offlineRegistrations,
      offlineAmount: this.data.offlineAmount || (defaultAmount > 0 ? defaultAmount.toFixed(2) : "")
    });
  },
  onOfflineInstrument(event: WechatMiniprogram.PickerChange) {
    const instrument = String(event.detail.value) === "1" ? "deposit" : "rental";
    const outstanding = instrument === "deposit" ? this.data.depositOutstanding : this.data.rentalOutstanding;
    this.setData({ offlineInstrument: instrument, offlineAmount: outstanding > 0 ? outstanding.toFixed(2) : "" });
  },
  onOfflineMethod(event: WechatMiniprogram.PickerChange) { this.setData({ offlineMethodIndex: Number(event.detail.value) === 1 ? 1 : 0 }); },
  onOfflineAmount(event: WechatMiniprogram.Input) { this.setData({ offlineAmount: String(event.detail.value ?? ""), error: "" }); },
  onOfflineReason(event: WechatMiniprogram.Input) { this.setData({ offlineReason: String(event.detail.value ?? "") }); },
  onChooseOfflineProof() {
    wx.chooseImage({ count: 1, sizeType: ["compressed"], sourceType: ["album", "camera"], success: async (result) => {
      const file = result.tempFiles[0];
      if (!file || !this.data.id) return;
      const extension = file.path.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
      this.setData({ busy: true, error: "" });
      try {
        const asset = await uploadStaffImage({ path: file.path, size: file.size, fileName: `offline-proof-${Date.now()}.${extension}`, mimeType, businessType: "rental_order", businessId: this.data.id, uploadScene: "offline-payment-proof" });
        this.setData({ offlineEvidenceId: asset.id, offlineEvidencePath: file.path });
      } catch (error) { this.setData({ error: describeError(error).message }); }
      finally { this.setData({ busy: false }); }
    } });
  },
  async onRegisterOfflinePayment() {
    const amount = Number(this.data.offlineAmount);
    const available = this.data.offlineInstrument === "deposit" ? this.data.depositOutstanding : this.data.rentalOutstanding;
    const reason = this.data.offlineReason.trim();
    if (!this.data.canRegisterOffline || this.data.busy) return;
    if (!Number.isFinite(amount) || amount <= 0 || amount > available + 0.005) { this.setData({ error: "請輸入不超過當前待收金額的有效金額" }); return; }
    if (!reason) { this.setData({ error: "請填寫收款用途或備註" }); return; }
    const paymentMethod = this.data.offlineMethodIndex === 1 ? "offline_transfer" : "offline_cash";
    const fingerprint = `${this.data.offlineInstrument}:${amount.toFixed(2)}:${paymentMethod}:${reason}:${this.data.offlineEvidenceId}`;
    const key = actionKey("offline-payment", this.data.id, fingerprint);
    this.setData({ busy: true, error: "" });
    try {
      await registerOfflinePayment({ orderId: this.data.id, instrument: this.data.offlineInstrument, amount, paymentMethod, reason, idempotencyKey: key, ...(this.data.offlineEvidenceId ? { evidenceFileAssetId: this.data.offlineEvidenceId } : {}) });
      releaseActionKey("offline-payment", this.data.id);
      this.setData({ offlineEvidenceId: "", offlineEvidencePath: "", offlineAmount: "" });
      toast("已登记，等待结算人员确认", { icon: "success" });
      await this.load();
    } catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  async onConfirmOfflinePayment(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canConfirmOffline || this.data.busy) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    if (!id || !await confirmDialog({ title: "確認線下收款", content: "確認款項已實際到帳？確認後將計入訂單資金流水。" })) return;
    this.setData({ busy: true, error: "" });
    try { await confirmOfflinePayment(id); toast("已確認到帳", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  async onConfirm() {
    if (!this.data.canConfirm || this.data.busy || !await confirmDialog({ title: "确认订单", content: "确认前请核对资金、客户资格和服务时间。" })) return;
    this.setData({ busy: true, error: "" });
    try { await confirmOrder(this.data.id); toast("订单已确认", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  async onAllocate() {
    if (!this.data.canAllocate) return;
    // 进入配货页：可一键配货，也可扫描实物做手动预分配/锁定/解锁/释放/改配（S07）。
    navigate(buildUrl(ROUTES.allocate, { id: this.data.id }));
  },
  async onCancel() {
    if (!this.data.canCancel || this.data.busy) return;
    const reason = await promptDialog({ title: "取消订单", placeholder: "请填写取消原因", danger: true });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "取消原因不能为空" }); return; }
    const key = actionKey("order.cancel", this.data.id, reason);
    this.setData({ busy: true, error: "" });
    try { await cancelOrder(this.data.id, { reason }, key); releaseActionKey("order.cancel", this.data.id); toast("订单已取消", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  onInternalNoteInput(event: WechatMiniprogram.Input) { this.setData({ internalNoteDraft: String(event.detail.value ?? "") }); },
  async onAddInternalNote() {
    const content = this.data.internalNoteDraft.trim();
    if (!this.data.canAddInternalNote || this.data.internalNotesBusy) return;
    if (!content) { this.setData({ error: "请填写内部备注" }); return; }
    const key = actionKey("order.internal-note", this.data.id, content);
    this.setData({ internalNotesBusy: true, error: "" });
    try {
      const note = await createInternalOrderNote(this.data.id, { content }, key);
      releaseActionKey("order.internal-note", this.data.id);
      this.setData({ internalNotes: [note, ...this.data.internalNotes], internalNoteDraft: "" });
      toast("内部备注已保存", { icon: "success" });
    } catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ internalNotesBusy: false }); }
  },
  async onForceReleaseLock() {
    const activeLock = this.order?.assignment?.operationLock;
    if (!this.data.canForceReleaseLock || !activeLock || this.data.busy) return;
    const reason = await promptDialog({ title: `解除 ${activeLock.ownerName} 的交接锁`, placeholder: "请填写人工解除原因", confirmText: "解除交接锁", danger: true });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "人工解除原因不能为空" }); return; }
    const fingerprint = `${activeLock.ownerId}:${activeLock.expiresAt}:${reason}`;
    const key = actionKey("operation-lock-force-release", this.data.id, fingerprint);
    this.setData({ busy: true, error: "" });
    try {
      const result = await operationLock(this.data.id, { action: "force-release", reason }, key);
      releaseActionKey("operation-lock-force-release", this.data.id);
      toast(`已解除 ${result.releasedOwnerName ?? activeLock.ownerName} 的交接锁`, { icon: "success" });
      await this.load();
    } catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  /* ---------- 处理层：待支付超时 / 爽约 ---------- */
  async onExpirePending() {
    if (!this.data.canExpirePending || this.data.busy) return;
    if (!await confirmDialog({ title: "待支付超时作废", content: "该订单已超过待支付保留期，作废后将释放占用的库存与资源，不可撤销。", confirmText: "确认作废", danger: true })) return;
    this.setData({ busy: true, error: "" });
    try { await expirePendingOrder(this.data.id); toast("已按待支付超时作废", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: unknownResultOr(error) }); }
    finally { this.setData({ busy: false }); }
  },
  async onMarkPickupOverdue() {
    if (!this.data.canMarkOverdue || this.data.busy || !await confirmDialog({ title: "标记逾期未取", content: "确认客户已超过约定领取时间且仍未领取？标记后进入待确认爽约流程。" })) return;
    this.setData({ busy: true, error: "" });
    try { await markPickupOverdue(this.data.id); toast("已标记逾期未取", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: unknownResultOr(error) }); }
    finally { this.setData({ busy: false }); }
  },
  async onSendNoShowNotice() {
    if (!this.data.canSendNoShowNotice || this.data.busy || !await confirmDialog({ title: "发送爽约通知", content: "将按已启用的通知模板向客户发送爽约提醒，并记录通知时间。" })) return;
    this.setData({ busy: true, error: "" });
    try { await sendNoShowNotice(this.data.id); toast("爽约通知已发送", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: unknownResultOr(error) }); }
    finally { this.setData({ busy: false }); }
  },
  async onConfirmNoShow() {
    if (!this.data.canConfirmNoShow || this.data.busy) return;
    const reason = await promptDialog({ title: "确认爽约", placeholder: "请填写确认爽约的原因", confirmText: "确认爽约", danger: true });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "确认爽约原因不能为空" }); return; }
    this.setData({ busy: true, error: "" });
    try { await confirmNoShow(this.data.id, reason); toast("已确认爽约", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: unknownResultOr(error) }); }
    finally { this.setData({ busy: false }); }
  },
  async onResumePickup() {
    if (!this.data.canResumePickup || this.data.busy || !await confirmDialog({ title: "恢复领取", content: "确认客户仍要领取？系统将复核资源可用性后恢复为待领取。" })) return;
    this.setData({ busy: true, error: "" });
    try { await resumePickup(this.data.id); toast("已恢复为待领取", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: unknownResultOr(error) }); }
    finally { this.setData({ busy: false }); }
  },
  /* ---------- 处理层：续租代办 ---------- */
  onOpenExtend() {
    if (!this.data.canExtend || !this.order) return;
    const parts = splitInstant(this.order.effectiveEndAt ?? this.order.endAt, this.timeZone);
    const today = todayInZone(this.timeZone);
    this.extPreview = undefined;
    this.setData({ extendOpen: true, extendDate: parts.date || today, extendTime: parts.time || "18:00", extendMinDate: parts.date || today, extendZoneHint: zoneLabel(this.timeZone), extendPreviewReady: false, extendPreview: null, error: "" });
  },
  onCloseExtend() { this.extPreview = undefined; this.setData({ extendOpen: false, extendPreviewReady: false, extendPreview: null, error: "" }); },
  onExtendField(event: WechatMiniprogram.PickerChange) {
    const field = String(event.currentTarget.dataset.field ?? "");
    if (field !== "extendDate" && field !== "extendTime") return;
    this.extPreview = undefined;
    this.setData({ [field]: String(event.detail.value ?? ""), extendPreviewReady: false, extendPreview: null, error: "" });
  },
  async onPreviewExtend() {
    if (!this.order || this.data.extendBusy) return;
    let newEndAt: string;
    try { newEndAt = zonedToInstant(this.data.extendDate, this.data.extendTime, this.timeZone); }
    catch (error) { this.setData({ error: describeError(error).message }); return; }
    const currentEndAt = this.order.effectiveEndAt ?? this.order.endAt;
    if (Date.parse(newEndAt) <= Date.parse(currentEndAt)) { this.setData({ error: "新归还时间必须晚于当前约定归还时间" }); return; }
    const currency = this.order.currency;
    this.setData({ extendBusy: true, error: "" });
    try {
      const preview = await previewExtension(this.data.id, { newEndAt });
      this.extPreview = preview;
      this.setData({
        extendPreviewReady: true,
        extendPreview: {
          newEndLabel: formatBusinessDateTime(preview.newEndAt, this.timeZone),
          payableLabel: formatMoney(preview.payableAmount, currency),
          depositDeltaLabel: formatMoney(preview.depositDelta, currency, { signed: true }), hasDepositDelta: Math.abs(preview.depositDelta) > 0.005,
          preAuthDeltaLabel: formatMoney(preview.preAuthDelta, currency, { signed: true }), hasPreAuthDelta: Math.abs(preview.preAuthDelta) > 0.005,
          rentalLabel: formatMoney(preview.rentalAmount, currency), serviceLabel: formatMoney(preview.serviceAmount, currency), hasService: preview.serviceAmount > 0.005,
          billableUnits: preview.billableUnits, paymentRequired: preview.paymentRequired, monthly: preview.settlementMode === "monthly"
        }
      });
    } catch (error) { this.extPreview = undefined; this.setData({ extendPreviewReady: false, extendPreview: null, error: describeError(error).message }); }
    finally { this.setData({ extendBusy: false }); }
  },
  async onRequestExtend() {
    if (!this.order || !this.extPreview || this.data.extendBusy) return;
    const newEndAt = this.extPreview.newEndAt;
    if (!await confirmDialog({ title: "确认续租", content: `将订单归还时间延长至 ${formatBusinessDateTime(newEndAt, this.timeZone)}？` })) return;
    const key = actionKey("order-extend", this.data.id, newEndAt);
    this.setData({ extendBusy: true, error: "" });
    try {
      const extension = await requestExtension(this.data.id, { newEndAt }, key);
      releaseActionKey("order-extend", this.data.id);
      this.extPreview = undefined;
      this.setData({ extendOpen: false, extendPreviewReady: false, extendPreview: null });
      toast(extension.status === "effective" ? "续租已生效" : "已生成续租待付款，由客户在客户端支付", { icon: "success" });
      await this.load();
    } catch (error) { this.setData({ error: unknownResultOr(error) }); }
    finally { this.setData({ extendBusy: false }); }
  },
  /* ---------- 处理层：续租退款审核 / 检查异常费用复核 ---------- */
  applyReviews(extensions: RentalOrderExtension[], inspections: RentalInspectionRecord[], order: RentalOrder) {
    this.extensions = extensions;
    this.inspections = inspections;
    const currency = order.currency;
    const t = terms();
    const extensionReviews = extensions
      .filter((row) => row.status === "effective" && row.pricingSnapshot?.refundReview?.status === "pending")
      .map((row) => ({ id: row.id, sequence: row.sequence, newEndLabel: formatBusinessDateTime(row.newEndAt, this.timeZone), amountLabel: formatMoney(row.pricingSnapshot!.refundReview!.amount, currency) }));
    const inspectionExceptions: Array<{ inspectionId: string; index: number; key: string; stageLabel: string; description: string; suggestedLabel: string; approvedLabel: string; needsReview: boolean; disputed: boolean; customerReason: string }> = [];
    inspections.forEach((inspection) => {
      (inspection.exceptions ?? []).forEach((exception, index) => {
        const needsReview = exception.reviewStatus === "pending";
        const disputed = exception.customerResponseStatus === "disputed";
        if (!needsReview && !disputed) return;
        inspectionExceptions.push({
          inspectionId: inspection.id, index, key: `${inspection.id}:${index}`,
          stageLabel: inspection.stage === "return" ? `${t.returnLabel}检查` : `${t.pickupLabel}检查`,
          description: exception.description,
          suggestedLabel: exception.suggestedChargeAmount !== undefined ? formatMoney(exception.suggestedChargeAmount, currency) : "",
          approvedLabel: exception.approvedChargeAmount !== undefined ? formatMoney(exception.approvedChargeAmount, currency) : "",
          needsReview, disputed, customerReason: exception.customerResponseReason ?? ""
        });
      });
    });
    this.setData({ extensionReviews, hasExtensionReviews: extensionReviews.length > 0, inspectionExceptions, hasInspectionExceptions: inspectionExceptions.length > 0 });
  },
  async onReviewExtensionRefund(event: WechatMiniprogram.TouchEvent) {
    if (this.data.reviewBusy) return;
    const extensionId = String(event.currentTarget.dataset.id ?? "");
    const decision = String(event.currentTarget.dataset.decision ?? "");
    if (!extensionId || (decision !== "approved" && decision !== "rejected")) return;
    const reason = await promptDialog({ title: decision === "approved" ? "通过续租退款" : "驳回续租退款", placeholder: "请填写审核原因", danger: decision === "rejected" });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "审核原因不能为空" }); return; }
    this.setData({ reviewBusy: true, error: "" });
    try { await reviewExtensionRefund(this.data.id, extensionId, { decision, reason }); toast(decision === "approved" ? "已通过退款审核" : "已驳回退款审核", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: unknownResultOr(error) }); }
    finally { this.setData({ reviewBusy: false }); }
  },
  findException(inspectionId: string, exceptionIndex: number) {
    const inspection = this.inspections.find((row) => row.id === inspectionId);
    return inspection?.exceptions?.[exceptionIndex];
  },
  async onReviewException(event: WechatMiniprogram.TouchEvent) {
    if (this.data.reviewBusy) return;
    const inspectionId = String(event.currentTarget.dataset.inspection ?? "");
    const exceptionIndex = Number(event.currentTarget.dataset.index);
    const decision = String(event.currentTarget.dataset.decision ?? "");
    if (!inspectionId || !Number.isInteger(exceptionIndex) || (decision !== "approved" && decision !== "rejected")) return;
    const exception = this.findException(inspectionId, exceptionIndex);
    if (!exception) { this.setData({ error: "检查异常已变化，请刷新" }); return; }
    let approvedChargeAmount: number | undefined;
    if (decision === "approved") {
      const suggested = exception.suggestedChargeAmount;
      const amountText = await promptDialog({ title: "核准金额", placeholder: suggested !== undefined ? `建议 ${suggested.toFixed(2)}，留空则按建议额` : "请输入核准金额（元）" });
      if (amountText === undefined) return;
      if (!amountText.trim()) {
        if (suggested === undefined) { this.setData({ error: "请填写核准金额" }); return; }
        approvedChargeAmount = suggested;
      } else {
        const parsed = Number(amountText.trim());
        if (!Number.isFinite(parsed) || parsed < 0) { this.setData({ error: "核准金额无效" }); return; }
        approvedChargeAmount = parsed;
      }
    }
    const reason = await promptDialog({ title: decision === "approved" ? "复核通过原因" : "驳回原因", placeholder: "请填写复核依据", danger: decision === "rejected" });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "复核原因不能为空" }); return; }
    this.setData({ reviewBusy: true, error: "" });
    try {
      await reviewInspectionException(this.data.id, inspectionId, exceptionIndex, decision === "approved" ? { decision, approvedChargeAmount, reason } : { decision, reason });
      toast(decision === "approved" ? "已复核通过" : "已驳回", { icon: "success" });
      await this.load();
    } catch (error) { this.setData({ error: unknownResultOr(error) }); }
    finally { this.setData({ reviewBusy: false }); }
  },
  async onReReviewException(event: WechatMiniprogram.TouchEvent) {
    if (this.data.reviewBusy) return;
    const inspectionId = String(event.currentTarget.dataset.inspection ?? "");
    const exceptionIndex = Number(event.currentTarget.dataset.index);
    if (!inspectionId || !Number.isInteger(exceptionIndex)) return;
    const exception = this.findException(inspectionId, exceptionIndex);
    if (!exception) { this.setData({ error: "检查异常已变化，请刷新" }); return; }
    const current = exception.approvedChargeAmount;
    const amountText = await promptDialog({ title: "调整核准金额", placeholder: current !== undefined ? `当前 ${current.toFixed(2)}，请输入新的核准金额` : "请输入核准金额（元）" });
    if (amountText === undefined) return;
    const parsed = Number(amountText.trim());
    if (!amountText.trim() || !Number.isFinite(parsed) || parsed < 0) { this.setData({ error: "核准金额无效" }); return; }
    const reason = await promptDialog({ title: "再复核原因", placeholder: "请填写调整依据" });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "再复核原因不能为空" }); return; }
    this.setData({ reviewBusy: true, error: "" });
    try { await reReviewInspectionException(this.data.id, inspectionId, exceptionIndex, { approvedChargeAmount: parsed, reason }); toast("已再复核调整", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: unknownResultOr(error) }); }
    finally { this.setData({ reviewBusy: false }); }
  },
  async onRespondException(event: WechatMiniprogram.TouchEvent) {
    if (this.data.reviewBusy) return;
    const inspectionId = String(event.currentTarget.dataset.inspection ?? "");
    const exceptionIndex = Number(event.currentTarget.dataset.index);
    if (!inspectionId || !Number.isInteger(exceptionIndex)) return;
    const reason = await promptDialog({ title: "记录客户确认", placeholder: "请填写客户确认说明" });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "确认说明不能为空" }); return; }
    this.setData({ reviewBusy: true, error: "" });
    try { await respondInspectionException(this.data.id, inspectionId, exceptionIndex, { decision: "confirmed", reason }); toast("已记录客户确认", { icon: "success" }); await this.load(); }
    catch (error) { this.setData({ error: unknownResultOr(error) }); }
    finally { this.setData({ reviewBusy: false }); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.order, { id: this.data.id }) })) void this.load(); }
});
