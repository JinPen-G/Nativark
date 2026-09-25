/**
 * 客户端 API 的独立契约（MEMBER-01F）。
 *
 * 这里故意不复用后台 `SystemUserRow`、运营登录请求或后台会员 DTO：
 * 客户账号与运营账号是两套认证边界，客户端也必须明确目标租户与经营空间。
 * 本文件只固化 v1 的请求/响应形状；验证码 provider、客户端页面和真实发信另行激活。
 */

import type {
  CustomerMembershipBenefit,
  RentalBookingIdentityInput,
  RentalFulfillmentMode,
  RentalOfflinePaymentMethod,
  RentalPaymentMethod,
  RentalPricingUnit
} from "./core";
import type { CompleteFileUploadRequest, FileDownloadUrlSummary, FileUploadSessionSummary } from "./infrastructure";

export const CLIENT_API_VERSION = "v1" as const;
export const CLIENT_REGISTRATION_CHANNEL = "app" as const;

export const CLIENT_VERIFICATION_METHODS = ["sms", "email"] as const;
export type ClientVerificationMethod = (typeof CLIENT_VERIFICATION_METHODS)[number];

export const CLIENT_REGISTRATION_CHALLENGE_STATUSES = [
  "pending_verification",
  "verified",
  "expired",
  "consumed",
  "delivery_failed"
] as const;
export type ClientRegistrationChallengeStatus =
  (typeof CLIENT_REGISTRATION_CHALLENGE_STATUSES)[number];

/**
 * 客户端目标不能依赖后台当前会话；正式 API 通过公开的租户/空间编码解析目标，
 * 服务端随后校验租户、空间状态、品类和注册模式。响应和 token 不向客户端暴露内部 id。
 */
export interface ClientTenantTarget {
  tenantCode: string;
  workspaceCode?: string;
}

export interface ClientWorkspaceTarget extends ClientTenantTarget {
  workspaceCode: string;
}

export interface ClientRegistrationChallengeRequest extends ClientTenantTarget {
  method: ClientVerificationMethod;
  identifier: string;
  /** 同一次点击/重试的业务幂等键，不能用手机号或验证码代替。 */
  idempotencyKey: string;
}

export interface ClientRegistrationChallengeResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  challengeId: string;
  status: ClientRegistrationChallengeStatus;
  method: ClientVerificationMethod;
  maskedDestination: string;
  expiresAt: string;
  retryAfterSeconds?: number;
  /** 仅本地开发返回，生产环境永不返回验证码。 */
  developmentCode?: string;
  deliveryMode?: "development" | "provider" | "provider_pending";
  /** 证明只能用于该用途（缺省即注册）。 */
  purpose?: "registration" | "login" | "account_closure";
}

/** 验证码交换为一次性短期证明，不把原始验证码带进注册请求或日志。 */
export interface VerifyClientRegistrationChallengeRequest {
  challengeId: string;
  code: string;
}

export interface VerifyClientRegistrationChallengeResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  verificationToken: string;
  expiresAt: string;
}

export interface ClientAgreementConsent {
  userAgreementVersion: string;
  privacyPolicyVersion: string;
  agreedAt: string;
}

/**
 * APP 注册请求。服务端依据 verificationToken、目标空间和注册策略创建/复用主档，
 * 客户端不能提交 tenantId、workspaceId、directApprove、reviewedBy 或最终会员状态。
 */
export interface ClientPersonalMembershipRegistrationRequest extends ClientTenantTarget {
  name: string;
  phone: string;
  email?: string;
  identityNo?: string;
  password: string;
  verificationToken: string;
  consent: ClientAgreementConsent;
  idempotencyKey: string;
}

export const CLIENT_REGISTRATION_RESULTS = ["pending_review", "active"] as const;
export type ClientRegistrationResult = (typeof CLIENT_REGISTRATION_RESULTS)[number];

export interface ClientPersonalMembershipRegistrationResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  result: ClientRegistrationResult;
  registrationId: string;
  customerId?: string;
  /** 只返回客户端可理解的状态，不返回后台审核权限、操作者或内部数据范围。 */
  reviewStatus: "pending" | "approved";
  membershipStatus: "pending_activation" | "active";
}

