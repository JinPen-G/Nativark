import { themeBehavior } from "../../core/theme-behavior";
import { enterpriseExtensionServiceRequests, enterpriseExtensionServiceSelectionKey, type ClientCatalogResponse, type ClientOrderView, type ClientQuoteServiceRequest, type RentalOrderExtension, type RentalOrderExtensionPreview, type EnterpriseExtensionApprovalView } from "@rental-os/shared";
import { fetchCatalog } from "../../api/catalog";
import { PUBLIC_CONFIG } from "../../config/public";
import { fetchEnterpriseExtensionEligibility } from "../../api/enterprise";
import { enterpriseExtensionOperation } from "../../core/enterprise-extension-operation";
import { contextVersion, currentSession, sessionEvents } from "../../core/session";
import { activatePaidExtension, applyExtension, fetchFunding, fetchOrder, listExtensions, previewExtension } from "../../api/orders";
import { describeError } from "../../core/errors";
import { ensureServiceForOrder } from "../../core/flow";
import { isApiError } from "../../core/http";
import { actionKey, releaseActionKey } from "../../core/keys";
import { describeDelta } from "../../core/money";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { rentalDue } from "../../core/payment";
import { currentServiceCode, isSignedIn } from "../../core/session";
import { formatBusinessDateTime, splitInstant, todayInZone, zoneLabel, zoneSupported, zonedToInstant } from "../../core/time";
import { ROUTES, buildUrl, navigate, requireSignIn, toast } from "../../core/ui";
import { zoneOf, ensureCurrentZone } from "../../core/zones";

/**
 * P10 续租（需求 §10.2）。只选一个新的归还时间；金额由服务端预览返回，正/零/负差额分别说明。
 * 正差额：申请后进入收银台补款，到账后再执行“生效”动作；零差额：服务端确认资源后生效；
 * 负差额：进入审核/退款，不显示“已退款”。已有待补款申请时优先恢复它，不重复提交。
 */
