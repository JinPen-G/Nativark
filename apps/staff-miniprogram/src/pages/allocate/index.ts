import type { ManageRentalAllocationRequest, RentalAllocationCandidates, RentalOrder } from "@rental-os/shared";
import { allocationCandidates, autoAllocate, getOrder, manageAllocations } from "../../api/orders";
import { loadContext, terms, type WorkspaceContext } from "../../core/context";
import { describeError } from "../../core/errors";
import { isApiError } from "../../core/http";
import { allocationStatusLabel, inventoryModeLabel, orderStatusLabel } from "../../core/labels";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, currentSession, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { formatBusinessDateTime, formatBusinessRange } from "../../core/time";
import { ROUTES, buildUrl, confirmDialog, promptDialog, relaunch, toast } from "../../core/ui";

/**
 * S07 配货与锁定：候选资源勾选 → 预分配 / 锁定 / 解锁 / 释放 / 改配。
 *
 * 所有写操作都带 `expectedRevision`（=assignment.revision），既做乐观并发，也作服务端幂等键；
 * 服务端整单事务，冲突整体失败不留半套，前端只需 toast 冲突项并重新拉 candidates 刷新 revision。
 *
 * 交接操作锁不在本页主动持有：服务端 manage 在存在任何操作锁时都会拒绝分配（含本人持有），
 * 因此这里只从 `order.assignment.operationLock` 读取占用信息做提示，不 acquire（详见交接报告）。
 */
interface CandidateView { assetId: string; assetNo: string; itemGroupId: string; modelName: string; substitute: boolean; available: boolean; reason: string; selected: boolean; }
interface ReservationView { reservationId: string; itemGroupId: string; name: string; modeLabel: string; serialized: boolean; quantity: number; assignedQuantity: number; lockedQuantity: number; remaining: number; candidates: CandidateView[]; quantityDraft: string; }
interface AllocationView { id: string; assetNo: string; name: string; quantity: number; statusLabel: string; locked: boolean; selected: boolean; }