/** 客户端登录与后台运营登录完全分离，token 不能互换。 */
export interface ClientMembershipLoginRequest {
  tenantCode: string;
  loginIdentifier: string;
  password: string;
  workspaceCode?: string;
  clientId?: string;
}

export interface ClientRefreshRequest {
  refreshToken: string;
}

/** 客户账号已登录后切换到另一个已授权经营空间。 */
export interface ClientSwitchWorkspaceRequest {
  workspaceCode: string;
}

export interface ClientMembershipSessionResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  customer: {
    customerId: string;
    customerType: "personal" | "corporate";
    displayName: string;
    loginIdentifierMasked: string;
  };
  workspaces: Array<{
    workspaceCode: string;
    workspaceName: string;
    categoryCode: string;
    membershipStatus: string;
  }>;
  /**
   * 本次会话绑定的当前服务空间（服务端事实）。客户端切换/刷新时以此为准记录当前服务，
   * 不能凭“请求时想切到哪”推断；旧客户端可忽略该字段。
   */
  workspace?: ClientWorkspaceSummary;
  /** 本人是否已在本租户绑定微信身份（小程序内微信支付需要）。 */
  wechatBound?: boolean;
}

export interface ClientMembershipReviewStatus {
  registrationId: string;
  status: "pending" | "approved" | "rejected" | "supplement_required" | "cancelled";
  reason?: string;
  updatedAt: string;
}

export interface ClientMembershipQualificationStatus {
  qualificationType: string;
  status: "not_submitted" | "pending" | "approved" | "rejected" | "expired" | "revoked";
  expiresAt?: string;
  reviewComment?: string;
  updatedAt: string;
}

export interface ClientWorkspaceSummary {
  workspaceCode: string;
  workspaceName: string;
  categoryCode: string;
  membershipStatus: string;
  isDefault?: boolean;
}

export interface ClientMembershipStatusResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  customerId: string;
  customerType: "personal" | "corporate";
  displayName: string;
  phoneMasked: string;
  email?: string;
  accountStatus: "active" | "suspended" | "closed";
  workspace: ClientWorkspaceSummary;
  workspaces: ClientWorkspaceSummary[];
  reviews: ClientMembershipReviewStatus[];
  qualifications: ClientMembershipQualificationStatus[];
}

/**
 * 客户端自己的资料视图。手机号、证件号和企业统一社会信用代码只返回脱敏值；
 * 客户端不能通过这个接口修改手机号、证件或企业主体事实。
 */
export interface ClientProfileView {
  apiVersion: typeof CLIENT_API_VERSION;
  customerId: string;
  customerType: "personal" | "corporate";
  name: string;
  phoneMasked: string;
  email?: string;
  identityVerified: boolean;
  identityNoMasked?: string;
  accountStatus: "active" | "suspended" | "closed";
  workspace: ClientWorkspaceSummary;
  corporate?: {
    legalName: string;
    unifiedSocialCreditCodeMasked: string;
    registeredAddress?: string;
    industry?: string;
    scale?: string;
    status: string;
  };
  contacts: ClientContactView[];
}

export interface ClientProfileUpdateRequest {
  name?: string;
  email?: string | null;
}

export type ClientContactKind = "emergency" | "corporate" | "other";

export interface ClientContactRequest {
  id?: string;
  kind: ClientContactKind;
  name: string;
  phone: string;
  email?: string;
  relation?: string;
  isPrimary?: boolean;
}

export interface ClientContactView {
  id: string;
  kind: ClientContactKind;
  name: string;
  phoneMasked: string;
  email?: string;
  relation?: string;
  isPrimary: boolean;
  status: "active" | "inactive" | string;
}

/** 客户端资质影像上传只接受业务字段，租户、客户和上传场景由服务端绑定。 */
export interface ClientQualificationUploadSessionRequest {
  qualificationType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  idempotencyKey: string;
}

