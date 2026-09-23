import type { RentalInspectionTemplate, RentalOrder } from "@rental-os/shared";
import { createInspection, getOrder, handover, listInspectionTemplates, operationLock } from "../../api/orders";
import { terms } from "../../core/context";
import { describeError } from "../../core/errors";
import { inspectionResults, inspectionRows, type InspectionFieldRow } from "../../core/inspection-form";
import { actionKey, releaseActionKey } from "../../core/keys";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, confirmDialog, relaunch, toast } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", orderNo: "", customer: "", itemLabel: "物品", lines: [] as Array<{ id: string; name: string; quantity: number }>, templateName: "", fields: [] as InspectionFieldRow[], noTemplate: false, busy: false, error: "" },
  order: undefined as RentalOrder | undefined,
  template: undefined as RentalInspectionTemplate | undefined,
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    if (!this.data.id) { this.setData({ view: blockedState("缺少订单编号", "请从订单详情重新进入") }); return; }
    this.setData({ view: loadingState() });
    try {
      const [order, templates] = await Promise.all([getOrder(this.data.id), listInspectionTemplates("pickup")]);
      if (order.status !== "ready_for_pickup") { this.setData({ view: blockedState("当前不能办理领取", `订单当前状态：${order.status}`) }); return; }
      if (!can("rental-os:order:pickup", "rental-os:order:operate")) { this.setData({ view: blockedState("无领取权限", "请联系管理员授权") }); return; }
      this.order = order;
      this.template = templates.find((row) => row.enabled && row.categoryCode === order.categoryCode);
      this.setData({ view: readyState(), orderNo: order.orderNo, customer: order.customerName, itemLabel: terms().itemLabel, lines: order.lines.map((row) => ({ id: row.id, name: row.itemGroupName, quantity: row.quantity - (row.cancelledQuantity ?? 0) })), templateName: this.template?.name ?? "无需检查模板", fields: inspectionRows(this.template), noTemplate: !this.template, error: "" });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onFieldInput(event: WechatMiniprogram.Input) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${index}].value`]: String(event.detail.value ?? ""), error: "" }); },
  onFieldBool(event: WechatMiniprogram.SwitchChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${index}].checked`]: Boolean(event.detail.value), error: "" }); },
  onFieldSelect(event: WechatMiniprogram.PickerChange) { const index = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${index}].value`]: this.data.fields[index]?.options[Number(event.detail.value)] ?? "", error: "" }); },
  async onSubmit() {
    if (this.data.busy || !this.order) return;
    const { results, error } = inspectionResults(this.data.fields);
    if (error) { this.setData({ error }); return; }
    if (!await confirmDialog({ title: "确认交付", content: "提交后订单将进入使用中，请先与客户当面核对资源及检查结果。" })) return;
    const action = this.template ? "pickup.inspection" : "pickup.handover";
    const fingerprint = JSON.stringify({ templateId: this.template?.id, results });
    const key = actionKey(action, this.data.id, fingerprint);
    this.setData({ busy: true, error: "" });
    let lockToken: string | undefined;
    try {
      const lock = await operationLock(this.data.id, { action: "acquire" });
      lockToken = lock.token;
      if (!lockToken) throw new Error("未取得交接操作锁，请稍后重试");
      if (this.template) await createInspection(this.data.id, { templateId: this.template.id, results }, { idempotencyKey: key, operationToken: lockToken });
      else await handover(this.data.id, "pickup", { idempotencyKey: key, operationToken: lockToken });
      releaseActionKey(action, this.data.id);
      toast("领取交接已完成", { icon: "success" });
      relaunch(buildUrl(ROUTES.order, { id: this.data.id }));
    } catch (caught) { this.setData({ error: describeError(caught).message }); }
    finally { if (lockToken) await operationLock(this.data.id, { action: "release", token: lockToken }).catch(() => undefined); this.setData({ busy: false }); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.pickup, { id: this.data.id }) })) void this.load(); }
});
