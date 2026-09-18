import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import {
  CLIENT_API_VERSION,
  DEFAULT_RENTAL_PAYMENT_METHODS,
  RentalCoreOrderStatus,
  type ClientCancellationPreview,
  type ClientCatalogLocation,
  type ClientCatalogStartingPrice,
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
    @Optional() private readonly corporateSettlement?: CustomerCorporateSettlementService
  ) {}

  private context(tenantId: string): BusinessContext {
    const profile = this.core.getProfile(tenantId);
    const category = this.core.listCategories().find((item) => item.code === profile.categoryCode);
    if (!category) throw new ConflictException("当前经营空间的品类定义不存在");
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

  private orderView(order: RentalOrder): ClientOrderView {
    return {
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

  async catalog(context: ClientRequestContext) {
    const business = this.context(context.tenantId);
    const workspaces = await this.auth.listPublicWorkspaces(context.tenantCode);
    const workspace = workspaces.workspaces.find((row) => row.code === context.workspaceCode);
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
      timeZone: business.settings.calendar.timeZone ?? "Asia/Shanghai",
      items: business.groups.filter((item) => item.status === "enabled").map((item) => ({ id: item.id, code: item.code, name: item.name, description: item.description, inventoryMode: item.inventoryMode, images: item.images?.map((image) => ({ url: `/api/client/v1/catalog/items/${encodeURIComponent(item.id)}/images/${encodeURIComponent(image.id)}`, alt: image.fileName })), attributes: item.attributes, startingPrice: startingPriceOf(item.id) })),
      pricingGroups: enabledPricingGroups.map((group) => ({ id: group.id, code: group.code, name: group.name, memberItemGroupIds: group.memberItemGroupIds, enabled: group.status === "enabled" })),
      services: this.business.listServices(context.tenantId, business).filter((service) => service.status === "enabled").map((service) => ({ id: service.id, code: service.code, name: service.name, description: service.terms, pricingUnit: service.billingUnit, enabled: true })),
      // 地点只投影客户可见的公开信息：地址、营业时段、门店电话与取还能力；经营主体与结算方式不外露。
      locations: business.locations.filter((location) => location.status === "enabled").map((location): ClientCatalogLocation => ({ id: location.id, code: location.code, name: location.name, status: location.status, address: location.address || undefined, businessHours: location.businessHours || undefined, contactPhone: location.contactPhone || undefined, capabilities: location.capabilities })),
      discountPlans: this.business.listDiscountPlans(context.tenantId, business).filter((plan) => plan.status === "enabled").map((plan) => ({ id: plan.id, code: plan.code, name: plan.name, status: plan.status }))
    };
  }

  async readCatalogItemImage(context: ClientRequestContext, itemGroupId: string, imageId: string) {
    const business = this.context(context.tenantId);
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
    const business = this.context(context.tenantId);
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
        notifications: true
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
    const business = this.context(context.tenantId);
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
      .listNotificationLogs(context.tenantId, this.context(context.tenantId))
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
    return this.core.availability(context.tenantId, input);
  }

  async createQuote(context: ClientRequestContext, input: ClientCreateQuoteRequest) {
    this.requireActiveMembership(context);
    const request: RentalQuoteRequest = {
      ...input,
      customerType: "personal",
      customerId: context.customerId,
      bookingIdentity: input.bookingIdentity ?? { bookingIdentity: "personal" }
    };
    return this.business.createQuote(context.tenantId, this.context(context.tenantId), request);
  }

  async getQuote(context: ClientRequestContext, quoteId: string) {
    const quote = this.business.getQuote(context.tenantId, this.context(context.tenantId), quoteId);
    if (quote.request.customerId !== context.customerId) throw new NotFoundException("报价不存在");
    return quote;
  }

  async coupons(context: ClientRequestContext) {
    return this.business.listCurrentCustomerCoupons(context.tenantId, this.context(context.tenantId), context.customerId);
  }

  async claimCoupon(context: ClientRequestContext, templateId: string) {
    this.requireActiveMembership(context);
    return this.business.claimCoupon(context.tenantId, this.context(context.tenantId), templateId, context.customerId);
  }

  async createOrder(context: ClientRequestContext, input: ClientCreateOrderRequest, requestContext?: ClientOrderRequestContext) {
    this.requireActiveMembership(context);
    const business = this.context(context.tenantId);
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
    const created = await this.orders.createOrder(context.tenantId, orderInput, `client:${context.customerId}`, business, idempotencyKeyOf(requestContext));
    const order = await this.assertClientOrder(context, created.order.id);
    await Promise.all([this.core.persist(context.tenantId), this.business.persist(context.tenantId)]);
    return { order: this.orderView(order), replayed: created.replayed };
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
    return this.orderView(await this.assertClientOrder(context, orderId));
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
    const business = this.context(context.tenantId);
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
    const business = this.context(context.tenantId);
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
    const business = this.context(context.tenantId);
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
        await this.corporateSettlement?.releaseOrderCredit(context.tenantId, orderId, "client_order_cancelled", tx, `client:${context.customerId}`);
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
    const priced = await this.business.quoteOrderExtension(context.tenantId, this.context(context.tenantId), { order, previousExtensions: await this.core.listOrderExtensions(context.tenantId, orderId), lines: order.lines, newEndAt: input.newEndAt, services: input.services, appliedAt: new Date().toISOString(), settlementMode: await this.extensionSettlement(context, order), fulfillmentMode: order.fulfillmentMode, locationIds: [order.fulfillmentLocationId, order.returnLocationId].filter((id): id is string => Boolean(id)), customerType: order.customerType });
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
    const enabledMethods = this.context(context.tenantId).settings.payment.enabledMethods;
    if (!(enabledMethods?.length ? enabledMethods : DEFAULT_RENTAL_PAYMENT_METHODS).includes(input.method)) {
      throw new ConflictException("该线上支付方式尚未在经营空间设置中启用");
    }
    return this.payments.createPaymentIntent(context.tenantId, context.workspaceId, orderId, input);
  }

  async createMiniProgramPaymentIntent(context: ClientRequestContext, orderId: string, input: ClientMiniProgramPaymentIntentRequest): Promise<ClientPaymentIntentResponse> {
    this.requireActiveMembership(context);
    await this.assertClientOrder(context, orderId);
    return this.payments.createMiniProgramPaymentIntent(context.tenantId, context.workspaceId, orderId, input);
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