export type ClientQualificationUploadSessionResponse = FileUploadSessionSummary;
export type ClientQualificationUploadCompleteRequest = CompleteFileUploadRequest;
export type ClientQualificationFileUrlResponse = FileDownloadUrlSummary;

export interface ClientContactsResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  items: ClientContactView[];
}

export interface ClientMembershipPlanView {
  planId: string;
  code: string;
  name: string;
  targetType: "personal" | "corporate";
  versionId: string;
  version: number;
  levelRank: number;
  isDefault: boolean;
  isRecommended: boolean;
  benefits: CustomerMembershipBenefit[];
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface ClientMembershipPlansResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  plans: ClientMembershipPlanView[];
}

export interface ClientMembershipAssignmentView {
  id: string;
  planId: string;
  planVersionId: string;
  planName: string;
  targetType: "personal" | "corporate";
  source: "manual" | "system" | "corporate_contract" | string;
  status: "active" | "expired" | "revoked" | string;
  effectiveFrom: string;
  effectiveTo?: string;
  benefits: CustomerMembershipBenefit[];
  reason?: string;
  createdAt: string;
}

export interface ClientMembershipAssignmentsResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  items: ClientMembershipAssignmentView[];
}

export interface ClientMembershipBenefitsResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  personal?: ClientMembershipAssignmentView;
  corporate?: ClientMembershipAssignmentView;
}

export interface ClientCorporateIdentityView {
  corporateCustomerId: string;
  corporateName: string;
  legalName?: string;
  unifiedSocialCreditCodeMasked?: string;
  registeredAddress?: string;
  role: "admin" | "employee" | string;
  department?: string;
  employeeNo?: string;
  membershipId: string;
  effectiveTo?: string;
}

export interface ClientCorporateIdentityListResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  items: ClientCorporateIdentityView[];
}

export interface ClientPaymentCapabilitiesResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  mode: "simulation_only" | "provider_pending" | "provider";
  realPaymentEnabled: boolean;
  methods: Array<"simulation" | RentalPaymentMethod>;
  instruments: Array<"rental" | "deposit" | "preauthorization">;
}

export interface ClientPaymentIntentRequest {
  /** 第一阶段真实支付只承接租金/费用；押金和预授权仍由独立资金能力处理。 */
  instrument: "rental" | "deposit" | "preauthorization";
  method: "alipay" | "wechat_pay" | "stripe";
  idempotencyKey: string;
}

/** 小程序不接受客户端提交 openid；微信身份必须由服务端可信绑定取得。 */
export interface ClientMiniProgramPaymentIntentRequest {
  instrument: "rental";
  idempotencyKey: string;
}

/** 只能由真实 JSAPI 预支付结果及商户私钥生成，Native code_url 不是这些参数。 */
export interface ClientWechatJsapiParameters {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: "RSA";
  paySign: string;
}

export interface ClientPaymentIntentResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  intentId: string;
  provider: "alipay" | "wechat_pay" | "stripe";
  method: "alipay" | "wechat_pay" | "stripe";
  instrument: "rental" | "deposit" | "preauthorization";
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "funding_failed" | "closed";
  checkoutUrl?: string;
  /** 预留 JSAPI 契约；缺少可信微信身份/适配器时不得返回，更不能用 checkoutUrl 拼造。 */
  jsapi?: ClientWechatJsapiParameters;
  expiresAt: string;
  paidAt?: string;
  message?: string;
}

export interface ClientConfigResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  tenantCode: string;
  workspace: ClientWorkspaceSummary;
  categoryCode: string;
  timeZone: string;
  registration: {
    mode: "manual" | "automatic";
    verificationMethods: ClientVerificationMethod[];
    providerMode: "development" | "provider_pending" | "provider";
  };
  features: {
    profile: boolean;
    contacts: boolean;
    membershipPlans: boolean;
    qualifications: boolean;
    coupons: boolean;
    orderExtensions: boolean;
    notifications: boolean;
    /** 当前服务空间是否启用配送类履约方式（本人地址簿随之开放）。 */
    delivery: boolean;
    /** 检查异常费用的本人确认/异议。 */
    feeResponse: boolean;
    /** 本人在线注销（仍受全租户前置检查）。 */
    accountClosure: boolean;
    /** 商户是否开通小程序渠道，可绑定微信身份用于小程序支付。 */
    wechatBinding: boolean;
  };
  payment: ClientPaymentCapabilitiesResponse;
}

