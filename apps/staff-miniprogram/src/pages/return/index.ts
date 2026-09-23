import type { RentalInspectionTemplate, RentalOrder } from "@rental-os/shared";
import { createInspection, getOrder, handover, listInspectionTemplates, operationLock, partialReturn } from "../../api/orders";
import { terms } from "../../core/context";
import { describeError } from "../../core/errors";
import { inspectionResults, inspectionRows, type InspectionFieldRow } from "../../core/inspection-form";
import { actionKey, releaseActionKey } from "../../core/keys";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, confirmDialog, relaunch, toast } from "../../core/ui";

interface ReturnAllocation { id: string; label: string; max: number; quantity: string; selected: boolean; }

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", orderNo: "", customer: "", itemLabel: "物品", returnLocation: "", allocations: [] as ReturnAllocation[], templateName: "", fields: [] as InspectionFieldRow[], noTemplate: false, busy: false, error: "" },
  order: undefined as RentalOrder | undefined,
  template: undefined as RentalInspectionTemplate | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    if (!this.data.id) { this.setData({ view: blockedState("缺少订单编号", "请从订单详情重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const [order, templates] = await Promise.all([getOrder(this.data.id), listInspectionTemplates("return")]);
      if (order.status !== "renting") { this.setData({ view: blockedState("当前不能办理归还", `订单当前状态：${order.status}`) }); return; }
      if (!can("rental-os:order:return", "rental-os:order:operate")) { this.setData({ view: blockedState("无归还权限", "请联系管理员授权") }); return; }
      this.order = order;
      this.template = templates.find((row) => row.enabled && row.categoryCode === order.categoryCode);
      const allocations = order.allocations.filter((row) => row.status === "picked_up").map((row) => ({ id: row.id, label: row.assetNo || order.lines.find((line) => line.id === row.orderLineId)?.itemGroupName || row.itemGroupId || "资源", max: row.quantity, quantity: String(row.quantity), selected: true }));
      this.setData({ view: readyState(), orderNo: order.orderNo, customer: order.customerName, itemLabel: terms().itemLabel, returnLocation: order.returnLocationName ?? order.fulfillmentLocationName, allocations, templateName: this.template?.name ?? "无需检查模板", fields: inspectionRows(this.template), noTemplate: !this.template, error: "" });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onToggleAllocation(event: WechatMiniprogram.SwitchChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`allocations[${index}].selected`]: Boolean(event.detail.value), error: "" }); },
  onQuantity(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`allocations[${index}].quantity`]: String(event.detail.value ?? ""), error: "" }); },
  onFieldInput(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${index}].value`]: String(event.detail.value ?? ""), error: "" }); },
  onFieldBool(event: WechatMiniprogram.SwitchChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${index}].checked`]: Boolean(event.detail.value), error: "" }); },
  onFieldSelect(event: WechatMiniprogram.PickerChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${index}].value`]: this.data.fields[index]?.options[Number(event.detail.value)] ?? "", error: "" }); },
  async onSubmit() {
    if (this.data.busy || !this.order) return;
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
    const action = partial ? "return.partial" : this.template ? "return.inspection" : "return.handover";
    const fingerprint = JSON.stringify({ templateId: this.template?.id, results, items });
    const key = actionKey(action, this.data.id, fingerprint);
    this.setData({ busy: true, error: "" });
    let lockToken: string | undefined;
    try {
      const lock = await operationLock(this.data.id, { action: "acquire" });
      lockToken = lock.token;
      if (!lockToken) throw new Error("未取得交接操作锁，请稍后重试");
      if (this.template) await createInspection(this.data.id, { templateId: this.template.id, results, ...(partial ? { returnItems: items, returnBatchNo: key } : {}) }, { idempotencyKey: key, operationToken: lockToken });
      else if (partial) await partialReturn(this.data.id, { items, batchNo: key }, { idempotencyKey: key, operationToken: lockToken });
      else await handover(this.data.id, "return", { idempotencyKey: key, operationToken: lockToken });
      releaseActionKey(action, this.data.id);
      toast(partial ? "本批归还已记录" : "归还交接已完成", { icon: "success" });
      relaunch(buildUrl(ROUTES.order, { id: this.data.id }));
    } catch (caught) { this.setData({ error: describeError(caught).message }); }
    finally { if (lockToken) await operationLock(this.data.id, { action: "release", token: lockToken }).catch(() => undefined); this.setData({ busy: false }); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.return, { id: this.data.id }) })) void this.load(); }
});
