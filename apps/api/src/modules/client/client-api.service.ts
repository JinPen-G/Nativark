import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import {
  CLIENT_API_VERSION,
  DEFAULT_RENTAL_PAYMENT_METHODS,
  RENTAL_PRICING_UNIT_LABELS,
  RentalCoreOrderStatus,
  type ClientCancellationPreview,
  type ClientCatalogLocation,
  type ClientCatalogResponse,
  type ClientCatalogStartingPrice,
  type ClientChannelBootstrapResponse,
  type ClientWebsiteConfig,
  type ClientChannelKind,
  type ClientLoginMethod,
  type ClientPublicDocumentKind,
  type ClientPublicDocumentResponse,
  type ClientFeeItemView,
  type ClientFeeItemsResponse,
  type ClientFeeResponseRequest,
  type ClientFeeResponseResult,
  type ClientMiniProgramPaymentIntentRequest,
  type ClientMyOrdersQuery,
  type ClientMyOrdersResponse,
  type MyOrderIndex,
  type MyOrderItemSummary,
  type ClientConfigResponse,
  type ClientContactRequest,
  type ClientContactView,
  type ClientCreateOrderRequest,
  type ClientCorporateIdentityListResponse,
  type ClientCreateQuoteRequest,
  type ClientFulfillmentView,
  type ClientMembershipAssignmentView,
  type ClientMembershipBenefitsResponse,
  type ClientMembershipPlansResponse,
  type ClientNotificationListResponse,
  type ClientOrderExtensionRequest,
  type ClientOrderView,
  type ClientPaymentSimulationRequest,
  type ClientPaymentIntentRequest,
  type ClientPaymentIntentResponse,
  type ClientPaymentCapabilitiesResponse,
  type ClientQualificationUploadSessionRequest,
  type ClientQualificationUploadCompleteRequest,
  type ClientQualificationUploadSessionResponse,
  type ClientQualificationFileUrlResponse,
  type ClientProfileUpdateRequest,
  type ClientProfileView,
  type ClientWorkspaceSummary,
  type CreateRentalOrderRequest,
  type CustomerMembershipPlanAssignment,
  type RentalOrder,
  type RentalPaymentMethod,
  type RentalQuoteRequest
} from "@rental-os/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { MembershipService } from "../platform/membership.service";
import { RentalCoreService } from "../rental-core/rental-core.service";
import { RentalCategoryResolver } from "../rental-core/rental-category-resolver.service";
import { RentalBusinessService, type BusinessContext } from "../rental-core/rental-business.service";
import { RentalOrderConfirmationService } from "../rental-core/rental-order-confirmation.service";
import { RentalIdempotentActionService } from "../rental-core/rental-idempotent-action.service";
import { RentalFundingService } from "../rental-core/rental-funding.service";
import { RentalServiceCapacityService } from "../rental-core/rental-service-capacity.service";
import { TenantIntegrationService } from "../integrations/tenant-integration.service";
import { PaymentRuntimeService } from "../integrations/payment.runtime.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { ClientAuthService, type ClientRequestContext } from "./client-auth.service";
import { RentalDocumentService } from "../rental-core/rental-document.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { ClientDeliveryAddressService } from "./client-delivery-address.service";
import { ClientWechatAuthService } from "./client-wechat-auth.service";
import { validateInspectionCustomerResponse } from "../rental-core/rental-inspection-customer-response";
import { runWithRequestIdentity } from "../../common/request-identity";

const DELIVERY_MODES = new Set<string>(["delivery", "onsite_delivery"]);

interface ClientOrderRequestContext {
  headers?: Record<string, unknown>;
}

function idempotencyKeyOf(req?: ClientOrderRequestContext) {
  const raw = req?.headers?.["idempotency-key"] ?? req?.headers?.["Idempotency-Key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (value.trim().length > 191) throw new BadRequestException("Idempotency-Key 最多 191 个字符");
  return value.trim();
}

/** 读取官网内容块 JSON（卖点/步骤/评价）：仅保留含全部必填字段的对象，字符串字段透传；无有效项返回 undefined。 */
function readWebsiteJsonList(value: unknown, required: string[]): Array<Record<string, string>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Array<Record<string, string>> = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const entry: Record<string, string> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) entry[k] = v;
    }
    if (required.every((key) => entry[key])) out.push(entry);
  }
  return out.length ? out : undefined;
}