export interface ClientBookingOption {
  bookingIdentity: "personal" | "enterprise_employee";
  corporateCustomerId?: string;
  corporateName?: string;
  membershipId?: string;
  label: string;
  eligible: boolean;
  reason?: string;
}

/** 参考起价：当前生效价格版本里该型号（或其所属定价分组）最低的基础单价；实际以租期报价为准。 */
export interface ClientCatalogStartingPrice {
  amount: number;
  unit: RentalPricingUnit;
  currency: string;
}

export interface ClientCatalogItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  inventoryMode: string;
  images?: Array<{ url: string; alt?: string }>;
  attributes?: Record<string, unknown>;
  /** 无生效价格版本或该型号无费率时缺省；客户端不得以 0 元替代。 */
  startingPrice?: ClientCatalogStartingPrice;
}

/** 客户可见的履约地点摘要：公开地址、营业时段与门店电话，不含经营主体结算信息。 */
export interface ClientCatalogLocation {
  id: string;
  code: string;
  name: string;
  status: string;
  address?: string;
  /** 门店坐标（客户端按位置排序与地图导航使用）；未录入时为空，客户端退回按列表顺序展示、不显示距离。 */
  latitude?: number;
  longitude?: number;
  businessHours?: string;
  contactPhone?: string;
  capabilities?: Array<"pickup" | "return" | "storage" | "delivery">;
}

export interface ClientCatalogPricingGroup {
  id: string;
  code: string;
  name: string;
  memberItemGroupIds: string[];
  enabled: boolean;
}

export interface ClientCatalogService {
  id: string;
  code: string;
  name: string;
  description?: string;
  pricingUnit?: string;
  enabled: boolean;
}

export interface ClientCatalogResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  tenantCode: string;
  workspace: ClientWorkspaceSummary;
  categoryCode: string;
  timeZone: string;
  items: ClientCatalogItem[];
  pricingGroups: ClientCatalogPricingGroup[];
  services: ClientCatalogService[];
  locations: ClientCatalogLocation[];
  discountPlans: Array<{ id: string; code: string; name: string; status: string }>;
  /**
   * 当前服务空间启用的履约方式；客户端只据此显示入口，服务端报价仍逐项校验。
   * `allowDifferentReturnLocation` 取自**当前生效的规则版本**（报价按同一规则校验），
   * 没有生效规则时为 false。
   */
  fulfillment: {
    enabledModes: RentalFulfillmentMode[];
    allowDifferentReturnLocation: boolean;
    /** 配送/上门类履约的目的地：customer_address=选客户地址簿地址；tenant_location=送到门店/据点。客户端据此分流「选地址 vs 选据点」，无需判 categoryCode。 */
    deliveryDestination: "customer_address" | "tenant_location";
    /** 配送方式的品类文案（车辆=送车到点、物品=配送到家）；未配置时客户端回退通用「配送」。 */
    deliveryLabel?: string;
  };
}

export interface ClientQuoteLineRequest {
  pricingGroupId?: string;
  itemGroupId?: string;
  quantity: number;
  pricingUnit?: RentalPricingUnit;
  usageQuantity?: number;
  note?: string;
}

export interface ClientQuoteServiceRequest {
  serviceId: string;
  quantity: number;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  serviceLocationId?: string;
}

export interface ClientCreateQuoteRequest {
  bookingIdentity?: RentalBookingIdentityInput;
  fulfillmentMode: RentalFulfillmentMode;
  fulfillmentLocationId: string;
  returnLocationId?: string;
  startAt: string;
  endAt: string;
  pricingPlanId?: string;
  discountPlanId?: string;
  customerCouponId?: string;
  lines: ClientQuoteLineRequest[];
  services?: ClientQuoteServiceRequest[];
  /** 配送类履约方式必须选择本人地址簿中的地址；服务端在报价时固化快照。 */
  deliveryAddressId?: string;
}

