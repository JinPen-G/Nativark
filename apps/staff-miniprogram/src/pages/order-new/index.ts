import type { CreateRentalOrderRequest, RentalDeliveryAddressDraft, RentalFulfillmentMode, RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { listItemGroups } from "../../api/context";
import { createOrder, quoteOrder } from "../../api/orders";
import { loadContext, type WorkspaceContext } from "../../core/context";
import { describeError } from "../../core/errors";
import { actionKey, releaseActionKey } from "../../core/keys";
import { fulfillmentModeLabel } from "../../core/labels";
import { formatMoney } from "../../core/money";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { requireStaffAction } from "../../core/subscription-access";
import { todayInZone, zoneLabel, zonedToInstant } from "../../core/time";
import { ROUTES, buildUrl, confirmDialog, relaunch, toast } from "../../core/ui";

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState() as ViewState, itemLabel: "物品", customerType: "personal" as "personal" | "corporate", customerTypes: ["个人", "企业"], customerName: "", phone: "",
    groups: [] as Array<{ id: string; name: string }>, groupId: "", groupName: "", quantity: "1",
    locations: [] as Array<{ id: string; name: string; timezone: string }>, locationId: "", locationName: "", timeZone: "Asia/Shanghai", zoneHint: "",
    modes: [] as Array<{ code: RentalFulfillmentMode; label: string }>, mode: "" as RentalFulfillmentMode | "", modeLabel: "",
    needsAddress: false, addrRecipient: "", addrPhone: "", addrRegion: [] as string[], addrRegionText: "", addrDetail: "",
    startDate: "", startTime: "09:00", endDate: "", endTime: "18:00", today: "", quoteText: "", depositText: "", quoteNo: "", busy: false, error: ""
  },
  context: undefined as WorkspaceContext | undefined,
  quote: undefined as RentalQuoteSnapshotV1 | undefined,
  async onShow() {
    if (!isSignedIn()) { relaunch(ROUTES.login); return; }
    if (this.data.view.status !== "ready") { await this.load(); return; }
    try { await requireStaffAction("order.create"); }
    catch (error) { this.invalidate(); this.setData({ view: errorState(error) }); }
  },
  async load() {
    if (!can("rental-os:order:create")) { this.setData({ view: blockedState("无新建订单权限", "请联系管理员授权") }); return; }
    this.setData({ view: loadingState() });
    try {
      await requireStaffAction("order.create");
      const [context, groups] = await Promise.all([loadContext(), listItemGroups()]);
      this.context = context;
      const locations = context.locations.filter((row) => row.capabilities.includes("pickup")).map((row) => ({ id: row.id, name: row.name, timezone: row.timezone ?? "Asia/Shanghai" }));
      const selected = locations.find((row) => row.id === context.currentLocationId) ?? locations[0];
      const zone = selected?.timezone ?? "Asia/Shanghai";
      const today = todayInZone(zone);
      this.setData({ view: readyState(), itemLabel: context.terminology.itemLabel, groups: groups.filter((row) => row.status === "enabled").map((row) => ({ id: row.id, name: row.name })), locations, locationId: selected?.id ?? "", locationName: selected?.name ?? "", timeZone: zone, zoneHint: zoneLabel(zone), modes: context.fulfillmentModes.map((code) => ({ code, label: fulfillmentModeLabel(code) })), today, startDate: today, endDate: today, error: "" });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  invalidate() { this.quote = undefined; this.setData({ quoteText: "", depositText: "", quoteNo: "", error: "" }); },
  onInput(event: WechatMiniprogram.Input) { const field = String(event.currentTarget.dataset.field); this.setData({ [field]: String(event.detail.value ?? "") }); this.invalidate(); },
  onCustomerType(event: WechatMiniprogram.PickerChange) { this.setData({ customerType: Number(event.detail.value) === 1 ? "corporate" : "personal" }); this.invalidate(); },
  onGroup(event: WechatMiniprogram.PickerChange) { const row = this.data.groups[Number(event.detail.value)]; if (row) { this.setData({ groupId: row.id, groupName: row.name }); this.invalidate(); } },
  onLocation(event: WechatMiniprogram.PickerChange) { const row = this.data.locations[Number(event.detail.value)]; if (row) { this.setData({ locationId: row.id, locationName: row.name, timeZone: row.timezone, zoneHint: zoneLabel(row.timezone), today: todayInZone(row.timezone) }); this.invalidate(); } },
  onMode(event: WechatMiniprogram.PickerChange) { const row = this.data.modes[Number(event.detail.value)]; if (row) { const needsAddress = (row.code === "delivery" || row.code === "onsite_delivery") && this.context?.deliveryDestination === "customer_address"; this.setData({ mode: row.code, modeLabel: row.label, needsAddress }); this.invalidate(); } },
  onRegion(event: WechatMiniprogram.PickerChange) { const region = (event.detail.value as string[]) ?? []; this.setData({ addrRegion: region, addrRegionText: region.join(" ") }); this.invalidate(); },
  onDate(event: WechatMiniprogram.PickerChange) { const field = String(event.currentTarget.dataset.field); this.setData({ [field]: String(event.detail.value ?? "") }); this.invalidate(); },
  buildRequest() {
    const quantity = Number(this.data.quantity);
    if (!this.data.customerName.trim() || !this.data.groupId || !this.data.locationId || !this.data.mode) throw new Error("请填写客户、型号、地点和履约方式");
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error("数量必须为正整数");
    const startAt = zonedToInstant(this.data.startDate, this.data.startTime, this.data.timeZone);
    const endAt = zonedToInstant(this.data.endDate, this.data.endTime, this.data.timeZone);
    if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("结束时间必须晚于开始时间");
    return { customerType: this.data.customerType, fulfillmentMode: this.data.mode, fulfillmentLocationId: this.data.locationId, startAt, endAt, lines: [{ itemGroupId: this.data.groupId, quantity }] };
  },
  /** 代客建单的配送地址：customer_address 品类选配送/上门时必填，作为本单一次性草稿由服务端固化进报价快照（不写入地址簿）。自取模式不带地址。 */
  buildDelivery(): { deliveryAddressDraft?: RentalDeliveryAddressDraft } {
    if (!this.data.needsAddress) return {};
    const recipient = this.data.addrRecipient.trim();
    const phone = this.data.addrPhone.trim();
    const [province, city, district] = this.data.addrRegion;
    const detail = this.data.addrDetail.trim();
    if (!recipient || !phone || !province || !city || !detail) throw new Error("配送订单需填写收货人、电话、地区与详细地址");
    return { deliveryAddressDraft: { recipient, phone, province, city, district: district || undefined, detail } };
  },
  async onQuote() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try {
      const quote = await quoteOrder({ ...this.buildRequest(), ...this.buildDelivery() });
      this.quote = quote;
      this.setData({ quoteNo: quote.quoteNo, quoteText: formatMoney(quote.receivableAmount, quote.currency), depositText: formatMoney(quote.depositAmount, quote.currency) });
    } catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  async onCreate() {
    if (this.data.busy || !this.quote) return;
    let request: ReturnType<typeof this.buildRequest>;
    try { request = this.buildRequest(); } catch (error) { this.setData({ error: describeError(error).message }); return; }
    if (!await confirmDialog({ title: "创建订单", content: `服务端报价 ${this.data.quoteText}。确认以当前报价创建订单？` })) return;
    const input: CreateRentalOrderRequest = { ...request, quoteId: this.quote.id, customerName: this.data.customerName.trim(), contactPhone: this.data.phone.trim() || undefined };
    const key = actionKey("order.create", this.quote.id, JSON.stringify(input));
    this.setData({ busy: true, error: "" });
    try { const order = await createOrder(input, key); releaseActionKey("order.create", this.quote.id); toast("订单已创建", { icon: "success" }); relaunch(buildUrl(ROUTES.order, { id: order.id })); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: ROUTES.orderNew })) void this.load(); }
});