@Injectable()
export class ClientApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: ClientAuthService,
    private readonly memberships: MembershipService,
    private readonly core: RentalCoreService,
    private readonly business: RentalBusinessService,
    private readonly orders: RentalOrderConfirmationService,
    private readonly idempotent: RentalIdempotentActionService,
    private readonly fundingService: RentalFundingService,
    private readonly serviceCapacities: RentalServiceCapacityService,
    private readonly tenantIntegrations: TenantIntegrationService,
    private readonly payments: PaymentRuntimeService,
    private readonly files: FileStorageRuntimeService,
    private readonly documents: RentalDocumentService,
    @Optional() private readonly corporateSettlement?: CustomerCorporateSettlementService,
    @Optional() private readonly addresses?: ClientDeliveryAddressService,
    @Optional() private readonly wechat?: ClientWechatAuthService,
    private readonly categoryResolver?: RentalCategoryResolver
  ) {}

  private async context(tenantId: string): Promise<BusinessContext> {
    const profile = this.core.getProfile(tenantId);
    const category = await this.core.getWorkspaceCategory(tenantId);
    return {
      profile,
      category,
      settings: this.core.getBusinessSettings(tenantId),
      groups: this.core.listItemGroups(tenantId),
      pricingGroups: this.core.listPricingGroups(tenantId),
      couponTemplates: this.core.listCouponTemplates(tenantId),
      locations: this.core.listLocations(tenantId),
      operators: this.core.listOperators(tenantId)
    };
  }

  private requireActiveMembership(context: ClientRequestContext) {
    if (context.membershipStatus !== "active") throw new ForbiddenException("租户会员关系尚未生效或已受限，暂不能进行租赁业务");
  }

  private clientOwnsOrder(context: ClientRequestContext, order: { tenantId: string; customerId?: string | null; membershipSnapshot?: unknown }) {
    const snapshot = order.membershipSnapshot;
    const personalCustomerId = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && "personalCustomerId" in snapshot
      ? snapshot.personalCustomerId : undefined;
    // 不用付款企业、签约企业或当前员工关系扩展范围：同事不是订单本人。
    return order.tenantId === context.tenantId && (order.customerId === context.customerId || personalCustomerId === context.customerId);
  }

  private async assertClientOrder(context: ClientRequestContext, orderId: string) {
    const order = await this.core.getOrder(context.tenantId, orderId);
    if (order.id !== orderId || !this.clientOwnsOrder(context, order)) throw new NotFoundException("订单不存在");
    return order;
  }

  private orderView(order: RentalOrder, fallbackDeliveryAddress?: ClientOrderView["deliveryAddress"]): ClientOrderView {
    // 收货地址事实源已收敛到订单快照（core 下单时固化）；旧订单没有该快照时回落到客户端旁表快照。
    // 客户视图一律脱敏：只取 phoneMasked，绝不下发订单快照里的明文电话。
    const snapshot = order.deliveryAddressSnapshot;
    const deliveryAddress: ClientOrderView["deliveryAddress"] = snapshot
      ? {
          addressId: snapshot.addressId,
          recipient: snapshot.recipient,
          phoneMasked: snapshot.phoneMasked,
          countryCode: snapshot.countryCode,
          province: snapshot.province,
          city: snapshot.city,
          district: snapshot.district,
          detail: snapshot.detail,
          postalCode: snapshot.postalCode,
          latitude: snapshot.latitude,
          longitude: snapshot.longitude,
          // 快照本身不带采集时点，用订单创建时间近似（客户视图仅作展示）。
          capturedAt: order.createdAt
        }
      : fallbackDeliveryAddress;
    return {
      deliveryAddress,
      id: order.id,
      orderNo: order.orderNo,
      status: String(order.status),
      customerName: order.customerName,
      fulfillmentMode: order.fulfillmentMode,
      fulfillmentLocationName: order.fulfillmentLocationName,
      returnLocationName: order.returnLocationName,
      startAt: order.startAt,
      endAt: order.endAt,
      effectiveEndAt: order.effectiveEndAt,
      rentalAmount: order.rentalAmount,
      discountAmount: order.discountAmount,
      couponAmount: order.couponAmount,
      serviceAmount: order.serviceAmount,
      fulfillmentAmount: order.fulfillmentAmount,
      depositAmount: order.depositAmount,
      preAuthAmount: order.preAuthAmount,
      payableAmount: order.payableAmount,
      adjustmentAmount: order.adjustmentAmount,
      finalPayableAmount: order.finalPayableAmount,
      currency: order.currency,
      lines: order.lines.map((line) => ({
        id: line.id,
        itemGroupId: line.itemGroupId,
        itemGroupName: line.itemGroupName,
        pricingGroupId: line.pricingGroupId,
        pricingGroupName: line.pricingGroupName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount
      })),
      chargeLines: order.chargeLines.map((line) => ({ type: line.type, name: line.name, amount: line.amount, quantity: undefined, unitPrice: undefined })),
      allocations: order.allocations?.map((row) => ({ id: row.id, orderLineId: row.orderLineId, quantity: row.quantity, status: row.status, assetNo: row.assetNo })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };
  }

  async catalog(context: ClientRequestContext): Promise<ClientCatalogResponse> {
    const workspaces = await this.auth.listPublicWorkspaces(context.tenantCode);
    const workspace = workspaces.workspaces.find((row) => row.code === context.workspaceCode);
    if (!workspace) throw new NotFoundException("当前经营空间尚未开放客户端服务");
    return this.buildCatalog(context.tenantId, context.tenantCode, {
      workspaceCode: context.workspaceCode,
      workspaceName: context.workspaceName,
      categoryCode: context.categoryCode,
      membershipStatus: context.membershipStatus,
      isDefault: workspace.isDefault
    });
  }

  /**
   * MP-03 公开游客目录：只按商户公开编码与**已发布到小程序渠道**的服务读取。
   * 与登录目录同一投影（白名单字段），在服务端按该空间建立请求上下文；没有渠道发布则 404，
   * 不因空间 active 就自动对游客开放。
   */
  async publicCatalog(tenantCode: string, serviceCode: string): Promise<ClientCatalogResponse> {
    const tenant = await this.prisma.tenant.findFirst({ where: { code: tenantCode.trim(), status: "ACTIVE" }, select: { id: true, code: true } });
    if (!tenant) throw new NotFoundException("商户不存在");
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { tenantId: tenant.id, code: serviceCode.trim(), status: "ACTIVE", clientChannelPublications: { some: { tenantId: tenant.id, enabled: true } } },
      select: { id: true, code: true, name: true, categoryCode: true, isDefault: true }
    });
    if (!workspace) throw new NotFoundException("该服务尚未开放游客浏览");
    return runWithRequestIdentity({ tenantId: tenant.id, workspaceId: workspace.id, isSaasAdmin: false }, () =>
      this.buildCatalog(tenant.id, tenant.code, { workspaceCode: workspace.code, workspaceName: workspace.name, categoryCode: String(workspace.categoryCode), membershipStatus: "guest", isDefault: workspace.isDefault })
    );
  }

  /** 游客读取已发布服务的商品图片：同一白名单与同一图片读取器，不暴露本地路径。 */
  async readPublicCatalogItemImage(tenantCode: string, serviceCode: string, itemGroupId: string, imageId: string) {
    const tenant = await this.prisma.tenant.findFirst({ where: { code: tenantCode.trim(), status: "ACTIVE" }, select: { id: true } });
    if (!tenant) throw new NotFoundException("商户不存在");
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { tenantId: tenant.id, code: serviceCode.trim(), status: "ACTIVE", clientChannelPublications: { some: { tenantId: tenant.id, enabled: true } } },
      select: { id: true }
    });
    if (!workspace) throw new NotFoundException("该服务尚未开放游客浏览");
    return runWithRequestIdentity({ tenantId: tenant.id, workspaceId: workspace.id, isSaasAdmin: false }, async () => {
      const business = (await this.context(tenant.id));
      const item = business.groups.find((group) => group.id === itemGroupId && group.status === "enabled");
      if (!item) throw new NotFoundException("商品不存在");
      return this.core.readItemGroupImage(tenant.id, itemGroupId, imageId);
    });
  }

  /**
   * 渠道启动配置（MP-01 / CLIENT-CHANNEL-01）：品牌/协议/客服/帮助/横幅/已发布服务来自租户级
   * ClientChannelProfile，小程序与 APP 读同一份；微信一键登录与小程序内微信支付只在
   * `client=wechat_miniprogram` 且微信凭证就绪时开放。未发布任何空间时只返回租户名与客户端登录入口，
   * 不以 ACTIVE 状态代替渠道发布。
   */
  async channelBootstrap(tenantCode: string, client: ClientChannelKind = "wechat_miniprogram", appId?: string): Promise<ClientChannelBootstrapResponse> {
    const tenant = await this.prisma.tenant.findFirst({ where: { code: tenantCode.trim(), status: "ACTIVE" }, select: { id: true, code: true, name: true } });
    if (!tenant) throw new NotFoundException("商户不存在");
    const profile = await this.prisma.clientChannelProfile.findUnique({
      where: { tenantId: tenant.id },
      include: { publishedWorkspaces: { where: { enabled: true }, include: { workspace: { select: { code: true, name: true, categoryCode: true, isDefault: true, status: true } } } } }
    });
    // APPEARANCE-01：品牌标识/主题色已拆到独立「品牌与外观」领域，为唯一真源；缺行时回退旧渠道列（过渡期仍在库）。
    const appearance = await this.prisma.tenantAppearanceProfile.findUnique({
      where: { tenantId: tenant.id },
      select: { brandName: true, brandLogoUrl: true, faviconUrl: true, themeColor: true, adminLoginJson: true }
    });
    const adminLogin = client === "web" ? (appearance?.adminLoginJson ?? undefined) as ClientChannelBootstrapResponse["adminLogin"] : undefined;
    const brandName = appearance?.brandName?.trim() || profile?.brandName?.trim() || tenant.name;
    const brandLogoUrl = appearance?.brandLogoUrl ?? profile?.brandLogoUrl ?? undefined;
    const brandFaviconUrl = appearance?.faviconUrl ?? profile?.faviconUrl ?? undefined;
    const brandThemeColor = appearance?.themeColor ?? profile?.themeColor ?? undefined;
    const isMiniProgram = client === "wechat_miniprogram";
    const wechatChannel = isMiniProgram
      ? await this.prisma.miniProgramChannel.findFirst({ where: { tenantId: tenant.id, enabled: true, ...(appId?.trim() ? { appId: appId.trim() } : {}) }, select: { appSecretEncrypted: true }, orderBy: { updatedAt: "desc" } })
      : null;
    const wechatReady = Boolean(wechatChannel?.appSecretEncrypted);
    const integrationCatalog = await this.tenantIntegrations.catalog(tenant.id);
    const wechatPayReady = integrationCatalog.configs.some((item) => item.capability === "payment" && item.provider === "wechat_pay" && item.enabled && item.isDefault && item.lastTestStatus === "passed" && item.lastTestMode === "live");
    const smsReady = integrationCatalog.configs.some((item) => item.capability === "sms" && item.enabled && item.isDefault) || process.env.NODE_ENV !== "production";

    // WEBSITE-CHANNEL-01：仅 web 渠道叠加官网特有配置；其余渠道恒为 undefined。
    const website = client === "web" ? await this.websiteConfig(tenant.id) : undefined;

    // 只公开租户明确发布的有效空间；无发布时不回退经营空间目录。
    const publishedActive = (profile?.publishedWorkspaces ?? []).filter((row) => row.workspace.status === "ACTIVE");
    // 公开目录仅投影租户已发布空间的采用版本，不泄露平台未开放品类或治理配置。
    const definitions = await Promise.all(publishedActive.map(async (row) => this.categoryResolver
      ? (await this.categoryResolver.forWorkspace(tenant.id, row.workspaceId)).definition
      : this.core.listCategories().find((category) => category.code === String(row.workspace.categoryCode).toLowerCase())));
    const categories = [...new Map(definitions.filter((row) => row !== undefined)
      .map((row) => [String(row!.code), { code: String(row!.code), name: row!.name }])).values()];
    const loginMethods: ClientLoginMethod[] = [
      ...(isMiniProgram && wechatReady ? ["wechat_phone" as const] : []),
      ...((profile?.smsLoginEnabled ?? true) && smsReady ? ["sms" as const] : []),
      ...((profile?.passwordLoginEnabled ?? true) ? ["password" as const] : [])
    ];
    // An empty list is meaningful: all login methods are disabled or unavailable.
    // Do not advertise a password fallback that the server must reject.
    const safeLoginMethods = loginMethods;

    if (!profile || publishedActive.length === 0) {
      // 未发布渠道不回退 ACTIVE 空间列表；只保留租户级登录/帮助入口，禁止客户端
      // 发现新空间后继续浏览、注册或发起新订单。既有会话的订单售后 API 不依赖此目录。
      const services: ClientChannelBootstrapResponse["services"] = [];
      return {
        apiVersion: CLIENT_API_VERSION,
        tenantCode: tenant.code,
        client,
        merchant: { name: brandName, logoUrl: brandLogoUrl, faviconUrl: brandFaviconUrl, servicePhone: profile?.customerServicePhone ?? undefined, serviceHours: profile?.customerServiceHours ?? undefined },
        services,
        categories,
        defaultServiceCode: undefined,
        help: { available: false, faqCount: 0 },
        loginMethods: safeLoginMethods,
        capabilities: { publicCatalog: false, wechatPay: false, delivery: false, feeResponse: true, accountClosure: true },
        website,
        adminLogin,
        source: "workspace_directory"
      };
    }

    const published = publishedActive.map((row) => row.workspace);
    const services = published.map((row) => ({ code: row.code, name: row.name, categoryCode: String(row.categoryCode), isDefault: row.isDefault, status: "open" as const }));
    const defaultServiceCode = publishedActive.find((p) => p.workspaceId === profile.defaultWorkspaceId)?.workspace.code
      ?? services.find((row) => row.isDefault)?.code ?? services[0]?.code;
    const deliveryEnabled = published.length > 0 && await this.anyWorkspaceEnablesDelivery(tenant.id, published.map((row) => row.code));
    const agreements = profile.userAgreementVersion && profile.privacyPolicyVersion
      ? {
          userAgreement: { name: profile.userAgreementName?.trim() || "用户服务协议", version: profile.userAgreementVersion, url: profile.userAgreementUrl ?? undefined, hasBody: Boolean(profile.userAgreementBody?.trim()) },
          privacyPolicy: { name: profile.privacyPolicyName?.trim() || "隐私政策", version: profile.privacyPolicyVersion, url: profile.privacyPolicyUrl ?? undefined, hasBody: Boolean(profile.privacyPolicyBody?.trim()) }
        }
      : undefined;
    const faqCount = Array.isArray(profile.helpFaqJson) ? profile.helpFaqJson.length : 0;
    return {
      apiVersion: CLIENT_API_VERSION,
      tenantCode: tenant.code,
      client,
      merchant: { name: brandName, logoUrl: brandLogoUrl, faviconUrl: brandFaviconUrl, servicePhone: profile.customerServicePhone ?? undefined, serviceHours: profile.customerServiceHours ?? undefined },
      services,
      categories,
      defaultServiceCode,
      agreements,
      help: { available: Boolean(profile.helpIntro?.trim()) || faqCount > 0, faqCount },
      banner: profile.bannerTitle?.trim() ? { title: profile.bannerTitle.trim(), subtitle: profile.bannerSubtitle?.trim() || undefined } : undefined,
      themeColor: brandThemeColor,
      loginMethods: safeLoginMethods,
      capabilities: { publicCatalog: services.length > 0, wechatPay: isMiniProgram && wechatPayReady && wechatReady, delivery: deliveryEnabled, feeResponse: true, accountClosure: true },
      website,
      adminLogin,
      source: "channel"
    };
  }

  /** WEBSITE-CHANNEL-01：读取 web 官网渠道的公开配置；未配置或未启用时返回 undefined，官网回退到通用品牌文案。 */
  private async websiteConfig(tenantId: string): Promise<ClientWebsiteConfig | undefined> {
    const row = await this.prisma.websiteChannelProfile.findUnique({ where: { tenantId } });
    if (!row || !row.enabled) return undefined;
    return {
      slogan: row.slogan ?? undefined,
      heroTitle: row.heroTitle ?? undefined,
      heroDescription: row.heroDescription ?? undefined,
      heroImageUrl: row.heroImageUrl ?? undefined,
      secondaryColor: row.secondaryColor ?? undefined,
      footerText: row.footerText ?? undefined,
      contactAddress: row.contactAddress ?? undefined,
      ctaTitle: row.ctaTitle ?? undefined,
      ctaDescription: row.ctaDescription ?? undefined,
      seoTitle: row.seoTitle ?? undefined,
      seoDescription: row.seoDescription ?? undefined,
      seoKeywords: row.seoKeywords ?? undefined,
      categoryImages: Array.isArray(row.categoryImagesJson)
        ? (row.categoryImagesJson as unknown[]).flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const code = typeof (entry as Record<string, unknown>).code === "string" ? String((entry as Record<string, unknown>).code) : "";
            const imageUrl = typeof (entry as Record<string, unknown>).imageUrl === "string" ? String((entry as Record<string, unknown>).imageUrl) : "";
            return code && imageUrl ? [{ code, imageUrl }] : [];
          })
        : undefined,
      advantages: readWebsiteJsonList(row.advantagesJson, ["title"]) as ClientWebsiteConfig["advantages"],
      steps: readWebsiteJsonList(row.stepsJson, ["title"]) as ClientWebsiteConfig["steps"],
      testimonials: readWebsiteJsonList(row.testimonialsJson, ["name", "text"]) as ClientWebsiteConfig["testimonials"],
      showPoweredBy: row.showPoweredBy
    };
  }

  /**
   * WEBSITE-CHANNEL-02：按 Host 反查租户编码。一套前端服务多租户时，自定义域名（www.brand.com）
   * 经边缘回源后由后端据此定位租户；只匹配已启用官网渠道且域名精确一致（小写）的租户。
   * 命中返回 { tenantCode }；未绑定返回 { tenantCode: null }（客户端据此回退，而非报错）。
   */
  async resolveWebsiteHost(host: string): Promise<{ tenantCode: string | null }> {
    const normalized = host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
    if (!normalized) return { tenantCode: null };
    const row = await this.prisma.websiteChannelProfile.findFirst({
      where: { customDomain: normalized, enabled: true },
      select: { tenant: { select: { code: true, status: true } } }
    });
    if (!row?.tenant || row.tenant.status !== "ACTIVE") return { tenantCode: null };
    return { tenantCode: row.tenant.code };
  }

  /** 公开文档：协议正文与帮助内容（游客可读），来自租户级客户端渠道配置。 */
  async publicDocument(tenantCode: string, kind: ClientPublicDocumentKind): Promise<ClientPublicDocumentResponse> {
    const tenant = await this.prisma.tenant.findFirst({ where: { code: tenantCode.trim(), status: "ACTIVE" }, select: { id: true, code: true } });
    if (!tenant) throw new NotFoundException("商户不存在");
    const profile = await this.prisma.clientChannelProfile.findUnique({ where: { tenantId: tenant.id } });
    if (!profile) throw new NotFoundException("商户尚未配置客户端渠道");
    const base = { apiVersion: CLIENT_API_VERSION, tenantCode: tenant.code, kind, updatedAt: profile.updatedAt.toISOString() } as const;
    if (kind === "help") {
      const faq = Array.isArray(profile.helpFaqJson)
        ? (profile.helpFaqJson as unknown[]).flatMap((row) => {
            if (!row || typeof row !== "object" || Array.isArray(row)) return [];
            const question = typeof (row as Record<string, unknown>).question === "string" ? String((row as Record<string, unknown>).question) : "";
            const answer = typeof (row as Record<string, unknown>).answer === "string" ? String((row as Record<string, unknown>).answer) : "";
            return question && answer ? [{ question, answer }] : [];
          })
        : [];
      if (!profile.helpIntro?.trim() && faq.length === 0) throw new NotFoundException("商户尚未提供帮助内容");
      return { ...base, name: "帮助与客服", intro: profile.helpIntro ?? undefined, faq };
    }
    const isAgreement = kind === "user_agreement";
    const name = isAgreement ? profile.userAgreementName : profile.privacyPolicyName;
    const version = isAgreement ? profile.userAgreementVersion : profile.privacyPolicyVersion;
    const url = isAgreement ? profile.userAgreementUrl : profile.privacyPolicyUrl;
    const body = isAgreement ? profile.userAgreementBody : profile.privacyPolicyBody;
    if (!version?.trim()) throw new NotFoundException("商户尚未提供该文档");
    return { ...base, name: name?.trim() || (isAgreement ? "用户服务协议" : "隐私政策"), version: version.trim(), url: url?.trim() || undefined, body: body?.trim() || undefined };
  }

  private async anyWorkspaceEnablesDelivery(tenantId: string, workspaceCodes: string[]): Promise<boolean> {
    const rows = await this.prisma.businessWorkspace.findMany({ where: { tenantId, code: { in: workspaceCodes } }, select: { id: true } });
    for (const row of rows) {
      try {
        const enabled = runWithRequestIdentity({ tenantId, workspaceId: row.id, isSaasAdmin: false }, () => this.core.getBusinessSettings(tenantId).fulfillment.enabledModes);
        if (enabled.some((mode) => DELIVERY_MODES.has(mode))) return true;
      } catch {
        // 空间未初始化经营配置：不视为支持配送。
      }
    }
    return false;
  }

  private async buildCatalog(tenantId: string, tenantCode: string, summary: ClientWorkspaceSummary): Promise<ClientCatalogResponse> {
    const business = (await this.context(tenantId));
    const context = { tenantId, tenantCode, workspaceCode: summary.workspaceCode, workspaceName: summary.workspaceName, categoryCode: summary.categoryCode, membershipStatus: summary.membershipStatus };
    const workspace = summary;
    // 参考起价：当前生效价格版本中，覆盖该型号（直接或经其定价分组）的最低基础单价。
    // 没有生效版本时不给价格，客户端显示“选租期查看报价”，不能以 0 元替代。
    const rates = await this.business.listSpaceRatesAt(context.tenantId, business, new Date().toISOString());
    const enabledPricingGroups = (business.pricingGroups ?? []).filter((group) => group.status === "enabled");
    const currency = business.settings.pricing.currency;
    const startingPriceOf = (itemGroupId: string): ClientCatalogStartingPrice | undefined => {
      let best: ClientCatalogStartingPrice | undefined;
      for (const rate of rates) {
        const targetsItem = rate.pricingGroupId
          ? enabledPricingGroups.some((group) => group.id === rate.pricingGroupId && group.memberItemGroupIds.includes(itemGroupId))
          : rate.itemGroupId === itemGroupId;
        if (!targetsItem || typeof rate.baseAmount !== "number" || !Number.isFinite(rate.baseAmount) || rate.baseAmount < 0) continue;
        if (!best || rate.baseAmount < best.amount) best = { amount: rate.baseAmount, unit: rate.unit, currency };
      }
      return best;
    };
    return {
      apiVersion: "v1",
      tenantCode: context.tenantCode,
      workspace: {
        workspaceCode: context.workspaceCode,
        workspaceName: context.workspaceName,
        categoryCode: context.categoryCode,
        membershipStatus: context.membershipStatus,
        isDefault: workspace?.isDefault
      } satisfies ClientWorkspaceSummary,
      categoryCode: business.profile.categoryCode,
      terminology: {
        itemLabel: business.category.terminology.itemLabel,
        itemGroupLabel: business.category.terminology.itemGroupLabel,
        assetLabel: business.category.terminology.assetLabel,
        fulfillmentLabel: business.category.terminology.fulfillmentLabel,
        pickupLabel: business.category.terminology.pickupLabel,
        returnLabel: business.category.terminology.returnLabel,
        deliveryLabel: business.category.terminology.deliveryLabel,
        usageMetricLabel: business.category.terminology.usageMetricLabel
      },
      pricingUnits: business.category.businessModel.pricingUnits.map((code) => ({
        code,
        label: code === "usage"
          ? business.category.terminology.usageMetricLabel ?? RENTAL_PRICING_UNIT_LABELS[code]
          : RENTAL_PRICING_UNIT_LABELS[code]
      })),
      timeZone: business.settings.calendar.timeZone ?? "Asia/Shanghai",
      items: business.groups.filter((item) => item.status === "enabled").map((item) => ({ id: item.id, code: item.code, name: item.name, description: item.description, inventoryMode: item.inventoryMode, images: item.images?.map((image) => ({ url: summary.membershipStatus === "guest" ? `/api/client/v1/public/catalog/items/${encodeURIComponent(item.id)}/images/${encodeURIComponent(image.id)}?tenantCode=${encodeURIComponent(tenantCode)}&service=${encodeURIComponent(summary.workspaceCode)}` : `/api/client/v1/catalog/items/${encodeURIComponent(item.id)}/images/${encodeURIComponent(image.id)}`, alt: image.fileName })), attributes: item.attributes, startingPrice: startingPriceOf(item.id) })),
      pricingGroups: enabledPricingGroups.map((group) => ({ id: group.id, code: group.code, name: group.name, memberItemGroupIds: group.memberItemGroupIds, enabled: group.status === "enabled" })),
      services: this.business.listServices(context.tenantId, business).filter((service) => service.status === "enabled").map((service) => ({ id: service.id, code: service.code, name: service.name, description: service.terms, pricingUnit: service.billingUnit, enabled: true })),
      // 地点只投影客户可见的公开信息：地址、营业时段、门店电话与取还能力；经营主体与结算方式不外露。
      locations: business.locations.filter((location) => location.status === "enabled").map((location): ClientCatalogLocation => ({ id: location.id, code: location.code, name: location.name, status: location.status, address: location.address || undefined, latitude: location.latitude, longitude: location.longitude, businessHours: location.businessHours || undefined, contactPhone: location.contactPhone || undefined, capabilities: location.capabilities })),
      discountPlans: this.business.listDiscountPlans(context.tenantId, business).filter((plan) => plan.status === "enabled").map((plan) => ({ id: plan.id, code: plan.code, name: plan.name, status: plan.status })),
      fulfillment: {
        enabledModes: business.settings.fulfillment?.enabledModes ?? [],
        // 异地归还是规则版本的字段（报价按同一规则校验），不是经营设置；没有生效规则时视为不允许。
        allowDifferentReturnLocation: this.business.effectiveRuleAt(tenantId, business)?.config.fulfillment.allowDifferentReturnLocation ?? false,
        // 配送目的地策略与配送文案取自品类定义/术语，客户端据此类型安全分流「选地址 vs 选据点」。
        deliveryDestination: business.category.businessModel.deliveryDestination,
        deliveryLabel: business.category.terminology.deliveryLabel,
        pickupLabel: business.category.terminology.pickupLabel,
        returnLabel: business.category.terminology.returnLabel
      }
    };
  }

  async readCatalogItemImage(context: ClientRequestContext, itemGroupId: string, imageId: string) {
    const business = (await this.context(context.tenantId));
    const item = business.groups.find((group) => group.id === itemGroupId && group.status === "enabled");
    if (!item) throw new NotFoundException("商品不存在");
    return this.core.readItemGroupImage(context.tenantId, itemGroupId, imageId);
  }

  private async currentWorkspace(context: ClientRequestContext) {
    const directory = await this.auth.listPublicWorkspaces(context.tenantCode);
    const workspace = directory.workspaces.find((row) => row.code === context.workspaceCode);
    if (!workspace) throw new NotFoundException("当前经营空间不存在或未启用");
    return workspace;
  }

  private maskPhone(value: string) {
    const phone = value.trim();
    return phone.length <= 4 ? "****" : `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }

  private normalizePhone(value: string) {
    const phone = value.trim().replace(/[\s-]/gu, "");
    if (!/^\+?[0-9]{6,20}$/u.test(phone)) throw new BadRequestException("联系人手机号格式无效");
    return phone;
  }

  private async profileRow(context: ClientRequestContext) {
    const row = await this.prisma.customerProfile.findFirst({
      where: { tenantId: context.tenantId, id: context.customerId },
      select: {
        id: true,
        customerType: true,
        name: true,
        phoneMasked: true,
        email: true,
        identityVerified: true,
        identityNoMasked: true,
        account: { select: { status: true } },
        corporateProfile: {
          select: {
            legalName: true,
            unifiedSocialCreditCodeMasked: true,
            registeredAddress: true,
            industry: true,
            scale: true,
            status: true
          }
        },
        contacts: {
          where: { status: "active" },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: { id: true, kind: true, name: true, phoneMasked: true, email: true, relation: true, isPrimary: true, status: true }
        }
      }
    });
    if (!row || !row.account) throw new UnauthorizedException("客户账号不存在");
    return row;
  }

  async config(context: ClientRequestContext): Promise<ClientConfigResponse> {
    const business = (await this.context(context.tenantId));
    const workspace = await this.currentWorkspace(context);
    const registration = await this.prisma.customerMembershipRegistrationSettings.findUnique({
      where: { tenantId: context.tenantId },
      select: { registrationMode: true }
    });
    const integrationCatalog = await this.tenantIntegrations.catalog(context.tenantId);
    const smsConfigured = integrationCatalog.configs.some((item) => item.capability === "sms" && item.enabled && item.isDefault);
    const smsReady = integrationCatalog.configs.some((item) => item.capability === "sms" && item.enabled && item.isDefault && item.lastTestStatus === "passed" && item.lastTestMode === "live");
    const payment = this.buildPaymentCapabilities(integrationCatalog.configs, business.settings.payment.enabledMethods);
    return {
      apiVersion: CLIENT_API_VERSION,
      tenantCode: context.tenantCode,
      workspace: {
        workspaceCode: workspace.code,
        workspaceName: workspace.name,
        categoryCode: String(workspace.categoryCode),
        membershipStatus: context.membershipStatus,
        isDefault: workspace.isDefault
      },
      categoryCode: business.profile.categoryCode,
      timeZone: business.settings.calendar.timeZone ?? "Asia/Shanghai",
      registration: {
        mode: registration?.registrationMode === "automatic" ? "automatic" : "manual",
        verificationMethods: ["sms", "email"],
        providerMode: smsReady ? "provider" : smsConfigured || process.env.NODE_ENV === "production" ? "provider_pending" : "development"
      },
      features: {
        profile: true,
        contacts: true,
        membershipPlans: true,
        qualifications: true,
        coupons: true,
        orderExtensions: true,
        notifications: true,
        delivery: business.settings.fulfillment.enabledModes.some((mode) => DELIVERY_MODES.has(mode)),
        feeResponse: true,
        accountClosure: true,
        wechatBinding: this.wechat ? await this.wechat.channelReady(context.tenantId) : false
      },
      payment
    };
  }

  private buildPaymentCapabilities(
    configs: Array<{ capability: string; provider: string; enabled: boolean; isDefault?: boolean; lastTestStatus?: string; lastTestMode?: string }> = [],
    configuredMethods: RentalPaymentMethod[] = DEFAULT_RENTAL_PAYMENT_METHODS
  ): ClientPaymentCapabilitiesResponse {
    const development = process.env.NODE_ENV !== "production";
    const enabledMethods = [...new Set(configuredMethods?.length ? configuredMethods : DEFAULT_RENTAL_PAYMENT_METHODS)];
    const offlineMethods = enabledMethods.filter((method): method is "offline_cash" | "offline_transfer" => method === "offline_cash" || method === "offline_transfer");
    const providerMethods = configs
      .filter((item) => item.capability === "payment" && item.enabled && item.isDefault && item.lastTestStatus === "passed" && item.lastTestMode === "live" && enabledMethods.includes(item.provider as RentalPaymentMethod))
      .map((item) => item.provider)
      .filter((item): item is "alipay" | "wechat_pay" => item === "alipay" || item === "wechat_pay");
    if (providerMethods.length > 0) {
      return {
        apiVersion: CLIENT_API_VERSION,
        mode: "provider",
        realPaymentEnabled: true,
        methods: [...new Set([...offlineMethods, ...providerMethods])],
        // 首批支付宝/微信适配器只做普通租金收款；押金/预授权必须继续走独立资金能力，
        // 不能因为“已配置支付平台”就在客户端宣称三类资金都能真实处理。
        instruments: ["rental"]
      };
    }
    const providerPending = configs.some((item) => item.capability === "payment" && item.enabled && item.isDefault && (item.provider === "alipay" || item.provider === "wechat_pay") && enabledMethods.includes(item.provider));
    return {
      apiVersion: CLIENT_API_VERSION,
      mode: providerPending || !development ? "provider_pending" : "simulation_only",
      realPaymentEnabled: false,
      methods: [...offlineMethods, ...(development ? ["simulation" as const] : [])],
      instruments: ["rental", "deposit", "preauthorization"]
    };
  }

  async paymentCapabilities(context: ClientRequestContext): Promise<ClientPaymentCapabilitiesResponse> {
    const business = (await this.context(context.tenantId));
    const catalog = await this.tenantIntegrations.catalog(context.tenantId);
    return this.buildPaymentCapabilities(catalog.configs, business.settings.payment.enabledMethods);
  }

  async profile(context: ClientRequestContext): Promise<ClientProfileView> {
    const [row, workspace] = await Promise.all([this.profileRow(context), this.currentWorkspace(context)]);
    return {
      apiVersion: CLIENT_API_VERSION,
      customerId: row.id,
      customerType: row.customerType as ClientProfileView["customerType"],
      name: row.name,
      phoneMasked: row.phoneMasked,
      email: row.email ?? undefined,
      identityVerified: row.identityVerified,
      identityNoMasked: row.identityNoMasked ?? undefined,
      accountStatus: row.account!.status as ClientProfileView["accountStatus"],
      workspace: {
        workspaceCode: workspace.code,
        workspaceName: workspace.name,
        categoryCode: String(workspace.categoryCode),
        membershipStatus: context.membershipStatus,
        isDefault: workspace.isDefault
      },
      corporate: row.corporateProfile
        ? {
            legalName: row.corporateProfile.legalName,
            unifiedSocialCreditCodeMasked: row.corporateProfile.unifiedSocialCreditCodeMasked,
            registeredAddress: row.corporateProfile.registeredAddress ?? undefined,
            industry: row.corporateProfile.industry ?? undefined,
            scale: row.corporateProfile.scale ?? undefined,
            status: row.corporateProfile.status
          }
        : undefined,
      contacts: row.contacts.map((contact): ClientContactView => ({
        id: contact.id,
        kind: contact.kind as ClientContactView["kind"],
        name: contact.name,
        phoneMasked: contact.phoneMasked,
        email: contact.email ?? undefined,
        relation: contact.relation ?? undefined,
        isPrimary: contact.isPrimary,
        status: contact.status
      }))
    };
  }

  async updateProfile(context: ClientRequestContext, input: ClientProfileUpdateRequest) {
    const data: Prisma.CustomerProfileUpdateManyMutationInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException("姓名不能为空");
      data.name = name;
    }
    if (input.email !== undefined) data.email = input.email?.trim() || null;
    if (Object.keys(data).length > 0) {
      const updated = await this.memberships.updateOwnProfile(context.tenantId, context.customerId, data);
      if (!updated) throw new NotFoundException("客户资料不存在");
    }
    return this.profile(context);
  }

  async contacts(context: ClientRequestContext) {
    const row = await this.profileRow(context);
    return {
      apiVersion: CLIENT_API_VERSION,
      items: row.contacts.map((contact): ClientContactView => ({
        id: contact.id,
        kind: contact.kind as ClientContactView["kind"],
        name: contact.name,
        phoneMasked: contact.phoneMasked,
        email: contact.email ?? undefined,
        relation: contact.relation ?? undefined,
        isPrimary: contact.isPrimary,
        status: contact.status
      }))
    };
  }

  async saveContact(context: ClientRequestContext, input: ClientContactRequest) {
    if (input.kind === "corporate" && context.customerType !== "corporate") {
      throw new ForbiddenException("个人会员不能维护企业联系人");
    }
    const phone = this.normalizePhone(input.phone);
    const name = input.name.trim();
    if (!name) throw new BadRequestException("联系人姓名不能为空");
    const saved = await this.prisma.$transaction(async (tx) => {
      let existing = input.id
        ? await tx.customerContact.findFirst({ where: { tenantId: context.tenantId, customerId: context.customerId, id: input.id, status: "active" } })
        : undefined;
      if (input.id && !existing) throw new NotFoundException("联系人不存在");
      if (input.isPrimary) {
        await tx.customerContact.updateMany({ where: { tenantId: context.tenantId, customerId: context.customerId, kind: input.kind, status: "active", isPrimary: true, ...(input.id ? { id: { not: input.id } } : {}) }, data: { isPrimary: false } });
      }
      if (existing) {
        existing = await tx.customerContact.update({
          where: { id: existing.id },
          data: { kind: input.kind, name, phone, phoneMasked: this.maskPhone(phone), email: input.email?.trim() || null, relation: input.relation?.trim() || null, isPrimary: input.isPrimary ?? existing.isPrimary }
        });
      } else {
        existing = await tx.customerContact.create({
          data: { tenantId: context.tenantId, customerId: context.customerId, kind: input.kind, name, phone, phoneMasked: this.maskPhone(phone), email: input.email?.trim() || null, relation: input.relation?.trim() || null, isPrimary: input.isPrimary ?? false, status: "active" }
        });
      }
      return existing;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return {
      id: saved.id,
      kind: saved.kind as ClientContactView["kind"],
      name: saved.name,
      phoneMasked: saved.phoneMasked,
      email: saved.email ?? undefined,
      relation: saved.relation ?? undefined,
      isPrimary: saved.isPrimary,
      status: saved.status
    } satisfies ClientContactView;
  }

  async deleteContact(context: ClientRequestContext, contactId: string) {
    const result = await this.prisma.customerContact.updateMany({ where: { tenantId: context.tenantId, customerId: context.customerId, id: contactId, status: "active" }, data: { status: "inactive", isPrimary: false } });
    if (result.count !== 1) throw new NotFoundException("联系人不存在");
    return { success: true };
  }

  private membershipAssignmentView(assignment: CustomerMembershipPlanAssignment): ClientMembershipAssignmentView {
    return {
      id: assignment.id,
      planId: assignment.planId,
      planVersionId: assignment.planVersionId,
      planName: assignment.snapshot.planName,
      targetType: assignment.snapshot.targetType,
      source: assignment.source,
      status: assignment.status,
      effectiveFrom: assignment.effectiveFrom,
      effectiveTo: assignment.effectiveTo,
      benefits: assignment.snapshot.benefits,
      reason: assignment.reason,
      createdAt: assignment.createdAt
    };
  }

  async membershipPlans(context: ClientRequestContext): Promise<ClientMembershipPlansResponse> {
    const now = new Date();
    const rows = await this.prisma.customerMembershipPlan.findMany({
      where: { tenantId: context.tenantId, status: "active" },
      include: {
        versions: {
          where: {
            status: "published",
            appVisible: true,
            AND: [
              { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
              { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }
            ]
          },
          orderBy: { version: "desc" },
          take: 1
        }
      },
      orderBy: [{ targetType: "asc" }, { code: "asc" }]
    });
    return {
      apiVersion: CLIENT_API_VERSION,
      plans: rows.flatMap((plan) => plan.versions.map((version) => ({
        planId: plan.id,
        code: plan.code,
        name: plan.name,
        targetType: plan.targetType as "personal" | "corporate",
        versionId: version.id,
        version: version.version,
        levelRank: version.levelRank,
        isDefault: version.isDefault,
        isRecommended: version.isRecommended,
        benefits: (Array.isArray(version.benefits) ? version.benefits : []) as unknown as ClientMembershipPlansResponse["plans"][number]["benefits"],
        effectiveFrom: version.effectiveFrom?.toISOString(),
        effectiveTo: version.effectiveTo?.toISOString()
      })))
    };
  }

  async membershipAssignments(context: ClientRequestContext) {
    const assignments = await this.memberships.listPlanAssignments(context.tenantId, context.customerId);
    return { apiVersion: CLIENT_API_VERSION, items: assignments.map((assignment) => this.membershipAssignmentView(assignment)) };
  }

  async membershipBenefits(context: ClientRequestContext, corporateCustomerId?: string): Promise<ClientMembershipBenefitsResponse> {
    const benefits = await this.memberships.resolveBenefits(context.tenantId, context.workspaceId, context.customerId, corporateCustomerId?.trim() || undefined);
    return {
      apiVersion: CLIENT_API_VERSION,
      personal: benefits.personal ? this.membershipAssignmentView(benefits.personal) : undefined,
      corporate: benefits.corporate ? this.membershipAssignmentView(benefits.corporate) : undefined
    };
  }

  async corporateIdentities(context: ClientRequestContext): Promise<ClientCorporateIdentityListResponse> {
    const now = new Date();
    const rows = await this.prisma.customerCorporateMembership.findMany({
      where: {
        tenantId: context.tenantId,
        personalCustomerId: context.customerId,
        status: "active",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        corporateCustomer: { tenantId: context.tenantId, customerType: "corporate", status: "active", membership: { is: { tenantId: context.tenantId, status: "active" } } }
      },
      include: {
        corporateCustomer: {
          select: {
            name: true,
            corporateProfile: { select: { legalName: true, unifiedSocialCreditCodeMasked: true, registeredAddress: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
    return {
      apiVersion: CLIENT_API_VERSION,
      items: rows.map((row) => ({
        corporateCustomerId: row.corporateCustomerId,
        corporateName: row.corporateCustomer.name,
        legalName: row.corporateCustomer.corporateProfile?.legalName,
        unifiedSocialCreditCodeMasked: row.corporateCustomer.corporateProfile?.unifiedSocialCreditCodeMasked,
        registeredAddress: row.corporateCustomer.corporateProfile?.registeredAddress ?? undefined,
        role: row.role,
        department: row.department ?? undefined,
        employeeNo: row.employeeNo ?? undefined,
        membershipId: row.id,
        effectiveTo: row.effectiveTo?.toISOString()
      }))
    };
  }

  async membershipStatus(context: ClientRequestContext) {
    return this.auth.sessionStatus(context);
  }

  async notifications(context: ClientRequestContext, query: { page?: number; pageSize?: number }): Promise<ClientNotificationListResponse> {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(query.pageSize ?? 20)));
    const customerOrders = (await this.core.listOrders(context.tenantId)).filter(
      (order) => order.customerId === context.customerId || order.membershipSnapshot?.personalCustomerId === context.customerId
    );
    const orderIds = new Set(customerOrders.map((order) => order.id));
    const logs = this.business
      .listNotificationLogs(context.tenantId, (await this.context(context.tenantId)))
      .filter((log) => log.businessObjectType === "order" && Boolean(log.businessObjectId) && orderIds.has(log.businessObjectId!))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const start = (page - 1) * pageSize;
    return {
      items: logs.slice(start, start + pageSize).map((log) => ({
        id: log.id,
        eventCode: log.eventCode,
        channel: log.channel,
        title: log.renderedTitle,
        body: log.renderedBody,
        status: log.status,
        orderId: log.businessObjectId,
        createdAt: log.createdAt,
        sentAt: log.sentAt
      })),
      page,
      pageSize,
      total: logs.length
    };
  }

  async bookingOptions(context: ClientRequestContext) {
    const rows = await this.memberships.listBookingOptions(context.tenantId, context.workspaceId, context.customerId);
    return [{ bookingIdentity: "personal", label: "个人身份", eligible: context.membershipStatus === "active" }, ...rows.map((row) => ({ bookingIdentity: "enterprise_employee", corporateCustomerId: row.corporateCustomerId, corporateName: row.corporateCustomerName, membershipId: row.corporateMembershipId, label: row.corporateCustomerName, eligible: true }))];
  }

  async qualificationTypes(context: ClientRequestContext) {
    return this.memberships.listQualificationTypes(context.tenantId, context.workspaceId);
  }

  async qualifications(context: ClientRequestContext) {
    return this.memberships.listQualificationRevisions(context.tenantId, context.customerId);
  }

  async submitQualification(context: ClientRequestContext, input: Parameters<MembershipService["submitQualification"]>[3]) {
    this.requireActiveMembership(context);
    return this.memberships.submitQualification(context.tenantId, context.workspaceId, context.customerId, input, "app", `client:${context.customerId}`);
  }

  async createQualificationUploadSession(context: ClientRequestContext, input: ClientQualificationUploadSessionRequest): Promise<ClientQualificationUploadSessionResponse> {
    this.requireActiveMembership(context);
    const types = await this.memberships.listQualificationTypes(context.tenantId, context.workspaceId);
    if (!types.some((type) => type.code === input.qualificationType && type.status === "enabled")) throw new BadRequestException("当前经营空间未启用该证件类型");
    return this.files.createUploadSession(context.tenantId, {
      businessModule: "membership",
      businessType: "customer",
      businessId: context.customerId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadScene: "client-qualification",
      idempotencyKey: input.idempotencyKey,
      metadata: { qualificationType: input.qualificationType }
    }, { businessType: "customer", businessId: context.customerId, uploadScene: "client-qualification" });
  }

  async completeQualificationUpload(context: ClientRequestContext, sessionId: string, input: ClientQualificationUploadCompleteRequest) {
    this.requireActiveMembership(context);
    return this.files.completeUpload(context.tenantId, sessionId, input, { businessType: "customer", businessId: context.customerId, uploadScene: "client-qualification" });
  }

  async qualificationFileUrl(context: ClientRequestContext, fileAssetId: string): Promise<ClientQualificationFileUrlResponse> {
    this.requireActiveMembership(context);
    return this.files.downloadUrl(context.tenantId, fileAssetId, { businessType: "customer", businessId: context.customerId, uploadScene: "client-qualification" });
  }

  async availability(context: ClientRequestContext, input: { locationId: string; startAt: string; endAt: string; lines: Array<{ itemGroupId: string; quantity: number }> }) {
    this.requireActiveMembership(context);
    await this.currentWorkspace(context);
    return this.core.availability(context.tenantId, input);
  }

  async createQuote(context: ClientRequestContext, input: ClientCreateQuoteRequest) {
    this.requireActiveMembership(context);
    await this.currentWorkspace(context);
    const business = (await this.context(context.tenantId));
    const request: RentalQuoteRequest = {
      ...input,
      customerType: "personal",
      customerId: context.customerId,
      bookingIdentity: input.bookingIdentity ?? { bookingIdentity: "personal" }
    };
    // 与管理端走同一条服务端解析链：只选定价组时选择可承接型号；显式选型号时
    // 固化准确型号预约精度和组成员快照。客户端不能自报精度或成员范围。
    // 收货地址（配送/上门必填、自取禁带）的归属校验与快照固化由核心 createQuote 统一处理，
    // 地址随报价/订单快照落库，客户端、运营后台看到同一份，不再各存客户端旁表。
    const resolved = await this.core.resolvePricingGroupQuoteRequest(context.tenantId, request);
    return this.business.createQuote(context.tenantId, business, resolved);
  }

  private requireAddressService(): ClientDeliveryAddressService {
    if (!this.addresses) throw new ServiceUnavailableException("配送地址服务未就绪");
    return this.addresses;
  }

  async getQuote(context: ClientRequestContext, quoteId: string) {
    const quote = this.business.getQuote(context.tenantId, (await this.context(context.tenantId)), quoteId);
    if (quote.request.customerId !== context.customerId) throw new NotFoundException("报价不存在");
    return quote;
  }

  async coupons(context: ClientRequestContext) {
    return this.business.listCurrentCustomerCoupons(context.tenantId, (await this.context(context.tenantId)), context.customerId);
  }

  async claimCoupon(context: ClientRequestContext, templateId: string) {
    this.requireActiveMembership(context);
    return this.business.claimCoupon(context.tenantId, (await this.context(context.tenantId)), templateId, context.customerId);
  }

  private async prepareClientOrder(context: ClientRequestContext, input: ClientCreateOrderRequest) {
    this.requireActiveMembership(context);
    // 即使客户在取消发布前拿到报价，也不能在关闭渠道后新建订单。
    await this.currentWorkspace(context);
    const business = (await this.context(context.tenantId));
    const quote = this.business.getQuote(context.tenantId, business, input.quoteId);
    if (quote.request.customerId !== context.customerId) throw new NotFoundException("报价不存在");
    const lines = quote.request.lines.map((line) => {
      if (!line.itemGroupId) throw new ConflictException("报价缺少承接商品型号，不能下单");
      return { itemGroupId: line.itemGroupId, pricingGroupId: line.pricingGroupId, quantity: line.quantity, note: line.note };
    });
    const orderInput: CreateRentalOrderRequest = {
      quoteId: input.quoteId,
      customerType: "personal",
      customerId: context.customerId,
      customerName: context.displayName,
      contactPhone: input.contactPhone ?? context.phone,
      bookingIdentity: quote.request.bookingIdentity ?? { bookingIdentity: "personal" },
      fulfillmentMode: quote.request.fulfillmentMode,
      fulfillmentLocationId: quote.request.fulfillmentLocationId,
      returnLocationId: quote.request.returnLocationId,
      startAt: quote.request.startAt,
      endAt: quote.request.endAt,
      lines
    };
    return { business, orderInput };
  }

  /** Explicit server adapter for the original booking page. No quote is consumed
   * and no stock is reserved; the caller must still obtain an explicit submission. */
  async prepareOrderSubmission(context: ClientRequestContext, input: ClientCreateOrderRequest) {
    context = structuredClone(context);
    const snapshot = structuredClone(input);
    const { orderInput } = await this.prepareClientOrder(context, snapshot);
    return { tenantId: context.tenantId, workspaceId: context.workspaceId, customerId: context.customerId,
      request: structuredClone(orderInput), requestHash: this.orders.fingerprintOrderRequest(orderInput),
      execution: 'not_submitted' as const, inventory: 'not_reserved' as const };
  }

  /** Accepted request comes from server persistence, not an AI response or HTTP
   * hash. The original key is read only; absence does not authorize resubmission. */
  async readOrderSubmission(context: ClientRequestContext, accepted: {
    tenantId: string; workspaceId: string; customerId: string; request: CreateRentalOrderRequest;
  }, operationKey: string) {
    context = structuredClone(context);
    const original = structuredClone(accepted);
    await this.currentWorkspace(context);
    if (original.tenantId !== context.tenantId || original.workspaceId !== context.workspaceId
      || original.customerId !== context.customerId || original.request.customerId !== context.customerId
      || original.request.customerType !== 'personal') throw new NotFoundException("原下单操作不存在");
    const result = await this.orders.readOrderCreation(context.tenantId, original.request, operationKey);
    if (result.state !== 'observed' || !result.orderId) return result;
    await this.assertClientOrder(context, result.orderId);
    return { ...result, payment: 'not_inferred' as const, fulfillment: 'not_inferred' as const };
  }

  async createOrder(context: ClientRequestContext, input: ClientCreateOrderRequest, requestContext?: ClientOrderRequestContext) {
    const { business, orderInput } = await this.prepareClientOrder(context, structuredClone(input));
    // 收货地址在报价阶段已由核心解析并固化进报价/订单快照；下单直接消费报价即可，无需再查客户端旁表。
    const created = await this.orders.createOrder(context.tenantId, orderInput, `client:${context.customerId}`, business, idempotencyKeyOf(requestContext));
    const order = await this.assertClientOrder(context, created.order.id);
    await Promise.all([this.core.persist(context.tenantId), this.business.persist(context.tenantId)]);
    return { order: this.orderView(order, await this.addresses?.snapshotForOrder(context, order)), replayed: created.replayed };
  }

  async listOrders(context: ClientRequestContext, query: { page?: number; pageSize?: number; status?: string }) {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(query.pageSize ?? 20)));
    const all = (await this.core.listOrders(context.tenantId)).filter((order) => order.customerId === context.customerId || order.membershipSnapshot?.personalCustomerId === context.customerId).filter((order) => !query.status || String(order.status).toLowerCase() === query.status.toLowerCase());
    const start = (page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize).map((order) => this.orderView(order)), page, pageSize, total: all.length };
  }

  async myOrders(context: ClientRequestContext, query: ClientMyOrdersQuery): Promise<ClientMyOrdersResponse> {
    if (context.customerType !== "personal") throw new ForbiddenException("本人订单索引仅支持个人客户账号");
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      throw new BadRequestException("分页参数无效：page 为 1-1000000，pageSize 为 1-50 的整数");
    }
    // 直接按租户和本人查询已持久化事实；不调用当前空间的 Core 列表、不切换会话/请求身份。
    const where: Prisma.RentalOrderWhereInput = {
      tenantId: context.tenantId,
      workspace: { tenantId: context.tenantId },
      OR: [
        { customerId: context.customerId },
        { membershipSnapshot: { path: "$.personalCustomerId", equals: context.customerId } }
      ]
    };
    return this.prisma.$transaction(async (tx) => {
      const total = await tx.rentalOrder.count({ where });
      const rows = await tx.rentalOrder.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, tenantId: true, workspaceId: true, customerId: true, membershipSnapshot: true,
          orderNo: true, categoryCode: true, status: true, startAt: true, endAt: true, effectiveEndAt: true,
          finalPayableAmount: true, currency: true, createdAt: true, updatedAt: true,
          workspace: { select: { id: true, tenantId: true, code: true, name: true } }
        }
      });
      const items = rows.map((order): MyOrderIndex => {
        // 二次检查每条订单及空间的归属；不把查询过滤条件当成响应授权的唯一防线。
        if (!this.clientOwnsOrder(context, order) || order.workspace.tenantId !== context.tenantId || order.workspace.id !== order.workspaceId) {
          throw new NotFoundException("订单不存在");
        }
        return {
          orderId: order.id, orderNo: order.orderNo, tenantCode: context.tenantCode,
          workspaceCode: order.workspace.code, workspaceName: order.workspace.name,
          categoryCode: String(order.categoryCode), status: String(order.status).toLowerCase(),
          startAt: order.startAt.toISOString(), endAt: order.endAt.toISOString(), effectiveEndAt: order.effectiveEndAt?.toISOString(),
          finalPayableAmount: Number(order.finalPayableAmount), currency: order.currency,
          createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString()
        };
      });
      // 商品摘要单独查询：主投影保持最小，摘要只取型号名与件数（不含资产编号、金额）。
      if (items.length) {
        const lines = await tx.rentalOrderLine.findMany({
          where: { orderId: { in: items.map((item) => item.orderId) } },
          select: { orderId: true, itemGroupId: true, itemGroupName: true, quantity: true },
          orderBy: [{ orderId: "asc" }, { id: "asc" }]
        });
        const summaries = new Map<string, MyOrderItemSummary>();
        for (const line of lines) {
          const existing = summaries.get(line.orderId);
          if (existing) {
            existing.itemCount += 1;
            existing.totalQuantity += line.quantity;
          } else {
            summaries.set(line.orderId, { firstItemGroupId: line.itemGroupId, firstItemName: line.itemGroupName, itemCount: 1, totalQuantity: line.quantity });
          }
        }
        for (const item of items) {
          const summary = summaries.get(item.orderId);
          if (summary) item.itemSummary = summary;
        }
      }
      return { apiVersion: CLIENT_API_VERSION, items, page, pageSize, total };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async getOrder(context: ClientRequestContext, orderId: string) {
    const order = await this.assertClientOrder(context, orderId);
    return this.orderView(order, await this.addresses?.snapshotForOrder(context, order));
  }

  /* ---------- MP-11：检查异常费用的本人确认与异议 ---------- */

  private feeItemsOf(orderId: string, currency: string, records: Awaited<ReturnType<RentalCoreService["listInspections"]>>): ClientFeeItemView[] {
    const items: ClientFeeItemView[] = [];
    for (const record of records) {
      record.exceptions.forEach((exception, index) => {
        // 只展示已批准且需要本人响应的费用：待审核建议额不能显示成应收，被拒绝的异常不显示。
        if (exception.reviewStatus !== "approved" || !(Number(exception.approvedChargeAmount ?? 0) > 0)) return;
        const status = exception.customerResponseStatus;
        if (!status || status === "not_required") return;
        items.push({
          inspectionId: record.id,
          exceptionIndex: index,
          stage: record.stage,
          code: exception.code,
          description: exception.description,
          amount: Number(exception.approvedChargeAmount),
          currency,
          reviewedAt: exception.reviewedAt,
          responseStatus: status,
          responseReason: exception.customerResponseReason,
          respondedAt: exception.customerRespondedAt,
          adjustments: (exception.adjustmentHistory ?? []).map((row) => ({ fromAmount: row.fromAmount, toAmount: row.toAmount, reason: row.reason, adjustedAt: row.adjustedAt })),
          history: (exception.customerResponseHistory ?? []).map((row) => ({ decision: row.decision, reason: row.reason, respondedAt: row.respondedAt })),
          evidenceCount: exception.evidenceAttachments?.length ?? 0
        });
      });
    }
    return items;
  }

  async feeItems(context: ClientRequestContext, orderId: string): Promise<ClientFeeItemsResponse> {
    const order = await this.assertClientOrder(context, orderId);
    const records = await this.core.listInspections(context.tenantId, orderId);
    const items = this.feeItemsOf(orderId, order.currency ?? "CNY", records);
    return { apiVersion: CLIENT_API_VERSION, orderId, items, pendingCount: items.filter((row) => row.responseStatus === "pending").length };
  }

  /**
   * 本人确认/异议：复用运营端同一条追加式响应链（同一校验、同一幂等动作），
   * 只是操作人是客户本人；不接受金额、裁定结果或改写旧响应。
   */
  async respondToFee(context: ClientRequestContext, orderId: string, inspectionId: string, exceptionIndex: number, input: ClientFeeResponseRequest, requestContext?: ClientOrderRequestContext): Promise<ClientFeeResponseResult> {
    this.requireActiveMembership(context);
    const order = await this.assertClientOrder(context, orderId);
    if (!Number.isInteger(exceptionIndex) || exceptionIndex < 0) throw new BadRequestException("异常序号无效");
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException(input.decision === "disputed" ? "提出异议必须填写原因" : "请填写确认说明");
    const operator = `client:${context.customerId}`;
    const outcome = await this.idempotent.executeWithReplayFlag({
      tenantId: context.tenantId,
      action: "order.inspection-exception.customer-response",
      key: idempotencyKeyOf(requestContext),
      fallbackKey: `client:inspection-exception.customer-response:${inspectionId}:${exceptionIndex}:${input.decision}`,
      request: { orderId, inspectionId, exceptionIndex, decision: input.decision, reason },
      orderId,
      run: async (tx) => {
        await this.assertClientOrder(context, orderId);
        const row = await tx.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId: context.tenantId, workspaceId: context.workspaceId, orderId } });
        if (!row) throw new NotFoundException("检查记录不存在");
        const exceptions = structuredClone(row.exceptions as unknown as Array<Record<string, unknown>>);
        const exception = exceptions[exceptionIndex];
        if (!exception) throw new NotFoundException("检查异常不存在");
        const error = validateInspectionCustomerResponse({
          reviewStatus: exception.reviewStatus as "pending" | "approved" | "rejected",
          approvedChargeAmount: Number(exception.approvedChargeAmount ?? 0),
          currentStatus: exception.customerResponseStatus as "not_required" | "pending" | "confirmed" | "disputed" | undefined,
          decision: input.decision
        });
        if (error) throw new ConflictException(error);
        const respondedAt = new Date().toISOString();
        const history = Array.isArray(exception.customerResponseHistory) ? (exception.customerResponseHistory as Array<Record<string, unknown>>) : [];
        history.push({ decision: input.decision, reason, operator, respondedAt });
        Object.assign(exception, { customerResponseStatus: input.decision, customerResponseReason: reason, customerRespondedBy: operator, customerRespondedAt: respondedAt, customerResponseHistory: history });
        await tx.rentalInspectionRecord.update({ where: { id: inspectionId }, data: { exceptions: exceptions as Prisma.InputJsonValue } });
        return { inspectionId, exceptionIndex };
      },
      replay: async () => {
        await this.assertClientOrder(context, orderId);
        const row = await this.prisma.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId: context.tenantId, workspaceId: context.workspaceId, orderId } });
        const exception = (row?.exceptions as unknown as Array<Record<string, unknown>> | undefined)?.[exceptionIndex];
        return exception && exception.customerResponseStatus === input.decision ? { inspectionId, exceptionIndex } : undefined;
      }
    });
    await Promise.all([this.core.persist(context.tenantId), this.business.persist(context.tenantId)]);
    const records = await this.core.listInspections(context.tenantId, orderId);
    const item = this.feeItemsOf(orderId, order.currency ?? "CNY", records).find((row) => row.inspectionId === outcome.result.inspectionId && row.exceptionIndex === outcome.result.exceptionIndex);
    if (!item) throw new NotFoundException("检查异常不存在");
    return { apiVersion: CLIENT_API_VERSION, item, replayed: outcome.replayed };
  }

  async fulfillment(context: ClientRequestContext, orderId: string): Promise<ClientFulfillmentView> {
    const order = await this.assertClientOrder(context, orderId);
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      status: String(order.status),
      fulfillmentMode: order.fulfillmentMode,
      fulfillmentLocationName: order.fulfillmentLocationName,
      returnLocationName: order.returnLocationName,
      startAt: order.startAt,
      endAt: order.endAt,
      effectiveEndAt: order.effectiveEndAt,
      allocations: order.allocations?.map((row) => ({ id: row.id, orderLineId: row.orderLineId, quantity: row.quantity, status: row.status, assetNo: row.assetNo })) ?? []
    };
  }

  /**
   * APP-01：客户端订单凭证必须先通过会员自己的订单归属校验，
   * 再复用后台同一份服务端快照渲染器。客户端不传 workspaceId，
   * 当前空间由客户端会话和请求上下文决定；结算凭证只展示该会员订单的
   * 资金汇总，不把后台财务权限或内部费用裁定字段带给客户端。
   */
  async orderDocument(context: ClientRequestContext, orderId: string, documentType: string, snapshotId?: string) {
    await this.assertClientOrder(context, orderId);
    const business = (await this.context(context.tenantId));
    if (snapshotId) {
      return this.documents.readSnapshot(context.tenantId, orderId, documentType, snapshotId, {
        includeFinancial: documentType === "settlement"
      });
    }
    return this.documents.render(context.tenantId, orderId, documentType, {
      includeFinancial: documentType === "settlement",
      terminology: business.profile.terminology
    });
  }

  async orderDocumentVersions(context: ClientRequestContext, orderId: string, documentType: string) {
    await this.assertClientOrder(context, orderId);
    return this.documents.listSnapshots(context.tenantId, orderId, documentType);
  }

  async previewCancellation(context: ClientRequestContext, orderId: string): Promise<ClientCancellationPreview> {
    this.requireActiveMembership(context);
    const order = await this.assertClientOrder(context, orderId);
    // 与 Core.cancelOrder 的状态门禁一致；这里只预览取消费，不模拟取消事务或退款。
    if ([RentalCoreOrderStatus.Renting, RentalCoreOrderStatus.Settling, RentalCoreOrderStatus.Completed, RentalCoreOrderStatus.Cancelled, RentalCoreOrderStatus.NoShow].includes(order.status)) {
      throw new ConflictException("当前订单状态不能取消");
    }
    const business = (await this.context(context.tenantId));
    const calculatedAt = new Date().toISOString();
    const cancellationCharge = this.business.calculateCancellationCharge(
      context.tenantId, business, this.business.getQuote(context.tenantId, business, order.quoteId), calculatedAt
    );
    return { apiVersion: CLIENT_API_VERSION, orderId, cancellationCharge, currency: order.currency ?? "CNY", calculatedAt, estimated: true };
  }

  async cancelOrder(context: ClientRequestContext, orderId: string, input: { reason: string }, requestContext?: ClientOrderRequestContext) {
    this.requireActiveMembership(context);
    await this.assertClientOrder(context, orderId);
    const key = idempotencyKeyOf(requestContext) ?? `client:order.cancel:${orderId}`;
    const business = (await this.context(context.tenantId));
    const outcome = await this.idempotent.executeWithReplayFlag({
      tenantId: context.tenantId,
      action: "order.cancel",
      key,
      fallbackKey: `client:order.cancel:${orderId}`,
      request: { orderId, reason: input.reason },
      orderId,
      run: async (tx) => {
        await this.assertClientOrder(context, orderId);
        const order = await this.core.cancelOrder(context.tenantId, orderId, input.reason, (locked) => this.business.calculateCancellationCharge(context.tenantId, business, this.business.getQuote(context.tenantId, business, locked.quoteId)), tx, `client:${context.customerId}`);
        await this.business.releaseCouponInTransaction(context.tenantId, orderId, tx);
        await this.serviceCapacities.releaseForOrder(context.tenantId, orderId, "client_order_cancelled", new Date().toISOString(), tx);
        await this.corporateSettlement?.settleCancelledOrderCredit(context.tenantId, orderId, "client_order_cancelled", tx, `client:${context.customerId}`);
        return order;
      },
      replay: async () => {
        const latest = await this.assertClientOrder(context, orderId);
        return String(latest.status).toLowerCase() === "cancelled" ? latest : undefined;
      }
    });
    await Promise.all([this.core.persist(context.tenantId), this.business.persist(context.tenantId)]);
    return { order: this.orderView(outcome.result), replayed: outcome.replayed };
  }

  private async extensionSettlement(context: ClientRequestContext, order: RentalOrder) {
    const overdue = new Date(order.effectiveEndAt ?? order.endAt).getTime() < Date.now();
    if (overdue) return "immediate" as const;
    const corporateId = order.membershipSnapshot?.enterpriseContractAndPayer ? order.membershipSnapshot.corporateCustomerId : undefined;
    if (!corporateId) return "immediate" as const;
    const credit = await this.prisma.customerCorporateCredit.findFirst({ where: { tenantId: context.tenantId, customerId: corporateId, status: "active" }, select: { billingCycle: true } });
    return credit && credit.billingCycle !== "per_order" ? "monthly" as const : "immediate" as const;
  }

  private async priceExtension(context: ClientRequestContext, orderId: string, input: ClientOrderExtensionRequest) {
    const order = await this.assertClientOrder(context, orderId);
    await this.core.assertOrderExtensionAvailable(context.tenantId, order, input.newEndAt);
    const priced = await this.business.quoteOrderExtension(context.tenantId, (await this.context(context.tenantId)), { order, previousExtensions: await this.core.listOrderExtensions(context.tenantId, orderId), lines: order.lines, newEndAt: input.newEndAt, services: input.services, appliedAt: new Date().toISOString(), settlementMode: await this.extensionSettlement(context, order), fulfillmentMode: order.fulfillmentMode, locationIds: [order.fulfillmentLocationId, order.returnLocationId].filter((id): id is string => Boolean(id)), customerType: order.customerType });
    const { rateSnapshot: _rateSnapshot, ruleSnapshot: _ruleSnapshot, ...preview } = priced;
    return { order, priced, preview };
  }

  async previewExtension(context: ClientRequestContext, orderId: string, input: ClientOrderExtensionRequest) {
    this.requireActiveMembership(context);
    return (await this.priceExtension(context, orderId, input)).preview;
  }

  private async occupyExtensionServices(context: ClientRequestContext, orderId: string, extension: { id: string; serviceSnapshots?: unknown[] }, tx: Prisma.TransactionClient) {
    if (!extension.serviceSnapshots?.length) return;
    await this.serviceCapacities.reserveForOrder(context.tenantId, { id: orderId, serviceSnapshots: extension.serviceSnapshots, reservations: [] } as never, `client-extension:${extension.id}`, tx);
    await this.serviceCapacities.confirmForOrder(context.tenantId, orderId, new Date().toISOString(), tx);
  }

  async applyExtension(context: ClientRequestContext, orderId: string, input: ClientOrderExtensionRequest, requestContext?: ClientOrderRequestContext) {
    this.requireActiveMembership(context);
    await this.assertClientOrder(context, orderId);
    const key = idempotencyKeyOf(requestContext) ?? `client:order.extend:${orderId}:${input.newEndAt}`;
    const outcome = await this.idempotent.executeWithReplayFlag({
      tenantId: context.tenantId,
      action: "order.extend",
      key: idempotencyKeyOf(requestContext),
      fallbackKey: `client:order.extend:${orderId}:${input.newEndAt}`,
      request: { orderId, newEndAt: input.newEndAt, services: input.services ?? [] },
      orderId,
      run: async (tx) => {
        const { priced } = await this.priceExtension(context, orderId, input);
        const result = await this.core.requestOrderExtension(context.tenantId, orderId, priced, { idempotencyKey: key, memo: input.memo, operator: `client:${context.customerId}` }, tx);
        await this.business.synchronizeExtensionCoupon(context.tenantId, result.extension, tx);
        if (result.extension.status === "effective") {
          await this.corporateSettlement?.reserveExtensionCredit(
            context.tenantId,
            orderId,
            result.extension.id,
            result.extension.payableAmount,
            tx,
            `client:${context.customerId}`
          );
          await this.occupyExtensionServices(context, orderId, result.extension, tx);
        }
        return result;
      },
      replay: async () => {
        const order = await this.assertClientOrder(context, orderId);
        const existing = (await this.core.listOrderExtensions(context.tenantId, orderId)).find((row) => row.idempotencyKey === key);
        return existing ? { order, extension: existing } : undefined;
      }
    });
    return { order: this.orderView(outcome.result.order), extension: outcome.result.extension, replayed: outcome.replayed };
  }

  async listExtensions(context: ClientRequestContext, orderId: string) {
    await this.assertClientOrder(context, orderId);
    return this.core.listOrderExtensions(context.tenantId, orderId);
  }

  async payExtension(context: ClientRequestContext, orderId: string, extensionId: string, requestContext?: ClientOrderRequestContext) {
    this.requireActiveMembership(context);
    await this.assertClientOrder(context, orderId);
    const key = idempotencyKeyOf(requestContext) ?? `client:order.extend.pay:${extensionId}`;
    const outcome = await this.idempotent.executeWithReplayFlag({
      tenantId: context.tenantId,
      action: "order.extend.pay",
      key: idempotencyKeyOf(requestContext),
      fallbackKey: `client:order.extend.pay:${extensionId}`,
      request: { orderId, extensionId },
      orderId,
      run: async (tx) => {
        await this.assertClientOrder(context, orderId);
        await this.fundingService.assertExtensionPaid(context.tenantId, context.workspaceId, orderId, extensionId, tx);
        const result = await this.core.payOrderExtension(context.tenantId, orderId, extensionId, tx);
        await this.business.synchronizeExtensionCoupon(context.tenantId, result.extension, tx);
        await this.occupyExtensionServices(context, orderId, result.extension, tx);
        return result;
      },
      replay: async () => {
        const order = await this.assertClientOrder(context, orderId);
        const extension = (await this.core.listOrderExtensions(context.tenantId, orderId)).find((row) => row.id === extensionId && row.status === "effective");
        return extension ? { order, extension } : undefined;
      }
    });
    return { order: this.orderView(outcome.result.order), extension: outcome.result.extension, replayed: outcome.replayed };
  }

  async funding(context: ClientRequestContext, orderId: string) {
    await this.assertClientOrder(context, orderId);
    return this.fundingService.listEvents(context.tenantId, context.workspaceId, orderId);
  }

  async simulateFunding(context: ClientRequestContext, orderId: string, input: ClientPaymentSimulationRequest, requestContext?: ClientOrderRequestContext) {
    if (process.env.NODE_ENV === "production") throw new ForbiddenException("生产环境未接入真实支付 provider，不能使用模拟资金接口");
    await this.assertClientOrder(context, orderId);
    const key = idempotencyKeyOf(requestContext);
    if (!key) throw new BadRequestException("资金操作必须提供 Idempotency-Key");
    const needsMethod = ["initiate", "append", "refund", "fail"].includes(input.action);
    const paymentMethod = needsMethod ? this.core.resolveOfflinePaymentMethod(context.tenantId, input.paymentMethod) : undefined;
    return this.fundingService.recordEvent(context.tenantId, context.workspaceId, orderId, { ...input, idempotencyKey: key, paymentMethod }, `client:${context.customerId}`);
  }

  async createPaymentIntent(context: ClientRequestContext, orderId: string, input: ClientPaymentIntentRequest) {
    this.requireActiveMembership(context);
    await this.assertClientOrder(context, orderId);
    const enabledMethods = (await this.context(context.tenantId)).settings.payment.enabledMethods;
    const methods = enabledMethods?.length ? enabledMethods : DEFAULT_RENTAL_PAYMENT_METHODS;
    // Stripe(跨境收单)不由经营空间的收款方式开关管控,而是由租户第三方支付配置(启用+默认+币种匹配+连接测试)决定;
    // 空间级开关只管线下/支付宝/微信这类空间自选方式。stripe 的可用性在 payments.createPaymentIntent 内按币种与配置门禁。
    if (input.method !== "stripe" && !methods.includes(input.method)) {
      throw new ConflictException("该线上支付方式尚未在经营空间设置中启用");
    }
    return this.payments.createPaymentIntent(context.tenantId, context.workspaceId, orderId, input);
  }

  async createMiniProgramPaymentIntent(context: ClientRequestContext, orderId: string, input: ClientMiniProgramPaymentIntentRequest): Promise<ClientPaymentIntentResponse> {
    this.requireActiveMembership(context);
    await this.assertClientOrder(context, orderId);
    const enabledMethods = (await this.context(context.tenantId))?.settings?.payment?.enabledMethods;
    if (!(enabledMethods?.length ? enabledMethods : DEFAULT_RENTAL_PAYMENT_METHODS).includes("wechat_pay")) {
      throw new ConflictException("微信支付尚未在经营空间设置中启用");
    }
    // openid 只来自服务端可信绑定（微信手机号登录或绑定动作），绝不接受客户端自报。
    const identity = this.wechat ? await this.wechat.identityForSession(context) : undefined;
    return this.payments.createMiniProgramPaymentIntent(context.tenantId, context.workspaceId, orderId, input, identity);
  }

  async getPaymentIntent(context: ClientRequestContext, orderId: string, intentId: string): Promise<ClientPaymentIntentResponse> {
    await this.assertClientOrder(context, orderId);
    return this.payments.getPaymentIntent(context.tenantId, context.workspaceId, orderId, intentId);
  }

  async refreshPaymentIntent(context: ClientRequestContext, orderId: string, intentId: string): Promise<ClientPaymentIntentResponse> {
    await this.assertClientOrder(context, orderId);
    return this.payments.refreshPaymentIntent(context.tenantId, context.workspaceId, orderId, intentId);
  }

  async closePaymentIntent(context: ClientRequestContext, orderId: string, intentId: string): Promise<ClientPaymentIntentResponse> {
    this.requireActiveMembership(context);
    await this.assertClientOrder(context, orderId);
    return this.payments.closePaymentIntent(context.tenantId, context.workspaceId, orderId, intentId);
  }
}