export interface ClientCreateOrderRequest {
  quoteId: string;
  contactPhone?: string;
}

export interface ClientAvailabilityRequest {
  locationId: string;
  startAt: string;
  endAt: string;
  lines: Array<{ itemGroupId: string; quantity: number }>;
}

export interface ClientCancelOrderRequest {
  reason: string;
}

export interface ClientOrderExtensionRequest {
  newEndAt: string;
  services?: ClientQuoteServiceRequest[];
  memo?: string;
}

export interface ClientChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ClientPaymentSimulationRequest {
  instrument: "rental" | "deposit" | "preauthorization";
  action: "initiate" | "append" | "capture" | "refund" | "release" | "fail";
  amount?: number;
  reason: string;
  failureCode?: string;
  paymentMethod?: RentalOfflinePaymentMethod;
}

/** 订单商品摘要：只取型号名称与件数，供列表卡片展示；不含资产编号或金额明细。 */
export interface MyOrderItemSummary {
  firstItemGroupId: string;
  firstItemName: string;
  /** 商品行数。 */
  itemCount: number;
  /** 全部行数量之和。 */
  totalQuantity: number;
}

/** 只读跨空间索引：只含当前租户客户本人的订单，不授予目标空间的操作权限。 */
export interface MyOrderIndex {
  orderId: string;
  orderNo: string;
  tenantCode: string;
  workspaceCode: string;
  workspaceName: string;
  categoryCode: string;
  status: string;
  startAt: string;
  endAt: string;
  effectiveEndAt?: string;
  finalPayableAmount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  /** 没有商品行的历史订单缺省。 */
  itemSummary?: MyOrderItemSummary;
}

export interface ClientMyOrdersQuery {
  page?: number;
  pageSize?: number;
}

export interface ClientMyOrdersResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  items: MyOrderIndex[];
  page: number;
  pageSize: number;
  total: number;
}

/** 仅试算既有取消费；不是实际退款，也不承诺绕过取消时的状态/结算门禁。 */
export interface ClientCancellationPreview {
  apiVersion: typeof CLIENT_API_VERSION;
  orderId: string;
  cancellationCharge: number;
  currency: string;
  calculatedAt: string;
  estimated: true;
}

