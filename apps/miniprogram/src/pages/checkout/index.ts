import type { AiBookingSubmissionAcceptance, ClientCatalogLocation, ClientCatalogResponse, ClientCreateQuoteRequest, ClientDeliveryAddressView, EnterpriseOwnRentalPolicy, EnterpriseBookingApprovalView, EnterpriseApprovalOriginalResult, RentalCustomerCoupon, RentalFulfillmentMode, RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { listAddresses } from "../../api/addresses";
import { fetchEnterpriseRentalPolicies, fetchEnterpriseApprovals, requestEnterpriseApproval, submitEnterpriseApproval, readEnterpriseOperation, readEnterpriseApprovalResult, createEnterpriseOrder, readEnterpriseOrderOriginal } from "../../api/enterprise";
import { newKey } from "../../core/keys";
import { STORAGE_KEYS, readStorage, writeRequiredStorage, removeStorage } from "../../core/storage";
import { createQuote, fetchCoupons, fetchQuote } from "../../api/catalog";
import { createOrder, readBookingHostCapabilities } from "../../api/orders";
import { fetchPaymentCapabilities } from "../../api/payments";
import { CartLocked, abandonSubmission, beginSubmission, bindQuote, cartMissing, completeSubmission, getCart, isDeliveryMode, markSubmissionUnknown, quoteIsCurrent, removeLine, setLineQuantity, updateCart, type CartState } from "../../core/cart";
import { catalogPricingUnitLabel, loadCatalog, primaryLocation } from "../../core/catalogStore";
import { formatRemaining, remainingMs, serverNow } from "../../core/clock";
import { describeError } from "../../core/errors";
import { isApiError } from "../../core/http";
import { chargeLabel } from "../../core/labels";
import { formatMoney, startingPriceParts } from "../../core/money";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { jsapiEnabled, offlineMethods } from "../../core/payment";
import { contextVersion, currentServiceCode, currentSession, membershipStatus, sessionEvents } from "../../core/session";
import { PUBLIC_CONFIG } from "../../config/public";
import { createCustomerBookingConsumer, type CustomerBookingHost, type CustomerHandoffView } from "../../components/ai-native/booking-handoff";
import { createCustomerBookingHostFactory, type CustomerBookingPublication } from "../../components/ai-native/booking-host.factory";
import { cachedMerchant } from "../../core/merchant";
import { formatBusinessDate, formatBusinessTime, splitInstant, todayInZone, zoneLabel, zonedToInstant } from "../../core/time";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, navigate, redirect, requireSignIn, toast } from "../../core/ui";
import { rememberZone, zoneOf } from "../../core/zones";
import { clientQuoteStorageKey } from "../../components/ai-native/client-quote-session";

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
  aiQuoteActive: boolean;
  aiQuotePendingCore: boolean;
  aiQuoteSelection: ClientCreateQuoteRequest | null;
  aiQuoteScopeKey: string;
  aiQuoteTimeZone: string;
  enterprisePolicies: EnterpriseOwnRentalPolicy[];
  enterpriseIndex: number;
  enterpriseLabel: string;
  enterprisePayer: boolean;
  enterpriseNotice: string;
  enterpriseAccepted: boolean;
  enterpriseError: string;
  enterprisePurpose: string;
  enterpriseApproval?: EnterpriseBookingApprovalView;
  enterprisePending: boolean;
  enterpriseBusy: boolean;
  aiHandoffInput: string;
  aiHandoffOffered: boolean;
  aiHandoffOpening: boolean;
  aiHandoffPending: boolean;
  aiEnabled: boolean;
  aiStatus: CustomerHandoffView["status"];
  aiReference: string;
  aiRevision: number;
  aiExpiresAt: string;
  aiQuoteId: string;
  aiLocationId: string;
  aiSelection: { itemGroupId: string; quantity: number }[];
  aiOriginalLines: { itemGroupId: string; quantity: number; pricingUnit: string; usageQuantity: string }[];
  aiIdentityLabel: string;
  aiFulfillmentLabel: string;
  aiEnterpriseNotice: string;
  aiEnterpriseApprovalRequired: boolean;
  aiSubmissionAvailable: boolean;
  aiReceiptAvailable: boolean;
  aiOrderId: string;
  aiReceiptStatus: string;
  aiReadOnly: boolean;
  aiReceiptLookup: string;
  aiReceiptOpening: boolean;
  aiReceiptError: string;
  view: ViewState;
  cart?: CartState;
  quote?: RentalQuoteSnapshotV1;
  /** 头部信息（需求 §7.1）：商户 / 服务 / 使用人（本人姓名 + 脱敏手机号）。 */
  merchantName: string;
  serviceName: string;
  userName: string;
  userPhone: string;
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
  pickupActionLabel: string;
  returnActionLabel: string;
  pickupModeLabel: string;
  deliveryModeLabel: string;
  pickupLocationLabel: string;
  deliveryLocationLabel: string;
  deliveryAvailable: boolean;
  addresses: ClientDeliveryAddressView[];
  showAddressSheet: boolean;
  addressesLoading: boolean;
  addressesError: string;
  addressLabel: string;
  locations: ClientCatalogLocation[];
  store?: ClientCatalogLocation;
  showStoreSheet: boolean;
  /** 异地归还（需求 §6.4 / MP-06）：可归还门店列表、当前归还门店与选择弹层；未选时归还＝取货门店。 */
  returnLocations: ClientCatalogLocation[];
  returnStore?: ClientCatalogLocation;
  showReturnSheet: boolean;
  returnLabel: string;
  coupons: CouponRow[];
  couponText: string;
  couponsError: boolean;
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
  behaviors: [themeBehavior],
  data: {
    aiQuoteActive: false, aiQuotePendingCore: false, aiQuoteSelection: null, aiQuoteScopeKey: '', aiQuoteTimeZone: '',
    aiOriginalLines: [], aiIdentityLabel: '', aiFulfillmentLabel: '', aiEnterpriseNotice: '', aiEnterpriseApprovalRequired: false,
    enterprisePolicies: [], enterpriseIndex: -1, enterpriseLabel: "个人签约付款", enterprisePayer: false,
    enterpriseNotice: "", enterpriseAccepted: false, enterpriseError: "", enterprisePurpose: "", enterprisePending: false, enterpriseBusy: false,
    aiHandoffInput: "",
    aiHandoffOffered: false,
    aiHandoffOpening: false,
    aiHandoffPending: false,
    aiEnabled: false,
    aiStatus: "disabled",
    aiReference: "",
    aiRevision: 0,
    aiExpiresAt: "",
    aiQuoteId: "",
    aiLocationId: "",
    aiSelection: [],
    aiSubmissionAvailable: false,
    aiReceiptAvailable: false,
    aiOrderId: "",
    aiReceiptStatus: "none",
    aiReadOnly: false,
    aiReceiptLookup: "",
    aiReceiptOpening: false,
    aiReceiptError: "",
    view: loadingState(),
    merchantName: "",
    serviceName: "",
    userName: "",
    userPhone: "",
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
    pickupActionLabel: "领取",
    returnActionLabel: "归还",
    pickupModeLabel: "领取",
    deliveryModeLabel: "配送",
    pickupLocationLabel: "领取地点",
    deliveryLocationLabel: "配送地点",
    deliveryAvailable: false,
    addresses: [],
    showAddressSheet: false,
    addressesLoading: false,
    addressesError: "",
    addressLabel: "",
    locations: [],
    showStoreSheet: false,
    returnLocations: [],
    showReturnSheet: false,
    returnLabel: "与领取地点相同",
    coupons: [],
    couponText: "暂无可用优惠券",
    couponsError: false,
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
    ruleVersion: "",
    themeStyle: ""
  } as CheckoutData,

  catalog: undefined as ClientCatalogResponse | undefined,
  rawCoupons: [] as RentalCustomerCoupon[],
  deliveryMode: "delivery" as RentalFulfillmentMode,
  /** 当前服务所有已启用地点；按取送方式再筛出可领取（pickup）或可发货（delivery）的门店。 */
  allLocations: [] as ClientCatalogLocation[],
  ticker: undefined as number | undefined,
  requestVersion: 0,
  enterpriseOperation: undefined as { key: string; version: number; quoteId: string; approvalId?: string; kind?: "request" | "submit" | "order"; viewEpoch?: number; customerId: string; serviceCode: string } | undefined,
  enterpriseReading: false,
  enterpriseViewEpoch: 0,
  enterprisePolicyReadVersion: 0,
  enterpriseStorageKey() { return `${STORAGE_KEYS.enterpriseOperations}:${PUBLIC_CONFIG.tenantCode}:${currentSession()?.customer.customerId ?? ""}:${currentServiceCode()}`; },
  enterpriseCurrent(operation: { version: number; viewEpoch?: number; customerId: string; serviceCode: string }) {
    return this.aiVisible && !this.aiDisposed && (operation.viewEpoch === undefined || operation.viewEpoch === this.enterpriseViewEpoch) && operation.version === contextVersion()
      && operation.customerId === currentSession()?.customer.customerId && operation.serviceCode === currentServiceCode();
  },
  // Functions/hosts are instance-owned only, never setData, storage or event detail.
  aiHost: undefined as CustomerBookingHost | undefined,
  aiConsumer: undefined as ReturnType<typeof createCustomerBookingConsumer> | undefined,
  aiAcceptance: undefined as AiBookingSubmissionAcceptance | undefined,
  aiMode: false,
  aiVisible: false,
  aiDisposed: false,
  aiUnsubscribe: undefined as (() => void) | undefined,
  aiFactory: undefined as ReturnType<typeof createCustomerBookingHostFactory> | undefined,
  aiBindingEpoch: 0,
  aiPendingHandoffRef: undefined as string | undefined,
  aiOffHandoff: undefined as (() => void) | undefined,
  aiOpeningGeneration: 0,
  aiQuoteMode: false,
  hasOriginalQuotePreparation() {
    const session = currentSession();
    if (!session || session.customer.customerType !== 'personal') return false;
    const key = clientQuoteStorageKey({ tenantCode: PUBLIC_CONFIG.tenantCode, serviceCode: session.serviceCode,
      customerId: session.customer.customerId, surface: 'client_miniprogram' });
    try { const value: unknown = wx.getStorageSync(key); return value !== '' && value !== null && value !== undefined; }
    catch { return this.aiQuoteMode; }
  },
  syncQuotePreparation(cart: CartState | undefined) {
    if (this.data.aiHandoffPending) {
      this.setData({ aiQuoteActive: false, aiQuoteSelection: null }); return;
    }
    const personal = cart?.bookingIdentity?.bookingIdentity !== 'enterprise_employee' && currentSession()?.customer.customerType === 'personal';
    if (!personal) this.aiQuoteMode = false;
    else if (this.hasOriginalQuotePreparation()) this.aiQuoteMode = true;
    const selection = personal && cart && cartMissing(cart).length === 0 && !cart.submission ? this.buildRequest(cart) : null;
    this.setData({ aiQuoteActive: personal && this.aiQuoteMode, aiQuoteSelection: selection,
      aiQuoteTimeZone: this.catalog?.timeZone ?? '',
      aiQuoteScopeKey: JSON.stringify([contextVersion(), currentServiceCode(), cart?.revision, personal]) });
  },
  async onQuoteBookingHandoff(event: WechatMiniprogram.CustomEvent<{ handoffRef: string }>) {
    const reference = event.detail.handoffRef, version = contextVersion(), attempt = ++this.aiOpeningGeneration;
    if (this.aiDisposed || !this.aiVisible || this.aiMode || !/^[a-f0-9-]{36}$/iu.test(reference)) return;
    this.requestVersion++; this.aiPendingHandoffRef = reference;
    this.setData({ aiHandoffInput: reference, aiHandoffOffered: true, aiHandoffPending: true });
    try {
      const publication = await readBookingHostCapabilities();
      if (this.aiDisposed || !this.aiVisible || version !== contextVersion() || attempt !== this.aiOpeningGeneration) return;
      if (!await this.attachPublishedBooking(publication, reference)) toast('原预约入口暂不可用，请保留原交接引用');
    } catch { if (!this.aiDisposed && this.aiVisible && version === contextVersion()) toast('原预约交接待核对，不重建报价'); }
  },
  onQuotePreparationMode(event: WechatMiniprogram.CustomEvent<{ active: boolean; hasLocator: boolean; pendingCore: boolean }>) {
    if (this.aiMode || this.aiDisposed || !this.aiVisible) return;
    this.aiQuoteMode = event.detail.active || event.detail.hasLocator;
    this.requestVersion++;
    this.setData({ aiQuoteActive: this.aiQuoteMode, aiQuotePendingCore: event.detail.pendingCore, quote: undefined, quoteLoading: false });
    if (!this.aiQuoteMode) void this.requestQuote();
  },

  onHandoffReferenceInput(event: WechatMiniprogram.Input) {
    if (this.aiDisposed || this.data.aiHandoffOpening || this.aiMode) return;
    const reference = event.detail.value.trim();
    this.aiPendingHandoffRef = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(reference) ? reference : undefined;
    if (this.aiPendingHandoffRef) { this.requestVersion++; this.stopTicker(); }
    this.setData({ aiHandoffInput: reference, aiHandoffOffered: Boolean(this.aiPendingHandoffRef),
      ...(this.aiPendingHandoffRef ? { aiHandoffPending: true, quoteLoading: false } : {}) });
  },

  onContinueOrdinaryBooking() {
    if (this.aiDisposed || !this.aiVisible || this.aiMode || this.data.aiHandoffOpening) return;
    this.aiOpeningGeneration++; this.aiPendingHandoffRef = undefined;
    this.setData({ aiHandoffPending: false, aiHandoffInput: '', aiHandoffOffered: false });
    // Explicit return to the ordinary cart. No original AI quote, Draft,
    // handoff, acceptance or unknown receipt is overwritten or redispatched.
    void this.prepare(); void this.loadEnterprisePolicies(); this.startTicker();
  },

  async onOpenPublishedBooking() {
    if (this.aiDisposed || !this.aiVisible || this.data.aiHandoffOpening || !this.aiPendingHandoffRef || getCart()?.submission) return;
    const reference = this.aiPendingHandoffRef, epoch = this.aiBindingEpoch, version = contextVersion();
    const attempt = ++this.aiOpeningGeneration;
    this.setData({ aiHandoffOpening: true });
    try {
      const publication = await readBookingHostCapabilities();
      if (this.aiDisposed || !this.aiVisible || attempt !== this.aiOpeningGeneration || epoch !== this.aiBindingEpoch || version !== contextVersion()
        || publication.surface !== 'client_miniprogram' || publication.channel !== 'wechat_miniprogram'
        || publication.enabled !== true) return;
      if (!await this.attachPublishedBooking(publication, reference)) toast('AI草稿不可用，请继续人工办理');
    } catch { if (!this.aiDisposed && this.aiVisible && attempt === this.aiOpeningGeneration) toast('AI入口尚不可用，未提交订单'); }
    finally { if (!this.aiDisposed && attempt === this.aiOpeningGeneration) this.setData({ aiHandoffOpening: false }); }
  },

  onReceiptLookupInput(event: WechatMiniprogram.Input) {
    if (!this.data.aiReceiptOpening) this.setData({ aiReceiptLookup: event.detail.value.slice(0, 36), aiReceiptError: "" });
  },

  async onOpenOriginalReceipt() {
    if (this.aiDisposed || !this.aiVisible || this.data.aiReceiptOpening || this.data.submitting
      || (!this.aiMode && (this.data.locked || getCart()?.submission))) return;
    const reference = this.data.aiReceiptLookup.trim();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(reference)) {
      this.setData({ aiReceiptError: "请输入原预约交接引用" }); return;
    }
    const epoch = ++this.aiBindingEpoch;
    this.aiFactory?.dispose();
    if (this.aiMode) {
      this.aiConsumer?.destroy(); this.aiConsumer = undefined; this.aiHost = undefined; this.aiAcceptance = undefined;
      this.clearBookingHandoff();
    }
    const owner = createCustomerBookingHostFactory("server", "receipt_only");
    this.aiFactory = owner;
    this.setData({ aiReceiptOpening: true, aiReceiptError: "" });
    try {
      const host = await owner.openFromUser(reference);
      if (this.aiDisposed || !this.aiVisible || this.aiBindingEpoch !== epoch || this.aiFactory !== owner) { owner.dispose(); return; }
      if (!host) { this.setData({ aiReceiptError: "当前无法读取原预约，请核对登录、服务及商户是否开放读取" }); return; }
      this.attachHost(host);
      await this.aiConsumer?.reconcile();
    } finally {
      if (!this.aiDisposed && this.aiVisible && this.aiBindingEpoch === epoch) this.setData({ aiReceiptOpening: false });
    }
  },

  // Called explicitly by a trusted published entry, never from route parameters.
  // The publication is client isolation input; the factory/server reauthorize it.
  async attachPublishedBooking(publication: CustomerBookingPublication | null, handoffRef: string) {
    if (this.aiDisposed || !this.aiVisible || !publication) return false;
    const epoch = ++this.aiBindingEpoch;
    this.aiFactory?.dispose(); this.aiConsumer?.destroy();
    this.aiConsumer = undefined; this.aiHost = undefined; this.aiAcceptance = undefined;
    // Do not blank or lock the ordinary booking form while capabilities are
    // still being checked. A failed AI connection must preserve manual work.
    const hadAiHost = this.aiMode;
    this.aiMode = false;
    if (hadAiHost) { this.requestVersion++; this.clearBookingHandoff(); void this.prepare(); this.startTicker(); }
    const owner = createCustomerBookingHostFactory(publication);
    this.aiFactory = owner;
    let host: CustomerBookingHost | null;
    try { host = await owner.openFromUser(handoffRef); }
    catch { owner.dispose(); if (this.aiFactory === owner) this.aiFactory = undefined; return false; }
    if (this.aiDisposed || !this.aiVisible || this.aiBindingEpoch !== epoch || this.aiFactory !== owner) {
      owner.dispose(); return false;
    }
    if (!host) { owner.dispose(); this.aiFactory = undefined; return false; }
    this.attachHost(host);
    return true;
  },

  attachHost(host: CustomerBookingHost) {
    if (this.aiDisposed || !this.aiVisible) { host?.dispose?.(); return; }
    if (!host || host.enabled !== true || !(host.isCurrent?.() ?? true)) { if (this.aiMode) this.detachHost(); return; }
    this.aiConsumer?.destroy();
    this.aiAcceptance = undefined;
    this.aiHost = host ? { ...host, capability: { ...host.capability } } : undefined;
    this.aiMode = host?.enabled === true;
    this.requestVersion++;
    this.stopTicker();
    this.clearBookingHandoff();
    if (this.aiMode && this.aiVisible) this.bindBookingHandoff();
  },

  detachHost() {
    if (this.aiDisposed) return;
    this.aiBindingEpoch++; this.aiFactory?.dispose(); this.aiFactory = undefined;
    this.aiConsumer?.destroy(); this.aiConsumer = undefined; this.aiHost = undefined;
    this.aiAcceptance = undefined;
    this.aiMode = false; this.requestVersion++; this.clearBookingHandoff();
  },

  clearBookingHandoff() {
    this.setData({ aiEnabled: this.aiMode && Boolean(this.aiHost), aiReadOnly: this.aiHost?.mode === "receipt_only", aiStatus: this.aiMode ? "unavailable" : "disabled", aiReference: "", aiRevision: 0,
      aiSubmissionAvailable: false, aiReceiptAvailable: false, aiOrderId: "", aiReceiptStatus: "none",
      aiExpiresAt: "", aiQuoteId: "", aiLocationId: "", aiSelection: [], quote: undefined, charges: [], benefits: [], cart: undefined,
      aiOriginalLines: [], aiIdentityLabel: '', aiFulfillmentLabel: '', aiEnterpriseNotice: '', aiEnterpriseApprovalRequired: false,
      lines: [], payable: 0, deposit: 0, preAuth: 0, currency: "", agreed: false, startText: "", endText: "",
      locked: this.aiMode && Boolean(this.aiHost), view: this.aiMode ? readyState() : loadingState() });
  },

  bindBookingHandoff() {
    this.aiConsumer?.destroy();
    if (!this.aiHost) return;
    this.aiConsumer = createCustomerBookingConsumer(this.aiHost, () => ({ tenantCode: PUBLIC_CONFIG.tenantCode,
      serviceCode: currentServiceCode(), customerId: currentSession()?.customer.customerId ?? "", version: contextVersion() }),
    fetchQuote, view => { if (this.aiVisible) this.applyBookingHandoff(view); }, serverNow, this.aiAcceptance);
    this.setData({ aiEnabled: true, aiReadOnly: this.aiHost.mode === "receipt_only", aiReference: this.aiHost.handoffRef,
      aiStatus: this.aiAcceptance || this.aiHost.mode === "receipt_only" ? "pending_reconcile" : "idle",
      aiReceiptAvailable: typeof this.aiHost.readBookingSubmission === "function"
        && (Boolean(this.aiAcceptance) || typeof this.aiHost.readBookingAcceptance === "function"),
      aiSubmissionAvailable: this.aiHost.mode === "interactive"
        && [this.aiHost.acceptBookingSubmission, this.aiHost.submitAcceptedBooking, this.aiHost.readBookingSubmission]
          .every(method => typeof method === "function"), view: readyState() });
  },

  applyBookingHandoff(view: CustomerHandoffView) {
    const h = view.handoff, quote = view.quote;
    const start = h && view.status === "continued" ? splitInstant(h.fields.startAt, h.fields.timeZone) : undefined;
    const end = h && view.status === "continued" ? splitInstant(h.fields.endAt, h.fields.timeZone) : undefined;
    this.setData({ aiStatus: view.status, aiReference: h?.handoffRef ?? this.aiHost?.handoffRef ?? "", aiRevision: h?.revision ?? 0,
      aiSubmissionAvailable: view.submissionAvailable === true, aiReceiptAvailable: view.receiptAvailable === true, aiOrderId: view.receipt?.state === "observed" ? view.receipt.orderId : "",
      aiReceiptStatus: view.receipt?.state ?? "none", ruleVersion: quote?.ruleVersion ?? "",
      aiExpiresAt: h?.expiresAt ?? "", aiQuoteId: h?.fields.quoteId ?? "", aiSelection: h?.fields.lines ?? [],
      aiOriginalLines: quote?.request.lines.map(line => ({ itemGroupId: line.itemGroupId ?? '未记录商品', quantity: line.quantity,
        pricingUnit: line.pricingUnit ?? '', usageQuantity: line.usageQuantity === undefined ? '' : String(line.usageQuantity) })) ?? [],
      aiIdentityLabel: h?.fields.bookingIdentity.bookingIdentity === 'enterprise_employee'
        ? `${h.fields.bookingIdentity.corporateCustomerId} · ${h.fields.bookingIdentity.enterpriseContractAndPayer ? '企业签约付款' : '企业优惠个人付款'}` : '个人签约付款',
      aiEnterpriseNotice: quote?.membershipSnapshot?.enterpriseBasis
        ? `原告知版本：${quote.membershipSnapshot.enterpriseBasis.noticeVersion}；原已确认时间：${quote.membershipSnapshot.enterpriseBasis.acknowledgedAt}` : '',
      aiEnterpriseApprovalRequired: h?.fields.bookingIdentity.enterpriseContractAndPayer === true
        && quote?.membershipSnapshot?.enterpriseBasis?.approvalMode === 'per_order',
      aiFulfillmentLabel: h ? ({ store_pickup_return: '门店自取', partner_pickup_return: '合作点自取', warehouse_pickup_return: '仓库自取',
        locker_pickup_return: '柜机自取', delivery: '配送', onsite_delivery: '送达现场', carrier_shipping: '承运寄送' } as Record<string, string>)[h.fields.fulfillmentMode] ?? h.fields.fulfillmentMode : '',
      startText: h?.fields.startAt ?? "", endText: h?.fields.endAt ?? "", timeZone: h?.fields.timeZone ?? DEFAULT_ZONE,
      startDate: start?.date ?? "", startTime: start?.time ?? "", endDate: end?.date ?? "", endTime: end?.time ?? "",
      aiLocationId: h?.fields.fulfillmentLocationId ?? "", store: undefined,
      returnLabel: h?.fields.returnLocationId ?? "与领取地点相同", addressLabel: h?.fields.deliveryAddressId ?? "",
      method: h && isDeliveryMode(h.fields.fulfillmentMode) ? "delivery" : "pickup",
      currency: quote?.currency ?? "", payable: quote?.payableAmount ?? 0, deposit: quote?.depositAmount ?? 0,
      preAuth: quote?.preAuthAmount ?? 0, quote: quote ?? undefined, locked: true });
  },

  onReadBookingHandoff() { return this.aiVisible && this.aiMode ? this.aiConsumer?.read() : undefined; },
  onContinueBookingHandoff() { return this.aiVisible && this.aiMode ? this.aiConsumer?.continue() : undefined; },
  async onAcceptBookingSubmission() {
    if (!this.aiVisible || !this.aiMode || !this.data.agreed || this.data.aiEnterpriseApprovalRequired) {
      if (this.aiVisible && this.aiMode) this.setData({ formError: "请先阅读并同意原租赁规则" });
      return;
    }
    await this.aiConsumer?.accept();
    if (this.aiVisible && !this.aiDisposed) this.aiAcceptance = this.aiConsumer?.snapshotAcceptance();
  },
  onSubmitAcceptedBooking() {
    return this.aiVisible && this.aiMode && this.data.agreed && !this.data.aiEnterpriseApprovalRequired ? this.aiConsumer?.submit() : undefined;
  },
  onReadBookingSubmission() { return this.aiVisible && this.aiMode ? this.aiConsumer?.reconcile() : undefined; },
  onOpenAiOrder() {
    if (this.aiVisible && this.aiMode && this.data.aiStatus === "order_observed" && this.data.aiOrderId) {
      navigate(buildUrl(ROUTES.order, { id: this.data.aiOrderId }));
    }
  },

  onLoad(options: Record<string, string | undefined> = {}) {
    // This fixed route marker only suppresses ordinary cart writes while the
    // original locator is offered. It cannot enable or authorize an AI host.
    if (options.entry === 'original_booking_handoff') this.setData({ aiHandoffPending: true });
    // Native event channel carries a reference only, never functions, scope or
    // an enable flag. No AI read happens until the human presses the button.
    const channel = (this as unknown as { getOpenerEventChannel?: () => {
      on(name: string, handler: (value: unknown) => void): void;
      off(name: string, handler: (value: unknown) => void): void;
    } }).getOpenerEventChannel?.();
    const offer = (value: unknown) => {
      const ref = value && typeof value === 'object' && 'handoffRef' in value ? value.handoffRef : undefined;
      if (this.aiDisposed || this.aiMode || typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(ref)) return;
      this.aiOpeningGeneration++; this.aiBindingEpoch++;
      this.aiFactory?.dispose(); this.aiFactory = undefined;
      this.aiPendingHandoffRef = ref;
      this.requestVersion++;
      this.setData({ aiHandoffInput: ref, aiHandoffOffered: true, aiHandoffOpening: false, aiHandoffPending: true });
    };
    if (typeof channel?.on === 'function' && typeof channel.off === 'function') {
      channel.on('ai-booking-handoff', offer);
      this.aiOffHandoff = () => channel.off('ai-booking-handoff', offer);
    }
    this.aiUnsubscribe?.();
    this.aiUnsubscribe = sessionEvents.on(event => {
      if (event.type === "refreshed" && !this.aiMode) return;
      this.selectComponent('#client-quote-preparation')?.invalidateQuote?.();
      this.aiQuoteMode = false;
      this.aiOpeningGeneration++; this.aiPendingHandoffRef = undefined;
      this.setData({ aiHandoffOpening: false, aiHandoffInput: '', aiHandoffOffered: false });
      if (!this.aiMode) {
        this.requestVersion++; this.enterpriseOperation = undefined;
        this.setData({ enterprisePolicies: [], enterpriseIndex: -1, enterpriseLabel: "个人签约付款", enterpriseAccepted: false, enterpriseApproval: undefined,
          enterprisePending: false, enterpriseBusy: false, enterpriseError: "客户身份已变化，请重新读取企业授权", quote: undefined });
        return;
      }
      this.aiBindingEpoch++; this.aiFactory?.dispose(); this.aiFactory = undefined;
      this.aiConsumer?.destroy(); this.aiConsumer = undefined; this.aiHost = undefined;
      this.aiAcceptance = undefined;
      this.setData({ aiReceiptLookup: "", aiReceiptOpening: false, aiReceiptError: "" });
      if (!this.aiMode) return;
      this.requestVersion++; this.stopTicker(); this.clearBookingHandoff();
    });
    if (!requireSignIn(ROUTES.checkout)) return;
  },

  onShow() {
    this.enterpriseViewEpoch++;
    this.aiVisible = true;
    this.syncQuotePreparation(getCart());
    if (this.aiMode) {
      this.clearBookingHandoff(); this.bindBookingHandoff();
      const original = readStorage<typeof this.enterpriseOperation>(this.enterpriseStorageKey());
      this.enterpriseOperation = original && original.customerId === currentSession()?.customer.customerId && original.serviceCode === currentServiceCode()
        ? { ...original, version: contextVersion(), viewEpoch: this.enterpriseViewEpoch } : undefined;
      this.setData({ enterprisePending: Boolean(this.enterpriseOperation), enterpriseBusy: false });
      return;
    }
    if (this.data.aiHandoffPending || this.aiPendingHandoffRef) {
      this.requestVersion++; this.stopTicker(); this.setData({ view: readyState(), quoteLoading: false });
      return;
    }
    const original = readStorage<typeof this.enterpriseOperation>(this.enterpriseStorageKey()) ?? readStorage<typeof this.enterpriseOperation>(STORAGE_KEYS.enterpriseOperations);
    this.enterpriseOperation = original && original.customerId === currentSession()?.customer.customerId && original.serviceCode === currentServiceCode() ? { ...original, version: contextVersion(), viewEpoch: this.enterpriseViewEpoch } : undefined;
    this.setData({ enterprisePending: Boolean(this.enterpriseOperation), enterpriseBusy: false });
    void this.prepare();
    void this.loadEnterprisePolicies();
    this.startTicker();
  },

  onHide() {
    this.selectComponent('#client-quote-preparation')?.invalidateQuote?.();
    this.enterpriseViewEpoch++;
    this.aiOpeningGeneration++; this.setData({ aiHandoffOpening: false });
    this.aiBindingEpoch++; this.aiFactory?.hide(); this.aiFactory = undefined;
    this.aiVisible = false;
    if (this.aiHost) this.setData({ aiHandoffInput: this.aiHost.handoffRef, aiHandoffOffered: true });
    if (this.aiHost) this.aiPendingHandoffRef = this.aiHost.handoffRef;
    this.aiConsumer?.destroy(); this.aiConsumer = undefined; this.aiHost = undefined; this.aiAcceptance = undefined;
    this.setData({ aiReceiptLookup: "", aiReceiptOpening: false, aiReceiptError: "" });
    if (this.aiMode) this.clearBookingHandoff();
    this.stopTicker();
  },

  onUnload() {
    this.selectComponent('#client-quote-preparation')?.invalidateQuote?.();
    this.enterpriseViewEpoch++;
    this.aiOpeningGeneration++;
    this.aiOffHandoff?.(); this.aiOffHandoff = undefined; this.aiPendingHandoffRef = undefined;
    this.aiBindingEpoch++; this.aiFactory?.dispose(); this.aiFactory = undefined;
    this.aiDisposed = true;
    this.aiVisible = false; this.aiConsumer?.destroy(); this.aiConsumer = undefined; this.aiHost = undefined;
    this.aiAcceptance = undefined;
    this.setData({ aiReceiptLookup: "", aiReceiptOpening: false, aiReceiptError: "" });
    if (this.aiMode) this.clearBookingHandoff();
    this.aiUnsubscribe?.(); this.aiUnsubscribe = undefined;
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
    if (this.aiMode || this.data.aiHandoffPending) return;
    const cart = getCart();
    if (!cart || cart.lines.length === 0) {
      this.setData({ view: blockedState("还没有选择设备", "从设备详情点“立即预约”把设备加入本次租赁。", "去选设备", "none") });
      return;
    }
    if (currentServiceCode() !== cart.serviceCode) {
      this.setData({ view: blockedState("服务不一致", `本次租赁属于“${cart.serviceName}”，请先在首页切换到该服务。`, "回首页", "none") });
      return;
    }
    const session = currentSession();
    this.setData({
      merchantName: cachedMerchant()?.name ?? "",
      serviceName: cart.serviceName,
      userName: session?.customer.displayName ?? "",
      userPhone: session?.customer.loginIdentifierMasked ?? ""
    });
    const status = membershipStatus();
    if (status && status !== "active") {
      const reason = status === "pending_activation" ? "会员资料正在等待商户审核，审核通过后即可租赁；你可以先补充资料。" : "当前会员状态受限，暂不能提交新的租赁，请联系商户。";
      this.setData({ membershipBlocked: reason, view: blockedState("暂不能确认租赁", reason, status === "pending_activation" ? "补充资料" : "联系商户", status === "pending_activation" ? "qualifications" : "contact", "回首页") });
      return;
    }
    if (cart.submission) {
      // 结果未知的提交：先把目录与当时报价读出来渲染清单/时间/门店供核对，再按同键重放拿结果，而不是再报价。
      this.setData({ view: loadingState(), locked: true, cart });
      try {
        const [catalog, quote] = await Promise.all([loadCatalog(cart.serviceCode, false), fetchQuote(cart.submission.quoteId)]);
        if (this.aiMode || this.data.aiHandoffPending || !this.aiVisible) return;
        this.catalog = catalog;
        this.applyCatalog(catalog, catalog.timeZone || zoneOf(cart.serviceCode) || DEFAULT_ZONE);
        this.syncFromCart(getCart());
        this.render(quote);
      } catch {
        // 目录/报价读不到也要给出恢复入口。
      }
      if (cart.bookingIdentity?.bookingIdentity === "enterprise_employee") await this.onRecover();
      else await this.submit(true);
      return;
    }
    const version = contextVersion();
    if (!this.catalog) this.setData({ view: loadingState() });
    try {
      const [catalog] = await Promise.all([loadCatalog(cart.serviceCode, false), this.loadCoupons(), this.loadPaymentCapabilities()]);
      if (this.aiMode || this.data.aiHandoffPending || !this.aiVisible || contextVersion() !== version) return;
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
      if (this.aiMode || !this.aiVisible) return;
      if (isApiError(error, "STALE_CONTEXT")) return;
      this.setData({ view: errorState(error, "回首页") });
    }
  },

  /** 服务端校验：自取要求门店有 pickup 能力，配送要求发货门店有 delivery 能力（归还地点另需 return，由服务端核）。 */
  locationsFor(mode: string | undefined): ClientCatalogLocation[] {
    const capability = isDeliveryMode(mode) ? "delivery" : "pickup";
    return this.allLocations.filter((row) => !row.capabilities || row.capabilities.includes(capability));
  },

  /** 可作为归还地点的门店（具备 return 能力）；异地归还从这里选，未选则归还＝取货门店，由服务端按同点处理。 */
  returnCapableLocations(): ClientCatalogLocation[] {
    return this.allLocations.filter((row) => !row.capabilities || row.capabilities.includes("return"));
  },

  applyCatalog(catalog: ClientCatalogResponse, timeZone: string) {
    this.allLocations = catalog.locations.filter((row) => row.status === "enabled");
    // 同城配送是否开通：经营空间启用了配送类履约方式，且至少有一家可发货门店；否则如实只提供自提。
    const deliveryModes = (catalog.fulfillment?.enabledModes ?? []).filter((mode) => isDeliveryMode(mode));
    this.deliveryMode = deliveryModes[0] ?? "delivery";
    const deliveryAvailable = deliveryModes.length > 0 && this.locationsFor("delivery").length > 0;
    let cart = getCart();
    // 清单里残留的配送选择在商户关闭配送后自动退回自提，避免报价被服务端拒绝而无从修改。
    if (cart && isDeliveryMode(cart.fulfillmentMode) && !deliveryAvailable) {
      this.mutate((draft) => { draft.fulfillmentMode = "store_pickup_return"; });
      cart = getCart();
    }
    const locations = this.locationsFor(cart?.fulfillmentMode);
    this.setData({
      timeZone,
      zoneNote: zoneLabel(timeZone),
      minDate: todayInZone(timeZone),
      locations,
      returnLocations: this.returnCapableLocations(),
      deliveryAvailable,
      pickupActionLabel: catalog.fulfillment?.pickupLabel || catalog.terminology?.pickupLabel || "领取",
      returnActionLabel: catalog.fulfillment?.returnLabel || catalog.terminology?.returnLabel || "归还",
      pickupModeLabel: catalog.fulfillment?.pickupLabel || catalog.terminology?.pickupLabel || "领取",
      deliveryModeLabel: catalog.fulfillment?.deliveryLabel || catalog.terminology?.deliveryLabel || "配送",
      pickupLocationLabel: `${catalog.fulfillment?.pickupLabel || catalog.terminology?.pickupLabel || "领取"}地点`,
      deliveryLocationLabel: catalog.fulfillment?.deliveryLabel || catalog.terminology?.deliveryLabel || "配送地点",
      services: catalog.services.filter((row) => row.enabled).map((row) => ({ id: row.id, name: row.name, description: row.description ?? "", selected: false }))
    });
    // 默认门店：清单未选或所选门店不支持当前取送方式时，预选第一家合适的门店（服务端仍会校验）。
    if (cart && (!cart.locationId || !locations.some((row) => row.id === cart!.locationId))) {
      const first = (isDeliveryMode(cart.fulfillmentMode) ? undefined : primaryLocation({ ...catalog, locations })) ?? locations[0];
      if (first) this.mutate((draft) => { draft.locationId = first.id; draft.locationName = first.name; });
    }
  },

  syncFromCart(cart: CartState | undefined) {
    if (!cart) return;
    const start = splitInstant(cart.startAt, this.data.timeZone);
    const end = splitInstant(cart.endAt, this.data.timeZone);
    const locations = this.locationsFor(cart.fulfillmentMode);
    const store = locations.find((row) => row.id === cart.locationId);
    const returnStore = cart.returnLocationId ? this.returnCapableLocations().find((row) => row.id === cart.returnLocationId) : undefined;
    const lines: LineRow[] = cart.lines.map((line) => {
      const item = this.catalog?.items.find((row) => row.id === line.itemGroupId);
      const price = startingPriceParts(item?.startingPrice, (unit) => catalogPricingUnitLabel(this.catalog, unit));
      const previous = this.data.lines.find((row) => row.key === line.key);
      return {
        key: line.key,
        name: line.itemName,
        option: line.pricingGroupName ?? "",
        quantity: line.quantity,
        imageSource: line.imageSource ?? item?.images?.[0]?.url ?? "",
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
      method: isDeliveryMode(cart.fulfillmentMode) ? "delivery" : "pickup",
      addressLabel: cart.deliveryAddressLabel ?? "",
      locations,
      store,
      returnStore,
      returnLabel: returnStore ? returnStore.name : `与${this.data.pickupActionLabel}地点相同`,
      memo: cart.memo ?? "",
      services: this.data.services.map((row) => ({ ...row, selected: cart.services.some((item) => item.serviceId === row.id) })),
      couponText: cart.couponId ? this.data.coupons.find((row) => row.id === cart.couponId)?.name ?? "已选优惠券" : this.data.coupons.some((row) => row.usable) ? "有可用优惠券，点击选择" : "暂无可用优惠券"
    });
    this.syncQuotePreparation(cart);
  },

  mutate(mutator: (draft: CartState) => void) {
    if (this.enterpriseOperation) { toast("企业原提交结果待核对，不能修改或重发"); return; }
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
    if (this.enterpriseOperation) { toast("原企业操作待核对，不能修改清单"); return; }
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
    if (this.data.locked) return;
    const method = String(event.currentTarget.dataset.method ?? "pickup") === "delivery" ? "delivery" : "pickup";
    if (method === "delivery" && !this.data.deliveryAvailable) {
      toast(`${this.data.deliveryModeLabel}尚未开通，当前请选择${this.data.pickupModeLabel}`, { duration: 3000 });
      return;
    }
    if (method === this.data.method) return;
    const mode: RentalFulfillmentMode = method === "delivery" ? this.deliveryMode : "store_pickup_return";
    // 切换取送方式后门店按新能力重筛：原门店不支持则换成第一家合适的门店（可再手动改）。
    const candidates = this.locationsFor(mode);
    this.mutate((draft) => {
      draft.fulfillmentMode = mode;
      if (!candidates.some((row) => row.id === draft.locationId)) {
        const first = candidates[0];
        draft.locationId = first?.id;
        draft.locationName = first?.name;
        draft.returnLocationId = undefined;
        draft.returnLocationName = undefined;
      }
    });
    void this.requestQuote();
  },

  /* ---------- 配送地址（MP-06） ---------- */
  async onOpenAddress() {
    if (this.data.locked) return;
    this.setData({ showAddressSheet: true, addressesLoading: true, addressesError: "" });
    try {
      const addresses = await listAddresses();
      this.setData({ addresses, addressesLoading: false });
    } catch (error) {
      // 读取失败与“还没有地址”是两回事：分开显示，不诱导用户去新增。
      this.setData({ addressesLoading: false, addressesError: describeError(error).message });
    }
  },

  onCloseAddress() {
    this.setData({ showAddressSheet: false });
  },

  onPickAddress(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const addr = this.data.addresses.find((row) => row.id === id);
    if (!addr) return;
    const label = `${addr.recipient} · ${addr.phoneMasked}｜${addr.province}${addr.city}${addr.district ?? ""}${addr.detail}`;
    this.setData({ showAddressSheet: false });
    this.mutate((draft) => {
      draft.deliveryAddressId = addr.id;
      draft.deliveryAddressLabel = label;
    });
    void this.requestQuote();
  },

  /** 去地址簿新增/管理；回来后重新打开地址面板即重新读取，不留旧列表。 */
  onManageAddresses() {
    this.setData({ showAddressSheet: false });
    navigate(ROUTES.addresses);
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
    // 归还门店是独立选择：换取货门店不清空异地归还（用户显式选过就保留），仅切换取送方式时才重置。
    this.mutate((draft) => {
      draft.locationId = store.id;
      draft.locationName = store.name;
    });
    void this.requestQuote();
  },

  /* ---------- 归还门店（异地归还，MP-06） ---------- */
  onOpenReturn() {
    if (this.data.locked) return;
    this.setData({ showReturnSheet: true });
  },

  onCloseReturn() {
    this.setData({ showReturnSheet: false });
  },

  /** data-id 为空表示“与取货门店相同”（清空异地归还）；否则设为所选归还门店并重报。 */
  onPickReturn(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const store = id ? this.data.returnLocations.find((row) => row.id === id) : undefined;
    if (id && !store) return;
    this.setData({ showReturnSheet: false });
    this.mutate((draft) => {
      draft.returnLocationId = store?.id;
      draft.returnLocationName = store?.name;
    });
    void this.requestQuote();
  },

  /* ---------- 优惠券 ---------- */
  async loadCoupons() {
    try {
      this.rawCoupons = await fetchCoupons();
      this.setData({ couponsError: false });
    } catch {
      this.rawCoupons = [];
      this.setData({ couponsError: true });
    }
    this.setData({ coupons: this.rawCoupons.map((coupon) => this.couponRow(coupon)) });
  },

  couponRow(coupon: RentalCustomerCoupon): CouponRow {
    const usable = coupon.status === "claimed" && Date.parse(coupon.effectiveTo) > serverNow();
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
  async loadEnterprisePolicies() {
    if (this.aiMode || !this.aiVisible || this.aiDisposed || !currentSession()) return;
    const owner = { version: contextVersion(), viewEpoch: this.enterpriseViewEpoch,
      customerId: currentSession()!.customer.customerId, serviceCode: currentServiceCode() };
    const readVersion = ++this.enterprisePolicyReadVersion;
    let policies: EnterpriseOwnRentalPolicy[] = [], error = "";
    try { policies = (await fetchEnterpriseRentalPolicies()).filter(row => row.available); }
    catch (failure) { error = `企业身份不可用：${describeError(failure).message}`; }
    if (readVersion !== this.enterprisePolicyReadVersion || !this.enterpriseCurrent(owner)) return;

    // The cart retains the selected company. A refreshed list may reorder or
    // remove relations, so its numeric picker index cannot carry that identity.
    const cart = getCart(), booking = cart?.bookingIdentity;
    const enterprise = booking?.bookingIdentity === "enterprise_employee";
    const index = enterprise ? policies.findIndex(row => row.corporateCustomerId === booking.corporateCustomerId) : -1;
    const policy = policies[index];
    const permitted = Boolean(policy && (booking?.enterpriseContractAndPayer ? policy.enterprisePaymentAllowed : policy.personalPaymentAllowed));
    const acknowledged = permitted && booking?.enterpriseDisclosure?.acknowledged === true
      && booking.enterpriseDisclosure.noticeVersion === policy.noticeVersion;
    this.setData({ enterprisePolicies: policies, enterpriseIndex: index,
      enterpriseLabel: enterprise ? policy?.corporateName ?? "原企业身份当前不可用" : "个人签约付款",
      enterprisePayer: enterprise && Boolean(booking?.enterpriseContractAndPayer), enterpriseNotice: policy?.noticeText ?? "",
      enterpriseAccepted: acknowledged,
      enterpriseError: error || (enterprise && !permitted ? "当前企业身份或所选付款方式已不可用，请重新核对" : "") });
    if (enterprise && (!permitted || booking.enterpriseDisclosure?.acknowledged && !acknowledged)
      && !this.enterpriseOperation && !cart?.submission) {
      // Unresolved commands keep their exact quote/company/K for original reads.
      // Only an editable new request loses stale disclosure and quote material.
      this.requestVersion++;
      this.setData({ quote: undefined, enterpriseApproval: undefined, agreed: false });
      this.mutate(draft => { if (draft.bookingIdentity?.bookingIdentity === "enterprise_employee") {
        draft.bookingIdentity = { ...draft.bookingIdentity, enterpriseDisclosure: undefined };
      } });
    }
  },
  onPickEnterprise(event: WechatMiniprogram.PickerChange) {
    if (this.aiMode || this.data.locked || this.data.enterprisePending) return;
    const index = Number(event.detail.value), policy = this.data.enterprisePolicies[index]; if (!policy) return;
    this.requestVersion++; this.setData({ enterpriseIndex: index, enterpriseLabel: policy.corporateName, enterprisePayer: false, enterpriseNotice: policy.noticeText ?? "", enterpriseAccepted: false, enterpriseApproval: undefined, quote: undefined });
    this.mutate(draft => { draft.bookingIdentity = { bookingIdentity: "enterprise_employee", corporateCustomerId: policy.corporateCustomerId, enterpriseContractAndPayer: false }; });
  },
  onPersonalIdentity() {
    if (this.aiMode || this.data.locked || this.data.enterprisePending) return;
    this.requestVersion++; this.setData({ enterpriseIndex: -1, enterpriseLabel: "个人签约付款", enterprisePayer: false, enterpriseNotice: "", enterpriseAccepted: false, enterpriseApproval: undefined, quote: undefined });
    this.mutate(draft => { draft.bookingIdentity = { bookingIdentity: "personal" }; }); void this.requestQuote();
  },
  onEnterprisePayer(event: WechatMiniprogram.SwitchChange) {
    if (this.data.locked || this.data.enterprisePending) return;
    const policy = this.data.enterprisePolicies[this.data.enterpriseIndex];
    if (!policy || event.detail.value && !policy.enterprisePaymentAllowed) { toast("尚未获企业付费权"); return; }
    this.requestVersion++; this.setData({ enterprisePayer: event.detail.value, enterpriseAccepted: false, enterpriseApproval: undefined, quote: undefined });
    this.mutate(draft => { if (draft.bookingIdentity) draft.bookingIdentity = { ...draft.bookingIdentity, enterpriseContractAndPayer: event.detail.value, enterpriseDisclosure: undefined }; });
  },
  onEnterpriseAccept(event: WechatMiniprogram.CheckboxGroupChange) {
    if (this.data.locked || this.data.enterprisePending) return;
    const policy = this.data.enterprisePolicies[this.data.enterpriseIndex], accepted = event.detail.value.includes("accept"); if (!policy?.noticeVersion) return;
    this.requestVersion++; this.setData({ enterpriseAccepted: accepted, quote: undefined });
    this.mutate(draft => { if (draft.bookingIdentity) draft.bookingIdentity = { ...draft.bookingIdentity, enterpriseDisclosure: { noticeVersion: policy.noticeVersion!, acknowledged: accepted } }; });
    if (accepted) void this.requestQuote();
  },
  onEnterprisePurpose(event: WechatMiniprogram.Input) { if (!this.data.enterprisePending) this.setData({ enterprisePurpose: event.detail.value }); },
  clearEnterpriseOperation() {
    const operation = this.enterpriseOperation;
    if (!operation || !this.enterpriseCurrent(operation)) throw new Error("原企业操作身份已变化");
    removeStorage(this.enterpriseStorageKey());
    if (readStorage<typeof operation>(STORAGE_KEYS.enterpriseOperations)?.key === operation.key) removeStorage(STORAGE_KEYS.enterpriseOperations);
    this.enterpriseOperation = undefined; this.setData({ enterprisePending: false });
  },
  acceptEnterpriseResult(result: EnterpriseApprovalOriginalResult, quoteId: string, approvalId: string) {
    if (result.approval.id !== approvalId || result.approval.quoteId !== quoteId) throw new Error("原批准与执行结果引用不匹配，保留原操作");
    if (result.approval.state === "closed" && result.original.state === "closed" && result.retryable === false && result.original.retryable === false && !result.approval.orderId) {
      if (this.enterpriseOperation) this.clearEnterpriseOperation();
      // Keep the cart and original quote visible; only an explicit re-quote action
      // may obtain new material. Closure is not order cancellation or submission.
      this.setData({ enterpriseApproval: result.approval, agreed: false, enterpriseError: "原执行已封闭，未取消订单或重试下单。新申请须重新获取报价并取得新的批准。" }); return;
    }
    if (result.approval.state !== "consumed" || result.original.state !== "observed" || !result.original.orderId) throw new Error("原提交仍需核对，不能重复执行");
    if (this.enterpriseOperation) this.clearEnterpriseOperation();
    if (!this.aiMode) completeSubmission();
    redirect(buildUrl(ROUTES.order, { id: result.original.orderId }));
  },
  async resolveEnterpriseOperation() {
    const operation = this.enterpriseOperation;
    const owner = operation ?? { version: contextVersion(), viewEpoch: this.enterpriseViewEpoch, customerId: currentSession()?.customer.customerId ?? "", serviceCode: currentServiceCode() };
    const current = () => { if (!this.enterpriseCurrent(owner)) throw new Error("客户身份、空间或页面已变化，原请求已隔离"); };
    if (operation?.kind === "order") {
      const result = await readEnterpriseOrderOriginal(operation.quoteId, operation.key); current();
      if (result.state !== "observed" || !result.orderId) throw new Error("原下单结果待核对，没有订单不代表可重发");
      this.clearEnterpriseOperation(); if (!this.aiMode) completeSubmission(); redirect(buildUrl(ROUTES.order, { id: result.orderId })); return;
    }
    let approvalId = operation?.approvalId;
    if (operation) {
      const receipt = await readEnterpriseOperation(operation.key); current();
      if (receipt.state !== "committed") throw new Error("没有原收据不代表未执行，不能重发");
      if (!approvalId && typeof receipt.result?.approvalId === "string") approvalId = receipt.result.approvalId;
      if (operation.kind === "submit" || approvalId) {
        if (!approvalId) throw new Error("原批准引用缺失，须核对原操作");
        const result = await readEnterpriseApprovalResult(approvalId); current();
        this.acceptEnterpriseResult(result, operation.quoteId, approvalId); return;
      }
    }
    const rows = await fetchEnterpriseApprovals(); current();
    const approval = rows.find(row => row.quoteId === (operation?.quoteId ?? this.data.quote?.id));
    if (!approval) throw new Error("原批准申请未读到；保留原请求，不能新建替代申请");
    if (["executing", "consumed", "closed"].includes(approval.state)) {
      const result = await readEnterpriseApprovalResult(approval.id); current();
      this.acceptEnterpriseResult(result, operation?.quoteId ?? approval.quoteId, approval.id); return;
    }
    this.setData({ enterpriseApproval: approval, enterpriseError: "" });
    if (operation) this.clearEnterpriseOperation();
  },
  async onEnterpriseApproval() {
    const quote = this.data.quote, purpose = this.data.enterprisePurpose.trim();
    if (!quote || !purpose || this.data.enterpriseApproval?.quoteId === quote.id && this.data.enterpriseApproval.state === "closed" || this.data.enterpriseBusy || this.enterpriseReading || this.enterpriseOperation || !currentSession()) return;
    const operation = { key: newKey("enterprise-approval"), kind: "request" as const, version: contextVersion(), viewEpoch: this.enterpriseViewEpoch,
      quoteId: quote.id, customerId: currentSession()!.customer.customerId, serviceCode: currentServiceCode() };
    this.setData({ enterpriseBusy: true });
    try {
      writeRequiredStorage(this.enterpriseStorageKey(), operation); this.enterpriseOperation = operation; this.setData({ enterprisePending: true });
      await requestEnterpriseApproval({ operationKey: operation.key, quoteId: quote.id, purpose, reason: purpose, expectedRevision: 0 });
      if (this.enterpriseCurrent(operation)) await this.resolveEnterpriseOperation();
    } catch (error) { if (this.enterpriseCurrent(operation)) this.setData({ enterpriseError: `原批准申请待核对：${describeError(error).message}` }); }
    finally { if (this.enterpriseCurrent(operation)) this.setData({ enterpriseBusy: false }); }
  },
  async onReadEnterpriseApproval() {
    if (this.data.enterpriseBusy || this.enterpriseReading || !currentSession()) return;
    const owner = { version: contextVersion(), viewEpoch: this.enterpriseViewEpoch, customerId: currentSession()!.customer.customerId, serviceCode: currentServiceCode() };
    this.enterpriseReading = true; this.setData({ enterpriseBusy: true });
    try { await this.resolveEnterpriseOperation(); }
    catch (error) { if (this.enterpriseCurrent(owner)) this.setData({ enterpriseError: describeError(error).message }); }
    finally { this.enterpriseReading = false; if (this.enterpriseCurrent(owner)) this.setData({ enterpriseBusy: false }); }
  },
  async onSubmitEnterpriseApproval() {
    const approval = this.data.enterpriseApproval;
    if (!approval || approval.state !== "approved" || approval.quoteId !== this.data.quote?.id || !this.data.agreed
      || this.data.enterpriseBusy || this.enterpriseReading || this.enterpriseOperation || !currentSession()) return;
    const operation = { key: newKey("enterprise-submit"), kind: "submit" as const, approvalId: approval.id, version: contextVersion(), viewEpoch: this.enterpriseViewEpoch,
      quoteId: approval.quoteId, customerId: currentSession()!.customer.customerId, serviceCode: currentServiceCode() };
    this.setData({ enterpriseBusy: true });
    try {
      const confirmed = (await wx.showModal({ title: "确认企业付款预约", content: "我已核对原报价、企业签约付款责任及保证金安排，明确提交本次请求。批准不保证库存或已支付。", confirmText: "明确提交" })).confirm;
      if (!confirmed || !this.enterpriseCurrent(operation) || this.enterpriseOperation || approval !== this.data.enterpriseApproval) return;
      writeRequiredStorage(this.enterpriseStorageKey(), operation); this.enterpriseOperation = operation; this.setData({ enterprisePending: true });
      await submitEnterpriseApproval({ operationKey: operation.key, approvalId: approval.id, expectedRevision: approval.revision, reason: this.data.enterprisePurpose || "本人核对后明确提交", confirm: true });
      if (this.enterpriseCurrent(operation)) await this.resolveEnterpriseOperation();
    } catch (error) { if (this.enterpriseCurrent(operation)) this.setData({ enterpriseError: `提交结果待核对，保留原引用：${describeError(error).message}` }); }
    finally { if (this.enterpriseCurrent(operation)) this.setData({ enterpriseBusy: false }); }
  },
  async submitEnterpriseOrder(quoteId: string) {
    if (this.enterpriseOperation || this.enterpriseReading || this.data.enterpriseBusy || !currentSession()) return;
    const operation = { key: newKey("enterprise-order"), kind: "order" as const, version: contextVersion(), viewEpoch: this.enterpriseViewEpoch,
      quoteId, customerId: currentSession()!.customer.customerId, serviceCode: currentServiceCode() };
    this.setData({ enterpriseBusy: true });
    try {
      writeRequiredStorage(this.enterpriseStorageKey(), operation); this.enterpriseOperation = operation; this.setData({ enterprisePending: true });
      await createEnterpriseOrder(quoteId, operation.key);
      if (this.enterpriseCurrent(operation)) await this.resolveEnterpriseOperation();
    } catch (error) { if (this.enterpriseCurrent(operation)) this.setData({ enterpriseError: `原企业下单待核对，不能再次派发：${describeError(error).message}` }); }
    finally { if (this.enterpriseCurrent(operation)) this.setData({ enterpriseBusy: false }); }
  },

  buildRequest(cart: CartState): ClientCreateQuoteRequest {
    const note = cart.memo?.trim() || undefined;
    const delivery = isDeliveryMode(cart.fulfillmentMode);
    return {
      bookingIdentity: cart.bookingIdentity ?? { bookingIdentity: "personal" },
      fulfillmentMode: cart.fulfillmentMode as RentalFulfillmentMode,
      fulfillmentLocationId: cart.locationId!,
      startAt: cart.startAt!,
      endAt: cart.endAt!,
      customerCouponId: cart.couponId || undefined,
      lines: cart.lines.map((line) => ({ itemGroupId: line.itemGroupId, pricingGroupId: line.pricingGroupId, quantity: line.quantity, note })),
      services: cart.services.length ? cart.services.map((row) => ({ serviceId: row.serviceId, quantity: row.quantity })) : undefined,
      // 异地归还：自取方式下带上归还门店（服务端校验其 return 能力）；未选或配送方式不传，由服务端按同点/配送规则处理。
      returnLocationId: !delivery ? cart.returnLocationId || undefined : undefined,
      // 配送履约必须带本人地址簿地址；服务端在报价时固化收货快照。自取方式不传。
      deliveryAddressId: delivery ? cart.deliveryAddressId : undefined
    };
  },

  async requestQuote() {
    if (this.aiMode || this.data.aiHandoffPending) return;
    const cart = getCart();
    this.syncQuotePreparation(cart);
    if (this.aiQuoteMode) return;
    if (!cart || cart.submission || this.data.enterprisePending) return;
    if (cart.bookingIdentity?.bookingIdentity === "enterprise_employee" && !cart.bookingIdentity.enterpriseDisclosure?.acknowledged) { this.setData({ quote: undefined, formError: "请先明确确认企业身份订单告知" }); return; }
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
      if (token !== this.requestVersion || version !== contextVersion() || this.data.aiHandoffPending || this.aiMode || !this.aiVisible) return;
      bindQuote(quote.id, quote.expiresAt);
      this.render(quote);
      this.setData({ cart: getCart() });
      this.tick();
    } catch (error) {
      if (token !== this.requestVersion || this.data.aiHandoffPending || this.aiMode || !this.aiVisible || isApiError(error, "STALE_CONTEXT")) return;
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
      unitsText: units > 0 && unit ? `共 ${units} ${catalogPricingUnitLabel(this.catalog, unit)}` : "",
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
    if (this.enterpriseOperation) { toast("原企业操作待核对，不能重新报价"); return; }
    const cart = getCart();
    if (cart) bindQuote("", new Date(0).toISOString());
    this.setData({ enterpriseApproval: undefined, agreed: false });
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
    if (this.aiMode || this.aiQuoteMode || this.data.aiHandoffPending) return;
    if (this.data.submitting || this.data.enterpriseBusy || this.enterpriseReading || this.enterpriseOperation) return;
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
    if (this.data.quote.membershipSnapshot?.enterpriseContractAndPayer && this.data.quote.membershipSnapshot.enterpriseBasis?.approvalMode === "per_order") { await this.onSubmitEnterpriseApproval(); return; }
    if (this.data.quote.membershipSnapshot?.bookingIdentity === "enterprise_employee") { await this.submitEnterpriseOrder(this.data.quote.id); return; }
    await this.submit(false);
  },

  /** replay=true 表示恢复一次结果未知的提交：同键同报价重放。 */
  async submit(replay: boolean) {
    if (this.aiMode || this.aiQuoteMode || this.data.aiHandoffPending) return;
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

  async onRecover() {
    if (this.enterpriseOperation) { await this.onReadEnterpriseApproval(); return; }
    const cart = getCart();
    if (cart?.bookingIdentity?.bookingIdentity === "enterprise_employee" && cart.submission && currentSession()) {
      const operation = { key: cart.submission.key, kind: "order" as const, version: contextVersion(), viewEpoch: this.enterpriseViewEpoch,
        quoteId: cart.submission.quoteId, customerId: currentSession()!.customer.customerId, serviceCode: currentServiceCode() };
      try { writeRequiredStorage(this.enterpriseStorageKey(), operation); this.enterpriseOperation = operation; this.setData({ enterprisePending: true }); await this.onReadEnterpriseApproval(); }
      catch (error) { this.setData({ enterpriseError: describeError(error).message }); }
      return;
    }
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