interface ExtendData {
  view: ViewState;
  order?: ClientOrderView;
  timeZone: string;
  zoneNote: string;
  currentEndText: string;
  minDate: string;
  endDate: string;
  endTime: string;
  preview?: RentalOrderExtensionPreview;
  deltaText: string;
  depositDeltaText: string;
  preAuthDeltaText: string;
  previewLoading: boolean;
  previewError: string;
  submitting: boolean;
  pending?: RentalOrderExtension;
  pendingText: string;
  currency: string;
  blockedReason: string;
  unknownResult: boolean;
  enterpriseRequired?: boolean;
  enterpriseError: string;
  enterpriseApproval?: EnterpriseExtensionApprovalView;
  enterpriseReason: string;
  enterprisePending: boolean;
  enterpriseCanClose: boolean;
  enterpriseResult: string;
  serviceChoices: Array<{ id: string; name: string }>;
  serviceLocations: Array<{ id: string; name: string }>;
  serviceRows: Array<{ serviceId: string; quantity: number; startDate: string; startTime: string; endDate: string; endTime: string; locationId: string; name: string; locationName: string }>;
  serviceError: string;
}

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    timeZone: "Asia/Shanghai",
    zoneNote: "",
    currentEndText: "",
    minDate: "",
    endDate: "",
    endTime: "10:00",
    deltaText: "",
    depositDeltaText: "",
    preAuthDeltaText: "",
    previewLoading: false,
    previewError: "",
    submitting: false,
    pendingText: "",
    currency: "",
    blockedReason: "",
    unknownResult: false,
    enterpriseError: "",
    enterpriseReason: "",
    enterprisePending: false,
    enterpriseCanClose: false,
    enterpriseResult: "", serviceChoices: [], serviceLocations: [], serviceRows: [], serviceError: ""
  } as ExtendData,

  orderId: "" as string,
  serviceCode: "" as string,
  enterpriseOperation: undefined as ReturnType<typeof enterpriseExtensionOperation> | undefined,
  viewEpoch: 0,
  visible: false,
  viewIdentity: "",
  unsubscribeSession: undefined as (() => void) | undefined,
  serviceCatalog: undefined as ClientCatalogResponse | undefined,
  serviceVersion: 0,
  previewServiceKey: "",

  sessionIdentity() { return JSON.stringify([contextVersion(), currentSession()?.customer.customerId, currentServiceCode()]); },
  viewCurrent(epoch: number, identity: string) { return this.visible && epoch === this.viewEpoch && identity === this.sessionIdentity(); },
  invalidateView() {
    this.serviceCatalog = undefined; this.serviceVersion++; this.previewServiceKey = "";
    this.viewEpoch++; this.enterpriseOperation = undefined; this.viewIdentity = "";
    this.setData({ view: loadingState(), order: undefined, preview: undefined, pending: undefined, endDate: "", endTime: "10:00",
      currentEndText: "", pendingText: "", previewError: "", previewLoading: false, submitting: false, unknownResult: false,
      enterpriseRequired: undefined, enterpriseApproval: undefined, enterpriseReason: "", enterprisePending: false, enterpriseCanClose: false, enterpriseResult: "", enterpriseError: "",
      serviceChoices: [], serviceLocations: [], serviceRows: [], serviceError: "" });
  },
  finishEnterprise(operation: ReturnType<typeof enterpriseExtensionOperation>, epoch: number, identity: string) {
    if (!this.viewCurrent(epoch, identity)) return;
    try { const pending = operation.pending(); this.setData({ submitting: false, enterprisePending: Boolean(pending), enterpriseCanClose: Boolean(pending && !pending.closureKey && (pending.kind === "request" || pending.approvalId)) }); }
    catch (error) { this.setData({ submitting: false, enterprisePending: true, enterpriseError: describeError(error).message }); }
  },
  preferredApproval(rows: EnterpriseExtensionApprovalView[]) { return rows.find(row => ["pending", "approved"].includes(row.state)) ?? rows[0]; },
  onHide() { this.visible = false; this.viewEpoch++; this.unsubscribeSession?.(); this.unsubscribeSession = undefined; },
  onUnload() { this.onHide(); this.enterpriseOperation = undefined; },

  onLoad(options: Record<string, string | undefined>) {
    this.orderId = options.id ?? "";
    this.serviceCode = options.service ?? "";
    if (!requireSignIn(buildUrl(ROUTES.extend, { id: this.orderId, service: this.serviceCode }))) return;
  },

  onShow() {
    this.visible = true; this.unsubscribeSession?.();
    this.unsubscribeSession = sessionEvents.on(event => { if (event.type !== "refreshed") this.invalidateView(); });
    void this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  onReload() {
    void this.load();
  },

  async load() {
    if (!this.visible) return;
    if (!this.orderId || !isSignedIn()) { this.invalidateView(); return; }
    if (this.viewIdentity !== this.sessionIdentity()) this.invalidateView();
    const customerId = currentSession()?.customer.customerId;
    let epoch = ++this.viewEpoch, identity = this.sessionIdentity();
    this.setData({ submitting: false, previewLoading: false, enterpriseRequired: undefined, enterpriseError: "" });
    try {
      if (this.serviceCode && currentServiceCode() !== this.serviceCode) {
        let switchedIdentity: string | undefined, changedOwner = false;
        const unsubscribe = sessionEvents.on(event => {
          if (event.type === "refreshed") return;
          if (event.type === "service-changed" && event.serviceCode === this.serviceCode && !switchedIdentity) switchedIdentity = this.sessionIdentity();
          else changedOwner = true;
        });
        let ok: boolean;
        try { ok = await ensureServiceForOrder(this.serviceCode); } finally { unsubscribe(); }
        // Only this explicit service-switch event may refresh the captured owner.
        // Re-login, hide/show or a second switch must not restart the old load.
        if (!this.visible || changedOwner || customerId !== currentSession()?.customer.customerId
          || epoch !== this.viewEpoch && !(epoch + 1 === this.viewEpoch && switchedIdentity === this.sessionIdentity())) return;
        if (!ok) {
          this.setData({ view: blockedState("已保留当前租赁", "续租需要切换到该订单所属的服务。", "返回订单", "none") });
          return;
        }
      }
      epoch = ++this.viewEpoch; identity = this.sessionIdentity(); this.viewIdentity = identity;
      const [order, extensions, eligibility] = await Promise.all([fetchOrder(this.orderId), listExtensions(this.orderId),
        fetchEnterpriseExtensionEligibility(this.orderId).catch(error => { if (this.viewCurrent(epoch, identity)) this.setData({ enterpriseError: describeError(error).message }); return undefined; }), ensureCurrentZone()]);
      if (!this.viewCurrent(epoch, identity)) return;
      if (eligibility?.approvalRequired) {
        try {
          const catalog = await fetchCatalog(); if (!this.viewCurrent(epoch, identity)) return;
          if (catalog.tenantCode !== PUBLIC_CONFIG.tenantCode || catalog.workspace?.workspaceCode !== currentServiceCode()
            || !Array.isArray(catalog.services) || !Array.isArray(catalog.locations) || typeof catalog.timeZone !== "string" || !catalog.timeZone.trim()
            || !zoneSupported(catalog.timeZone)) throw new Error("原公开服务候选或时区不可核对");
          this.serviceCatalog = catalog; this.setData({ serviceChoices: catalog.services.filter(service => service.enabled).map(service => ({ id: service.id, name: service.name })),
            serviceLocations: [{ id: "", name: "原规则默认地点" }, ...catalog.locations.filter(location => location.status === "enabled").map(location => ({ id: location.id, name: location.name }))], serviceError: "" });
        } catch (error) { if (!this.viewCurrent(epoch, identity)) return; this.serviceCatalog = undefined; this.setData({ serviceError: describeError(error).message }); }
      }
      const operation = enterpriseExtensionOperation(this.orderId, () => { if (!this.viewCurrent(epoch, identity)) throw new Error("原续租页面已变化，只能在当前页面核对"); });
      this.enterpriseOperation = operation;
      const originalOperation = operation.pending(), enterprisePending = Boolean(originalOperation);
      let approvals: EnterpriseExtensionApprovalView[] = [];
      try { approvals = await operation.list(); }
      catch (error) { if (!this.viewCurrent(epoch, identity)) return; this.setData({ enterpriseError: describeError(error).message }); }
      operation.current();
      const enterpriseApproval = originalOperation?.approvalId ? approvals.find(row => row.id === originalOperation.approvalId) : this.preferredApproval(approvals);
      const knownZone = zoneOf(currentServiceCode());
      const timeZone = eligibility?.approvalRequired && this.serviceCatalog ? this.serviceCatalog.timeZone : knownZone ?? "Asia/Shanghai";
      const currentEnd = order.effectiveEndAt ?? order.endAt;
      const pending = extensions.find((row) => row.status === "pending_payment");
      const status = String(order.status);
      const blockedReason = status !== "ready_for_pickup" && status !== "renting" ? "只有待取件或使用中的订单可以续租" : "";
      const split = splitInstant(currentEnd, timeZone);
      this.setData({
        view: readyState(),
        order,
        timeZone,
        zoneNote: (eligibility?.approvalRequired && this.serviceCatalog) || knownZone ? zoneLabel(timeZone) : "营业时区暂未获取，以下时间按 Asia/Shanghai 显示",
        currentEndText: formatBusinessDateTime(currentEnd, timeZone),
        minDate: split.date || todayInZone(timeZone),
        endDate: this.data.endDate || split.date,
        endTime: this.data.endTime || split.time || "10:00",
        currency: order.currency ?? "",
        pending,
        pendingText: pending ? `你有一笔待补款的续租申请（延长至 ${formatBusinessDateTime(pending.newEndAt, timeZone)}，${describeDelta(pending.payableAmount, order.currency)}）。请先完成补款并生效，不要重复申请。` : "",
        blockedReason,
        unknownResult: false,
        enterpriseRequired: eligibility?.approvalRequired,
        enterpriseError: this.data.enterpriseError,
        enterpriseApproval,
        enterprisePending,
        enterpriseCanClose: Boolean(originalOperation && !originalOperation.closureKey && (originalOperation.kind === "request" || originalOperation.approvalId)),
        enterpriseResult: ""
      });
    } catch (error) {
      if (!this.viewCurrent(epoch, identity) || isApiError(error, "STALE_CONTEXT")) return;
      // 二次加载失败保留当前续租信息，只在首屏无数据时整屏报错。
      if (this.data.order) toast("刷新失败，已保留当前续租信息");
      else this.setData({ view: errorState(error) });
    }
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    if (this.data.enterprisePending || this.data.submitting) return;
    this.serviceVersion++; this.previewServiceKey = "";
    const field = String(event.currentTarget.dataset.field) as "endDate" | "endTime";
    this.setData({ [field]: String(event.detail.value), preview: undefined, previewLoading: false, deltaText: "", previewError: "" });
  },

  onAddService() {
    if (this.data.submitting || this.data.enterprisePending || !this.serviceCatalog || this.data.serviceRows.length >= 100) return;
    this.serviceVersion++; this.previewServiceKey = "";
    this.setData({ preview: undefined, previewLoading: false, previewError: "", serviceRows: [...this.data.serviceRows, { serviceId: "", quantity: 1, startDate: "", startTime: "", endDate: "", endTime: "", locationId: "", name: "选择服务", locationName: "原规则默认地点" }] });
  },
  onRemoveService(event: WechatMiniprogram.CustomEvent) {
    if (this.data.submitting || this.data.enterprisePending) return;
    const index = Number(event.currentTarget.dataset.index); this.serviceVersion++; this.previewServiceKey = "";
    this.setData({ preview: undefined, previewLoading: false, previewError: "", serviceRows: this.data.serviceRows.filter((_, position) => position !== index) });
  },
  onServiceChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.submitting || this.data.enterprisePending) return;
    const index = Number(event.currentTarget.dataset.index), field = String(event.currentTarget.dataset.field), rows = this.data.serviceRows.map(row => ({ ...row })), row = rows[index];
    if (!row) return;
    if (field === "serviceId") { const selected = this.data.serviceChoices[Number(event.detail.value)]; if (!selected) return; row.serviceId = selected.id; row.name = selected.name; }
    else if (field === "locationId") { const selected = this.data.serviceLocations[Number(event.detail.value)]; if (!selected) return; row.locationId = selected.id; row.locationName = selected.name; }
    else if (field === "quantity") row.quantity = Number(event.detail.value);
    else if (["startDate", "startTime", "endDate", "endTime"].includes(field)) Object.assign(row, { [field]: event.detail.value });
    else return;
    this.serviceVersion++; this.previewServiceKey = ""; this.setData({ serviceRows: rows, preview: undefined, previewLoading: false, previewError: "" });
  },
  serviceRequest(): ClientQuoteServiceRequest[] {
    if (!this.data.enterpriseRequired) return [];
    const catalog = this.serviceCatalog; if (!catalog) throw new Error("原服务候选不可用，请先刷新");
    return enterpriseExtensionServiceRequests(this.data.serviceRows.map(row => ({ serviceId: row.serviceId, quantity: row.quantity,
      ...(row.startDate || row.startTime || row.endDate || row.endTime ? { scheduledStartAt: zonedToInstant(row.startDate, row.startTime, catalog.timeZone), scheduledEndAt: zonedToInstant(row.endDate, row.endTime, catalog.timeZone) } : {}),
      ...(row.locationId ? { serviceLocationId: row.locationId } : {}) })), catalog);
  },

  newEndAt(): string | undefined {
    try {
      return zonedToInstant(this.data.endDate, this.data.endTime, this.data.timeZone);
    } catch (error) {
      this.setData({ previewError: error instanceof Error ? error.message : "时间无效" });
      return undefined;
    }
  },

  async onPreview() {
    const order = this.data.order, epoch = this.viewEpoch, identity = this.sessionIdentity();
    if (!order || this.data.previewLoading || this.viewIdentity !== identity) return;
    const newEndAt = this.newEndAt();
    if (!newEndAt) return;
    const currentEnd = Date.parse(order.effectiveEndAt ?? order.endAt);
    if (Date.parse(newEndAt) <= currentEnd) {
      this.setData({ previewError: "新的归还时间必须晚于当前归还时间" });
      return;
    }
    const generation = this.serviceVersion;
    this.setData({ previewLoading: true, previewError: "", preview: undefined });
    try {
      const services = this.serviceRequest(), sourceKey = this.data.enterpriseRequired && this.serviceCatalog ? enterpriseExtensionServiceSelectionKey(services, this.serviceCatalog) : "";
      const preview = await previewExtension(this.orderId, { newEndAt, ...(services.length ? { services } : {}) });
      if (!this.viewCurrent(epoch, identity) || generation !== this.serviceVersion) return;
      if (Date.parse(preview.newEndAt) !== Date.parse(newEndAt)) throw new Error("原预览的归还时间与本次选择不一致");
      this.previewServiceKey = JSON.stringify([Date.parse(newEndAt), sourceKey]);
      this.setData({
        preview,
        deltaText: describeDelta(preview.payableAmount, preview.currency),
        depositDeltaText: preview.depositDelta ? describeDelta(preview.depositDelta, preview.currency) : "无变化",
        preAuthDeltaText: preview.preAuthDelta ? describeDelta(preview.preAuthDelta, preview.currency) : "无变化"
      });
    } catch (error) {
      if (this.viewCurrent(epoch, identity) && generation === this.serviceVersion) this.setData({ previewError: describeError(error).message });
    } finally {
      if (this.viewCurrent(epoch, identity) && generation === this.serviceVersion) this.setData({ previewLoading: false });
    }
  },

  async onApply() {
    const epoch = this.viewEpoch, identity = this.sessionIdentity();
    if (!this.visible || this.viewIdentity !== identity) return;
    if (this.data.enterpriseRequired !== false || this.data.enterprisePending) { toast("请先核对企业续租准入与原批准；不能使用普通提交绕过审批"); return; }
    const preview = this.data.preview;
    if (!preview || this.data.submitting) return;
    if (this.data.pending) {
      toast("已有待补款的续租申请，请先处理", { duration: 3000 });
      return;
    }
    this.setData({ submitting: true, previewError: "" });
    const key = actionKey("order.extend", this.orderId, preview.newEndAt);
    try {
      const result = await applyExtension(this.orderId, { newEndAt: preview.newEndAt }, key);
      if (!this.viewCurrent(epoch, identity)) return;
      releaseActionKey("order.extend", this.orderId);
      const extension = result.extension;
      if (extension.status === "effective") {
        toast("续租已生效", { icon: "success" });
        navigate(buildUrl(ROUTES.order, { id: this.orderId, service: this.serviceCode }));
        return;
      }
      if (extension.status === "pending_payment") {
        if (extension.payableAmount > 0) {
          toast("续租申请已提交，请完成补款", { duration: 3000 });
          navigate(buildUrl(ROUTES.pay, { id: this.orderId }));
        } else {
          toast("续租申请已提交，等待商户确认", { duration: 3000 });
          await this.load();
        }
        return;
      }
      toast(`续租申请状态：${extension.status}`, { duration: 3000 });
      await this.load();
    } catch (error) {
      if (!this.viewCurrent(epoch, identity)) return;
      if (isApiError(error, "TIMEOUT") || isApiError(error, "NETWORK") || isApiError(error, "SERVER")) {
        this.setData({ previewError: "申请结果未知：请点击下方“刷新本页”；若申请已存在会显示在上方，再次提交会使用同一凭证，不会重复申请。", unknownResult: true });
      } else {
        releaseActionKey("order.extend", this.orderId);
        this.setData({ previewError: describeError(error).message });
      }
    } finally {
      if (this.viewCurrent(epoch, identity)) this.setData({ submitting: false });
    }
  },

  onEnterpriseReason(event: WechatMiniprogram.Input) { if (!this.data.submitting && (!this.data.enterprisePending || this.data.enterpriseCanClose)) this.setData({ enterpriseReason: event.detail.value }); },
  async refreshOriginalExtension(operation: ReturnType<typeof enterpriseExtensionOperation>) {
    const [order, extensions] = await Promise.all([fetchOrder(this.orderId), listExtensions(this.orderId)]); operation.current();
    const pending = extensions.find(row => row.status === "pending_payment");
    this.setData({ order, pending, currentEndText: formatBusinessDateTime(order.effectiveEndAt ?? order.endAt, this.data.timeZone), preview: undefined,
      pendingText: pending ? `原续租待补款（延长至 ${formatBusinessDateTime(pending.newEndAt, this.data.timeZone)}，${describeDelta(pending.payableAmount, order.currency)}）；原租期尚未延长。` : "" });
  },
  async onRequestEnterpriseExtension() {
    const operation = this.enterpriseOperation, order = this.data.order, preview = this.data.preview, reason = this.data.enterpriseReason.trim(), epoch = this.viewEpoch, identity = this.sessionIdentity();
    if (!operation || !order || !preview || !reason || this.data.submitting || this.data.enterprisePending || !this.data.enterpriseRequired || this.data.pending || this.data.blockedReason
      || this.data.enterpriseApproval && ["pending", "approved"].includes(this.data.enterpriseApproval.state)) return;
    this.setData({ submitting: true, enterpriseError: "" });
    try {
      const generation = this.serviceVersion, services = this.serviceRequest(), catalog = this.serviceCatalog;
      if (!catalog || this.previewServiceKey !== JSON.stringify([Date.parse(preview.newEndAt), enterpriseExtensionServiceSelectionKey(services, catalog)])) throw new Error("原服务选择或预览已变化");
      const currentCatalog = await fetchCatalog(); operation.current();
      if (generation !== this.serviceVersion || currentCatalog.tenantCode !== PUBLIC_CONFIG.tenantCode || currentCatalog.workspace?.workspaceCode !== currentServiceCode()
        || enterpriseExtensionServiceSelectionKey(services, currentCatalog) !== enterpriseExtensionServiceSelectionKey(services, catalog)) throw new Error("原服务候选在申请前已变化");
      const result = await operation.request(order.updatedAt, preview.newEndAt, reason, services.length ? services : undefined); operation.current(); if (result) {
      if ("state" in result) this.setData({ enterpriseApproval: undefined, preview: undefined, enterpriseResult: "原申请键已封闭；新申请须重新试算并明确发起" });
      else this.setData({ enterpriseApproval: result.approval, enterpriseResult: "批准仅为企业费用授权，不代表续租已生效" });
    } }
    catch (error) { if (this.viewCurrent(epoch, identity)) this.setData({ enterpriseError: describeError(error).message }); }
    finally { this.finishEnterprise(operation, epoch, identity); }
  },
  async onReadEnterpriseExtension() {
    const operation = this.enterpriseOperation, epoch = this.viewEpoch, identity = this.sessionIdentity();
    if (!operation || this.data.submitting) return;
    this.setData({ submitting: true, enterpriseError: "" });
    try {
      const result = operation.pending() ? await operation.recover() : this.data.enterpriseApproval ? await operation.result(this.data.enterpriseApproval.id) : undefined;
      operation.current();
      if (result && "state" in result) {
        this.setData({ enterpriseApproval: undefined, preview: undefined, enterpriseReason: "", enterpriseResult: "原申请键已封闭；未撤回已成立申请或取消续租，新申请须重新试算并明确发起" });
      } else if (result) {
        this.setData({ enterpriseApproval: result.approval, enterpriseResult: result.original.state === "observed" ? result.original.extensionState === "pending_payment" ? "待补款；当前归还时间不变，请勿重复申请" : `原续租状态：${result.original.extensionState}` : result.original.state === "closed" ? "原提交已封闭，新申请须重新试算与批准" : "原申请尚未提交至Core" });
        if (result.original.state === "observed") await this.refreshOriginalExtension(operation);
      } else { const rows = await operation.list(); this.setData({ enterpriseApproval: this.preferredApproval(rows) }); }
    } catch (error) { if (this.viewCurrent(epoch, identity)) this.setData({ enterpriseError: describeError(error).message }); }
    finally { this.finishEnterprise(operation, epoch, identity); }
  },
  async onCloseEnterpriseExtension() {
    const operation = this.enterpriseOperation, approval = this.data.enterpriseApproval, epoch = this.viewEpoch, identity = this.sessionIdentity(), reason = this.data.enterpriseReason.trim();
    if (!operation || !this.data.enterpriseCanClose || !reason || this.data.submitting) return;
    this.setData({ submitting: true, enterpriseError: "" });
    try {
      const pending = operation.pending(); if (!pending || pending.kind === "submit" && !approval) return;
      operation.current(); const answer = await wx.showModal({ title: "受控结束原操作", content: pending.kind === "request" ? "永久封闭本条原申请键；若申请已成立只恢复原申请，不撤回、不取消续租、不退款。新申请须重新试算并明确发起。" : "永久封闭本条原续租批准与提交键；若已消费只核对原续租，不取消、不退款、不重试。新申请须重新试算与批准。" });
      operation.current(); if (!answer.confirm) return;
      const result = pending.kind === "request" ? await operation.closeRequest(reason) : await operation.close(approval!, reason); operation.current();
      if (result && "state" in result) this.setData({ enterpriseApproval: undefined, preview: undefined, enterpriseReason: "", enterpriseResult: "原申请键已封闭；新申请须重新试算并明确发起" });
      else if (result) { this.setData({ enterpriseApproval: result.approval, enterpriseResult: result.original.state === "closed" ? "原提交已封闭，新申请须重新试算与批准" : "原申请或续租已成立，未撤回、取消或重试" }); if (result.original.state === "observed") await this.refreshOriginalExtension(operation); }
    } catch (error) { if (this.viewCurrent(epoch, identity)) this.setData({ enterpriseError: describeError(error).message }); }
    finally { this.finishEnterprise(operation, epoch, identity); }
  },
  async onSubmitEnterpriseExtension() {
    const operation = this.enterpriseOperation, approval = this.data.enterpriseApproval, reason = this.data.enterpriseReason.trim(), epoch = this.viewEpoch, identity = this.sessionIdentity();
    if (!operation || approval?.state !== "approved" || !reason || this.data.submitting || this.data.enterprisePending) return;
    if (approval.preview.services?.state !== "available") { this.setData({ enterpriseError: "原服务明细不可用，请重新核对本条申请" }); return; }
    const approvalKey = JSON.stringify(approval);
    this.setData({ submitting: true, enterpriseError: "" });
    try {
      operation.current();
      const answer = await wx.showModal({ title: "核对原续租费用", content: `延长至 ${formatBusinessDateTime(approval.preview.newEndAt, this.data.timeZone)}；租赁应付 ${describeDelta(approval.preview.payableAmount, approval.preview.currency)}，押金差额 ${describeDelta(approval.preview.depositDelta, approval.preview.currency)}，预授权差额 ${describeDelta(approval.preview.preAuthDelta, approval.preview.currency)}。明确提交本条批准；待补款不代表已延期。` });
      operation.current(); if (!answer.confirm || approval !== this.data.enterpriseApproval || approvalKey !== JSON.stringify(this.data.enterpriseApproval)) return;
      const result = await operation.submit(approval, reason); operation.current(); if (!result) return;
      if ("state" in result) { this.setData({ enterpriseApproval: undefined, preview: undefined, enterpriseResult: "原申请键已封闭" }); return; }
      this.setData({ enterpriseApproval: result.approval, enterpriseResult: result.original.state === "observed" && result.original.extensionState === "pending_payment" ? "待补款，原租期不变；请按原续租记录完成补款" : "原续租已提交，请读取原订单及续租状态" });
      if (result.original.state === "observed") await this.refreshOriginalExtension(operation);
    } catch (error) { if (this.viewCurrent(epoch, identity)) this.setData({ enterpriseError: describeError(error).message }); }
    finally { this.finishEnterprise(operation, epoch, identity); }
  },

  /** 补款已到账后，执行服务端资金校验的生效动作（不是付款入口）。 */
  async onActivate() {
    const pending = this.data.pending, epoch = this.viewEpoch, identity = this.sessionIdentity();
    if (!pending || this.data.submitting || !this.visible || this.viewIdentity !== identity) return;
    this.setData({ submitting: true, previewError: "" });
    try {
      const funding = await fetchFunding(this.orderId);
      if (!this.viewCurrent(epoch, identity)) return;
      // 待付 = 未付余额 + 待生效续租补款；服务端 assertExtensionPaid 按同一口径校验。
      if (rentalDue(funding) > 0) {
        toast("续租补款尚未到账，请先完成付款", { duration: 3000 });
        navigate(buildUrl(ROUTES.pay, { id: this.orderId }));
        return;
      }
      const key = actionKey("order.extend.pay", pending.id);
      const result = await activatePaidExtension(this.orderId, pending.id, key);
      if (!this.viewCurrent(epoch, identity)) return;
      releaseActionKey("order.extend.pay", pending.id);
      if (result.extension.status === "effective") {
        toast("续租已生效", { icon: "success" });
        navigate(buildUrl(ROUTES.order, { id: this.orderId, service: this.serviceCode }));
      } else {
        this.setData({ previewError: "款项已收到，但续租尚未生效，正在核对；请勿重复付款。" });
      }
    } catch (error) {
      if (!this.viewCurrent(epoch, identity)) return;
      if (isApiError(error, "CONFLICT")) this.setData({ previewError: `${describeError(error).message} 款项已收的情况下不会重复收费，请联系商户核对。` });
      else this.setData({ previewError: describeError(error).message });
    } finally {
      if (this.viewCurrent(epoch, identity)) this.setData({ submitting: false });
    }
  },

  onPay() {
    navigate(buildUrl(ROUTES.pay, { id: this.orderId }));
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.extend, { id: this.orderId, service: this.serviceCode }) })) return;
    if (this.data.view.actionText === "返回订单") navigate(buildUrl(ROUTES.order, { id: this.orderId, service: this.serviceCode }));
    else void this.load();
  }
});