export interface ClientOrderView {
  id: string;
  orderNo: string;
  status: string;
  customerName: string;
  fulfillmentMode: string;
  fulfillmentLocationName: string;
  returnLocationName?: string;
  startAt: string;
  endAt: string;
  effectiveEndAt?: string;
  rentalAmount: number;
  discountAmount: number;
  couponAmount: number;
  serviceAmount: number;
  fulfillmentAmount: number;
  depositAmount: number;
  preAuthAmount: number;
  payableAmount: number;
  adjustmentAmount: number;
  finalPayableAmount: number;
  currency?: string;
  lines: Array<{
    id: string;
    itemGroupId: string;
    itemGroupName: string;
    pricingGroupId?: string;
    pricingGroupName?: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  chargeLines: Array<{ type: string; name?: string; amount: number; quantity?: number; unitPrice?: number }>;
  allocations?: Array<{ id: string; orderLineId: string; quantity: number; status: string; assetNo?: string }>;
  /** 配送订单的收货地址快照（脱敏）；自取订单缺省。 */
  deliveryAddress?: ClientDeliveryAddressSnapshot;
  createdAt: string;
  updatedAt: string;
}

/** 客户只能看到与自己订单相关的通知，不暴露运营端收件人和 provider 细节。 */
export interface ClientNotificationView {
  id: string;
  eventCode: string;
  channel: "sms" | "app_push" | "wechat" | "email";
  title: string;
  body: string;
  status: "queued" | "sent" | "delivery_pending" | "delivered" | "delivery_failed" | "failed" | "delivery_uncertain" | "simulated" | "simulation_failed";
  orderId?: string;
  createdAt: string;
  sentAt?: string;
}

export interface ClientNotificationListResponse {
  items: ClientNotificationView[];
  page: number;
  pageSize: number;
  total: number;
}

/** 履约信息单独提供轻量入口，移动端不必依赖订单金额详情才能展示领取/归还进度。 */
export interface ClientFulfillmentView {
  orderId: string;
  orderNo: string;
  status: string;
  fulfillmentMode: string;
  fulfillmentLocationName: string;
  returnLocationName?: string;
  startAt: string;
  endAt: string;
  effectiveEndAt?: string;
  allocations: NonNullable<ClientOrderView["allocations"]>;
}

/* ====================================================================
 * MP-R1 渠道能力（MP-01/02A/02B/03/06/11）。
 * 以下契约由服务端真实提供；小程序不再把它们当“拟新增”。
 * ==================================================================== */

export const CLIENT_LOGIN_METHODS = ["wechat_phone", "sms", "password"] as const;
export type ClientLoginMethod = (typeof CLIENT_LOGIN_METHODS)[number];

/** 客户端渠道种类：微信小程序（缺省）、APP 与 web 官网。共用的品牌/协议/帮助来自租户级配置，渠道能力按种类叠加；`web` 额外带官网特有配置。 */
export const CLIENT_CHANNEL_KINDS = ["wechat_miniprogram", "app", "web"] as const;
export type ClientChannelKind = (typeof CLIENT_CHANNEL_KINDS)[number];

/** 公开启动配置的查询：包内只有商户公开编码、渠道种类与小程序 AppID，均不是密钥。 */
export interface ClientChannelBootstrapQuery {
  tenantCode: string;
  client?: ClientChannelKind;
  appId?: string;
}

export interface ClientChannelAgreementSummary {
  name: string;
  version: string;
  url?: string;
  /** 商户是否提供了可在客户端内直接阅读的正文（经 `GET /public/documents/{kind}` 读取）。 */
  hasBody: boolean;
}

/**
 * web 官网特有配置（WEBSITE-CHANNEL-01）。只在 `GET /public/bootstrap?client=web` 且商户已启用官网渠道时返回。
 * 商户名、Logo、协议、客服、帮助、已发布服务与主色（themeColor）仍在 bootstrap 顶层通用字段，官网直接复用，不在此重复。
 */
export interface ClientWebsiteConfig {
  /** 站点标语（header 品牌下、页脚展示）。 */
  slogan?: string;
  /** 首页 Hero 主标题；缺省时官网回退到商户名/标语。 */
  heroTitle?: string;
  /** 首页 Hero 副文案。 */
  heroDescription?: string;
  /** 首页 Hero 大图地址。 */
  heroImageUrl?: string;
  /** 辅助/强调色（#RRGGBB）；主色仍取通用 themeColor。 */
  secondaryColor?: string;
  /** 页脚品牌文案。 */
  footerText?: string;
  /** 页脚展示的联系地址。 */
  contactAddress?: string;
  /** 底部行动区标题。 */
  ctaTitle?: string;
  /** 底部行动区文案。 */
  ctaDescription?: string;
  /** SEO 标题 / 描述 / 关键词（关键词以英文逗号分隔）。 */
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  /** 品类入口图（按服务编码）；官网首页各品类卡片/场景图优先用它，缺省回落到商品图。 */
  categoryImages?: Array<{ code: string; imageUrl: string }>;
  /** 官网首页「为什么选择我们」卖点；缺省时官网用通用文案。 */
  advantages?: Array<{ icon?: string; title: string; description?: string }>;
  /** 官网首页「租赁流程」步骤；缺省时官网用通用文案。 */
  steps?: Array<{ title: string; description?: string }>;
  /** 官网首页「用户评价 / 客户案例」；缺省时该区块隐藏。 */
  testimonials?: Array<{ name: string; context?: string; text: string }>;
  /** 是否在页脚展示 “Powered by Rental OS”。 */
  showPoweredBy: boolean;
}

/**
 * 官网按 Host 反查租户（WEBSITE-CHANNEL-02）：`GET /public/site-resolve?host=`。
 * 一套前端服务多租户时，客户自带域名经边缘回源后据此定位租户；未绑定返回 null，官网回退而不报错。
 */
export interface ClientWebsiteHostResolution {
  tenantCode: string | null;
}

/**
 * 渠道启动配置（需求 §12.1 ChannelBootstrap / §12.4）。
 * `source=channel`：商户已在运营端配置客户端渠道（品牌、协议、客服、帮助、已发布服务）；
 * `source=workspace_directory`：商户尚未配置时按启用空间回退，只有服务列表与租户名。
 * 微信一键登录与小程序内微信支付只在 `client=wechat_miniprogram` 且微信凭证就绪时开放。
 */
export interface ClientChannelBootstrapResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  tenantCode: string;
  client: ClientChannelKind;
  merchant: { name: string; logoUrl?: string; faviconUrl?: string; servicePhone?: string; serviceHours?: string };
  services: Array<{ code: string; name: string; categoryCode: string; isDefault?: boolean; status: "open" | "paused" }>;
  /** 品类名/术语字典，来源同为服务端 RENTAL_CATEGORY_DEFINITIONS；客户端据此显示品类名，不再本地维护映射（与员工端同源）。 */
  categories: Array<{ code: string; name: string }>;
  defaultServiceCode?: string;
  agreements?: {
    userAgreement: ClientChannelAgreementSummary;
    privacyPolicy: ClientChannelAgreementSummary;
  };
  /** 帮助与客服页：商户是否提供了帮助正文/常见问题。 */
  help: { available: boolean; faqCount: number };
  /** 首页横幅文案；缺省时客户端用品牌文案。 */
  banner?: { title: string; subtitle?: string };
  /** 客户端主题色（#RRGGBB）；客户端据此覆盖主色，未设置时用系统默认色。 */
  themeColor?: string;
  /** web 官网特有配置；仅在 `client=web` 且商户已启用官网渠道时返回，其余渠道恒为 undefined。 */
  website?: ClientWebsiteConfig;
  loginMethods: ClientLoginMethod[];
  capabilities: {
    publicCatalog: boolean;
    wechatPay: boolean;
    delivery: boolean;
    feeResponse: boolean;
    accountClosure: boolean;
  };
  source: "channel" | "workspace_directory";
}