const MANAGEABLE = ["pre_assigned", "locked", "allocated"];

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState() as ViewState, id: "",
    orderNo: "", customer: "", period: "", fulfillmentLabel: "", fulfillment: "", identifierLabel: "",
    canOperate: false, canReassign: false,
    occupied: false, occupiedOwner: "", occupiedUntil: "",
    revision: 0, reservations: [] as ReservationView[], allocations: [] as AllocationView[],
    hasActive: false, hasLocked: false, hasUnassigned: false,
    busy: false, error: ""
  },
  order: undefined as RentalOrder | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  onRefresh() { void this.load(); },

  async load(silent = false) {
    if (!this.data.id) { this.setData({ view: blockedState("缺少订单编号", "请从订单详情重新进入") }); return; }
    if (!silent) this.setData({ view: loadingState() });
    try {
      const [order, candidates, context] = await Promise.all([getOrder(this.data.id), allocationCandidates(this.data.id), loadContext()]);
      if (!can("rental-os:order:operate")) { this.setData({ view: blockedState("无配货权限", "需要租赁订单操作权限，请联系管理员授权") }); return; }
      if (!["reserved", "ready_for_pickup"].includes(order.status)) { this.setData({ view: blockedState("当前订单不可配货", `订单状态：${orderStatusLabel(order.status)}`) }); return; }
      this.order = order;
      this.applyCandidates(order, candidates, context);
    } catch (error) { this.setData({ view: errorState(error) }); }
  },

  applyCandidates(order: RentalOrder, candidates: RentalAllocationCandidates, context: WorkspaceContext) {
    const t = terms();
    const timeZone = context.locations.find((row) => row.id === order.fulfillmentLocationId)?.timezone ?? "Asia/Shanghai";
    const me = currentSession()?.user.id;
    const lock = order.assignment?.operationLock;
    const occupied = Boolean(lock && lock.ownerId !== me && Date.parse(lock.expiresAt) > Date.now());
    const reservations: ReservationView[] = candidates.reservations.map((r) => {
      const serialized = r.inventoryMode === "serialized";
      const cands: CandidateView[] = r.candidates.map((c) => ({
        assetId: c.assetId, assetNo: c.assetNo, itemGroupId: c.itemGroupId,
        modelName: r.models.find((m) => m.itemGroupId === c.itemGroupId)?.name ?? "",
        substitute: c.itemGroupId !== r.itemGroupId, available: c.available, reason: c.reason ?? "", selected: false
      }));
      return {
        reservationId: r.reservationId, itemGroupId: r.itemGroupId, name: r.itemGroupName,
        modeLabel: inventoryModeLabel(r.inventoryMode), serialized,
        quantity: r.quantity, assignedQuantity: r.assignedQuantity, lockedQuantity: r.lockedQuantity, remaining: Math.max(0, r.quantity - r.assignedQuantity),
        candidates: cands, quantityDraft: ""
      };
    });
    const allocations: AllocationView[] = order.allocations.filter((a) => MANAGEABLE.includes(a.status)).map((a) => ({
      id: a.id, assetNo: a.assetNo ?? "", name: a.metadata?.itemGroupName ?? "", quantity: a.quantity,
      statusLabel: allocationStatusLabel(a.status), locked: a.status !== "pre_assigned", selected: false
    }));
    this.setData({
      view: readyState(), orderNo: order.orderNo, customer: order.customerName,
      period: formatBusinessRange(order.startAt, order.effectiveEndAt ?? order.endAt, timeZone),
      fulfillmentLabel: t.fulfillmentLabel, fulfillment: order.fulfillmentLocationName, identifierLabel: t.identifierLabel,
      canOperate: can("rental-os:order:operate"), canReassign: can("rental-os:order:reassign"),
      occupied, occupiedOwner: lock?.ownerName ?? "", occupiedUntil: occupied ? formatBusinessDateTime(lock!.expiresAt, timeZone) : "",
      revision: order.assignment?.revision ?? candidates.revision ?? 0, reservations, allocations,
      hasActive: allocations.length > 0, hasLocked: allocations.some((a) => a.locked), hasUnassigned: reservations.some((r) => r.remaining > 0),
      error: ""
    });
  },

  onToggleCandidate(event: WechatMiniprogram.TouchEvent) {
    if (this.data.occupied || this.data.busy) return;
    const ri = Number(event.currentTarget.dataset.ri), ci = Number(event.currentTarget.dataset.ci);
    const res = this.data.reservations[ri];
    if (!res || !res.candidates[ci] || !res.candidates[ci].available) return;
    const candidates = res.candidates.map((c, index) => (index === ci ? { ...c, selected: !c.selected } : c));
    this.setData({ [`reservations[${ri}].candidates`]: candidates, error: "" });
  },

  onQuantityInput(event: WechatMiniprogram.Input) {
    const ri = Number(event.currentTarget.dataset.ri);
    const value = String(event.detail.value ?? "").replace(/[^0-9]/g, "");
    this.setData({ [`reservations[${ri}].quantityDraft`]: value, error: "" });
  },

  onToggleAllocation(event: WechatMiniprogram.TouchEvent) {
    if (this.data.occupied || this.data.busy) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.allocations[index]) return;
    this.setData({ [`allocations[${index}].selected`]: !this.data.allocations[index].selected, error: "" });
  },

  /** 由勾选的候选资产/填写的数量构造 selections；跨型号仅在改配（allowCrossModel）时放行，与服务端一致。 */
  buildSelections(allowCrossModel: boolean): { selections?: NonNullable<ManageRentalAllocationRequest["selections"]>; error?: string } {
    const selections: NonNullable<ManageRentalAllocationRequest["selections"]> = [];
    for (const res of this.data.reservations) {
      if (res.serialized) {
        const picked = res.candidates.filter((c) => c.selected);
        if (!picked.length) continue;
        if (picked.length > res.quantity) return { error: `${res.name} 所选数量超过需求 ${res.quantity}` };
        const models = Array.from(new Set(picked.map((c) => c.itemGroupId)));
        if (models.length > 1) return { error: `${res.name} 同一明细只能选择同一型号` };
        const modelId = models[0];
        if (modelId !== res.itemGroupId && !allowCrossModel) return { error: `${res.name} 跨型号请使用「改配」并填写原因` };
        selections.push({ reservationId: res.reservationId, assetIds: picked.map((c) => c.assetId), ...(modelId !== res.itemGroupId ? { itemGroupId: modelId } : {}) });
      } else {
        if (!res.quantityDraft) continue;
        const quantity = Number(res.quantityDraft);
        if (!Number.isInteger(quantity) || quantity <= 0) return { error: `${res.name} 请输入有效数量` };
        if (quantity > res.quantity) return { error: `${res.name} 数量不能超过需求 ${res.quantity}` };
        selections.push({ reservationId: res.reservationId, quantity });
      }
    }
    return { selections };
  },
  async runWrite(action: () => Promise<unknown>, successMessage: string) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try {
      await action();
      toast(successMessage, { icon: "success" });
      await this.load(true);
    } catch (error) {
      if (isApiError(error, "CONFLICT")) { toast(describeError(error).message); await this.load(true); }
      else this.setData({ error: describeError(error).message });
    } finally {
      this.setData({ busy: false });
    }
  },

  async onAuto() {
    if (!this.data.canOperate || this.data.occupied || this.data.busy) return;
    if (!(await confirmDialog({ title: "一键配货", content: "系统将按库存与规则自动分配并锁定资源。" }))) return;
    await this.runWrite(() => autoAllocate(this.data.id), "已完成配货");
  },

  async onPreassign() {
    if (!this.data.canOperate || this.data.occupied || this.data.busy) return;
    const { selections, error } = this.buildSelections(false);
    if (error) { this.setData({ error }); return; }
    if (!selections?.length && !this.data.hasUnassigned) { toast("已全部分配，无需预分配"); return; }
    const expectedRevision = this.data.revision;
    await this.runWrite(() => manageAllocations(this.data.id, { action: "preassign", expectedRevision, ...(selections?.length ? { selections } : {}) }), selections?.length ? "已按所选预分配" : "已按库存预分配");
  },

  async onLock() {
    if (!this.data.canOperate || this.data.occupied || this.data.busy || !this.data.hasActive) return;
    const allocationIds = this.data.allocations.filter((a) => a.selected).map((a) => a.id);
    const expectedRevision = this.data.revision;
    await this.runWrite(() => manageAllocations(this.data.id, { action: "lock", expectedRevision, ...(allocationIds.length ? { allocationIds } : {}) }), allocationIds.length ? "已锁定所选资源" : "已锁定全部资源");
  },

  async onUnlock() {
    if (!this.data.canReassign || this.data.occupied || this.data.busy) return;
    const allocationIds = this.data.allocations.filter((a) => a.selected && a.locked).map((a) => a.id);
    if (!allocationIds.length) { this.setData({ error: "请勾选已锁定的分配项再解锁" }); return; }
    const reason = await promptDialog({ title: "解锁资源", placeholder: "请填写解锁原因", confirmText: "解锁" });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "解锁原因不能为空" }); return; }
    await this.runWrite(() => manageAllocations(this.data.id, { action: "unlock", expectedRevision: this.data.revision, allocationIds, reason }), "已解锁所选资源");
  },

  async onRelease() {
    if (!this.data.canReassign || this.data.occupied || this.data.busy) return;
    const allocationIds = this.data.allocations.filter((a) => a.selected).map((a) => a.id);
    if (!allocationIds.length) { this.setData({ error: "请勾选要释放的分配项" }); return; }
    const reason = await promptDialog({ title: "释放资源", placeholder: "请填写释放原因", confirmText: "释放", danger: true });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "释放原因不能为空" }); return; }
    await this.runWrite(() => manageAllocations(this.data.id, { action: "release", expectedRevision: this.data.revision, allocationIds, reason }), "已释放所选资源");
  },

  async onReassign() {
    if (!this.data.canReassign || this.data.occupied || this.data.busy) return;
    const { selections, error } = this.buildSelections(true);
    if (error) { this.setData({ error }); return; }
    if (!selections?.length) { this.setData({ error: "请勾选改配的目标资源" }); return; }
    const reason = await promptDialog({ title: "改配资源", placeholder: "请填写改配原因", confirmText: "改配" });
    if (reason === undefined) return;
    if (!reason) { this.setData({ error: "改配原因不能为空" }); return; }
    await this.runWrite(() => manageAllocations(this.data.id, { action: "reassign", expectedRevision: this.data.revision, selections, reason }), "已改配资源");
  },

  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.allocate, { id: this.data.id }) })) void this.load(); }
});
