import type { ClientCatalogLocation, ClientCatalogResponse, ClientCreateQuoteRequest, RentalCustomerCoupon, RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { createQuote, fetchCoupons, fetchQuote } from "../../api/catalog";
import { createOrder } from "../../api/orders";
import { fetchPaymentCapabilities } from "../../api/payments";
import { CartLocked, abandonSubmission, beginSubmission, bindQuote, cartMissing, completeSubmission, getCart, markSubmissionUnknown, quoteIsCurrent, removeLine, setLineQuantity, updateCart, type CartState } from "../../core/cart";
import { loadCatalog, primaryLocation } from "../../core/catalogStore";
import { formatRemaining, remainingMs } from "../../core/clock";
import { describeError } from "../../core/errors";
import { isApiError } from "../../core/http";
import { resolveImage } from "../../core/images";
import { chargeLabel, pricingUnitLabel } from "../../core/labels";
import { formatMoney, startingPriceParts } from "../../core/money";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { jsapiEnabled, offlineMethods } from "../../core/payment";
import { contextVersion, currentServiceCode, membershipStatus } from "../../core/session";
import { formatBusinessDate, formatBusinessTime, splitInstant, todayInZone, zoneLabel, zonedToInstant } from "../../core/time";
import { ROUTES, buildUrl, navigate, redirect, requireSignIn, toast } from "../../core/ui";
import { rememberZone, zoneOf } from "../../core/zones";

/**
 * P05 确认订单（V2 设计稿）：商品 → 租赁时间 → 取还方式 → 自提门店 → 优惠券 → 押金说明 → 备注 → 费用明细 → 确认预约。
 * 页面只渲染服务端报价快照；任何输入变化都会废弃旧报价重新请求。提交用持久化的幂等键；
 * 响应丢失时同键重放，绝不新键重试。没有可执行付款路径时在此阻断。
 */
interface LineRow {
  key: string;
  name: string;
  option: string;
  quantity: number;
  imageSource: string;
  imagePath: string;
  priceText: string;
  amount: number | undefined;
}

interface ChargeRow {
  code: string;
  label: string;
  amount: number;
}

interface CouponRow {
  id: string;
  name: string;
  summary: string;
  usable: boolean;
  reason: string;
}

interface CheckoutData {
  view: ViewState;
  cart?: CartState;
  quote?: RentalQuoteSnapshotV1;
  lines: LineRow[];
  timeZone: string;
  zoneNote: string;
  minDate: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  startText: string;
  endText: string;
  unitsText: string;
  showPeriodSheet: boolean;
  method: "pickup" | "delivery";
  locations: ClientCatalogLocation[];
  store?: ClientCatalogLocation;
  showStoreSheet: boolean;
  coupons: CouponRow[];
  couponText: string;
  showCouponSheet: boolean;
  services: Array<{ id: string; name: string; description: string; selected: boolean }>;
  memo: string;
  charges: ChargeRow[];
  benefits: Array<{ key: string; text: string; applied: boolean }>;
  currency: string;
  payable: number;
  deposit: number;
  preAuth: number;
  depositNote: string;
  quoteExpiresText: string;
  quoteExpired: boolean;
  quoteLoading: boolean;
  missing: string[];
  paymentNote: string;
  paymentBlocked: boolean;
  membershipBlocked: string;
  agreed: boolean;
  submitting: boolean;
  locked: boolean;
  formError: string;
  ruleVersion: string;
}

const DEFAULT_ZONE = "Asia/Shanghai";

Page({
  data: {
    view: loadingState(),
    lines: [],
    timeZone: DEFAULT_ZONE,
    zoneNote: "",
    minDate: "",
    startDate: "",
    startTime: "10:00",
    endDate: "",
    endTime: "10:00",
    startText: "",
    endText: "",
    unitsText: "",
    showPeriodSheet: false,
    method: "pickup",
    locations: [],
    showStoreSheet: false,
    coupons: [],
    couponText: "暂无可用优惠券",
    showCouponSheet: false,
    services: [],
    memo: "",
    charges: [],
    benefits: [],
    currency: "",
    payable: 0,
    deposit: 0,
    preAuth: 0,
    depositNote: "押金金额由商户规则决定，在下方费用明细中单独列出；本期押金在领取前与商户线下办理，归还并确认无损后原路退还。",
    quoteExpiresText: "",
    quoteExpired: false,
    quoteLoading: false,
    missing: [],
    paymentNote: "",
    paymentBlocked: false,
    membershipBlocked: "",
    agreed: false,
    submitting: false,
    locked: false,
    formError: "",
    ruleVersion: ""
  } as CheckoutData,

  catalog: undefined as ClientCatalogResponse | undefined,
  rawCoupons: [] as RentalCustomerCoupon[],
  ticker: undefined as number | undefined,
  requestVersion: 0,

  onLoad() {
    if (!requireSignIn(ROUTES.checkout)) return;
  },

  onShow() {
    void this.prepare();
    this.startTicker();
  },

  onHide() {
    this.stopTicker();
  },

  onUnload() {
    this.stopTicker();
  },

  startTicker() {
    this.stopTicker();
    this.ticker = setInterval(() => this.tick(), 1000) as unknown as number;
  },

  stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
  },

  tick() {
    const quote = this.data.quote;
    if (!quote) return;
    const remaining = remainingMs(quote.expiresAt);
    const expired = remaining !== undefined && remaining <= 0;
    this.setData({ quoteExpiresText: expired ? "报价已过期，请重新获取" : `报价有效期剩余 ${formatRemaining(remaining)}`, quoteExpired: expired });
  },

  /* ---------- 准备：清单、目录、能力 ---------- */
  async prepare() {
    const cart = getCart();
    if (!cart || cart.lines.length === 0) {
      this.setData({ view: blockedState("还没有选择设备", "从设备详情点“立即预约”把设备加入本次租赁。", "去选设备", "none") });
      return;
    }
    if (currentServiceCode() !== cart.serviceCode) {
      this.setData({ view: blockedState("服务不一致", `本次租赁属于“${cart.serviceName}”，请先在首页切换到该服务。`, "回首页", "none") });
      return;
    }
    const status = membershipStatus();
    if (status && status !== "active") {
      const reason = status === "pending_activation" ? "会员资料正在等待商户审核，审核通过后即可租赁；你可以先补充资料。" : "当前会员状态受限，暂不能提交新的租赁，请联系商户。";
      this.setData({ membershipBlocked: reason, view: blockedState("暂不能确认租赁", reason, status === "pending_activation" ? "补充资料" : "联系商户", status === "pending_activation" ? "qualifications" : "contact", "回首页") });
      return;
    }
    if (cart.submission) {
      // 结果未知的提交：先把当时的报价读出来供核对，再按同键重放拿结果，而不是再报价。
      this.setData({ view: loadingState(), locked: true, cart });
      try {
        const quote = await fetchQuote(cart.submission.quoteId);
        this.render(quote);
      } catch {
        // 报价读不到也要给出恢复入口。
      }
      await this.submit(true);
      return;
    }
    const version = contextVersion();
    if (!this.catalog) this.setData({ view: loadingState() });
    try {
      const [catalog] = await Promise.all([loadCatalog(cart.serviceCode, false), this.loadCoupons(), this.loadPaymentCapabilities()]);
      if (contextVersion() !== version) return;
      this.catalog = catalog;
      const timeZone = catalog.timeZone || zoneOf(cart.serviceCode) || DEFAULT_ZONE;
      rememberZone(cart.serviceCode, timeZone);
      this.applyCatalog(catalog, timeZone);
      this.syncFromCart(getCart());
      this.setData({ view: readyState() });
      if (quoteIsCurrent(getCart()) && this.data.quote?.id === getCart()?.quote?.id) {
        this.tick();
        return;
      }
      await this.requestQuote();
    } catch (error) {
      if (isApiError(error, "STALE_CONTEXT")) return;
      this.setData({ view: errorState(error, "回首页") });
    }
  },

  applyCatalog(catalog: ClientCatalogResponse, timeZone: string) {
    const locations = catalog.locations.filter((row) => row.status === "enabled" && (!row.capabilities || row.capabilities.includes("pickup")));
    this.setData({
      timeZone,
      zoneNote: zoneLabel(timeZone),
      minDate: todayInZone(timeZone),
      locations,
      services: catalog.services.filter((row) => row.enabled).map((row) => ({ id: row.id, name: row.name, description: row.description ?? "", selected: false }))
    });
    // 默认门店：清单未选时预选第一家可领取门店（服务端仍会校验）。
    const cart = getCart();
    if (cart && !cart.locationId) {
      const first = primaryLocation({ ...catalog, locations }) ?? locations[0];
      if (first) this.mutate((draft) => { draft.locationId = first.id; draft.locationName = first.name; });
    }
  },

  syncFromCart(cart: CartState | undefined) {
    if (!cart) return;
    const start = splitInstant(cart.startAt, this.data.timeZone);
    const end = splitInstant(cart.endAt, this.data.timeZone);
    const store = this.data.locations.find((row) => row.id === cart.locationId);
    const lines: LineRow[] = cart.lines.map((line) => {
      const item = this.catalog?.items.find((row) => row.id === line.itemGroupId);
      const price = startingPriceParts(item?.startingPrice, pricingUnitLabel);
      const previous = this.data.lines.find((row) => row.key === line.key);
      return {
        key: line.key,
        name: line.itemName,
        option: line.pricingGroupName ?? "",
        quantity: line.quantity,
        imageSource: line.imageSource ?? item?.images?.[0]?.url ?? "",
        imagePath: previous?.imagePath ?? "",
        priceText: price.available ? `${price.symbol}${price.number}${price.unit}` : "",
        amount: previous?.amount
      };
    });
    this.setData({
      cart,
      locked: Boolean(cart.submission),
      missing: cartMissing(cart),
      lines,
      startDate: start.date || this.data.startDate,
      startTime: start.time || this.data.startTime,
      endDate: end.date || this.data.endDate,
      endTime: end.time || this.data.endTime,
      startText: cart.startAt ? `${formatBusinessDate(cart.startAt, this.data.timeZone)} ${formatBusinessTime(cart.startAt, this.data.timeZone)}` : "",
      endText: cart.endAt ? `${formatBusinessDate(cart.endAt, this.data.timeZone)} ${formatBusinessTime(cart.endAt, this.data.timeZone)}` : "",
      method: "pickup",
      store,
      memo: cart.memo ?? "",
      services: this.data.services.map((row) => ({ ...row, selected: cart.services.some((item) => item.serviceId === row.id) })),
      couponText: cart.couponId ? this.data.coupons.find((row) => row.id === cart.couponId)?.name ?? "已选优惠券" : this.data.coupons.some((row) => row.usable) ? "有可用优惠券，点击选择" : "暂无可用优惠券"
    });
    const version = contextVersion();
    lines.forEach((line, index) => {
      if (!line.imageSource || line.imagePath) return;
      resolveImage(line.imageSource).then((path) => {
        if (path && contextVersion() === version && this.data.lines[index]?.key === line.key) this.setData({ [`lines[${index}].imagePath`]: path });
      });
    });
  },

  mutate(mutator: (draft: CartState) => void) {
    const cart = getCart();
    if (!cart) return;
    try {
      this.syncFromCart(updateCart(cart.serviceCode, cart.serviceName, mutator));
    } catch (error) {
      toast(error instanceof CartLocked ? error.message : describeError(error).message, { duration: 3000 });
    }
  },

  /* ---------- 商品行 ---------- */
  onIncrease(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "");
    const line = this.data.cart?.lines.find((row) => row.key === key);
    if (!line) return;
    this.changeQuantity(key, Math.min(99, line.quantity + 1));
  },

  onDecrease(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "");
    const line = this.data.cart?.lines.find((row) => row.key === key);
    if (!line) return;
    this.changeQuantity(key, line.quantity - 1);
  },

  changeQuantity(key: string, quantity: number) {
    const cart = getCart();
    if (!cart) return;
    try {
      const next = quantity < 1 ? removeLine(cart.serviceCode, cart.serviceName, key) : setLineQuantity(cart.serviceCode, cart.serviceName, key, quantity);
      this.syncFromCart(next);
      if (next.lines.length === 0) {
        this.setData({ quote: undefined, view: blockedState("还没有选择设备", "从设备详情点“立即预约”把设备加入本次租赁。", "去选设备", "none") });
        return;
      }
      void this.requestQuote();
    } catch (error) {
      toast(error instanceof CartLocked ? error.message : describeError(error).message, { duration: 3000 });
    }
  },

  onAddMore() {
    wx.switchTab({ url: ROUTES.catalog });
  },

  /* ---------- 租期 ---------- */
  onOpenPeriod() {
    if (this.data.locked) return;
    this.setData({ showPeriodSheet: true });
  },

  onClosePeriod() {
    this.setData({ showPeriodSheet: false });
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    const field = String(event.currentTarget.dataset.field) as "startDate" | "startTime" | "endDate" | "endTime";
    this.setData({ [field]: String(event.detail.value) });
  },

  onApplyPeriod() {
    const { startDate, startTime, endDate, endTime, timeZone } = this.data;
    if (!startDate || !endDate) {
      toast("请选择领取和归还日期");
      return;
    }
    let startAt: string;
    let endAt: string;
    try {
      startAt = zonedToInstant(startDate, startTime, timeZone);
      endAt = zonedToInstant(endDate, endTime, timeZone);
    } catch (error) {
      toast(error instanceof Error ? error.message : "时间无效");
      return;
    }
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      toast("归还时间必须晚于领取时间");
      return;
    }
    this.setData({ showPeriodSheet: false });
    this.mutate((draft) => {
      draft.startAt = startAt;
      draft.endAt = endAt;
    });
    void this.requestQuote();
  },

  /* ---------- 取还方式 / 门店 ---------- */
  onPickMethod(event: WechatMiniprogram.TouchEvent) {
    const method = String(event.currentTarget.dataset.method ?? "pickup");
    if (method === "delivery") {
      toast("同城配送尚未开通，当前请选择门店自提", { duration: 3000 });
      return;
    }
  },

  onOpenStore() {
    if (this.data.locked) return;
    this.setData({ showStoreSheet: true });
  },

  onCloseStore() {
    this.setData({ showStoreSheet: false });
  },

  onPickStore(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const store = this.data.locations.find((row) => row.id === id);
    if (!store) return;
    this.setData({ showStoreSheet: false });
    this.mutate((draft) => {
      draft.locationId = store.id;
      draft.locationName = store.name;
      draft.returnLocationId = undefined;
      draft.returnLocationName = undefined;
    });
    void this.requestQuote();
  },

  /* ---------- 优惠券 ---------- */
  async loadCoupons() {
    try {
      this.rawCoupons = await fetchCoupons();
    } catch {
      this.rawCoupons = [];
    }
    this.setData({ coupons: this.rawCoupons.map((coupon) => this.couponRow(coupon)) });
  },

  couponRow(coupon: RentalCustomerCoupon): CouponRow {
    const usable = coupon.status === "claimed" && Date.parse(coupon.effectiveTo) > Date.now();
    const currency = this.data.currency || undefined;
    const value = coupon.discountType === "percentage" ? `${coupon.discountValue}% 折扣` : formatMoney(coupon.discountValue, currency);
    const threshold = coupon.minimumSpend > 0 ? `，满 ${formatMoney(coupon.minimumSpend, currency)} 可用` : "";
    return {
      id: coupon.id,
      name: coupon.templateName,
      summary: `${value}${threshold}，有效期至 ${coupon.effectiveTo.slice(0, 10)}`,
      usable,
      reason: usable ? "" : coupon.status === "locked" ? "已被其他订单占用" : coupon.status === "redeemed" ? "已使用" : "已过期或不可用"
    };
  },

  onOpenCoupons() {
    if (this.data.locked) return;
    this.setData({ showCouponSheet: true });
  },

  onCloseCoupons() {
    this.setData({ showCouponSheet: false });
  },

  onPickCoupon(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const row = this.data.coupons.find((item) => item.id === id);
    if (id && (!row || !row.usable)) {
      toast(row?.reason ?? "该券不可用");
      return;
    }
    this.setData({ showCouponSheet: false });
    this.mutate((draft) => {
      draft.couponId = id || undefined;
    });
    void this.requestQuote();
  },

  /* ---------- 可选服务 / 备注 ---------- */
  onToggleService(event: WechatMiniprogram.TouchEvent) {
    if (this.data.locked) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    const row = this.data.services.find((item) => item.id === id);
    if (!row) return;
    this.mutate((draft) => {
      const index = draft.services.findIndex((item) => item.serviceId === id);
      if (index >= 0) draft.services.splice(index, 1);
      else draft.services.push({ serviceId: id, name: row.name, quantity: 1 });
    });
    void this.requestQuote();
  },

  onMemoInput(event: WechatMiniprogram.Input) {
    const memo = String(event.detail.value ?? "").slice(0, 100);
    this.setData({ memo });
  },

  onMemoBlur() {
    const cart = getCart();
    if (!cart || (cart.memo ?? "") === this.data.memo) return;
    // 备注只写入商品行 note；它不参与计价，但报价快照带着它，所以照样重报。
    this.mutate((draft) => {
      draft.memo = this.data.memo || undefined;
    });
    void this.requestQuote();
  },

  /* ---------- 支付能力 ---------- */
  async loadPaymentCapabilities() {
    try {
      const capabilities = await fetchPaymentCapabilities();
      const jsapi = jsapiEnabled(capabilities);
      const offline = offlineMethods(capabilities);
      if (jsapi && offline.length) this.setData({ paymentNote: "支持微信支付与线下付款；小程序内微信支付以付款页实际可用为准", paymentBlocked: false });
      else if (jsapi) this.setData({ paymentNote: "商户已配置微信支付；若小程序内付款尚未开通，付款页会提示联系商户线下付款", paymentBlocked: false });
      else if (offline.length) this.setData({ paymentNote: "商户当前仅支持线下付款（到店/转账），提交后按订单页说明与商户完成付款", paymentBlocked: false });
      else this.setData({ paymentNote: "商户尚未开通可用的付款方式，暂不能提交订单", paymentBlocked: true });
    } catch {
      this.setData({ paymentNote: "付款方式暂时无法核实，提交后以订单页显示为准", paymentBlocked: false });
    }
  },

  /* ---------- 报价 ---------- */
  buildRequest(cart: CartState): ClientCreateQuoteRequest {
    const note = cart.memo?.trim() || undefined;
    return {
      fulfillmentMode: "store_pickup_return",
      fulfillmentLocationId: cart.locationId!,
      startAt: cart.startAt!,
      endAt: cart.endAt!,
      customerCouponId: cart.couponId || undefined,
      lines: cart.lines.map((line) => ({ itemGroupId: line.itemGroupId, pricingGroupId: line.pricingGroupId, quantity: line.quantity, note })),
      services: cart.services.length ? cart.services.map((row) => ({ serviceId: row.serviceId, quantity: row.quantity })) : undefined
    };
  },

  async requestQuote() {
    const cart = getCart();
    if (!cart || cart.submission) return;
    const missing = cartMissing(cart);
    this.setData({ missing });
    if (missing.length) {
      this.setData({ quote: undefined, charges: [], benefits: [], payable: 0, deposit: 0, preAuth: 0, unitsText: "", quoteExpiresText: "", quoteExpired: false });
      return;
    }
    if (quoteIsCurrent(cart) && this.data.quote?.id === cart.quote?.id) return;
    const version = contextVersion();
    const token = ++this.requestVersion;
    this.setData({ quoteLoading: true, formError: "" });
    try {
      const quote = await createQuote(this.buildRequest(cart));
      if (token !== this.requestVersion || version !== contextVersion()) return;
      bindQuote(quote.id, quote.expiresAt);
      this.render(quote);
      this.setData({ cart: getCart() });
      this.tick();
    } catch (error) {
      if (token !== this.requestVersion || isApiError(error, "STALE_CONTEXT")) return;
      this.setData({ quote: undefined, charges: [], payable: 0, formError: `报价失败：${describeError(error).message}` });
    } finally {
      if (token === this.requestVersion) this.setData({ quoteLoading: false });
    }
  },

  render(quote: RentalQuoteSnapshotV1) {
    const currency = quote.currency ?? "";
    const lineAmounts = quote.rentalLineAmounts ?? {};
    const lines = this.data.lines.map((line) => {
      const cartLine = this.data.cart?.lines.find((row) => row.key === line.key);
      const key = cartLine?.pricingGroupId ?? cartLine?.itemGroupId ?? "";
      return { ...line, amount: key in lineAmounts ? lineAmounts[key] : undefined };
    });
    // 计费单位数来自服务端逐日快照（对同一商品求和），不是客户端按日期推算。
    const firstLine = quote.request.lines[0];
    const unitEntries = (quote.calendarSnapshot ?? []).filter((day) => day.itemGroupId === firstLine?.itemGroupId);
    const units = unitEntries.reduce((sum, day) => sum + (day.unitCount ?? 0), 0);
    const unit = quote.rateSnapshot?.[0]?.unit;
    const charges: ChargeRow[] = quote.chargeLines
      .filter((row) => row.type !== "deposit" && row.type !== "preauthorization")
      .map((row) => ({ code: row.code, label: row.name || chargeLabel(row.type), amount: row.amount }));
    const benefits: Array<{ key: string; text: string; applied: boolean }> = [];
    for (const evaluation of quote.membershipBenefitEvaluations ?? []) {
      const applied = evaluation.appliedAmount > 0 && evaluation.scopeMatched !== false && !evaluation.skippedReason;
      benefits.push({ key: `membership-${benefits.length}`, text: applied ? `${evaluation.planName}：${evaluation.detail}` : `${evaluation.planName}：${evaluation.skippedReason ?? "本次未适用"}`, applied });
    }
    for (const evaluation of quote.discountEvaluations ?? []) {
      benefits.push({ key: `discount-${evaluation.planId}`, text: evaluation.applied ? `${evaluation.planName}：减 ${formatMoney(evaluation.discountAmount, currency || undefined)}` : `${evaluation.planName}：${evaluation.skipDetail ?? "未应用"}`, applied: evaluation.applied });
    }
    if (quote.couponEvaluation) {
      benefits.push({ key: `coupon-${quote.couponEvaluation.couponId}`, text: `优惠券 ${quote.couponEvaluation.templateName}：减 ${formatMoney(quote.couponEvaluation.discountAmount, currency || undefined)}`, applied: quote.couponEvaluation.discountAmount > 0 });
    }
    const depositParts = [`应收押金 ${formatMoney(quote.depositAmount, currency || undefined)}`];
    if (quote.preAuthAmount > 0) depositParts.push(`应冻结预授权 ${formatMoney(quote.preAuthAmount, currency || undefined)}`);
    this.setData({
      quote,
      currency,
      lines,
      unitsText: units > 0 && unit ? `共 ${units} ${pricingUnitLabel(unit)}` : "",
      charges,
      benefits,
      payable: quote.payableAmount,
      deposit: quote.depositAmount,
      preAuth: quote.preAuthAmount,
      depositNote: `${depositParts.join("，")}。押金在领取前与商户线下办理，归还并确认无损后原路退还；不计入本次需支付的租赁款。`,
      ruleVersion: quote.ruleVersion,
      coupons: this.rawCoupons.map((coupon) => this.couponRow(coupon))
    });
  },

  onRequote() {
    const cart = getCart();
    if (cart) bindQuote("", new Date(0).toISOString());
    void this.requestQuote();
  },

  onAgreeChange(event: WechatMiniprogram.CheckboxGroupChange) {
    this.setData({ agreed: (event.detail.value as string[]).length > 0, formError: "" });
  },

  onOpenRules() {
    navigate(buildUrl(ROUTES.legal, { doc: "rental-rules", version: this.data.ruleVersion }));
  },

  /* ---------- 提交 ---------- */
  async onSubmit() {
    if (this.data.submitting) return;
    if (this.data.paymentBlocked) {
      this.setData({ formError: this.data.paymentNote });
      return;
    }
    if (this.data.missing.length) {
      this.setData({ formError: this.data.missing[0] });
      return;
    }
    if (!this.data.agreed) {
      this.setData({ formError: "请先阅读并同意租赁规则" });
      return;
    }
    const cart = getCart();
    if (!cart || !quoteIsCurrent(cart) || this.data.quoteExpired || !this.data.quote) {
      this.setData({ formError: "报价已失效，请重新获取报价后再提交" });
      return;
    }
    await this.submit(false);
  },

  /** replay=true 表示恢复一次结果未知的提交：同键同报价重放。 */
  async submit(replay: boolean) {
    const cart = getCart();
    if (!cart) return;
    let submission;
    try {
      submission = beginSubmission();
    } catch (error) {
      this.setData({ formError: error instanceof Error ? error.message : "无法提交", view: readyState() });
      return;
    }
    this.setData({ submitting: true, formError: "", cart: getCart(), locked: true, view: replay ? loadingState() : this.data.view });
    try {
      const result = await createOrder(submission.quoteId, submission.key);
      completeSubmission();
      toast(result.replayed ? "已找到你之前提交的订单" : "预约已提交", { icon: "success" });
      redirect(buildUrl(ROUTES.pay, { id: result.order.id, from: "checkout" }));
    } catch (error) {
      if (isApiError(error, "TIMEOUT") || isApiError(error, "NETWORK") || isApiError(error, "SERVER")) {
        markSubmissionUnknown();
        this.setData({ view: readyState(), formError: "提交结果未知：请点击“查询提交结果”，系统会用同一提交凭证核对，不会重复下单。" });
      } else if (isApiError(error, "CONFLICT")) {
        abandonSubmission();
        this.setData({ view: readyState(), formError: `${describeError(error).message} 请重新获取报价后确认。` });
      } else if (isApiError(error, "FORBIDDEN") || isApiError(error, "BAD_REQUEST") || isApiError(error, "NOT_FOUND")) {
        abandonSubmission();
        this.setData({ view: readyState(), formError: describeError(error).message });
      } else {
        this.setData({ view: readyState(), formError: describeError(error).message });
      }
    } finally {
      const latest = getCart();
      this.setData({ submitting: false, cart: latest, locked: Boolean(latest?.submission) });
    }
  },

  onRecover() {
    void this.submit(true);
  },

  onViewAction() {
    const view = this.data.view;
    if (view.next === "qualifications") {
      navigate(ROUTES.qualifications);
      return;
    }
    if (handleCommonViewAction(view, { redirect: ROUTES.checkout })) return;
    if (view.actionText === "去选设备" || view.actionText === "回首页") wx.switchTab({ url: view.actionText === "回首页" ? ROUTES.home : ROUTES.catalog });
    else void this.prepare();
  },

  onViewSecondary() {
    wx.switchTab({ url: ROUTES.home });
  }
});