/** 公开文档：协议与帮助正文，由租户级客户端渠道配置提供，游客可读。 */
export const CLIENT_PUBLIC_DOCUMENT_KINDS = ["user_agreement", "privacy_policy", "help"] as const;
export type ClientPublicDocumentKind = (typeof CLIENT_PUBLIC_DOCUMENT_KINDS)[number];

export interface ClientHelpFaqItem {
  question: string;
  answer: string;
}

export interface ClientPublicDocumentResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  tenantCode: string;
  kind: ClientPublicDocumentKind;
  name: string;
  /** 协议版本；帮助文档无版本。 */
  version?: string;
  url?: string;
  /** 简单富文本/纯文本正文；商户未提供时为空，客户端如实显示“商户未提供”。 */
  body?: string;
  /** 仅 help：说明与常见问题。 */
  intro?: string;
  faq?: ClientHelpFaqItem[];
  updatedAt?: string;
}

/** 游客公开目录：只按商户公开编码与已发布服务读取，不携带任何私有数据。 */
export interface ClientPublicCatalogQuery {
  tenantCode: string;
  service: string;
}

export const CLIENT_CHALLENGE_PURPOSES = ["registration", "login", "account_closure"] as const;
export type ClientChallengePurpose = (typeof CLIENT_CHALLENGE_PURPOSES)[number];

/**
 * 用途化验证码挑战（MP-02B）：证明只能用于创建时声明的用途；注册证明不能登录，登录证明不能注销。
 * `account_closure` 用途不接受客户端提交的手机号，只能由已登录会话对本人手机号发起。
 */
export interface ClientChallengeRequest extends ClientRegistrationChallengeRequest {
  purpose: Exclude<ClientChallengePurpose, "account_closure">;
}

/** 短信验证码登录：证明须绑定 login 用途、本租户与该手机号；手机号必须已注册。 */
export interface ClientSmsLoginRequest {
  tenantCode: string;
  loginIdentifier: string;
  verificationToken: string;
  workspaceCode?: string;
  clientId?: string;
}

/**
 * 微信手机号一键登录（MP-02A）。小程序只提交两个一次性凭证：wx.login 的 code 与手机号授权组件的 code；
 * openid、unionid 与手机号均由服务端持商户 AppSecret 向微信换取，客户端不能自报。
 */
export interface ClientWechatPhoneLoginRequest {
  tenantCode: string;
  appId?: string;
  loginCode: string;
  phoneCode: string;
  consent: ClientAgreementConsent;
  workspaceCode?: string;
  clientId?: string;
}

/** 已登录客户把当前微信身份绑定到本人（短信/密码登录后需要小程序支付时使用）。 */
export interface ClientWechatBindRequest {
  loginCode: string;
  appId?: string;
}

export interface ClientWechatBindResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  bound: boolean;
  appId: string;
  boundAt: string;
}

/** 小程序支付缺少可信微信身份时的稳定错误码（HTTP 409 响应体 `code`）。 */
export const CLIENT_WECHAT_IDENTITY_REQUIRED = "wechat_identity_required" as const;

/* ---------- MP-06：配送地址簿与订单交付快照 ---------- */

export interface ClientDeliveryAddressRequest {
  id?: string;
  /** 编辑时携带版本，防止并发覆盖。 */
  revision?: number;
  recipient: string;
  phone: string;
  countryCode?: string;
  province: string;
  city: string;
  district?: string;
  detail: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
}

export interface ClientDeliveryAddressView {
  id: string;
  revision: number;
  recipient: string;
  phoneMasked: string;
  countryCode: string;
  province: string;
  city: string;
  district?: string;
  detail: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  isDefault: boolean;
  updatedAt: string;
}

export interface ClientDeliveryAddressListResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  items: ClientDeliveryAddressView[];
}

/** 订单/报价上的配送地址快照（客户视图脱敏）；修改地址簿不改变已提交订单的快照。 */
export interface ClientDeliveryAddressSnapshot {
  addressId?: string;
  recipient: string;
  phoneMasked: string;
  countryCode: string;
  province: string;
  city: string;
  district?: string;
  detail: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  capturedAt: string;
}

/* ---------- MP-11：费用确认与异议 ---------- */

export interface ClientFeeItemView {
  inspectionId: string;
  exceptionIndex: number;
  stage: "pickup" | "return";
  code: string;
  description: string;
  /** 已批准的最终金额（复核后为最新金额）。 */
  amount: number;
  currency: string;
  reviewedAt?: string;
  responseStatus: "pending" | "confirmed" | "disputed";
  responseReason?: string;
  respondedAt?: string;
  adjustments: Array<{ fromAmount: number; toAmount: number; reason: string; adjustedAt: string }>;
  history: Array<{ decision: "confirmed" | "disputed"; reason: string; respondedAt: string }>;
  evidenceCount: number;
}

export interface ClientFeeItemsResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  orderId: string;
  items: ClientFeeItemView[];
  pendingCount: number;
}

export interface ClientFeeResponseRequest {
  decision: "confirmed" | "disputed";
  reason: string;
}

export interface ClientFeeResponseResult {
  apiVersion: typeof CLIENT_API_VERSION;
  item: ClientFeeItemView;
  replayed: boolean;
}

/* ---------- MP-02B：本人注销 ---------- */

export interface ClientAccountClosurePreview {
  apiVersion: typeof CLIENT_API_VERSION;
  closable: boolean;
  blockers: Array<{ code: string; message: string; count?: number }>;
  manualConfirmations: Array<{ code: string; message: string }>;
}

export interface ClientAccountClosureRequest {
  /** 必须与当前账号手机号一致，再次证明本人。 */
  loginIdentifier: string;
  /** account_closure 用途的验证码证明。 */
  verificationToken: string;
  /** 客户对系统无法自动核对项的显式确认；为 false 时拒绝。 */
  acknowledgedManualChecks: boolean;
  reason?: string;
}

export interface ClientAccountClosureResponse {
  apiVersion: typeof CLIENT_API_VERSION;
  closed: true;
  closedAt: string;
}
