import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleInit, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { getRequestUserId, requireRequestUserId } from "../../common/request-identity";
import { assertInspectionRequiredResults } from "./rental-inspection-result-validation";
import { optionalUsageReading, usageDelta } from "./rental-usage-reading";
import { hasWholeEarlyReturnReduction } from "./rental-early-return";
import { quoteRentalLineSource } from "./rental-quote-line-source";
import { inventoryBasisGroups, assertRentalInventoryBasis } from "./rental-quote-inventory-basis";
import { selectDamageWaiver } from "./rental-damage-waiver";
import { inspectionClosureError } from "./rental-inspection-customer-response";
import { readFrozenInspectionTemplates, snapshotInspectionTemplate } from "./rental-inspection-template-snapshot";
import type { BusinessContext } from "./rental-business.service";
import { capabilityRequirementRoots, resolveCapabilityRequirements } from "./category-capability-conditions";
import { validateQuotedCapabilityRequirements } from "./category-capability-facts";
import { rentalDefaultWorkspaceName } from "./category-identity";
import { assertInspectionAllocationScope, exchangeBasis, exchangeInspectionTemplates, exchangePickupInspectionRequirements, projectExchangeInspectionTemplates } from "./rental-exchange-inspection";
import type { RentalOrderInspectionBasisFacts } from "@rental-os/shared";
import { assertInspectionObservations } from "./rental-inspection-observation";
import { approvedExchangeEvidence, type ApprovedExchangeAuthority } from "./rental-approved-exchange-authorization";
import { inspectionEvidenceIds, inspectionEvidenceRequiredError } from "./rental-inspection-evidence";
import { frozenFileContentHash } from "../integrations/file-content-binding";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import { MembershipService } from "../platform/membership.service";
import { EnterprisePolicyService } from "../enterprise/enterprise-policy.service";
import { RentalBusinessService } from "./rental-business.service";
import { FileStorageRuntimeService, type FileBusinessOwner } from "../integrations/file-storage.runtime.service";
import type { CapabilityHookSubjectType } from "./capability-hook.repository";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import {
  buildCapabilityEquipment,
  buildCapabilityEquipmentFromAssets,
  projectCapabilityEquipment,
  type CapabilityEquipmentGroup
} from "./capability-equipment";
import {
  DEFAULT_RENTAL_PAYMENT_METHODS,
  RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE,
  RENTAL_CATEGORY_DEFINITIONS,
  RENTAL_PAYMENT_METHOD_CODES,
  RentalAssetStatus,
  type RentalAttributeDefinition,
  RentalCategoryCode,
  type RentalCapabilityHookPoint,
  RentalCoreOrderStatus,
  RentalInventoryMode,
  RentalReservationStatus,
  type CreateRentalInspectionRequest,
  type CorrectRentalInspectionUsageRequest,
  type CreateRentalOrderRequest,
  type PartialReturnRentalOrderRequest,
  type RentalAllocation,
  type RentalAsset,
  type RentalAvailabilityRequest,
  type RentalAvailabilityResult,
  type RentalBundleComponent,
  type RentalCapability,
  type RentalCategoryDefinition,
  type RentalCurrency,
  type RentalOfflinePaymentMethod,
  type RentalPaymentMethod,
  type RentalCouponTemplate,
  type RentalFulfillmentOperator,
  type RentalFulfillmentLocation,
  type RentalFulfillmentLocationSnapshot,
  type RentalFulfillmentMode,
  type RentalInspectionRecord,
  type RentalInspectionTemplate,
  type RentalItemGroup,
  type RentalItemGroupImage,
  type RentalPricingGroup,
  type RentalOrder,
  type RentalOrderListQuery,
  type RentalOrderPage,
  RENTAL_ORDER_LIST_DEFAULT_PAGE_SIZE,
  RENTAL_ORDER_LIST_MAX_PAGE_SIZE,
  type RentalOrderChange,
  type RentalOrderChangePreview,
  type RentalOrderExchangeInspectionSnapshot,
  type RentalExchangePickupInspectionRequest,
  type RentalOrderExchangePriceBasis,
  type RentalOrderExchangeDisposition,
  type RentalOrderServiceOccurrence,
  type RentalOrderFeeReview,
  type RentalOrderExtension,
  type RentalOrderExtensionPreview,
  type RentalPricingRate,
  type RentalRuleConfig,
  type RentalQuoteSnapshotV1,
  type RentalQuoteInventoryBasis,
  type RentalQuoteRequest,
  type CustomerOrderSubjects,
  type RentalReservation,
  type RentalStockBalance,
  type RentalStockLedgerEntry,
  type RentalStockOperationRequest,
  type RentalStockOperationResult,
  type RentalStockDisposition,
  type RentalWorkOrder,
  type RentalWorkOrderAssignee,
  type RentalWorkOrderHistoryEntry,
  type CreateRentalWorkOrderRequest,
  type AssignRentalWorkOrderRequest,
  type CancelRentalWorkOrderRequest,
  type SubmitRentalWorkOrderRequest,
  type ReviewRentalWorkOrderRequest,
  type RentalWorkOrderType,
  type RentalWorkOrderStatus,
  type SaveRentalAssetRequest,
  type SaveRentalCouponTemplateRequest,
  type SaveRentalFulfillmentLocationRequest,
  type SaveRentalFulfillmentOperatorRequest,
  type SaveRentalItemGroupRequest,
  type SaveRentalPricingGroupRequest,
  type SaveRentalStockBalanceRequest,
  type SaveTenantRentalBusinessSettingsRequest,
  type SaveTenantRentalProfileRequest,
  type SubstituteRentalBundleComponentRequest,
  type TenantRentalBusinessSettings,
  type TenantRentalProfile,
  type WorkspaceCapabilityInstance,
  type RentalCapabilityEquipmentLine,
  type RentalCapabilityExceptionSnapshot,
  type UpdateRentalServiceOccurrenceRequest
} from "@rental-os/shared";
import { getRequestWorkspaceId, getRequestIdentity, getRequestStaffLocationIds, runWithRequestIdentity } from "../../common/request-identity";
import { ACTIVE_ASSIGNMENTS, allocationComplete } from "./rental-allocation-policy";
import { RentalStateRepository } from "./rental-state.repository";
import { DEFAULT_BUSINESS_TIME_ZONE, isValidTimeZone, businessHoursError } from "./rental-business-day";
import { hasOriginalRentalCurrency, roundMoney } from "./rental-money";
import { assertExchangePricingSegments, assertIncrementalPricingSnapshot, currentExchangePricingIds } from "./rental-exchange-pricing-source";
import { assertExchangeMembershipPricing } from "./rental-exchange-membership";
import { assertExchangeCouponPricing } from "./rental-exchange-coupon";
import { assertExchangeDiscountPricing } from "./rental-exchange-discount";
import { bufferedRentalPeriod, peakReservedQuantity } from "./rental-occupancy";
import { extensionPaymentRequired } from "./rental-extension-lifecycle";
import { assertCurrentExtensionReductionBasis, assertOriginalTotalExtensionLedger } from "./rental-repricing-context";
import { effectiveExtensionRule, effectiveNoShowRule, effectiveUnpaidHoldRule, inclusiveTaxAmount } from "./rental-rule-defaults";
import { redactDeliveryAddressPhone } from "./rental-delivery-address-privacy";
import { carrierSerializedCapacityConflict, carrierShipmentInventoryMutationBlocked, rentalOrderDueAt, shiftedCarrierDueAt } from "./rental-carrier-shipment";
import { RentalFundingService } from "./rental-funding.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { RentalCoreConfigRepository, parseRentalItemGroupPageQuery, type RentalConfigStore, type RentalConfigTx, type RentalDefaultWorkspaceInitialization,
  type RentalItemGroupPageQuery, type RentalItemGroupPage, RENTAL_OPENING_TERMINOLOGY_FIELDS,
  type RentalOpeningConfigurationFacts } from "./rental-core-config.repository";
import { lockActiveCategoryBinding, type CategoryWriteBinding } from "./category-active-write";
import { assertCurrentOfflinePaymentMethod, assertRentalOfflinePaymentMethodEnabled, parseRentalOfflinePaymentMethod } from "./rental-offline-payment-method";
import type { RentalFulfillmentRequirement } from "./rental-fulfillment-admission";
import { requestFingerprint } from "./rental-idempotency.repository";
import type { ApprovedSettingsNotifications, NotificationSettingsPreview, VersionedBusinessSettings } from "./approved-settings-change.ports";
import { settingsNotificationsSchema } from "./approved-settings-change.validation";
import { RentalCategoryResolver } from "./rental-category-resolver.service";
import { normalizedRentalAttributeValue, validateRentalCategoryAttributes, reconcileRentalCategoryAttributes } from "./rental-category-attributes";
import {
  RentalCoreFactRepository,
  type ActiveReservationRow,
  type RentalAvailabilitySnapshot,
  type AssetStatusChange,
  type InventoryLockTarget,
  type RentalFactTx,
  parseRentalInspectionPageQuery,
  type RentalInspectionPageQuery,
  type RentalInspectionPage,
  type RentalCoreFactStore,
  type RentalUniqueAttributeClaim,
  type StockQuarantineChange,
  type StockReturnTransfer
} from "./rental-core-fact.repository";
import { assertRentalCategoryExtensions } from "./rental-extension-registry";
import { appendOccurrences, extensionRequestKey, stampOccurrences } from "./rental-service-occurrence";
import { serviceCancellationAmounts, type ServiceCancellationSelection } from "./rental-service-cancellation";
import { buildRentalCategorySamples } from "./rental-category-samples";
import { evaluateRentalQualification } from "./rental-qualification";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { RentalBusinessConfigRepository, type RentalBusinessConfigStore } from "./rental-business-config.repository";
import { assertExchangeServices, resolveExchangeServices, exchangeServiceConfirmationHash } from "./rental-service-catalog";
import { assetValidityError } from "./rental-asset-validity";

/**
 * 内存态只保留**配置**（库为事实源、这里是写穿缓存）。
 * 订单、预占、分配、资产、库存和检查记录已迁入数据库，不再进这个结构，
 * 避免同一份事实存在两个副本。
 */
interface TenantRentalState {
  profile: TenantRentalProfile;
  businessSettings: TenantRentalBusinessSettings;
  couponTemplates: RentalCouponTemplate[];
  operators: RentalFulfillmentOperator[];
  locations: RentalFulfillmentLocation[];
  itemGroups: RentalItemGroup[];
  pricingGroups: RentalPricingGroup[];
  inspectionTemplates: RentalInspectionTemplate[];
  /** 演示租户的样本资产/库存模板，仅在该租户库中尚无事实时落库一次。 */
  sampleAssets: RentalAsset[];
  sampleStockBalances: RentalStockBalance[];
  sampleFactsEnsured?: boolean;
  /** 该租户的配置是否已确认落库。initializeTenant 会置为 true；懒加载路径为 false。 */
  configPersisted?: boolean;
}

type StoredItemGroupImage = Omit<RentalItemGroupImage, "url"> & { fileAssetId?: string };

interface UploadedItemGroupImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const ITEM_GROUP_MEDIA_KEY = "__itemGroupMedia";
const ITEM_GROUP_IMAGE_LIMIT = 6;
const ITEM_GROUP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 一次取齐的库存事实，供同步的可用量计算使用。 */
interface InventorySnapshot {
  reservations: ActiveReservationRow[];
  assets: RentalAsset[];
  stocks: RentalStockBalance[];
}

const categories: RentalCategoryDefinition[] = RENTAL_CATEGORY_DEFINITIONS;
assertRentalCategoryExtensions(categories);

function now() { return new Date().toISOString(); }
export const RENTAL_PENDING_PAYMENT_TIMEOUT_REASON = "待支付超时自动取消";
function id(prefix: string) { return `${prefix}_${randomUUID().slice(0, 8)}`; }

/** 门店坐标：空值透传为 undefined；填了就必须成对（经纬度都在）且在合法范围，否则拒绝，不静默丢弃。 */
function normalizeCoordinate(value: number | undefined, kind: "latitude" | "longitude"): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BadRequestException("门店坐标必须是有效数字");
  const limit = kind === "latitude" ? 90 : 180;
  if (Math.abs(value) > limit) throw new BadRequestException(kind === "latitude" ? "纬度超出范围（-90~90）" : "经度超出范围（-180~180）");
  return Math.round(value * 1e7) / 1e7;
}

function workOrderTypeForReason(reason: string): RentalWorkOrderType {
  if (/清洁|清洗|clean/iu.test(reason)) return "cleaning";
  if (/缺件|补货|耗材|restock|missing[_-]item|camping[_-]missing[_-]item/iu.test(reason)) return "restock";
  if (/校准|标定|calibr/iu.test(reason)) return "calibration";
  return "repair";
}
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();
}

function defaultBusinessSettings(
  tenantId: string,
  definition: RentalCategoryDefinition,
  /**
   * 新空间的默认结算币种（需求 §948）。建租户时指定一次，此后每个新空间继承它，
   * 空间可以单独改。缺省 CNY 与既有行为一致。
   */
  currency: RentalCurrency = "CNY"
): TenantRentalBusinessSettings {
  return {
    tenantId,
    categoryCode: definition.code,
    configVersion: definition.version,
    pricing: {
      enabledUnits: [...definition.businessModel.pricingUnits],
      defaultUnit: definition.businessModel.defaultPricingUnit,
      currency,
      taxIncluded: true,
      holidayPricingEnabled: definition.businessModel.supportsHolidayPricing
    },
    // 付款时机、押金模式、异地归还与逾期规则不在这里：它们由首版规则版本
    // （rental-business.service.ts 的 defaultRuleConfig）按品类缺省生成并进快照。
    fulfillment: {
      // 承运寄送需要单独完成运单、签收/揽收证据和在途库存配置；不能因为启用一个品类就默认对客开放。
      enabledModes: definition.businessModel.fulfillmentModes.filter((mode) => mode !== "carrier_shipping"),
      deliveryServiceArea: { mode: "all", areas: [] }
    },
    payment: {
      enabledMethods: [...DEFAULT_RENTAL_PAYMENT_METHODS]
    },
    calendar: {
      weekendDays: [0, 6],
      holidayPricingEnabled: definition.businessModel.supportsHolidayPricing,
      officialCalendarRegion: "CN",
      timeZone: DEFAULT_BUSINESS_TIME_ZONE
    },
    membership: {
      signupRewardEnabled: false,
      signupRewardType: "points",
      signupRewardAmount: 0,
      referralRewardEnabled: false,
      referralRewardType: "coupon",
      referrerRewardAmount: 0,
      inviteeRewardAmount: 0,
      referralTrigger: "first_order_completed"
    },
    notifications: {
      enabledEvents: ["member.registered", "order.created", "order.confirmed", "order.cancelled", "order.pickup_overdue", "order.no_show", "pickup.completed", "return.completed", "pickup.reminder", "return.reminder", "order.overdue"],
      editableChannels: ["sms", "app_push", "wechat"]
    },
    updatedAt: now(),
    updatedBy: "system"
  };
}

/**
 * 把旧空间保存的经营设置收敛到当前品类定义。
 *
 * 品类定义会随着基础模型修正而缩小允许范围；如果读取时原样返回旧 JSON，管理端
 * 仍会显示已经不适用的计价/履约选项，而且报价上下文也可能继续使用它们。这里仅
 * 过滤运行设置，不改历史订单、报价或价格版本快照；运营下次保存时自然持久化新值。
 */
function normalizeBusinessOptionsForCategory(
  settings: RentalOpeningConfigurationFacts['settings'], definition: RentalCategoryDefinition
) {
  const supportedUnits = new Set(definition.businessModel.pricingUnits);
  const configuredUnits = new Set((settings.pricing.enabledUnits ?? []).filter((unit) => supportedUnits.has(unit)));
  const enabledUnits = definition.businessModel.pricingUnits.filter((unit) => configuredUnits.has(unit));
  const safeUnits = enabledUnits.length ? enabledUnits : [definition.businessModel.defaultPricingUnit];
  const defaultUnit = safeUnits.includes(settings.pricing.defaultUnit)
    ? settings.pricing.defaultUnit
    : definition.businessModel.defaultPricingUnit;

  const supportedModes = new Set(definition.businessModel.fulfillmentModes);
  const configuredModes = new Set((settings.fulfillment.enabledModes ?? []).filter((mode) => supportedModes.has(mode)));
  const enabledModes = definition.businessModel.fulfillmentModes.filter((mode) => configuredModes.has(mode));
  const safeModes = enabledModes.length ? enabledModes : [definition.businessModel.fulfillmentModes[0]];
  return { enabledUnits: safeUnits, defaultUnit, enabledModes: safeModes };
}

function normalizeBusinessSettingsForCategory(settings: TenantRentalBusinessSettings, definition: RentalCategoryDefinition): TenantRentalBusinessSettings {
  const { enabledUnits: safeUnits, defaultUnit, enabledModes: safeModes } = normalizeBusinessOptionsForCategory(settings, definition);
  return {
    ...settings,
    pricing: {
      ...settings.pricing,
      enabledUnits: safeUnits,
      defaultUnit,
      holidayPricingEnabled: definition.businessModel.supportsHolidayPricing && settings.pricing.holidayPricingEnabled
    },
    fulfillment: {
      ...settings.fulfillment,
      enabledModes: safeModes,
      // 兼容尚未带服务区域的旧 JSON 设置；只有管理员显式配置 allowlist 才限制报价。
      deliveryServiceArea: settings.fulfillment.deliveryServiceArea?.mode === "allowlist"
        ? {
            mode: "allowlist",
            areas: Array.isArray(settings.fulfillment.deliveryServiceArea.areas)
              ? settings.fulfillment.deliveryServiceArea.areas
              : []
          }
        : { mode: "all", areas: [] }
    },
    calendar: {
      ...settings.calendar,
      holidayPricingEnabled: definition.businessModel.supportsHolidayPricing && settings.calendar.holidayPricingEnabled
    }
  };
}

@Injectable()
export class RentalCoreService implements OnModuleInit, OnApplicationBootstrap {
  /**
   * SPACE-03：状态以**经营空间**为键，而不是租户。
   * 同租户两个空间各有独立的商品组、地点、券模板与检查模板。
   */
  private readonly states = new Map<string, TenantRentalState>();
  private readonly businessSettingsRevisions = new Map<string, number>();
  /** 同空间的读取与发布按调用顺序完成，避免旧响应覆盖已采用的新配置。 */
  private readonly configurationReadsByWorkspace = new Map<string, Promise<void>>();
  /** A missing committed profile must not become a current profile through a
   * recovery snapshot. Cleared by an authoritative read or explicit profile save. */
  private readonly missingCommittedProfiles = new Set<string>();
  /**
   * 「租户 → 默认经营空间」与「经营空间 → 品类」。
   *
   * 需要这两张表是因为 `state()` 是同步的（58 处调用），而解析空间在无会话路径上
   * 需要查库。启动预热与租户初始化时填好，`state()` 便可同步解析：
   * 有会话取会话空间，无会话取默认空间。
   */
  private readonly defaultWorkspaceByTenant = new Map<string, string>();
  private readonly categoryByWorkspace = new Map<string, RentalCategoryCode>();
  private readonly tenantByWorkspace = new Map<string, string>();
  private readonly logger = new Logger(RentalCoreService.name);
  /** 同一空间首次并发读取时，只允许一条请求执行配置与样本补落。 */
  private readonly initializationByWorkspace = new Map<string, Promise<void>>();

  // configStore 必填：配置的事实源是数据库，内存 states 只是写穿缓存。
  // 不设为可选，避免生产环境缺少注入时静默退回纯内存而无人察觉。
  constructor(
    @Inject(RentalCoreConfigRepository) private readonly configStore: RentalConfigStore,
    @Inject(RentalCoreFactRepository) private readonly factStore: RentalCoreFactStore,
    @Optional() private readonly stateRepository?: RentalStateRepository,
    // CORE-EXT-02B：capability Hook 运行时。可选是为了让不涉及能力的单测继续用
    // 两三个参数直接构造本服务；生产装配里 Nest 必然注入。
    // mysql-e2e 会断言 Hook 确实执行，因此「装配里漏掉它」会让 E2E 变红，
    // 不会变成一个静默不跑 Hook 的部署。
    @Optional() private readonly hooks?: CapabilityHookRuntime,
    // SHARED-QUAL-01：领取与续租必须重新解析当前会员事实。可选仅为保留
    // 直接构造 RentalCoreService 的内存单测；生产 AppModule 必须注入。
    @Optional() private readonly memberships?: MembershipService,
    // MKT-02D：服务实际履约与容量转换必须在订单聚合的同一事务内完成。
    @Optional() private readonly serviceCapacities?: RentalServiceCapacityService,
    // EXT-03/CAT-IMAGE-01：已配置租户对象存储时，型号图片通过统一文件生命周期服务
    // 上传、读取和删除；未注入仅保留内存/开发环境的本地图片兼容路径。
    @Optional() private readonly fileStorage?: FileStorageRuntimeService,
    // 取消/爽约后仍被订单持有的押金、预授权与多收租金，须在同一事务内读事件流推导；
    // 可选仅为保留直接构造本服务的内存单测，生产 AppModule 必然注入。
    @Optional() private readonly funding?: RentalFundingService,
    private readonly categoryResolver?: RentalCategoryResolver,
    @Optional() private readonly corporateSettlement?: CustomerCorporateSettlementService,
    @Optional() @Inject(RentalBusinessConfigRepository) private readonly businessConfigStore?: RentalBusinessConfigStore,
    @Optional() private readonly enterprisePolicies?: EnterprisePolicyService,
    @Optional() private readonly extensionPrices?: RentalBusinessService
  ) {}

  /**
   * 在一个 Core 动作上执行某触发点的全部已启用能力 Hook。
   *
   * 统一从这里取空间与品类：两者都由服务自身按会话解析（`workspaceOf` / `state`），
   * 不接受调用方传入——否则调用方可以声明另一个空间或品类来改变判定口径。
   *
   * 返回 undefined 表示「本进程没有 Hook 运行时」（仅单测直接构造的场景）。
   * 能力阻止时 `evaluate` 会抛 `CapabilityBlockedException`，本方法不吞异常：
   * 阻止必须让调用中的 Core 动作整体失败，这就是 fail-closed。
   */
  private async runHook(
    tenantId: string,
    point: RentalCapabilityHookPoint,
    subjectRef: { type: CapabilityHookSubjectType; id: string },
    subject: unknown,
    tx?: RentalFactTx,
    operator?: string,
    // CORE-EXT-02D：在途订单环节传入订单固化的能力快照，让判定按下单当时的
    // 实现版本与配置执行；不传则用当前已启用实例（商品建档等无订单快照的节点）。
    instances?: WorkspaceCapabilityInstance[]
  ) {
    const payload = subject && typeof subject === "object" ? subject as Record<string, unknown> : undefined;
    // 交接检查节点的 payload 为 { order, results }，配货/结算节点直接传订单。
    // 两种受控形状都必须读取订单的历史版本，不能因包了一层而失去历史政策。
    const orderPayload = payload?.order && typeof payload.order === "object"
      ? payload.order as Record<string, unknown> : payload;
    const historical = subjectRef.type === "order" && orderPayload
      ? orderPayload as Pick<RentalOrder, "categoryCode" | "categoryVersionId" | "capabilityPolicy" | "capabilityRequirementsSnapshot" | "lines" | "fulfillmentMode"> : undefined;
    if (!this.hooks) {
      if (historical?.capabilityRequirementsSnapshot || (historical?.categoryVersionId && this.categoryResolver &&
          (await this.categoryResolver.forVersion(historical.categoryCode, historical.categoryVersionId, tx)).conditionalCapabilities?.length)) {
        throw new ServiceUnavailableException("条件能力执行模块不可用");
      }
      return undefined;
    }
    if (historical?.capabilityRequirementsSnapshot && (!historical.categoryVersionId || !this.categoryResolver)) {
      throw new ConflictException("条件履约依据缺少可核对的品类版本");
    }
    const definition = historical?.categoryVersionId && this.categoryResolver
      ? await this.categoryResolver.forVersion(this.state(tenantId).profile.categoryCode, historical.categoryVersionId, tx)
      : historical ? undefined : await this.getWorkspaceCategory(tenantId);
    const executableSubject = definition && Array.isArray(payload?.equipment)
      ? { ...payload, equipment: projectCapabilityEquipment(payload.equipment as RentalCapabilityEquipmentLine[], definition.businessModel.assetFields) }
      : subject;
    const requirements = definition && historical
      ? resolveCapabilityRequirements(definition, historical.capabilityRequirementsSnapshot,
        historical.lines ? capabilityRequirementRoots(historical.lines.filter(line => line.quantity > (line.cancelledQuantity ?? 0))) : undefined)
      : undefined;
    if (historical?.capabilityRequirementsSnapshot && historical.fulfillmentMode !== historical.capabilityRequirementsSnapshot.fulfillmentMode) {
      throw new ConflictException("履约方式变化须保留该动作自己的条件依据");
    }
    return this.hooks.evaluate({
      point,
      tenantId,
      workspaceId: this.workspaceOf(tenantId),
      categoryCode: this.state(tenantId).profile.categoryCode,
      // 旧单明确保留已有兼容政策，不能把升级后新增必选能力套回存量。
      requiredCapabilities: requirements?.required ?? definition?.requiredCapabilities ?? (historical?.capabilityPolicy === "legacy_empty" ? [] : undefined),
      // 建档可以准备未就绪的商品；商品/履约条件在正式报价及订单动作中核对。
      inactiveConditionalCapabilities: requirements?.inactive ?? (!historical ? definition?.conditionalCapabilities?.map(row => row.code) : undefined),
      subjectRef,
      subject: executableSubject,
      tx,
      operator,
      instances
    });
  }

  /**
   * CORE-EXT-02D：把订单固化的能力快照还原成 Hook 执行名单。
   *
   * 在途订单的每个环节都用它，而不是当前实例：能力升级或暂停后，这张订单必须继续按
   * 下单当时的版本与配置履约。订单没有快照（旧订单或未注入能力服务时下的单）返回
   * undefined，`runHook` 退回按当前已启用实例判定——这与升级前的行为一致，不是回退。
   */
  private orderHookInstances(tenantId: string, order: RentalOrder): WorkspaceCapabilityInstance[] | undefined {
    // Review P1-10：没有快照的存量订单 → **空执行名单**，不是「按当前已启用能力判定」。
    //
    // 回退到当前实例意味着订单创建后新启用的任何 capability 都会反向影响这张旧订单的
    // 履约判定——一条新规则可以让一张早就成立的订单突然无法归还或结算。
    // 空名单如实表达「当时没有能力参与判定」，并由 `capabilityPolicy: legacy_empty`
    // 在响应里标明这是历史兼容订单。
    if (!order.capabilitySnapshot?.length) {
      if (order.capabilityPolicy === "legacy_empty") {
        this.logger.warn(
          `订单 ${order.id} 没有能力快照（历史兼容订单），本次判定按空名单执行，不会执行下单后新增的 capability`
        );
      }
      return [];
    }
    return WorkspaceCapabilityService.instancesFromSnapshot(
      tenantId,
      this.workspaceOf(tenantId),
      order.capabilitySnapshot
    );
  }

  private async assertExtensionCapabilityExecution(tenantId: string, order: RentalOrder,
    basis: RentalOrderExtension["executionBasis"], tx: RentalFactTx, recheckCurrent: boolean) {
    if (!basis?.categoryVersionId || !this.categoryResolver) {
      if (basis?.capabilityRequirementsSnapshot || order.capabilityRequirementsSnapshot) throw new ConflictException("续租缺少可核对的条件执行版本");
      return;
    }
    const definition = await this.categoryResolver.forVersion(basis.categoryCode, basis.categoryVersionId, tx);
    if (!definition.conditionalCapabilities?.length) return;
    resolveCapabilityRequirements(definition, basis.capabilityRequirementsSnapshot);
    const snapshot = basis.capabilityRequirementsSnapshot!;
    const lines = snapshot.rootItemGroupIds.map(itemGroupId => ({ itemGroupId, quantity: 1 }));
    if (recheckCurrent && basis.policySource === "current_workspace") {
      const rows = await tx.$queryRaw<Array<{ categoryVersionId: string | null; categoryAdoptionRevision: number }>>(Prisma.sql`
        SELECT categoryVersionId, categoryAdoptionRevision FROM business_workspaces
        WHERE id = ${this.workspaceOf(tenantId)} AND tenantId = ${tenantId} FOR UPDATE
      `);
      if (rows[0]?.categoryVersionId !== basis.categoryVersionId || rows[0]?.categoryAdoptionRevision !== basis.adoptionRevision) {
        throw new ConflictException("品类版本在续租期间已变化，请重新试算");
      }
      await validateQuotedCapabilityRequirements(tx, this.workspaceOf(tenantId), { tenantId,
        categoryCode: basis.categoryCode, categoryVersionId: basis.categoryVersionId,
        request: { lines, fulfillmentMode: snapshot.fulfillmentMode },
        capabilityRequirementsSnapshot: snapshot, capabilitySnapshot: basis.capabilitySnapshot });
    }
    const actionOrder = { ...order, categoryVersionId: basis.categoryVersionId, capabilityRequirementsSnapshot: snapshot,
      capabilitySnapshot: basis.capabilitySnapshot, fulfillmentMode: snapshot.fulfillmentMode,
      lines: snapshot.rootItemGroupIds.map(itemGroupId => {
        const fact = snapshot.items.find(item => item.itemGroupId === itemGroupId)!;
        const original = order.lines.find(line => line.itemGroupId === itemGroupId) ?? order.lines[0];
        if (!original) throw new ConflictException("续租缺少原订单商品依据");
        return { ...original, itemGroupId, inventoryMode: fact.inventoryMode, pricingGroupId: undefined,
          reservationPrecision: "exact_model" as const, cancelledQuantity: 0 };
      }) };
    await this.runHook(tenantId, "order_confirmation", { type: "order", id: order.id }, actionOrder, tx, undefined,
      this.orderHookInstances(tenantId, actionOrder));
  }

  /**
   * 演示租户的样本资产与库存落库一次。
   * 幂等：该租户库中已有任一资产或库存行就跳过，因此重启和多次调用都安全。
   */
  private async ensureSampleFacts(state: TenantRentalState) {
    if (state.sampleFactsEnsured) return;
    if (!state.sampleAssets.length && !state.sampleStockBalances.length) {
      state.sampleFactsEnsured = true;
      return;
    }
    const tenantId = state.profile.tenantId;
    const [assets, stocks] = await Promise.all([
      this.factStore.listAssets(tenantId),
      this.factStore.listStockBalances(tenantId)
    ]);
    if (!assets.length && !stocks.length) {
      const fields = (await this.effectiveCategory(tenantId, state.profile.categoryCode)).businessModel.assetFields;
      for (const asset of state.sampleAssets) {
        await this.factStore.upsertAsset(
          asset,
          this.uniqueAttributeClaims(fields, "asset", asset.attributes, { serialNo: asset.serialNo })
        );
      }
      for (const stock of state.sampleStockBalances) await this.factStore.upsertStockBalance(stock);
    }
    state.sampleFactsEnsured = true;
  }

  /**
   * 取配置上下文，并确保该租户的配置与样本事实都已落库。
   *
   * 为什么需要补落配置：`state()` 是同步的懒加载，只把 seedState 的结果灌进内存缓存，
   * 不写库（persistConfig 只在 initializeTenant 里调用）。而 seed.ts 只建租户与品类档案，
   * 不建 rental_item_groups / rental_fulfillment_locations。阶段 2 时这不可见——配置读取
   * 走内存；到阶段 3 事实落库后就会立刻炸：资产和订单行的外键指向并不存在的商品组行。
   */
  private async factContext(tenantId: string) {
    const committed = await this.refreshCommittedWorkspace(tenantId);
    if (committed && !committed.effectiveProfile) throw new ConflictException("经营空间档案尚未持久化，不能通过业务访问重新初始化");
    if (committed && !committed.businessSettings) throw new ConflictException("经营设置尚未持久化，不能通过业务访问重新初始化空间");
    const workspaceId = this.workspaceOf(tenantId);
    const state = this.state(tenantId);
    let initialization = this.initializationByWorkspace.get(workspaceId);
    if (!initialization) {
      initialization = (async () => {
        if (!state.configPersisted) {
          await this.persistConfig(state);
          state.configPersisted = true;
        }
        await this.ensureSampleFacts(state);
      })().finally(() => {
        this.initializationByWorkspace.delete(workspaceId);
      });
      this.initializationByWorkspace.set(workspaceId, initialization);
    }
    await initialization;
    return state;
  }

  async onModuleInit() {
    for (const row of await this.stateRepository?.loadCoreStates() ?? []) {
      const state = row.state as unknown as TenantRentalState;
      // 快照行自带 workspaceId，直接按空间键装载，不再需要事后从 tenantId 迁键。
      if (state?.profile?.tenantId === row.tenantId) this.states.set(row.workspaceId, state);
    }
    for (const tenant of await this.stateRepository?.loadTenantProfiles() ?? []) {
      // 守卫也必须按空间键判断：states 已改为按经营空间键，
      // 继续用 tenantId 判断会认为"还没有状态"，从而用空白 seedState
      // 覆盖上一步刚从快照恢复出来的状态（实测表现为重启后配置丢失）。
      if (!tenant.categoryCode || this.states.has(`ws_${tenant.tenantId}`)) continue;
      const categoryCode = String(tenant.categoryCode).toLowerCase() as RentalCategoryCode;
      // 品类档案仍是租户级，其对应的是该租户的默认空间。
      // 持久化空间在回填结束后的 bootstrap 按绑定版本装载；这里只保留旧内存宿主的内置样例。
      if (!this.categoryResolver && categories.some((category) => category.code === categoryCode)) {
        this.states.set(`ws_${tenant.tenantId}`, this.seedState(tenant.tenantId, categoryCode));
      }
    }
  }

  /**
   * 配置写穿缓存的启动预热。
   *
   * 用 onApplicationBootstrap 而不是 onModuleInit：快照回填服务
   * （RentalSnapshotBackfillService）也是 OnModuleInit，且在 app.module 里注册在本服务之后，
   * 如果预热放在 onModuleInit，会先于回填执行而读到空表。Nest 保证
   * onApplicationBootstrap 在所有 onModuleInit 之后运行，因此无需引入服务间耦合来排序。
   *
   * 库中已有的配置一律覆盖内存中的同名集合——库是事实源，
   * seedState 造出来的样本只是尚未落库时的占位。
   */
  async onApplicationBootstrap() {
    // 先建「租户 → 默认空间」「空间 → 品类」两张表：state() 是同步的，
    // 无会话路径（快照回填、seed）需要它们才能解析空间。
    const workspaces = await this.configStore.listWorkspaces();
    for (const workspace of workspaces) {
      this.categoryByWorkspace.set(workspace.id, workspace.categoryCode);
      this.tenantByWorkspace.set(workspace.id, workspace.tenantId);
      if (workspace.isDefault) this.defaultWorkspaceByTenant.set(workspace.tenantId, workspace.id);
    }
    if (this.configStore.loadWorkspaceSnapshot) {
      // 启动与采用后的读取使用同一锁定快照；不能先读旧配置，再单独拼接新绑定正文。
      // 原快照里的样本与缺省值不回填当前配置，合法空集也必须覆盖旧缓存。
      for (const workspace of workspaces) await this.loadCommittedWorkspace(workspace.tenantId, workspace.id);
      return;
    }
    if (this.categoryResolver) throw new ServiceUnavailableException("品类已版本化但启动缺少空间配置权威读取器");
    for (const snapshot of await this.configStore.loadAll()) {
      const cached = this.states.get(snapshot.workspaceId);
      // 品类以经营空间为准（需求 3）。
      const categoryCode = snapshot.workspaceCategoryCode;
      if (!categoryCode) continue;
      // 这里只承接未装配版本解析器的内存宿主；持久化空间已在上面读取锁定快照。
      const seeded = this.seedState(snapshot.tenantId, categoryCode, this.seedPrefix(snapshot.tenantId, snapshot.workspaceId), "CNY");
      const base = cached ?? seeded;
      // tenant_rental_profiles 是升级兼容用的租户级档案，只能还原默认空间。
      // 第二空间若直接套用它，会把 workspace 的 camping 等品类重新覆盖成租户
      // 默认空间的 camera，并让业务服务据此生成错误品类的定价和规则。
      base.profile = this.defaultWorkspaceByTenant.get(snapshot.tenantId) === snapshot.workspaceId && snapshot.profile
        ? snapshot.profile
        : seeded.profile;
      if (snapshot.businessSettings) base.businessSettings = snapshot.businessSettings;
      // 库写过配置的租户：无条件覆盖，包括空数组——库里没有就是没有。
      // 「非空才覆盖」会让合法为空的配置继续保留快照或 seedState 的演示数据，
      // 使快照在读路径上静默胜出。
      //
      // 但只有品类档案（seed 建的）而没写过任何配置的租户不能覆盖：那不是
      // "库里为空"而是"库还没写"，覆盖会把 seedState 的演示商品组直接抹掉，
      // 后续 factContext 补落时已无内容可写。
      if (snapshot.hasPersistedConfig) {
        base.operators = snapshot.operators;
        base.locations = snapshot.locations;
        base.itemGroups = snapshot.itemGroups;
        base.pricingGroups = snapshot.pricingGroups ?? snapshot.itemGroups.map((group) => this.defaultPricingGroup(group));
        base.couponTemplates = snapshot.couponTemplates;
        base.inspectionTemplates = snapshot.inspectionTemplates;
        base.configPersisted = true;
      }
      this.states.set(snapshot.workspaceId, base);
    }
  }

  async persist(tenantId: string) {
    // 快照已按经营空间存档，因此直接存**当前**空间的状态，不必再固定挑默认空间。
    const workspaceId = this.workspaceOf(tenantId);
    if (this.missingCommittedProfiles.has(workspaceId)) throw new ConflictException("经营空间档案缺失，不能把模板占位写成恢复资料");
    const state = this.states.get(workspaceId);
    if (state) await this.stateRepository?.saveCoreState(tenantId, workspaceId, state);
  }

  listCategories() { return categories; }
  async getWorkspaceCategory(tenantId: string): Promise<RentalCategoryDefinition> {
    const current = await this.refreshCommittedWorkspace(tenantId);
    return current?.definition ?? this.effectiveCategory(tenantId, this.state(tenantId).profile.categoryCode);
  }
  /** Refresh only current configuration from a scoped committed snapshot. It
   * never republishes snapshots or creates sample facts; old contexts hold their
   * own detached arrays/definition when a later adoption advances the cache. */
  async refreshCommittedWorkspace(tenantId: string) {
    return this.loadCommittedWorkspace(tenantId, this.workspaceOf(tenantId));
  }

  private async loadCommittedWorkspace(tenantId: string, workspaceId: string) {
    if (!this.configStore?.loadWorkspaceSnapshot) {
      if (this.categoryResolver) throw new ServiceUnavailableException("品类已版本化但缺少空间配置权威读取器");
      return undefined; // Explicit absorbing/memory stores have no DB authority.
    }
    const previous = this.configurationReadsByWorkspace.get(workspaceId) ?? Promise.resolve();
    const reading = previous.catch(() => undefined).then(async () => {
      const snapshot = await this.configStore.loadWorkspaceSnapshot!(tenantId, workspaceId);
      if (snapshot.tenantId !== tenantId || snapshot.workspaceId !== workspaceId || snapshot.definition.code !== snapshot.workspaceCategoryCode) {
        throw new ConflictException("空间配置快照的作用域或品类不一致");
      }
      if (snapshot.profile && (snapshot.profile.tenantId !== tenantId || snapshot.profile.categoryCode !== snapshot.definition.code)) {
        throw new ConflictException("经营空间档案与当前租户或品类不一致，不能用模板覆盖");
      }
      const seeded = this.seedState(tenantId, snapshot.definition.code, this.seedPrefix(tenantId, workspaceId), snapshot.businessSettings?.pricing.currency ?? "CNY", snapshot.definition);
      const state = this.states.get(workspaceId) ?? seeded;
      const profile = snapshot.profile;
      const effectiveProfile = profile ? { ...structuredClone(profile), terminology: {
        ...snapshot.definition.terminology, ...profile.terminology,
        navigationLabels: { ...snapshot.definition.terminology.navigationLabels, ...profile.terminology.navigationLabels }
      }, categoryVersionId: snapshot.binding.categoryVersionId, categoryAdoptionRevision: snapshot.binding.adoptionRevision } : undefined;
      if (effectiveProfile) this.missingCommittedProfiles.delete(workspaceId); else this.missingCommittedProfiles.add(workspaceId);
      // Keep the internal editor's template placeholder only for an explicit
      // profile save. Business readers and recovery writes reject its absence.
      Object.assign(state, { profile: effectiveProfile ?? seeded.profile,
        businessSettings: snapshot.businessSettings ? structuredClone(snapshot.businessSettings) : seeded.businessSettings,
        operators: structuredClone(snapshot.operators), locations: structuredClone(snapshot.locations), itemGroups: structuredClone(snapshot.itemGroups),
        pricingGroups: structuredClone(snapshot.pricingGroups ?? []), couponTemplates: structuredClone(snapshot.couponTemplates), inspectionTemplates: structuredClone(snapshot.inspectionTemplates),
        sampleAssets: [], sampleStockBalances: [], sampleFactsEnsured: true, configPersisted: snapshot.hasPersistedConfig });
      this.categoryByWorkspace.set(workspaceId, snapshot.definition.code); this.tenantByWorkspace.set(workspaceId, tenantId);
      this.states.set(workspaceId, state);
      return { ...snapshot, effectiveProfile: structuredClone(effectiveProfile) };
    });
    const settled = reading.then(() => undefined, () => undefined);
    this.configurationReadsByWorkspace.set(workspaceId, settled);
    try { return await reading; }
    finally { if (this.configurationReadsByWorkspace.get(workspaceId) === settled) this.configurationReadsByWorkspace.delete(workspaceId); }
  }
  /** Production business callers consume this single committed combination,
   * instead of independently combining profile/definition/cache getters. */
  async readBusinessContext(tenantId: string): Promise<BusinessContext> {
    const snapshot = await this.refreshCommittedWorkspace(tenantId);
    if (snapshot) {
      if (!snapshot.effectiveProfile) throw new ConflictException("经营空间档案尚未持久化，不能以模板值创建业务");
      if (!snapshot.businessSettings) throw new ConflictException("经营设置尚未持久化，不能以当前默认值创建业务");
      return structuredClone({ profile: snapshot.effectiveProfile, category: snapshot.definition, settings: snapshot.businessSettings,
        groups: snapshot.itemGroups.map(group => this.publicItemGroup(group)), pricingGroups: snapshot.pricingGroups ?? [], couponTemplates: snapshot.couponTemplates,
        locations: this.visibleLocations(snapshot.locations), operators: snapshot.operators,
        categoryVersionId: snapshot.binding.categoryVersionId, categoryAdoptionRevision: snapshot.binding.adoptionRevision });
    }
    const profile = await this.getProfile(tenantId);
    return { profile, category: await this.getWorkspaceCategory(tenantId), settings: await this.getBusinessSettings(tenantId), groups: this.listItemGroups(tenantId),
      pricingGroups: this.listPricingGroups(tenantId), couponTemplates: this.listCouponTemplates(tenantId), locations: this.listLocations(tenantId), operators: this.listOperators(tenantId) };
  }
  async getWorkspaceCategoryInTransaction(tenantId: string, workspaceId: string, categoryCode: RentalCategoryCode, tx: RentalConfigTx): Promise<RentalCategoryDefinition> {
    if (!this.categoryResolver) return this.category(categoryCode);
    const { definition } = await this.categoryResolver.forWorkspace(tenantId, workspaceId, tx);
    if (definition.code !== categoryCode) throw new ConflictException("新空间品类与初始化模板不一致");
    return definition;
  }
  /**
   * 初始化租户经营品类。
   *
   * `tx` 由租户 bootstrap 传入：需求 4.1 要求租户档案与唯一经营品类在同一事务内创建，
   * 否则会留下"租户和管理员已建、品类配置没建"的半成品租户——而阶段 3 的事实表
   * 全部外键指向这些配置，那种租户后续下单会撞外键且报错指向订单而非真正原因。
   * 内存缓存只在事务成功提交后才写入，避免回滚后缓存里留下并不存在的租户。
   */
  async initializeTenant(
    tenantId: string,
    categoryCode: RentalCategoryCode,
    tx?: RentalConfigTx,
    /** 建租户时选定的结算币种，写进首个经营空间的业务设置（需求 §948）。 */
    currency: RentalCurrency = "CNY",
    initialization?: RentalDefaultWorkspaceInitialization
  ) {
    if (tx && !this.categoryResolver) throw new ServiceUnavailableException("事务初始化缺少持久化品类解析服务");
    if (this.categoryResolver) {
      if (!tx || !this.configStore.readDefaultWorkspaceInitialization) {
        throw new ServiceUnavailableException("持久化租户初始化缺少同事务的默认空间读取接点");
      }
      // A cold or stale process cache is not evidence that this tenant is new.
      // Read the original default before selecting a recommendation or writing.
      const persisted = await this.configStore.readDefaultWorkspaceInitialization(tenantId, categoryCode, tx);
      if (persisted) {
        if (initialization?.categoryVersionId && initialization.categoryVersionId !== persisted.binding.categoryVersionId) {
          throw new ConflictException("已有默认空间不能通过初始化切换版本，请使用正式采用流程");
        }
        return structuredClone(persisted.profile);
      }
    }
    // upsertProfile 会在同一事务里建默认经营空间（见 ensureDefaultWorkspace），
    // 但那发生在 persistConfig 内部，而 persistConfig 里的写入已经需要空间。
    // 因此这里先把空间 id 按同一确定性规则登记进查找表，让同步的 workspaceOf 可用。
    const workspaceId = `ws_${tenantId}`;
    const existing = tx ? undefined : this.states.get(workspaceId);
    if (existing && existing.profile.categoryCode !== categoryCode) {
      throw new ConflictException("已有租赁数据的租户不能切换经营品类");
    }
    if (!existing) {
      if (initialization?.categoryVersionId && !this.categoryResolver) throw new ServiceUnavailableException("明确选版需要持久化品类解析服务");
      const definition = initialization?.categoryVersionId
        ? await this.categoryResolver!.forVersion(categoryCode, initialization.categoryVersionId, tx)
        : await this.categoryResolver?.forNewWorkspace(categoryCode, tx);
      if (definition?.conditionalCapabilities?.length) {
        if (!this.hooks) throw new ServiceUnavailableException("条件品类执行模块未装配，不能初始化空间");
        this.hooks.assertCategoryComposition(definition);
      }
      const seeded = this.seedState(tenantId, categoryCode, tenantId, currency, definition);
      await this.persistConfig(seeded, tx, initialization);
      seeded.configPersisted = true;
      // 先落库再发布进程缓存。persist 失败时不能让同步查找表指向一个
      // 根本不存在的空间或租户配置。
      // 外层 bootstrap 事务尚未提交时不得发布缓存；调用方会在提交返回后预热。
      if (!tx) {
        this.categoryByWorkspace.set(workspaceId, categoryCode);
        this.tenantByWorkspace.set(workspaceId, tenantId);
        this.defaultWorkspaceByTenant.set(tenantId, workspaceId);
        this.states.set(workspaceId, seeded);
      }
      return seeded.profile;
    }
    if (initialization?.categoryVersionId) {
      const current = await this.categoryResolver?.forWorkspace(tenantId, workspaceId, tx);
      if (current?.categoryVersionId !== initialization.categoryVersionId) throw new ConflictException("已有默认空间不能通过初始化切换版本");
    }
    return existing.profile;
  }

  async getCategoryOpeningOptions(query: import("@rental-os/shared").RentalCategoryOpeningOptionsQuery,
    source: "published" | "builtin_demo" = "published"): Promise<import("@rental-os/shared").RentalCategoryOpeningOptions> {
    if (source === "builtin_demo") {
      if (process.env.NODE_ENV === "production") throw new ServiceUnavailableException("生产不能使用演示品类目录");
      const search = query.search?.trim();
      if (search && search.length > 100) throw new BadRequestException("品类搜索内容过长");
      return { structureVersion: 1, source, truncated: false, options: RENTAL_CATEGORY_DEFINITIONS.filter(definition => !search || definition.code.includes(search) || definition.name.includes(search))
        .map(definition => ({ categoryCode: definition.code, name: definition.name, recommended: true, defaultWorkspaceName: rentalDefaultWorkspaceName(definition) })) };
    }
    if (!this.categoryResolver) throw new ServiceUnavailableException("发布品类目录未装配");
    return this.categoryResolver.openingOptions(query);
  }

  /**
   * SPACE-01/03：登记一个**新建的经营空间**并为其建立品类配置。
   *
   * 需求 4.1 要求新增空间必须原子创建空间档案与品类配置，因此由调用方在
   * 创建空间的同一事务内调用本方法：任一步失败则空间与配置一起回滚，
   * 不留「空间已建、没有任何品类配置」的空壳。
   *
   * 同时登记查找表，使同步的 workspaceOf/state 立刻能解析这个新空间——
   * 否则新空间在本进程内要等到下次重启预热才可用。
   */
  async registerWorkspace(
    workspaceId: string,
    tenantId: string,
    categoryCode: RentalCategoryCode,
    tx?: RentalConfigTx
  ) {
    if (this.states.has(workspaceId)) return;
    if (tx && !this.categoryResolver) throw new ServiceUnavailableException("事务初始化缺少持久化品类解析服务");
    const definition = (await this.categoryResolver?.forWorkspace(tenantId, workspaceId, tx))?.definition;
    if (definition?.conditionalCapabilities?.length) {
      if (!this.hooks) throw new ServiceUnavailableException("条件品类执行模块未装配，不能初始化空间");
      this.hooks.assertCategoryComposition(definition);
    }
    const seeded = this.seedState(tenantId, categoryCode, this.seedPrefix(tenantId, workspaceId), "CNY", definition);
    // 写入必须落在这个新空间，而不是会话当前所在的空间。
    await runWithRequestIdentity({ tenantId, workspaceId }, async () => {
      await this.persistConfig(seeded, tx);
    });
    seeded.configPersisted = true;
    // 仅在该空间的全部配置已写入后发布，避免配置写失败时留下幽灵映射。
    // 同一原则：事务内仅持久化，成功提交后由 PlatformService 统一预热发布。
    if (!tx) {
      this.categoryByWorkspace.set(workspaceId, categoryCode);
      this.tenantByWorkspace.set(workspaceId, tenantId);
      this.states.set(workspaceId, seeded);
    }
  }

  /**
   * 把整份配置落库。用于租户初始化；此后各 save* 方法按条写穿。
   * 套装必须排在其组成项之后写入——组成项是独立表的外键，先写套装会违反约束。
   */
  private async persistConfig(state: TenantRentalState, tx?: RentalConfigTx, initialization?: RentalDefaultWorkspaceInitialization) {
    await this.configStore.upsertProfile(state.profile, tx, initialization);
    await this.configStore.upsertBusinessSettings(state.businessSettings, state.businessSettings.updatedBy, tx);
    for (const operator of state.operators) await this.configStore.upsertOperator(operator, tx);
    for (const location of state.locations) await this.configStore.upsertLocation(location, tx);
    const ordered = [...state.itemGroups].sort(
      (left, right) => Number(left.inventoryMode === RentalInventoryMode.Bundle) - Number(right.inventoryMode === RentalInventoryMode.Bundle)
    );
    for (const group of ordered) await this.configStore.upsertItemGroup(group, tx);
    for (const pricingGroup of state.pricingGroups) await this.configStore.upsertPricingGroup?.(pricingGroup, tx);
    for (const template of state.couponTemplates) await this.configStore.upsertCouponTemplate(template, tx);
    for (const template of state.inspectionTemplates) await this.configStore.upsertInspectionTemplate(template, tx);
  }
  async getProfile(tenantId: string) {
    const current = await this.refreshCommittedWorkspace(tenantId);
    if (current && !current.effectiveProfile) throw new ConflictException("经营空间档案尚未持久化，不能以模板值冒充当前配置");
    const profile = current?.effectiveProfile ?? this.state(tenantId).profile;
    const defaults = (current?.definition ?? await this.effectiveCategory(tenantId, profile.categoryCode)).terminology;
    return {
      ...profile,
      // 旧空间的术语 JSON 不会凭空获得后来新增的导航显示配置。读时补齐定义默认值，
      // 同时保留租户已保存的基础术语与逐项导航覆盖，避免 UI-NAV-01 只对新空间生效。
      terminology: {
        ...defaults,
        ...profile.terminology,
        navigationLabels: {
          ...defaults.navigationLabels,
          ...profile.terminology.navigationLabels
        }
      }
    };
  }
  /** Current R0 quote preparation context from normalized, bounded tables.
   * This does not invoke state/cache/seed/factContext or initialize prices;
   * the existing R1 resolver and quote commit remain separate and unchanged. */
  async readQuoteConfiguration(tenantId: string) {
    const identity = getRequestIdentity(), workspaceId = getRequestWorkspaceId();
    if (!identity?.userId || !workspaceId || identity.tenantId !== tenantId || identity.isSaasAdmin)
      throw new ForbiddenException('报价只读配置缺少当前租户及经营空间');
    if (typeof this.configStore.readQuoteConfigurationFacts !== 'function') throw new ServiceUnavailableException('报价持久只读配置端口不可用');
    const published = this.categoryResolver ? await this.categoryResolver.forWorkspace(tenantId, workspaceId) : undefined;
    const binding = requestFingerprint(identity), facts = await this.configStore.readQuoteConfigurationFacts(tenantId, workspaceId);
    if (facts.tenantId !== tenantId || facts.workspaceId !== workspaceId || !facts.profile || !facts.settings
      || facts.profile.tenantId !== tenantId || facts.settings.tenantId !== tenantId
      || facts.profile.categoryCode !== facts.categoryCode || facts.settings.categoryCode !== facts.categoryCode)
      throw new ConflictException('报价持久配置来源变化');
    const category = published?.definition ?? await this.effectiveCategory(tenantId, facts.categoryCode);
    if (category.code !== facts.categoryCode) throw new ConflictException('报价品类版本与持久配置不一致');
    // Apply the same existing option normalization and compatible terminology
    // merge only AFTER a persisted profile/settings exists. Never invent either.
    const settings = normalizeBusinessSettingsForCategory(facts.settings, category);
    const profile = { ...facts.profile, terminology: { ...category.terminology, ...facts.profile.terminology,
      navigationLabels: { ...category.terminology.navigationLabels, ...facts.profile.terminology.navigationLabels } } };
    if (!settings.payment.enabledMethods?.length) settings.payment = { ...settings.payment, enabledMethods: [...DEFAULT_RENTAL_PAYMENT_METHODS] };
    if (published) {
      const latest = await this.categoryResolver!.forWorkspace(tenantId, workspaceId);
      if (latest.categoryVersionId !== published.categoryVersionId || latest.adoptionRevision !== published.adoptionRevision)
        throw new ConflictException('报价读取期间采用版本已变化，请重新读取');
    }
    if (requestFingerprint(getRequestIdentity()) !== binding) throw new ForbiddenException('报价配置读取期间授权范围变化');
    return { tenantId, workspaceId, ...(published ? { categoryVersionId: published.categoryVersionId, categoryAdoptionRevision: published.adoptionRevision } : {}), profile, category, settings, groups: facts.groups, pricingGroups: facts.pricingGroups,
      couponTemplates: facts.couponTemplates, locations: facts.locations, operators: facts.operators };
  }

  /** R0 report metadata, observed under the existing report Guard/ALS. Does not
   * initialize configuration or read a quote/price/inventory context. */
  async readReportConfiguration(tenantId: string): ReturnType<NonNullable<RentalConfigStore['readReportConfigurationFacts']>> {
    // isPlatformAdmin means tenant administrator in the original Guard, not
    // SaaS. It supplies no tenant/space grant independently of that Guard/ALS.
    const identity = getRequestIdentity(), workspaceId = getRequestWorkspaceId();
    if (!workspaceId || !identity?.userId || identity.tenantId !== tenantId || identity.isSaasAdmin)
      throw new ForbiddenException('经营报表配置缺少当前租户及经营空间');
    if (typeof this.configStore.readReportConfigurationFacts !== 'function') throw new ServiceUnavailableException('经营报表持久配置端口不可用');
    const binding = requestFingerprint(identity);
    const published = this.categoryResolver ? await this.categoryResolver.forWorkspace(tenantId, workspaceId) : undefined;
    const facts = await this.configStore.readReportConfigurationFacts(tenantId, workspaceId);
    if (facts.tenantId !== tenantId || facts.workspaceId !== workspaceId) throw new ConflictException('经营报表配置来源变化');
    const definition = published?.definition ?? await this.effectiveCategory(tenantId, facts.categoryCode);
    if (definition.code !== facts.categoryCode) throw new ConflictException('经营报表品类来源变化');
    if (published) {
      const latest = await this.categoryResolver!.forWorkspace(tenantId, workspaceId);
      if (latest.categoryVersionId !== published.categoryVersionId || latest.adoptionRevision !== published.adoptionRevision)
        throw new ConflictException('经营报表读取期间采用版本已变化，请重新读取');
    }
    if (requestFingerprint(getRequestIdentity()) !== binding) throw new ForbiddenException('经营报表配置读取期间授权范围变化');
    return facts;
  }

  /** Opening-only persisted page and selected fields. No state/seed/cache scan
   * or quote initialization; option normalization is shared with manual reads. */
  async readOpeningConfiguration(tenantId: string): Promise<RentalOpeningConfigurationFacts & { categoryVersion: string }> {
    const identity = getRequestIdentity(), workspaceId = getRequestWorkspaceId();
    if (!workspaceId || identity?.tenantId !== tenantId) throw new ForbiddenException('开业配置缺少当前租户或经营空间');
    if (typeof this.configStore.readOpeningConfigurationFacts !== 'function') throw new ServiceUnavailableException('开业配置持久投影不可用');
    const binding = requestFingerprint(identity);
    const published = this.categoryResolver ? await this.categoryResolver.forWorkspace(tenantId, workspaceId) : undefined;
    const facts = await this.configStore.readOpeningConfigurationFacts(tenantId, workspaceId);
    if (facts.tenantId !== tenantId || facts.workspaceId !== workspaceId) throw new ConflictException('开业配置来源变化');
    const definition = published?.definition ?? await this.effectiveCategory(tenantId, facts.categoryCode);
    if (definition.code !== facts.categoryCode) throw new ConflictException('开业配置品类来源变化');
    const options = normalizeBusinessOptionsForCategory(facts.settings, definition);
    const profile = facts.profile ? { ...facts.profile, terminology: Object.fromEntries(RENTAL_OPENING_TERMINOLOGY_FIELDS.map(field =>
      [field, facts.profile!.terminology[field] ?? definition.terminology[field]])) } : null;
    if (published) {
      const latest = await this.categoryResolver!.forWorkspace(tenantId, workspaceId);
      if (latest.categoryVersionId !== published.categoryVersionId || latest.adoptionRevision !== published.adoptionRevision)
        throw new ConflictException('开业配置读取期间采用版本已变化，请重新读取');
    }
    if (getRequestWorkspaceId() !== workspaceId || requestFingerprint(getRequestIdentity()) !== binding)
      throw new ForbiddenException('开业配置读取期间授权范围变化');
    return { ...facts, profile, categoryVersion: definition.version,
      settings: { ...facts.settings, pricing: { ...facts.settings.pricing, enabledUnits: options.enabledUnits, defaultUnit: options.defaultUnit },
        fulfillment: { enabledModes: options.enabledModes } } };
  }

  async getBusinessSettings(tenantId: string) {
    const committed = await this.refreshCommittedWorkspace(tenantId);
    if (committed && !committed.businessSettings) throw new ConflictException("经营设置尚未持久化，不能以当前默认值冒充实际配置");
    const state = this.state(tenantId);
    const settings = normalizeBusinessSettingsForCategory(
      committed?.businessSettings ?? state.businessSettings,
      committed?.definition ?? await this.effectiveCategory(tenantId, state.profile.categoryCode)
    );
    // 兼容已经落库、但还没有 enabledMethods 的旧 JSON 设置；读路径先给出明确默认值，
    // 下次保存时再把它持久化，避免存量空间突然变成“没有任何可用收款方式”。
    if (settings.payment.enabledMethods?.length) return settings;
    return { ...settings, payment: { ...settings.payment, enabledMethods: [...DEFAULT_RENTAL_PAYMENT_METHODS] } };
  }

  /** Current configuration admission only; funding still checks in its original
   * transaction after reading any existing receipt. Never use the process cache
   * as a current payment selection or as evidence of a money result. */
  async resolveOfflinePaymentMethod(tenantId: string, requested?: RentalOfflinePaymentMethod, tx?: RentalConfigTx): Promise<RentalOfflinePaymentMethod> {
    const method = parseRentalOfflinePaymentMethod(requested);
    if (tx) await assertCurrentOfflinePaymentMethod(tx, tenantId, this.workspaceOf(tenantId), method);
    else assertRentalOfflinePaymentMethodEnabled(method, (await this.getBusinessSettings(tenantId)).payment.enabledMethods);
    return method;
  }

  async saveBusinessSettings(tenantId: string, input: SaveTenantRentalBusinessSettingsRequest, operator: string) {
    const { settings, binding } = await this.buildBusinessSettings(tenantId, input, operator);
    const settingsRevision = await this.configStore.upsertBusinessSettings(settings, operator, undefined, binding);
    this.publishBusinessSettings(tenantId, { settings, settingsRevision });
    return settings;
  }

  async readVersionedBusinessSettings(tenantId: string, tx?: RentalConfigTx) {
    const current = await this.configStore.readVersionedBusinessSettings(tenantId, tx);
    if (!current || current.settings.tenantId !== tenantId) throw new ConflictException("经营设置尚未持久化或版本不可用");
    return current;
  }

  async previewNotificationSettings(
    tenantId: string, notifications: ApprovedSettingsNotifications, operator: string, tx: RentalConfigTx
  ): Promise<NotificationSettingsPreview> {
    const parsed = settingsNotificationsSchema.safeParse(notifications);
    if (!parsed.success) throw new BadRequestException("通知变更只能包含合法的系统事件及渠道数组");
    const current = await this.readVersionedBusinessSettings(tenantId, tx);
    const intended = { ...current.settings, notifications: parsed.data };
    const { settings: nextSettings, binding } = await this.buildBusinessSettings(tenantId, intended, operator, tx);
    const { updatedAt: previousAt, updatedBy: previousBy, ...previousContent } = intended;
    const { updatedAt: nextAt, updatedBy: nextBy, ...nextContent } = nextSettings;
    if (!binding || requestFingerprint(previousContent) !== requestFingerprint(nextContent)) {
      throw new ConflictException("经营设置需要人工更新后才能准备通知变更");
    }
    return { ...current, baseSettingsHash: requestFingerprint(current.settings), binding,
      before: structuredClone(current.settings.notifications), after: structuredClone(parsed.data), nextSettings };
  }

  async commitNotificationSettings(
    tenantId: string, notifications: ApprovedSettingsNotifications, operator: string,
    expected: { baseRevision: number; baseSettingsHash: string; binding: CategoryWriteBinding }, tx: RentalConfigTx
  ): Promise<VersionedBusinessSettings> {
    const preview = await this.previewNotificationSettings(tenantId, notifications, operator, tx);
    if (preview.settingsRevision !== expected.baseRevision || preview.baseSettingsHash !== expected.baseSettingsHash ||
        requestFingerprint(preview.binding) !== requestFingerprint(expected.binding)) {
      throw new ConflictException("经营设置或品类绑定已变化，请重新准备");
    }
    const settingsRevision = await this.configStore.upsertBusinessSettings(
      preview.nextSettings, operator, tx, expected.binding, expected.baseRevision
    );
    return { settings: preview.nextSettings, settingsRevision };
  }

  async refreshCommittedBusinessSettings(tenantId: string) {
    const current = await this.readVersionedBusinessSettings(tenantId);
    this.publishBusinessSettings(tenantId, current);
  }

  private publishBusinessSettings(tenantId: string, current: VersionedBusinessSettings) {
    const workspaceId = this.workspaceOf(tenantId);
    // A delayed commit acknowledgement must not replace a newer local revision.
    if (current.settingsRevision < (this.businessSettingsRevisions.get(workspaceId) ?? 0)) return;
    this.state(tenantId).businessSettings = structuredClone(current.settings);
    this.businessSettingsRevisions.set(workspaceId, current.settingsRevision);
  }

  private async buildBusinessSettings(
    tenantId: string, input: SaveTenantRentalBusinessSettingsRequest, operator: string, tx?: RentalConfigTx
  ) {
    const state = this.state(tenantId);
    const { definition, binding } = tx
      ? await lockActiveCategoryBinding(tx, tenantId, this.workspaceOf(tenantId), undefined, state.profile.categoryCode)
      : await this.categoryWriteContext(tenantId, state.profile.categoryCode);
    const pricingUnits = new Set(definition.businessModel.pricingUnits);
    const fulfillmentModes = new Set(definition.businessModel.fulfillmentModes);
    const enabledPaymentMethods = input.payment.enabledMethods?.length ? input.payment.enabledMethods : DEFAULT_RENTAL_PAYMENT_METHODS;
    if (!enabledPaymentMethods.length || enabledPaymentMethods.some((method) => !RENTAL_PAYMENT_METHOD_CODES.includes(method))) {
      throw new BadRequestException("至少启用一种有效的收款方式");
    }
    if (!input.pricing.enabledUnits.length || input.pricing.enabledUnits.some((unit) => !pricingUnits.has(unit))) {
      throw new BadRequestException("存在当前经营品类不支持的计价单位");
    }
    if (!input.pricing.enabledUnits.includes(input.pricing.defaultUnit)) {
      throw new BadRequestException("默认计价单位必须处于已启用计价单位中");
    }
    // 时区必须在保存时 fail-closed。放行一个无效标识的话，`Intl` 会在**报价时**抛
    // RangeError，表现为下单前 500——错误离配置点很远，排查成本高得多。
    if (input.calendar.timeZone !== undefined && !isValidTimeZone(input.calendar.timeZone)) {
      throw new BadRequestException(`无效的时区标识：${input.calendar.timeZone}`);
    }
    // 每周营业模板按下标定位星期（0=周日…6=周六）。允许留空（不配时段），
    // 但一旦配置就必须是完整 7 项——否则「只配 5 个工作日」会被按下标解读成周日到周四，
    // 而不是运营以为的周一到周五（需求 4.5.1 的每周模板按星期定位）。
    if (input.calendar.weeklyHours !== undefined) {
      if (input.calendar.weeklyHours.length !== 0 && input.calendar.weeklyHours.length !== 7) {
        throw new BadRequestException("每周营业时段模板必须是 7 项（下标 0=周日…6=周六），或留空表示不配置");
      }
      const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      input.calendar.weeklyHours.forEach((hours, weekday) => {
        const error = businessHoursError(hours, weekdayNames[weekday] ?? `星期${weekday}`);
        if (error) throw new BadRequestException(error);
      });
    }
    if (!input.fulfillment.enabledModes.length || input.fulfillment.enabledModes.some((mode) => !fulfillmentModes.has(mode))) {
      throw new BadRequestException("存在当前经营品类不支持的履约方式");
    }
    const configuredDeliveryArea =
      input.fulfillment.deliveryServiceArea ??
      state.businessSettings.fulfillment.deliveryServiceArea ??
      { mode: "all" as const, areas: [] };
    if (configuredDeliveryArea.mode !== "all" && configuredDeliveryArea.mode !== "allowlist") {
      throw new BadRequestException("配送服务区域模式无效");
    }
    if (!Array.isArray(configuredDeliveryArea.areas) || configuredDeliveryArea.areas.length > 100) {
      throw new BadRequestException("配送服务区域最多配置 100 条");
    }
    const normalizedDeliveryAreas = configuredDeliveryArea.mode === "allowlist"
      ? configuredDeliveryArea.areas.map((area) => {
          const province = typeof area?.province === "string" ? area.province.trim() : "";
          const city = typeof area?.city === "string" ? area.city.trim() : "";
          const district = typeof area?.district === "string" ? area.district.trim() : "";
          if (!province || !city || province.length > 64 || city.length > 64 || district.length > 64) {
            throw new BadRequestException("配送区域必须填写省份和城市，区县最多 64 个字符");
          }
          return { province, city, ...(district ? { district } : {}) };
        })
      : [];
    const areaKeys = normalizedDeliveryAreas.map((area) => [
      area.province.toLocaleLowerCase(),
      area.city.toLocaleLowerCase(),
      area.district?.toLocaleLowerCase() ?? ""
    ].join("|"));
    if (new Set(areaKeys).size !== areaKeys.length) throw new BadRequestException("配送服务区域不能重复");
    if (configuredDeliveryArea.mode === "allowlist" && normalizedDeliveryAreas.length === 0) {
      throw new BadRequestException("启用按地区限制时至少添加一个配送区域");
    }
    // 预授权与逾期参数的校验随字段一起移到规则版本（validateRule）；设置里不再有这些字段。
    if ((input.pricing.holidayPricingEnabled || input.calendar.holidayPricingEnabled) && !definition.businessModel.supportsHolidayPricing) {
      throw new BadRequestException("当前经营品类不支持节假日差异定价");
    }
    if (input.calendar.weekendDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new BadRequestException("周末规则只能使用 0 到 6 的星期序号");
    const rewardAmounts = [input.membership.signupRewardAmount, input.membership.referrerRewardAmount, input.membership.inviteeRewardAmount];
    if (rewardAmounts.some((amount) => !Number.isFinite(amount) || amount < 0)) throw new BadRequestException("会员奖励数量不能为负数");
    const validateRewardCoupon = (enabled: boolean, type: string, amount: number, templateId: string | undefined) => {
      if (!enabled || type !== "coupon" || amount <= 0) return;
      if (!Number.isInteger(amount)) throw new BadRequestException("优惠券奖励数量必须是整数");
      if (!templateId || !state.couponTemplates.some((template) => template.id === templateId && template.status === "active")) throw new BadRequestException("优惠券奖励必须选择进行中的券模板");
    };
    validateRewardCoupon(input.membership.signupRewardEnabled, input.membership.signupRewardType, input.membership.signupRewardAmount, input.membership.signupRewardCouponTemplateId);
    validateRewardCoupon(input.membership.referralRewardEnabled, input.membership.referralRewardType, Math.max(input.membership.referrerRewardAmount, input.membership.inviteeRewardAmount), input.membership.referralRewardCouponTemplateId);
    const supportedNotificationEvents = new Set(["member.registered", "referral.rewarded", "order.created", "order.confirmed", "order.cancelled", "order.pickup_overdue", "order.no_show", "pickup.completed", "return.completed", "pickup.reminder", "return.reminder", "order.overdue", "qualification.reviewed", "refund.completed", "asset.exception"]);
    if (!input.notifications.editableChannels.length || input.notifications.enabledEvents.some((event) => !supportedNotificationEvents.has(event))) throw new BadRequestException("通知渠道不能为空，且只能启用已注册的系统事件");
    const nextSettings = {
      ...input,
      fulfillment: {
        ...input.fulfillment,
        deliveryServiceArea: { mode: configuredDeliveryArea.mode, areas: normalizedDeliveryAreas }
      },
      payment: { ...input.payment, enabledMethods: [...new Set(enabledPaymentMethods)] as RentalPaymentMethod[] },
      tenantId,
      categoryCode: definition.code,
      configVersion: definition.version,
      updatedAt: now(),
      updatedBy: operator
    };
    return { settings: nextSettings, binding };
  }

  listCouponTemplates(tenantId: string) { return this.state(tenantId).couponTemplates; }

  async readCouponTemplates(tenantId: string) {
    const state = this.state(tenantId);
    if (this.configStore.listCouponTemplates) {
      const beforeRead = JSON.stringify(state.couponTemplates);
      const rows = await this.configStore.listCouponTemplates(tenantId, this.resolveWorkspaceId(tenantId));
      // Do not let a delayed read replace a newer local write or refresh.
      // Preserve the array reference used by in-flight business contexts.
      if (JSON.stringify(state.couponTemplates) === beforeRead) {
        state.couponTemplates.splice(0, state.couponTemplates.length, ...rows);
      }
      return rows;
    }
    return state.couponTemplates;
  }

  async saveCouponTemplate(tenantId: string, input: SaveRentalCouponTemplateRequest) {
    await this.readCouponTemplates(tenantId);
    const state = this.state(tenantId);
    const { binding } = await this.categoryWriteContext(tenantId, state.profile.categoryCode);
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("优惠券编码和名称不能为空");
    if (!Number.isFinite(input.discountValue) || input.discountValue <= 0) throw new BadRequestException("优惠值必须大于 0");
    if (input.discountType === "percentage" && input.discountValue > 100) throw new BadRequestException("折扣百分比不能超过 100");
    if (!Number.isFinite(input.minimumSpend) || input.minimumSpend < 0 || (input.maximumDiscount !== undefined && input.maximumDiscount < 0)) throw new BadRequestException("优惠门槛或封顶金额无效");
    if (!Number.isInteger(input.totalQuota) || input.totalQuota < 0 || !Number.isInteger(input.perCustomerLimit) || input.perCustomerLimit <= 0) throw new BadRequestException("发行量或每客限领数量无效");
    if (input.perCustomerUseLimit !== undefined && (!Number.isInteger(input.perCustomerUseLimit) || input.perCustomerUseLimit <= 0)) throw new BadRequestException("每客使用次数上限无效");
    if (input.totalBudget !== undefined && (!Number.isFinite(input.totalBudget) || input.totalBudget < 0)) throw new BadRequestException("总优惠预算无效");
    const claimFrom = input.claimFrom?.trim() || input.effectiveFrom;
    const claimTo = input.claimTo?.trim() || input.effectiveTo;
    const dates = [claimFrom, claimTo, input.effectiveFrom, input.effectiveTo, input.applicableRentalFrom, input.applicableRentalTo]
      .filter((value): value is string => Boolean(value)).map((value) => Date.parse(value));
    if (dates.some((value) => !Number.isFinite(value))) throw new BadRequestException("优惠券时间格式无效");
    if (Date.parse(claimFrom) >= Date.parse(claimTo)) throw new BadRequestException("优惠券领取时间范围无效");
    if (Date.parse(input.effectiveFrom) >= Date.parse(input.effectiveTo)) throw new BadRequestException("优惠券使用时间范围无效");
    if (input.applicableRentalFrom && input.applicableRentalTo && Date.parse(input.applicableRentalFrom) > Date.parse(input.applicableRentalTo)) {
      throw new BadRequestException("优惠券适用租期范围无效");
    }
    const duplicate = state.couponTemplates.find((row) => row.code === input.code.trim() && row.id !== input.id);
    if (duplicate) throw new ConflictException("优惠券编码已存在");
    const invalidGroup = (input.applicableItemGroupIds ?? []).find((itemGroupId) => !state.itemGroups.some((group) => group.id === itemGroupId));
    if (invalidGroup) throw new BadRequestException("优惠券包含不存在的适用商品");
    const existing = input.id ? state.couponTemplates.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("优惠券模板不存在");
    if (existing && input.totalQuota < existing.claimedQuantity) throw new BadRequestException("发行量不能低于已领取数量");
    if (existing && input.totalBudget !== undefined && input.totalBudget < existing.lockedBudget + existing.redeemedBudget) throw new BadRequestException("总预算不能低于已锁定与已核销预算");
    const timestamp = now();
    const nextVersion = existing ? `${Number(existing.version.split(".")[0] ?? 0) + 1}.0` : "1.0";
    const result: RentalCouponTemplate = {
      id: existing?.id ?? id("coupon"), tenantId, code: input.code.trim(), name: input.name.trim(),
      discountType: input.discountType, discountValue: input.discountValue, minimumSpend: input.minimumSpend,
      maximumDiscount: input.maximumDiscount, totalQuota: input.totalQuota, claimedQuantity: existing?.claimedQuantity ?? 0,
      appliesTo: input.appliesTo ?? existing?.appliesTo ?? "rental",
      stackableWithDiscountPlans: input.stackableWithDiscountPlans ?? existing?.stackableWithDiscountPlans ?? true,
      perCustomerLimit: input.perCustomerLimit, perCustomerUseLimit: input.perCustomerUseLimit ?? existing?.perCustomerUseLimit ?? 1,
      totalBudget: input.totalBudget ?? existing?.totalBudget, lockedBudget: existing?.lockedBudget ?? 0, redeemedBudget: existing?.redeemedBudget ?? 0,
      claimFrom, claimTo,
      effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
      applicableRentalFrom: input.applicableRentalFrom === undefined
        ? existing?.applicableRentalFrom
        : input.applicableRentalFrom.trim() || undefined,
      applicableRentalTo: input.applicableRentalTo === undefined
        ? existing?.applicableRentalTo
        : input.applicableRentalTo.trim() || undefined,
      applicableItemGroupIds: [...new Set(input.applicableItemGroupIds ?? [])], status: input.status ?? existing?.status ?? "draft",
      version: nextVersion, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    await this.configStore.upsertCouponTemplate(result, undefined, binding);

    if (existing) state.couponTemplates.splice(state.couponTemplates.indexOf(existing), 1, result); else state.couponTemplates.unshift(result);
    return result;
  }

  async saveProfile(tenantId: string, input: SaveTenantRentalProfileRequest) {
    const { definition, binding } = await this.categoryWriteContext(tenantId, input.categoryCode, true);
    const state = this.state(tenantId);
    const categoryChanged = state.profile.categoryCode !== input.categoryCode;
    if (categoryChanged) throw new ConflictException("SaaS 租户创建后经营品类固定，不能切换");
    const allowed = new Set(definition.defaultCapabilities);
    const capabilities = (input.capabilities ?? state.profile.capabilities).filter((item) => allowed.has(item));
    const nextProfile = {
      ...state.profile,
      categoryCode: input.categoryCode,
      capabilities,
      terminology: {
        ...definition.terminology,
        ...state.profile.terminology,
        ...input.terminology,
        navigationLabels: {
          ...definition.terminology.navigationLabels,
          ...state.profile.terminology.navigationLabels,
          ...input.terminology?.navigationLabels
        }
      },
      configVersion: definition.version,
      ...(binding ? { categoryVersionId: binding.categoryVersionId, categoryAdoptionRevision: binding.adoptionRevision } : {}),
      updatedAt: now()
    };
    // 先写库，成功后再落缓存：库写失败时缓存保持原状，
    // 不留只存在于当前进程的幽灵配置。
    await this.configStore.upsertProfile(nextProfile, undefined, undefined, binding);
    state.profile = nextProfile;
    this.missingCommittedProfiles.delete(this.workspaceOf(tenantId));
    return state.profile;
  }

  listLocations(tenantId: string) {
    return this.visibleLocations(this.state(tenantId).locations);
  }

  private visibleLocations(locations: RentalFulfillmentLocation[]) {
    const locationIds = getRequestStaffLocationIds();
    return locationIds === undefined ? locations : locations.filter((row) => locationIds.includes(row.id));
  }

  listOperators(tenantId: string) { return this.state(tenantId).operators; }

  async saveOperator(tenantId: string, input: SaveRentalFulfillmentOperatorRequest) {
    const state = this.state(tenantId);
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("经营主体编码和名称不能为空");
    if (input.status !== undefined && input.status !== 'enabled' && input.status !== 'disabled') throw new BadRequestException("经营主体状态无效");
    const duplicate = state.operators.find((row) => row.code === input.code.trim() && row.id !== input.id);
    if (duplicate) throw new ConflictException("经营主体编码已存在");
    const existing = input.id ? state.operators.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("经营主体不存在");
    const timestamp = now();
    const result: RentalFulfillmentOperator = {
      id: existing?.id ?? id("operator"), tenantId, code: input.code.trim(), name: input.name.trim(), type: input.type,
      contactName: input.contactName?.trim(), contactPhone: input.contactPhone?.trim(),
      settlementMode: input.settlementMode ?? (input.type === "partner" ? "monthly" : "self"),
      status: input.status ?? existing?.status ?? "enabled", createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    const preserveStatus = Boolean(existing && input.status === undefined);
    const savedStatus = await this.configStore.upsertOperator(result, undefined, preserveStatus);
    if (preserveStatus && savedStatus === undefined) throw new ServiceUnavailableException("经营主体原状态读取不可用");
    if (savedStatus !== undefined) result.status = savedStatus;

    if (existing) state.operators.splice(state.operators.indexOf(existing), 1, result); else state.operators.unshift(result);
    return result;
  }

  async saveLocation(tenantId: string, input: SaveRentalFulfillmentLocationRequest) {
    const state = this.state(tenantId);
    const { definition, binding } = await this.categoryWriteContext(tenantId, state.profile.categoryCode);
    if (!definition.businessModel.locationTypes.includes(input.type)) throw new BadRequestException("当前经营品类不支持该履约地点类型");
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("地点编码和名称不能为空");
    if (input.status !== undefined && input.status !== 'enabled' && input.status !== 'disabled') throw new BadRequestException("履约地点状态无效");
    let operator = input.operatorId ? state.operators.find((row) => row.id === input.operatorId) : undefined;
    if (!operator && input.operatorName?.trim()) {
      operator = state.operators.find((row) => row.name === input.operatorName?.trim());
      if (!operator) operator = await this.saveOperator(tenantId, { code: `LEGACY-${state.operators.length + 1}`, name: input.operatorName.trim(), type: input.operatorType ?? "self_operated" });
    }
    if (!operator || operator.status !== "enabled") throw new BadRequestException("请选择已启用的经营主体");
    if (!input.capabilities?.length) throw new BadRequestException("履约地点至少需要一种能力");
    // 坐标要么都不填，要么经纬度成对；只填一个无法定位，拒绝而不是静默丢弃。
    if ((input.latitude === undefined || input.latitude === null) !== (input.longitude === undefined || input.longitude === null)) {
      throw new BadRequestException("门店坐标需要同时填写经度和纬度");
    }
    const duplicate = state.locations.find((row) => row.code === input.code.trim() && row.id !== input.id);
    if (duplicate) throw new ConflictException("履约地点编码已存在");
    if (input.id && input.parentLocationId === input.id) throw new BadRequestException("地点不能将自身设为上级");
    if (input.parentLocationId) this.location(state, input.parentLocationId);
    const existing = input.id ? state.locations.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("履约地点不存在");
    const result: RentalFulfillmentLocation = {
      id: existing?.id ?? id("location"),
      tenantId,
      organizationId: input.organizationId === null ? undefined : input.organizationId?.trim() || existing?.organizationId,
      code: input.code.trim(),
      name: input.name.trim(),
      type: input.type,
      operatorId: operator.id,
      operatorType: operator.type,
      operatorName: operator.name,
      parentLocationId: input.parentLocationId,
      capabilities: [...new Set(input.capabilities)],
      address: input.address?.trim(),
      latitude: normalizeCoordinate(input.latitude, "latitude"),
      longitude: normalizeCoordinate(input.longitude, "longitude"),
      contactName: input.contactName?.trim(),
      contactPhone: input.contactPhone?.trim(),
      businessHours: input.businessHours?.trim(),
      status: input.status ?? existing?.status ?? "enabled"
    };
    const preserveStatus = Boolean(existing && input.status === undefined);
    const savedStatus = await this.configStore.upsertLocation(result, undefined, binding, preserveStatus);
    if (preserveStatus && savedStatus === undefined) throw new ServiceUnavailableException("履约地点原状态读取不可用");
    if (savedStatus !== undefined) result.status = savedStatus;

    if (existing) state.locations.splice(state.locations.indexOf(existing), 1, result); else state.locations.unshift(result);
    return result;
  }
  listItemGroups(tenantId: string) { return this.state(tenantId).itemGroups.map((group) => this.publicItemGroup(group)); }
  /** Minimal persisted read port for bounded consumers. Existing cached/manual
   * list and all pricing/write semantics remain unchanged. No fallback scan. */
  async listItemGroupsPage(tenantId: string, value: RentalItemGroupPageQuery): Promise<RentalItemGroupPage> {
    const query = parseRentalItemGroupPageQuery(value), workspaceId = this.workspaceOf(tenantId);
    if (!this.configStore.listItemGroupsPage) throw new ServiceUnavailableException('商品持久分页读取不可用');
    const result = structuredClone(await this.configStore.listItemGroupsPage(tenantId, workspaceId, query));
    if (this.workspaceOf(tenantId) !== workspaceId || result.rows.length > query.limit
      || result.rows.some(row => row.tenantId !== tenantId) || result.source !== 'persisted_workspace_configuration')
      throw new ConflictException('商品分页读取来源变化');
    return result;
  }

  /** Original bounded catalog page in the caller's active transaction/Guard ALS.
   * No state initialization, default workspace, pricing, stock hold or commit.
   * Owner supplies coherent isolation and current authorization through return. */
  async listItemGroupsPageInTransaction(tenantId: string, value: RentalItemGroupPageQuery,
    native: RentalConfigTx, signal: AbortSignal, assertCurrent?: () => void): Promise<RentalItemGroupPage> {
    const identity = getRequestIdentity();
    if (!identity?.workspaceId || identity.tenantId !== tenantId || !identity.userId || identity.isSaasAdmin
      || identity.audience !== 'operator' || !native || '$transaction' in native
      || typeof native.businessWorkspace?.findFirst !== 'function' || typeof native.rentalItemGroup?.findMany !== 'function'
      || typeof native.$queryRaw !== 'function'
      || typeof this.configStore.listItemGroupsPage !== 'function') throw new ServiceUnavailableException('商品事务分页读取范围不可用');
    const binding = requestFingerprint(structuredClone(identity));
    const live = () => {
      if (signal.aborted || requestFingerprint(getRequestIdentity() ?? null) !== binding) throw new ForbiddenException('商品事务读取已停止或范围变化');
      assertCurrent?.();
    };
    live();
    const query = parseRentalItemGroupPageQuery(value);
    // Scope resolution awaits before/after the page. Fence each actual delegate
    // dispatch so a cancelled scope lookup cannot start a late configuration read.
    const guarded = <T extends object>(delegate: T) => new Proxy(delegate, { get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return (property === 'findFirst' || property === 'findMany') && typeof value === 'function'
        ? new Proxy(value, { apply(method, _owner, args) { live(); return Reflect.apply(method, target, args); } }) : value;
    } });
    const workspace = guarded(native.businessWorkspace), groups = guarded(native.rentalItemGroup);
    const transaction = new Proxy(native, { get(target, property, receiver) {
      if (property === '$queryRaw') {
        return new Proxy(target.$queryRaw, { apply(method, _owner, args) { live(); return Reflect.apply(method, target, args); } });
      }
      return property === 'businessWorkspace' ? workspace : property === 'rentalItemGroup' ? groups : Reflect.get(target, property, receiver);
    } });
    const page = structuredClone(await this.configStore.listItemGroupsPage(tenantId, identity.workspaceId, query, transaction));
    live();
    if (!Array.isArray(page.rows) || page.rows.length > query.limit || page.rows.some(row => row.tenantId !== tenantId)
      || page.source !== 'persisted_workspace_configuration') throw new ConflictException('商品分页读取来源变化');
    return page;
  }

  listPricingGroups(tenantId: string) { return this.state(tenantId).pricingGroups; }

  async savePricingGroup(tenantId: string, input: SaveRentalPricingGroupRequest, tx?: RentalConfigTx, deferCache = false) {
    const state = this.state(tenantId);
    const writeContext = await this.categoryWriteContext(tenantId, state.profile.categoryCode);
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("定价分组编码和名称不能为空");
    if (input.defaultPricingUnit && !(await this.getBusinessSettings(tenantId)).pricing.enabledUnits.includes(input.defaultPricingUnit)) {
      throw new BadRequestException("定价分组默认计价单位必须是当前品类已启用的计价单位");
    }
    if (!input.memberItemGroupIds?.length) throw new BadRequestException("定价分组至少选择一个产品型号");
    if (new Set(input.memberItemGroupIds).size !== input.memberItemGroupIds.length) throw new BadRequestException("定价分组不能重复选择同一产品型号");
    const members = input.memberItemGroupIds.map((memberId) => this.group(state, memberId));
    if (members.some((member) => member.status !== "enabled")) throw new BadRequestException("定价分组只能包含启用的产品型号");
    const modes = new Set(members.map((member) => member.inventoryMode));
    if (modes.size !== 1) throw new BadRequestException("同一定价分组的产品型号必须使用相同库存方式");
    const existing = input.id ? state.pricingGroups.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("定价分组不存在");
    if (state.pricingGroups.some((row) => row.code === input.code.trim() && row.id !== input.id)) {
      throw new ConflictException("定价分组编码已存在");
    }
    const timestamp = now();
    const result: RentalPricingGroup = {
      id: existing?.id ?? id("pricing_group"),
      tenantId,
      categoryCode: state.profile.categoryCode,
      code: input.code.trim(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      defaultPricingUnit: input.defaultPricingUnit,
      memberItemGroupIds: members.map((member) => member.id),
      members: members.map(({ id, code, name, inventoryMode, unit, status }) => ({ id, code, name, inventoryMode, unit, status })),
      status: input.status ?? existing?.status ?? "enabled",
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    await this.configStore.upsertPricingGroup?.(result, tx, writeContext.binding);
    if (!deferCache) this.commitPricingGroup(result);
    return result;
  }

  /** 外层事务提交后再更新写穿缓存，避免价格版本失败时缓存先看到半成品分组。 */
  commitPricingGroup(result: RentalPricingGroup) {
    const state = this.state(result.tenantId);
    const existing = state.pricingGroups.find((row) => row.id === result.id);
    if (existing) state.pricingGroups.splice(state.pricingGroups.indexOf(existing), 1, result);
    else state.pricingGroups.unshift(result);
  }

  async saveItemGroup(tenantId: string, input: SaveRentalItemGroupRequest) {
    const state = this.state(tenantId);
    const writeContext = await this.categoryWriteContext(tenantId, state.profile.categoryCode);
    const definition = writeContext.definition;
    const existing = input.id ? state.itemGroups.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("标的分组不存在");
    const persistedAttributes = { ...(existing?.attributes ?? {}) };
    delete persistedAttributes[ITEM_GROUP_MEDIA_KEY];
    const reconciledAttributes = reconcileRentalCategoryAttributes(definition.businessModel.assetFields, "item_group", input.attributes ?? {}, persistedAttributes);
    if (!definition.supportedInventoryModes.includes(input.inventoryMode)) throw new BadRequestException("当前经营品类不支持该库存模式");
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("标的编码和名称不能为空");
    const duplicate = state.itemGroups.find((row) => row.code === input.code && row.id !== input.id);
    if (duplicate) throw new ConflictException("标的编码已存在");
    const components = this.resolveComponents(state, input.bundleComponents ?? [], input.id);
    if (input.inventoryMode === RentalInventoryMode.Bundle && components.length === 0) throw new BadRequestException("套装至少需要一个组成项");
    if (input.inventoryMode !== RentalInventoryMode.Bundle && components.length > 0) throw new BadRequestException("仅套装模式可以配置组成项");
    if (input.inventoryMode === RentalInventoryMode.Bundle) this.validateBundleComponentRules(components);
    if (input.inventoryMode !== RentalInventoryMode.Bundle) {
      this.validateAttributes(definition.businessModel.assetFields, "item_group", reconciledAttributes.active);
      if (state.profile.categoryCode === RentalCategoryCode.Camping) {
        const capacity = reconciledAttributes.active.capacity;
        if (capacity !== undefined && capacity !== null && capacity !== "" && (!Number.isFinite(Number(capacity)) || Number(capacity) <= 0)) throw new BadRequestException("露营装备容量必须大于0升");
      }
      if (state.profile.categoryCode === RentalCategoryCode.Construction) {
        const ratedLoad = reconciledAttributes.active.ratedLoad;
        const ratedLoadUnit = reconciledAttributes.active.ratedLoadUnit;
        if ((ratedLoad === undefined || ratedLoad === null || ratedLoad === "") !== (ratedLoadUnit === undefined || ratedLoadUnit === null || ratedLoadUnit === "")) {
          throw new BadRequestException("填写额定载荷时必须同时选择 kg 或 t 单位");
        }
        if (ratedLoad !== undefined && ratedLoad !== null && Number(ratedLoad) <= 0) throw new BadRequestException("额定载荷必须大于0");
      }
      this.assertUniqueAttributes(
        definition.businessModel.assetFields,
        "item_group",
        input.attributes ?? {},
        state.itemGroups,
        input.id
      );
    } else {
      // 套装不强制继承单品的厂商/型号必填规则，但传入的字段仍必须属于当前品类且类型正确。
      this.validateAttributes(definition.businessModel.assetFields, "item_group", reconciledAttributes.active, {}, false);
    }
    const timestamp = now();
    const media = existing?.attributes[ITEM_GROUP_MEDIA_KEY];
    const result: RentalItemGroup = {
      id: existing?.id ?? id("group"), tenantId, categoryCode: state.profile.categoryCode,
      code: input.code.trim(), name: input.name.trim(), inventoryMode: input.inventoryMode,
      unit: input.unit?.trim() || "件", description: input.description?.trim(),
      attributes: { ...reconciledAttributes.stored, ...(media ? { [ITEM_GROUP_MEDIA_KEY]: media } : {}) },
      images: existing?.images ?? [],
      bundleComponents: components, status: input.status ?? existing?.status ?? "enabled",
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    // 商品建档 Hook：落库前判定完整的待写记录。能力可以据此阻止（例如摄影兼容性
    // 规则认为该套装组合不可用）或给出提示，但不得改写记录本身——`result` 传进去的是
    // 冻结快照，能力只能通过返回值表达意见。
    await this.runHook(tenantId, "item_onboarding", { type: "item_group", id: result.id }, { ...result, attributes: reconciledAttributes.active });
    await this.configStore.upsertItemGroup(
      result, undefined,
      this.uniqueAttributeClaims(definition.businessModel.assetFields, "item_group", result.attributes), writeContext.binding
    );

    if (existing) state.itemGroups.splice(state.itemGroups.indexOf(existing), 1, result); else state.itemGroups.unshift(result);
    // 定价分组只保存型号引用，成员摘要由当前型号事实派生。型号更名或停用后同步
    // 当前进程缓存，避免必须重启 API 才能在分组页看到最新资料；成员关系和分组版本不变。
    state.pricingGroups = state.pricingGroups.map((pricingGroup) => pricingGroup.memberItemGroupIds.includes(result.id)
      ? {
          ...pricingGroup,
          members: pricingGroup.members.map((member) => member.id === result.id
            ? { id: result.id, code: result.code, name: result.name, inventoryMode: result.inventoryMode, unit: result.unit, status: result.status }
            : member)
        }
      : pricingGroup);
    return this.publicItemGroup(result);
  }

  async addItemGroupImage(tenantId: string, itemGroupId: string, file: UploadedItemGroupImage) {
    const state = this.state(tenantId);
    const group = this.group(state, itemGroupId);
    const mimeExtensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    };
    const extension = mimeExtensions[file.mimetype];
    if (!extension) throw new BadRequestException("只支持 JPG、PNG 或 WebP 图片");
    if (!file.buffer?.length || file.size <= 0) throw new BadRequestException("图片文件为空");
    if (file.size > ITEM_GROUP_IMAGE_MAX_BYTES || file.buffer.length > ITEM_GROUP_IMAGE_MAX_BYTES) throw new BadRequestException("单张图片不能超过 5MB");
    if (!this.matchesImageSignature(file.mimetype, file.buffer)) throw new BadRequestException("图片内容与文件格式不一致");
    const current = this.storedItemGroupImages(group);
    if (current.length >= ITEM_GROUP_IMAGE_LIMIT) throw new BadRequestException(`每个产品型号最多上传 ${ITEM_GROUP_IMAGE_LIMIT} 张图片`);

    const imageId = `img_${randomUUID().replace(/-/g, "")}`;
    const nextImage: StoredItemGroupImage = {
      id: imageId,
      fileName: file.originalname.slice(0, 180),
      mimeType: file.mimetype,
      sizeBytes: file.buffer.length,
      isCover: current.length === 0
    };
    const workspaceId = getRequestWorkspaceId() ?? undefined;
    const useConfiguredProvider = this.fileStorage ? await this.fileStorage.hasEnabledProvider(tenantId) : false;
    let absolutePath: string | undefined;
    if (useConfiguredProvider) {
      const owner: FileBusinessOwner = { businessType: "item_group", businessId: group.id, uploadScene: "item-group-image", workspaceId };
      const asset = await this.fileStorage!.uploadBuffer(tenantId, {
        businessModule: "rental-core",
        businessType: "item_group",
        businessId: group.id,
        fileName: nextImage.fileName,
        mimeType: nextImage.mimeType,
        sizeBytes: nextImage.sizeBytes,
        uploadScene: "item-group-image",
        idempotencyKey: `item-group-image:${group.id}:${imageId}`,
        metadata: { imageId, workspaceId }
      }, file.buffer, owner);
      nextImage.fileAssetId = asset.id;
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("生产环境必须先配置文件存储平台，不能使用本地图片存储");
      }
      absolutePath = this.itemGroupImagePath(group, nextImage);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.buffer);
    }
    const next: StoredItemGroupImage[] = [...current, nextImage];
    try {
      await this.persistItemGroupImages(group, next);
    } catch (error) {
      if (absolutePath) await rm(absolutePath, { force: true });
      if (nextImage.fileAssetId && this.fileStorage) {
        await this.fileStorage.deleteFileAsset(tenantId, nextImage.fileAssetId, {
          businessType: "item_group",
          businessId: group.id,
          uploadScene: "item-group-image",
          workspaceId
        }).catch(() => undefined);
      }
      throw error;
    }
    return this.publicItemGroup(group);
  }

  async removeItemGroupImage(tenantId: string, itemGroupId: string, imageId: string) {
    const group = this.group(this.state(tenantId), itemGroupId);
    const current = this.storedItemGroupImages(group);
    const target = current.find((image) => image.id === imageId);
    if (!target) throw new NotFoundException("产品型号图片不存在");
    if (process.env.NODE_ENV === "production" && (!this.fileStorage || !target.fileAssetId)) {
      throw new ServiceUnavailableException("生产环境不能操作本地图片，请先迁移到真实文件存储");
    }
    const remaining = current.filter((image) => image.id !== imageId).map((image, index) => ({ ...image, isCover: index === 0 }));
    await this.persistItemGroupImages(group, remaining);
    if (target.fileAssetId && this.fileStorage) {
      await this.fileStorage.deleteFileAsset(tenantId, target.fileAssetId, {
        businessType: "item_group",
        businessId: group.id,
        uploadScene: "item-group-image",
        workspaceId: getRequestWorkspaceId() ?? undefined
      });
    } else {
      await rm(this.itemGroupImagePath(group, target), { force: true });
    }
    return this.publicItemGroup(group);
  }

  async readItemGroupImage(tenantId: string, itemGroupId: string, imageId: string) {
    const group = this.group(this.state(tenantId), itemGroupId);
    const image = this.storedItemGroupImages(group).find((item) => item.id === imageId);
    if (!image) throw new NotFoundException("产品型号图片不存在");
    if (process.env.NODE_ENV === "production" && (!this.fileStorage || !image.fileAssetId)) {
      throw new ServiceUnavailableException("生产环境不能读取本地图片，请先迁移到真实文件存储");
    }
    if (image.fileAssetId && this.fileStorage) {
      const download = await this.fileStorage.downloadUrl(tenantId, image.fileAssetId, {
        businessType: "item_group",
        businessId: group.id,
        uploadScene: "item-group-image",
        workspaceId: getRequestWorkspaceId() ?? undefined
      });
      return { redirectUrl: download.downloadUrl, mimeType: image.mimeType, fileName: image.fileName };
    }
    try {
      return { content: await readFile(this.itemGroupImagePath(group, image)), mimeType: image.mimeType, fileName: image.fileName };
    } catch {
      throw new NotFoundException("产品型号图片文件不存在，请重新上传");
    }
  }

  async listAssets(tenantId: string) {
    await this.factContext(tenantId);
    return this.factStore.listAssets(tenantId);
  }

  async listAssetStatusHistory(tenantId: string, assetId: string) {
    await this.factContext(tenantId);
    return this.factStore.listAssetStatusHistory(tenantId, assetId);
  }

  async saveAsset(tenantId: string, input: SaveRentalAssetRequest) {
    const state = await this.factContext(tenantId);
    const group = this.group(state, input.itemGroupId);
    if (group.inventoryMode !== RentalInventoryMode.Serialized) throw new BadRequestException("只有序列化库存可以登记独立资产");
    const location = this.activeLocation(state, input.locationId, "storage");
    if (!input.assetNo?.trim()) throw new BadRequestException("资产编号不能为空");
    const writeContext = await this.categoryWriteContext(tenantId, state.profile.categoryCode);
    const definition = writeContext.definition;
    const assetNo = input.assetNo.trim();
    const assets = await this.factStore.listAssets(tenantId);
    const existing = input.id ? assets.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("资产不存在");
    const assetAttributes = { ...(input.attributes ?? {}) };
    const supportsSerialNo = definition.businessModel.assetFields.some((field) => field.scope === "asset" && field.code === "serialNo");
    if (!supportsSerialNo && input.serialNo?.trim() && input.serialNo.trim() !== existing?.serialNo) throw new BadRequestException("存在未定义的品类字段：serialNo");
    const serialNo = supportsSerialNo ? input.serialNo ?? assetAttributes.serialNo : existing?.serialNo;
    if (supportsSerialNo) delete assetAttributes.serialNo;
    const reconciledAttributes = reconcileRentalCategoryAttributes(definition.businessModel.assetFields, "asset", assetAttributes, existing?.attributes);
    const attributeAliases = supportsSerialNo ? { serialNo } : {};
    this.validateAttributes(definition.businessModel.assetFields, "asset", reconciledAttributes.active, attributeAliases);
    this.assertUniqueAttributes(
      definition.businessModel.assetFields,
      "asset",
      assetAttributes,
      assets,
      input.id,
      attributeAliases,
      (asset) => ({ serialNo: asset.serialNo })
    );
    if (assets.some((row) => row.assetNo === assetNo && row.id !== input.id)) throw new ConflictException("资产编号已存在");
    const timestamp = now();
    const result: RentalAsset = {
      id: existing?.id ?? id("asset"), tenantId, itemGroupId: group.id, itemGroupCode: group.code,
      itemGroupName: group.name, assetNo, serialNo: typeof serialNo === "string" ? serialNo.trim() : undefined,
      locationId: location.id, locationName: location.name, status: input.status ?? existing?.status ?? RentalAssetStatus.Available,
      attributes: reconciledAttributes.stored, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    await this.runHook(tenantId, "item_onboarding", { type: "asset", id: result.id }, { ...result, attributes: reconciledAttributes.active, serialNo: supportsSerialNo ? result.serialNo : undefined });
    await this.factStore.upsertAsset(
      result,
      this.uniqueAttributeClaims(definition.businessModel.assetFields, "asset", assetAttributes, attributeAliases),
      { reason: input.id ? "资产资料维护" : "资产登记", operator: input.operator }, writeContext.binding
    );
    return result;
  }

  async restoreStockDisposition(tenantId: string, dispositionId: string, operator: string) {
    this.state(tenantId);
    return this.factStore.restoreStockDisposition(tenantId, dispositionId, operator);
  }

  async writeOffStockDisposition(tenantId: string, dispositionId: string, reason: string, operator: string) {
    this.state(tenantId);
    return this.factStore.writeOffStockDisposition(tenantId, dispositionId, reason, operator);
  }

  async listStockDispositions(tenantId: string, orderId?: string) {
    this.state(tenantId);
    if (orderId) await this.requireOrder(tenantId, orderId);
    return this.factStore.listStockDispositions(tenantId, orderId);
  }

  async listWorkOrders(tenantId: string, status?: RentalWorkOrderStatus) {
    this.state(tenantId);
    if (status && !["pending", "in_progress", "pending_review", "completed", "rejected", "cancelled"].includes(status)) {
      throw new BadRequestException("养护工单状态无效");
    }
    return this.factStore.listWorkOrders(tenantId, status);
  }

  async listWorkOrderAssignees(tenantId: string, locationId?: string): Promise<RentalWorkOrderAssignee[]> {
    this.state(tenantId);
    return this.factStore.listWorkOrderAssignees(tenantId, locationId);
  }

  async listWorkOrderHistory(tenantId: string, workOrderId: string): Promise<RentalWorkOrderHistoryEntry[]> {
    this.state(tenantId);
    const row = (await this.factStore.listWorkOrders(tenantId)).find((item) => item.id === workOrderId);
    if (!row) throw new NotFoundException("养护工单不存在或不属于当前经营空间");
    return this.factStore.listWorkOrderHistory(tenantId, workOrderId);
  }

  private async resolveWorkOrderAssignee(tenantId: string, assigneeId: string | undefined, locationId: string) {
    if (!assigneeId) return undefined;
    const assignee = (await this.factStore.listWorkOrderAssignees(tenantId, locationId)).find((item) => item.id === assigneeId);
    if (!assignee) throw new BadRequestException("处理人不存在、未加入当前经营空间、已停用或无权访问该履约地点");
    return assignee;
  }

  async createWorkOrder(tenantId: string, input: CreateRentalWorkOrderRequest, operator: string) {
    this.state(tenantId);
    const dispositions = await this.factStore.listStockDispositions(tenantId);
    const disposition = dispositions.find((row) => row.id === input.dispositionId);
    if (!disposition) throw new NotFoundException("库存处置不存在或不属于当前经营空间");
    if (disposition.status === "restored" || disposition.status === "written_off") throw new ConflictException("已结束的库存处置不能再建养护工单");
    const reason = input.reason?.trim() || disposition.blockReason || "归还后需要养护处理";
    const assignee = await this.resolveWorkOrderAssignee(tenantId, input.assigneeId, disposition.locationId);
    const timestamp = now();
    const workOrder: RentalWorkOrder = {
      id: id("work"),
      tenantId,
      workspaceId: this.resolveWorkspaceId(tenantId),
      workNo: `WO${timestamp.replace(/\D/g, "").slice(0, 14)}${randomUUID().slice(0, 4).toUpperCase()}`,
      type: input.type,
      status: "pending",
      dispositionId: disposition.id,
      orderId: disposition.orderId,
      inspectionId: disposition.inspectionId,
      itemGroupId: disposition.itemGroupId,
      locationId: disposition.locationId,
      assetId: disposition.assetId,
      quantity: disposition.quantity,
      assigneeId: assignee?.id,
      assigneeName: assignee?.displayName,
      reason,
      attachments: [],
      createdBy: operator,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return this.factStore.upsertWorkOrder(workOrder);
  }

  async assignWorkOrder(tenantId: string, workOrderId: string, input: AssignRentalWorkOrderRequest) {
    this.state(tenantId);
    const current = await this.factStore.listWorkOrders(tenantId);
    const row = current.find((item) => item.id === workOrderId);
    if (!row) throw new NotFoundException("养护工单不存在或不属于当前经营空间");
    if (!["pending", "in_progress"].includes(row.status)) throw new ConflictException("当前工单状态不能派工");
    const assignee = await this.resolveWorkOrderAssignee(tenantId, input.assigneeId, row.locationId);
    return this.factStore.assignWorkOrder(tenantId, workOrderId, assignee?.id, assignee?.displayName);
  }

  async startWorkOrder(tenantId: string, workOrderId: string, operator: string) {
    this.state(tenantId);
    return this.factStore.transitionWorkOrder(tenantId, workOrderId, "start", operator);
  }

  async submitWorkOrder(tenantId: string, workOrderId: string, input: SubmitRentalWorkOrderRequest, operator: string) {
    this.state(tenantId);
    return this.factStore.transitionWorkOrder(tenantId, workOrderId, "submit", operator, input);
  }

  async reviewWorkOrder(tenantId: string, workOrderId: string, input: ReviewRentalWorkOrderRequest, operator: string) {
    this.state(tenantId);
    return this.factStore.transitionWorkOrder(tenantId, workOrderId, "review", operator, input);
  }

  async cancelWorkOrder(tenantId: string, workOrderId: string, input: CancelRentalWorkOrderRequest, operator: string) {
    this.state(tenantId);
    return this.factStore.transitionWorkOrder(tenantId, workOrderId, "cancel", operator, input);
  }

  async listStockBalances(tenantId: string) {
    await this.factContext(tenantId);
    const [stocks, reservations] = await Promise.all([
      this.factStore.listStockBalances(tenantId),
      this.factStore.activeReservations(tenantId)
    ]);
    return stocks.map((row) => {
      const reservedQuantity = this.reservedQuantity(reservations, row.itemGroupId, row.locationId);
      return { ...row, reservedQuantity, availableQuantity: Math.max(0, row.onHandQuantity - row.maintenanceQuantity - reservedQuantity) };
    });
  }

  async listStockLedger(tenantId: string, filters: { itemGroupId?: string; locationId?: string; batchNo?: string; sourceDocumentNo?: string; limit?: number } = {}) {
    await this.factContext(tenantId);
    return this.factStore.listStockLedger(tenantId, filters);
  }

  async applyStockOperation(tenantId: string, input: RentalStockOperationRequest, operator: string): Promise<RentalStockOperationResult> {
    const state = await this.factContext(tenantId);
    const group = this.group(state, input.itemGroupId);
    if (![RentalInventoryMode.Quantity, RentalInventoryMode.Consumable].includes(group.inventoryMode)) throw new BadRequestException("库存日常作业目前只适用于数量型或一次性耗材库存");
    if (input.type === "consume" && group.inventoryMode !== RentalInventoryMode.Consumable) {
      throw new BadRequestException("消耗作业只适用于一次性耗材库存");
    }
    if (!input.reason?.trim()) throw new BadRequestException("库存作业必须填写原因或来源说明");
    if (input.batchNo !== undefined && (!input.batchNo.trim() || input.batchNo.trim().length > 100)) throw new BadRequestException("批次号不能为空且不能超过100个字符");
    if (input.sourceDocumentNo !== undefined && (!input.sourceDocumentNo.trim() || input.sourceDocumentNo.trim().length > 100)) throw new BadRequestException("来源单据号不能为空且不能超过100个字符");

    if (input.type === "transfer") {
      if (!input.fromLocationId || !input.toLocationId || input.fromLocationId === input.toLocationId) throw new BadRequestException("调拨必须选择两个不同的履约地点");
      this.activeLocation(state, input.fromLocationId, "storage");
      this.activeLocation(state, input.toLocationId, "storage");
    } else {
      if (!input.locationId) throw new BadRequestException("库存作业必须选择履约地点");
      this.activeLocation(state, input.locationId, "storage");
    }

    const result = await this.factStore.applyStockOperation({
      ...input,
      batchNo: input.batchNo?.trim() || undefined,
      sourceDocumentNo: input.sourceDocumentNo?.trim() || undefined,
      tenantId,
      operator: operator || input.operator || "系统"
    });
    const locationIds = new Set(result.entries.map((entry) => entry.locationId));
    const balances = (await this.listStockBalances(tenantId)).filter((row) => row.itemGroupId === input.itemGroupId && locationIds.has(row.locationId));
    return { ...result, balances };
  }

  async saveStockBalance(tenantId: string, input: SaveRentalStockBalanceRequest) {
    const state = await this.factContext(tenantId);
    const group = this.group(state, input.itemGroupId);
    if (![RentalInventoryMode.Quantity, RentalInventoryMode.Consumable].includes(group.inventoryMode)) throw new BadRequestException("只有数量型或一次性耗材库存可以维护库存余额");
    const location = this.activeLocation(state, input.locationId, "storage");
    if (!Number.isInteger(input.onHandQuantity) || input.onHandQuantity < 0) throw new BadRequestException("在手数量必须是非负整数");
    if (input.maintenanceQuantity !== undefined && (!Number.isInteger(input.maintenanceQuantity) || input.maintenanceQuantity < 0)) {
      throw new BadRequestException("维护数量无效");
    }
    const existing = (await this.listStockBalances(tenantId)).find((row) => row.itemGroupId === group.id && row.locationId === location.id);
    if (existing && (input.onHandQuantity !== existing.onHandQuantity || (input.maintenanceQuantity !== undefined && input.maintenanceQuantity !== existing.maintenanceQuantity))) {
      throw new ConflictException("已有库存不能直接覆盖余额，请使用入库、盘点、调拨、报损或退出作业并填写来源");
    }
    // 不在这里 `?? 0`：维修量这一列还记着异常归还的隔离量，省略即清零会让一次
    // 只报在手数量的例行盘点顺手把隔离中的坏货放回可用池。合并与上界校验都在
    // `applyStockCount` 的行锁内完成——读-改-写必须原子，否则并发隔离会被覆盖。
    const saved = await this.factStore.applyStockCount({
      id: id("stock"),
      tenantId,
      itemGroupId: group.id,
      locationId: location.id,
      onHandQuantity: input.onHandQuantity,
      maintenanceQuantity: input.maintenanceQuantity
    });
    return (await this.listStockBalances(tenantId)).find((row) => row.id === saved.id)!;
  }

  /** R0 availability reads persisted configuration and bounded minimal stock
   * facts only. It never initializes a tenant or writes sample inventory. The
   * original arithmetic is shared; final order admission still locks/rechecks. */
  async readAvailability(tenantId: string, value: RentalAvailabilityRequest): Promise<RentalAvailabilityResult> {
    return this.readAvailabilityFrom(tenantId, value);
  }

  /** ORIGINAL owner-Native read, not inventory reservation or commit evidence.
   * Shares the legacy bounded read/arithmetic and keeps original admission locks.
   * Every actual SQL/delegate dispatch is fenced; no global/state fallback. */
  async readAvailabilityInTransaction(tenantId: string, value: RentalAvailabilityRequest, native: RentalFactTx,
    signal: AbortSignal, assertCurrent?: () => void): Promise<RentalAvailabilityResult> {
    const identity = getRequestIdentity();
    if (!identity?.workspaceId || identity.tenantId !== tenantId || !identity.userId || identity.isSaasAdmin
      || identity.audience !== 'operator' || !native || '$transaction' in native || typeof native.$queryRaw !== 'function'
      || typeof native.businessWorkspace?.findFirst !== 'function' || typeof native.rentalItemGroup?.findMany !== 'function'
      || typeof native.rentalReservation?.findMany !== 'function' || typeof native.rentalAsset?.findMany !== 'function'
      || typeof native.rentalStockBalance?.findMany !== 'function'
      || identity.dataScope === 'own' && typeof native.rentalWorkOrder?.findMany !== 'function') throw new ServiceUnavailableException('库存事务读取范围不可用');
    const binding = requestFingerprint(structuredClone(identity)); let active = true;
    const live = () => {
      if (!active || signal.aborted || requestFingerprint(getRequestIdentity() ?? null) !== binding) throw new ForbiddenException('库存事务读取已停止或范围变化');
      assertCurrent?.();
    };
    const delegates = new Set(['businessWorkspace','rentalItemGroup','rentalReservation','rentalAsset','rentalStockBalance','rentalWorkOrder']);
    const fenced = new Map<PropertyKey, unknown>();
    const transaction = new Proxy(native, { get(target, property, receiver) {
      if (fenced.has(property)) return fenced.get(property);
      const value = Reflect.get(target, property, receiver);
      if (property === '$queryRaw' && typeof value === 'function') {
        const method = new Proxy(value, { apply(fn, _owner, args) { live(); return Reflect.apply(fn, target, args); } }); fenced.set(property, method); return method;
      }
      if (typeof property === 'string' && delegates.has(property) && value && typeof value === 'object') {
        const delegate = new Proxy(value, { get(object, key, owner) {
          const method = Reflect.get(object, key, owner);
          return (key === 'findFirst' || key === 'findMany') && typeof method === 'function'
            ? new Proxy(method, { apply(fn, _owner, args) { live(); return Reflect.apply(fn, object, args); } }) : method;
        } }); fenced.set(property, delegate); return delegate;
      }
      return value;
    } });
    try { live(); const result = await this.readAvailabilityFrom(tenantId, value, transaction, live); live(); return result; }
    finally { active = false; fenced.clear(); }
  }

  private async readAvailabilityFrom(tenantId: string, value: RentalAvailabilityRequest, tx?: RentalFactTx, assertCurrent?: () => void): Promise<RentalAvailabilityResult> {
    const input = structuredClone(value), identity = getRequestIdentity();
    if (!identity?.workspaceId || !identity.userId || identity.tenantId !== tenantId || identity.isSaasAdmin)
      throw new ForbiddenException('库存只读查询缺少当前租户及经营空间');
    const workspaceId = identity.workspaceId, binding = requestFingerprint(identity);
    const current = () => {
      if (requestFingerprint(getRequestIdentity()) !== binding) throw new ForbiddenException('库存读取身份或范围变化');

      assertCurrent?.();
    };
    const resourceId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 4
      || !resourceId(input.locationId) || typeof input.startAt !== 'string' || typeof input.endAt !== 'string'
      || !Array.isArray(input.lines) || !input.lines.length || input.lines.length > 100
      || Array.from(input.lines).some(line => !line || typeof line !== 'object' || Array.isArray(line)
        || Object.keys(line).length !== 2 || !resourceId(line.itemGroupId)
        || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000))
      throw new BadRequestException('库存只读查询明细无效或超出上限');
    this.validatePeriod(input.startAt, input.endAt);
    if (!this.configStore.listItemGroupsPage || !this.factStore.readAvailabilitySnapshot)
      throw new ServiceUnavailableException('库存持久只读端口不可用');
    const locationIds = getRequestStaffLocationIds();
    if (locationIds !== undefined && !locationIds.includes(input.locationId)) throw new ForbiddenException('库存地点不可访问');
    current(); await this.fulfillmentAdmission(tenantId, [{ locationId: input.locationId }], tx); current();
    const pending = [...new Set(input.lines.map(line => line.itemGroupId))], groups = new Map<string, RentalItemGroupPage['rows'][number]>();
    // Resolve only requested groups and their required bundle dependencies. A
    // missing/oversized persisted configuration is not a seeded substitute.
    for (let index = 0; index < pending.length; index++) {
      if (pending.length > 100) throw new ServiceUnavailableException('套装库存依赖超出只读上限');
      const groupId = pending[index], query = parseRentalItemGroupPageQuery({ itemGroupId: groupId, limit: 1 });
      current();
      const page = structuredClone(await this.configStore.listItemGroupsPage(tenantId, workspaceId, query, tx)); current();
      if (page.source !== 'persisted_workspace_configuration' || page.truncated || page.rows.length !== 1
        || page.rows[0].id !== groupId || page.rows[0].tenantId !== tenantId) throw new NotFoundException('商品库存配置缺失或来源无效');
      const group = page.rows[0]; groups.set(groupId, group);
      if (group.inventoryMode === RentalInventoryMode.Bundle) for (const component of group.bundleComponents.filter(row => !row.optional)) {
        if (!Number.isSafeInteger(component.quantity) || component.quantity <= 0) throw new ConflictException('套装库存组成无效');
        if (!pending.includes(component.itemGroupId)) pending.push(component.itemGroupId);
      }
    }
    current();
    const snapshot = await this.factStore.readAvailabilitySnapshot(tenantId, workspaceId, { locationId: input.locationId, itemGroupIds: pending }, tx);
    current();
    return this.computeAvailability({ itemGroups: [...groups.values()] }, snapshot, input);
  }

  async availability(tenantId: string, input: RentalAvailabilityRequest): Promise<RentalAvailabilityResult> {
    const state = await this.factContext(tenantId);
    this.validatePeriod(input.startAt, input.endAt);
    await this.fulfillmentAdmission(tenantId, [{ locationId: input.locationId }]);
    if (!input.lines?.length) throw new BadRequestException("至少需要一个租赁明细");
    return this.computeAvailability(state, await this.loadInventorySnapshot(tenantId), input);
  }

  /**
   * RC-03：在订单事务内锁定实际依赖的基础库存并重新计算可用量。
   * 事务外的 availability 只负责快速反馈，最终是否可下单以这里的锁后重算为准。
   */
  async assertAvailabilityWithLocks(tenantId: string, input: RentalAvailabilityRequest, tx: RentalFactTx, rule?: RentalRuleConfig, quote?: RentalQuoteSnapshotV1) {
    const workspaceId = this.resolveWorkspaceId(tenantId);
    const state = quote ? { itemGroups: inventoryBasisGroups(quote.inventoryBasis, tenantId, workspaceId, input.lines) } : this.state(tenantId);
    this.validatePeriod(input.startAt, input.endAt);
    await this.fulfillmentAdmission(tenantId, [{ locationId: input.locationId }], tx);
    if (!input.lines?.length) throw new BadRequestException("至少需要一个租赁明细");

    const targets = new Map<string, InventoryLockTarget>();
    for (const line of input.lines) {
      const group = this.group(state, line.itemGroupId);
      const dependencies = group.inventoryMode === RentalInventoryMode.Bundle
        ? group.bundleComponents.filter((component) => !component.optional).map((component) => this.group(state, component.itemGroupId))
        : [group];
      for (const dependency of dependencies) {
        targets.set(dependency.id, { itemGroupId: dependency.id, inventoryMode: dependency.inventoryMode });
      }
    }

    // Fulfillment admission above acquired the item-group writer's workspace mutex.
    // Verify CURRENT content before locking frozen targets; never expand a changed kit.
    if (quote) await assertRentalInventoryBasis(this.configStore, tenantId, workspaceId, input.lines, quote.inventoryBasis, tx);
    await this.factStore.lockInventoryTargets(tenantId, input.locationId, [...targets.values()], tx);
    const checked = this.computeAvailability(state, await this.loadInventorySnapshot(tenantId, tx), {
      ...input, ...bufferedRentalPeriod(input.startAt, input.endAt, rule)
    });
    if (!checked.available) throw new ConflictException("库存已被其他订单占用，请重新选择租期或数量");
    return checked;
  }

  /** 续租预检与事务内复检共用：排除本单，按真实预占组成与已分配资产检查含缓冲区间。 */
  async assertOrderExtensionAvailable(tenantId: string, order: RentalOrder, newEndAt: string, tx?: RentalFactTx) {
    const state = this.state(tenantId);
    if (![RentalCoreOrderStatus.ReadyForPickup, RentalCoreOrderStatus.Renting].includes(order.status)) {
      throw new ConflictException("只有待领取或租用中的订单可以续租");
    }
    this.validatePeriod(rentalOrderDueAt(order), newEndAt);
    // Controller pricing can already own this transaction. Acquire the same
    // customer gates before workspace/inventory as the later Core commit does.
    if (tx) {
      await this.assertOrderQualification(tenantId, order, "extension", newEndAt, tx);
      await this.assertExtensionMembershipSecurity(tenantId, order, undefined, tx);
    }
    if (order.reservations.some(row => {
      const group = this.group(state, row.itemGroupId);
      // 一次性耗材在领取时就已完成消费并释放预占，不存在“部分归还后继续占用”
      // 的事实；混合订单仍要对其它可归还商品执行原有边界。
      return group.inventoryMode !== RentalInventoryMode.Consumable && row.releasedQuantity > 0;
    })) throw new ConflictException("已有部分归还，不能按整单自动续租，请人工处理剩余商品");
    const period = bufferedRentalPeriod(order.actualRentalStartAt ?? order.startAt, newEndAt, order.ruleSnapshot);
    const demands = new Map<string, { itemGroupId: string; locationId: string; quantity: number }>();
    for (const reservation of order.reservations) {
      const remaining = reservation.quantity - reservation.releasedQuantity;
      if (remaining <= 0 || reservation.status === RentalReservationStatus.Released) continue;
      const key = `${reservation.locationId}:${reservation.itemGroupId}`;
      const row = demands.get(key) ?? { itemGroupId: reservation.itemGroupId, locationId: reservation.locationId, quantity: 0 };
      row.quantity += remaining;
      demands.set(key, row);
    }
    if (!demands.size) throw new ConflictException("订单没有可延长的有效库存占用");
    const ordered = [...demands.values()].sort((a, b) => `${a.locationId}:${a.itemGroupId}`.localeCompare(`${b.locationId}:${b.itemGroupId}`));
    await this.fulfillmentAdmission(tenantId, [...new Set(ordered.map(row => row.locationId))].map(locationId => ({ locationId })), tx);
    if (tx) {
      for (const demand of ordered) {
        await this.factStore.lockInventoryTargets(tenantId, demand.locationId, [{
          itemGroupId: demand.itemGroupId, inventoryMode: this.group(state, demand.itemGroupId).inventoryMode
        }], tx);
      }
    }
    const snapshot = await this.loadInventorySnapshot(tenantId, tx);
    for (const allocation of order.allocations.filter((row) => ACTIVE_ASSIGNMENTS.includes(row.status) && row.assetId)) {
      const asset = snapshot.assets.find((row) => row.id === allocation.assetId);
      if (asset) this.assertAssetDocumentsCoverPeriod(state, asset, newEndAt);
    }
    snapshot.reservations = snapshot.reservations.filter((row) => row.orderId !== order.id);
    const assigned = new Set(order.allocations.filter((row) => ACTIVE_ASSIGNMENTS.includes(row.status)).map((row) => row.assetId).filter(Boolean));
    if (snapshot.reservations.some((row) => row.quantity > 0 && overlaps(row.startAt, row.endAt, period.startAt, period.endAt) && row.assetIds?.some((assetId) => assigned.has(assetId)))) {
      throw new ConflictException("本单已分配的资产与后续订单（含准备/周转缓冲）时间冲突，不能续租");
    }
    for (const demand of ordered) {
      const available = this.availableQuantity(state, snapshot, this.group(state, demand.itemGroupId), demand.locationId, period.startAt, period.endAt, new Set());
      if (available < demand.quantity) throw new ConflictException("续租与后续租赁（含准备/周转缓冲）库存冲突，请调整归还时间");
    }
  }

  async listOrders(tenantId: string) {
    this.state(tenantId);
    return (await this.factStore.listOrders(tenantId)).map((order) => this.publicOrder(order));
  }

  /**
   * ORDER-LIST-01：按筛选条件分页读取订单。`page`/`pageSize` 都缺省时不分页，
   * 只按条件筛，供兼容旧的纯数组响应；分页大小夹在 1..MAX 之间。
   */
  async queryOrders(tenantId: string, query: RentalOrderListQuery): Promise<RentalOrderPage> {
    this.state(tenantId);
    const paged = query.page !== undefined || query.pageSize !== undefined;
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(RENTAL_ORDER_LIST_MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize ?? RENTAL_ORDER_LIST_DEFAULT_PAGE_SIZE)));
    const result = await this.factStore.queryOrders(tenantId, {
      ...query,
      ...(paged ? { skip: (page - 1) * pageSize, take: pageSize } : {})
    });
    return {
      items: result.items.map((order) => this.publicOrder(order)),
      page: paged ? page : 1,
      pageSize: paged ? pageSize : Math.max(result.total, 1),
      total: result.total,
      summary: result.summary
    };
  }

  /**
   * RULE-CLOSE-01：返回当前经营空间中待支付软预占已到期的订单候选。
   *
   * 候选查询只负责缩小范围；真正的到期判定必须在订单行锁内再次完成，
   * 因为候选查询与实际取消之间可能已经发生确认、人工取消或续租等状态变化。
   */
  async listExpiredPendingOrderIds(tenantId: string, expiredBefore = now(), take = 50) {
    this.state(tenantId);
    return this.factStore.listExpiredDraftOrderIds(tenantId, expiredBefore, take);
  }

  /**
   * RULE-CLOSE-01：幂等终结一张待支付超时订单。
   *
   * 待确认订单的软预占到期后才允许走这条路径；已确认订单即使尚未登记租金收款，
   * 也不能被误当成待支付超时单。优惠券、服务容量和其它释放动作由控制器在同一
   * 事务中紧接着调用，确保订单终态不会先于这些占用事实提交。
   */
  async expirePendingOrder(
    tenantId: string,
    orderId: string,
    tx?: RentalFactTx,
    operator = "system",
    expiredBefore = now()
  ) {
    this.state(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Draft) {
      throw new ConflictException("只有待确认订单才能按待支付超时处理");
    }
    const cutoff = Date.parse(expiredBefore);
    if (!Number.isFinite(cutoff)) throw new ConflictException("订单的待支付占用尚未全部到期");
    if (!order.reservations.length) {
      // 无库存预占的草稿单（例如纯增值服务单）没有软预占可判到期，只能按
      // createdAt + 待支付保留时长（`effectiveUnpaidHoldRule` 缺省 = 现行行为）判定。
      const holdMs = effectiveUnpaidHoldRule(order.ruleSnapshot).unpaidHoldMinutes * 60_000;
      const createdMs = Date.parse(order.createdAt);
      if (!Number.isFinite(createdMs) || createdMs + holdMs > cutoff) {
        throw new ConflictException("订单的待支付占用尚未全部到期");
      }
    } else {
      const softReservations = order.reservations.filter((row) => row.status === RentalReservationStatus.Soft);
      if (!softReservations.length || softReservations.some((row) => {
        const expiresAt = row.expiresAt ? Date.parse(row.expiresAt) : Number.NaN;
        return !Number.isFinite(expiresAt) || expiresAt >= cutoff;
      })) {
        throw new ConflictException("订单的待支付占用尚未全部到期");
      }
    }
    if (!tx || !this.funding) throw new ConflictException("原资金与支付状态核对未就绪，不能自动按未支付取消");
    const workspaceId = this.resolveWorkspaceId(tenantId);
    const balance = await this.funding.listEvents(tenantId, workspaceId, orderId, tx, { realOnly: true });
    // current read 不沿用事务在等待订单锁之前建立的旧快照；不能漏掉刚提交的真实派发/登记。
    const pendingPayment = (await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM rental_payment_intents WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND orderId = ${orderId} AND status IN ('pending', 'verified_pending_funding', 'funding_failed', 'paid') LIMIT 1 LOCK IN SHARE MODE
    `))[0];
    const offline = (await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM rental_offline_payment_registrations WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}
        AND orderId = ${orderId} AND status IN ('pending', 'confirmed') LIMIT 1 LOCK IN SHARE MODE
    `))[0];
    if (pendingPayment || offline || balance.rental.collected > 0 || balance.deposit.collected > 0
      || balance.preauthorization.frozen > 0) {
      throw new ConflictException("订单已有收款或待核对资金，不能按未支付超时取消");
    }
    return this.cancelOrder(tenantId, orderId, RENTAL_PENDING_PAYMENT_TIMEOUT_REASON, 0, tx, operator);
  }

  /** RULE-CLOSE-01：列出已超过领取宽限、仍未领取的订单。 */
  async listPickupOverdueOrderIds(tenantId: string, at = now(), take = 50) {
    this.state(tenantId);
    const cutoff = Date.parse(at);
    if (!Number.isFinite(cutoff)) throw new BadRequestException("检查时间无效");
    const rows = await this.factStore.listOrders(tenantId);
    return rows
      .filter((order) => [RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(order.status)
        || (order.status === RentalCoreOrderStatus.PickupOverdue && !order.noShowNoticeAt))
      .filter((order) => order.ruleSnapshot.cancellation.noShow?.enabled === true)
      .filter((order) => {
        const grace = order.ruleSnapshot.cancellation.noShow?.pickupGraceMinutes ?? 0;
        return Date.parse(order.startAt) + grace * 60_000 <= cutoff;
      })
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
      .slice(0, Math.min(Math.max(1, take), 200))
      .map((order) => order.id);
  }

  /** 已通知且达到最终确认时限的待确认爽约候选。 */
  async listNoShowCandidateIds(tenantId: string, at = now(), take = 50) {
    this.state(tenantId);
    const cutoff = Date.parse(at);
    if (!Number.isFinite(cutoff)) throw new BadRequestException("检查时间无效");
    const rows = await this.factStore.listOrders(tenantId);
    return rows
      .filter((order) => order.status === RentalCoreOrderStatus.PickupOverdue && order.pickupOverdueAt && order.noShowNoticeAt)
      .filter((order) => order.ruleSnapshot.cancellation.noShow?.enabled === true)
      .filter((order) => Math.max(Date.parse(order.pickupOverdueAt!), Date.parse(order.noShowNoticeAt!)) + effectiveNoShowRule(order.ruleSnapshot).finalizationMinutes * 60_000 <= cutoff)
      .sort((a, b) => Date.parse(a.pickupOverdueAt!) - Date.parse(b.pickupOverdueAt!))
      .slice(0, Math.min(Math.max(1, take), 200))
      .map((order) => order.id);
  }

  async markPickupOverdueOrder(tenantId: string, orderId: string, tx?: RentalFactTx, operator = "system", at = now()) {
    this.state(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status === RentalCoreOrderStatus.PickupOverdue) return order;
    await this.assertCarrierOrderResourcesMutable(tenantId, order, tx, true);
    if (![RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(order.status)) {
      throw new ConflictException("只有已确认或待领取订单可以进入待确认爽约");
    }
    const rule = order.ruleSnapshot.cancellation.noShow;
    if (rule?.enabled !== true) throw new ConflictException("当前订单规则未启用爽约处理");
    const atMs = Date.parse(at);
    const deadline = Date.parse(order.startAt) + (rule?.pickupGraceMinutes ?? 0) * 60_000;
    if (!Number.isFinite(atMs) || atMs < deadline) throw new ConflictException("尚未超过领取宽限时间");
    order.status = RentalCoreOrderStatus.PickupOverdue;
    order.pickupOverdueAt = at;
    order.updatedAt = at;
    await this.factStore.saveOrderAggregate(order, [], tx);
    void operator;
    return order;
  }

  /** 由调用方核验真实受理/投递事实后记录；开发模拟不能作为生产通知证据。 */
  async recordNoShowNotice(tenantId: string, orderId: string, noticeAt = now(), tx?: RentalFactTx) {
    this.state(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.PickupOverdue) throw new ConflictException("订单不在待确认爽约状态");
    if (!order.noShowNoticeAt) {
      if (!Number.isFinite(Date.parse(noticeAt))) throw new BadRequestException("通知时间无效");
      order.noShowNoticeAt = noticeAt;
      order.updatedAt = noticeAt;
      await this.factStore.saveOrderAggregate(order, [], tx);
    }
    return order;
  }

  async confirmNoShowOrder(tenantId: string, orderId: string, reason: string, tx?: RentalFactTx, operator = "system", at = now(), allowEarly = false) {
    this.state(tenantId);
    const current = await this.lockedOrder(tenantId, orderId, tx);
    if (current.status !== RentalCoreOrderStatus.PickupOverdue) throw new ConflictException("只有待确认爽约订单才能确认爽约");
    const rule = current.ruleSnapshot.cancellation.noShow;
    if (rule?.enabled !== true) throw new ConflictException("当前订单规则未启用爽约处理");
    if (!current.pickupOverdueAt || !current.noShowNoticeAt) throw new ConflictException("必须先记录客户通知，才能确认爽约");
    const atMs = Date.parse(at);
    const finalAt = Math.max(Date.parse(current.pickupOverdueAt), Date.parse(current.noShowNoticeAt)) + effectiveNoShowRule(current.ruleSnapshot).finalizationMinutes * 60_000;
    if (!Number.isFinite(atMs)) throw new BadRequestException("确认时间无效");
    if (!allowEarly && atMs < finalAt) throw new ConflictException("尚未到达爽约最终确认时限");
    if (!reason?.trim()) throw new BadRequestException("爽约原因不能为空");
    const base = Math.max(0, current.finalPayableAmount ?? current.payableAmount);
    const fee = rule?.feeType === "fixed_amount"
      ? Math.min(base, Math.max(0, rule.feeValue))
      : rule?.feeType === "percentage"
        ? Math.min(base, Math.max(0, roundMoney(base * Math.max(0, rule.feeValue) / 100)))
        : 0;
    const order = await this.cancelOrder(tenantId, orderId, `客户爽约：${reason.trim()}`, fee, tx, operator);
    order.status = RentalCoreOrderStatus.NoShow;
    order.noShowAt = at;
    order.noShowReason = reason.trim();
    order.updatedAt = at;
    await this.factStore.saveOrderAggregate(order, [], tx);
    return order;
  }

  /**
   * RULE-CLOSE-01：把一张待确认爽约（PickupOverdue）订单恢复为待领取。
   *
   * 只允许 PickupOverdue → ReadyForPickup：客户在被判逾期后又来领取，是常见的补救动作。
   * 恢复前用与领取同一把闸（`assertAllocatedPickupReady`）在订单行锁内复核资产与库存仍可用，
   * 因为逾期期间原分配的资产可能已被改配、进厂维护或被后续订单占用；复核不过则事务回滚，
   * 状态留在 PickupOverdue，不会恢复出一张交付不了的订单。恢复只清逾期与通知时间戳，
   * 不动金额与资金，并向订单变更历史追加一条 `resume_pickup` 记录留痕。
   */
  async resumePickupOverdueOrder(
    tenantId: string,
    orderId: string,
    tx?: RentalFactTx,
    operator = "system",
    customerConfirmed = true
  ) {
    this.state(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.PickupOverdue) {
      throw new ConflictException("只有待确认爽约订单才能恢复领取");
    }
    if (!customerConfirmed) throw new ConflictException("恢复领取前必须确认客户仍要领取");
    const expectedUpdatedAt = order.updatedAt;
    // 领取同款复核：锁资产、按缓冲区间核数量库存与序列化资产可用性、校验能力装备。
    await this.assertAllocatedPickupReady(tenantId, order, tx);
    order.status = RentalCoreOrderStatus.ReadyForPickup;
    order.pickupOverdueAt = undefined;
    order.noShowNoticeAt = undefined;
    const at = now();
    order.updatedAt = at;
    await this.factStore.saveOrderAggregate(order, [], tx);
    const previousChanges = await this.factStore.listOrderChanges(tenantId, orderId, tx);
    const change: RentalOrderChange = {
      id: randomUUID(),
      tenantId,
      workspaceId: this.resolveWorkspaceId(tenantId),
      orderId: order.id,
      sequence: previousChanges.length + 1,
      type: "resume_pickup",
      status: "applied",
      request: { type: "resume_pickup", reason: "待确认爽约订单恢复领取", customerConfirmed, expectedUpdatedAt },
      beforeSnapshot: { status: RentalCoreOrderStatus.PickupOverdue, updatedAt: expectedUpdatedAt },
      afterSnapshot: { status: order.status, updatedAt: order.updatedAt },
      diff: { status: { from: RentalCoreOrderStatus.PickupOverdue, to: order.status } },
      refundAmount: 0,
      additionalAmount: 0,
      depositDelta: 0,
      preAuthDelta: 0,
      idempotencyKey: `resume_pickup:${order.id}:${previousChanges.length + 1}`,
      requestedBy: operator,
      appliedBy: operator,
      requestedAt: at,
      appliedAt: at,
      createdAt: at
    };
    await this.factStore.insertOrderChange(change, tx);
    return order;
  }

  /** R0 only: no state/initialization, aggregate or current-rule fallback. The
   * repository reuses original order visibility and rechecks its source. */
  async readOrderFacts(tenantId: string, orderId: string) {
    const identity = getRequestIdentity(), workspaceId = getRequestWorkspaceId();
    if (!identity?.userId || identity.isSaasAdmin || identity.tenantId !== tenantId || !workspaceId)
      throw new ForbiddenException('订单事实缺少当前租户及空间');
    if (typeof this.factStore.readOrderFacts !== 'function') throw new ServiceUnavailableException('订单持久事实端口不可用');
    const binding = requestFingerprint(identity);
    const facts = await this.factStore.readOrderFacts(tenantId, workspaceId, orderId);
    if (requestFingerprint(getRequestIdentity()) !== binding) throw new ForbiddenException('订单事实读取期间授权变化');
    if (!facts) throw new NotFoundException('订单不在当前业务范围内');
    if (facts.id !== orderId || facts.tenantId !== tenantId || facts.workspaceId !== workspaceId)
      throw new ConflictException('订单事实来源绑定无效');
    return facts;
  }

  /** R0 applicability uses the original Core algorithm on narrow frozen refs;
   * no state/config initialization, inspection-result inference or action grant. */
  async readOrderInspectionBasis(tenantId: string, orderId: string): Promise<RentalOrderInspectionBasisFacts> {
    const identity = requestFingerprint(getRequestIdentity());
    const before = await this.readOrderFacts(tenantId, orderId);
    if (typeof this.factStore.readOrderInspectionBasis !== 'function') throw new ServiceUnavailableException('冻结检查依据持久端口不可用');
    const value = await this.factStore.readOrderInspectionBasis(tenantId, before.workspaceId, orderId);
    const after = await this.readOrderFacts(tenantId, orderId);
    if (requestFingerprint(getRequestIdentity()) !== identity || requestFingerprint(before) !== requestFingerprint(after)
      || value.orderId !== orderId || value.tenantId !== tenantId || value.workspaceId !== before.workspaceId
      || value.sourceOrderUpdatedAt !== before.updatedAt) throw new ConflictException('冻结检查依据读取期间来源或范围变化');
    const applicable = projectExchangeInspectionTemplates(value.allocations.map(row => ({ ...row,
      metadata: row.exchangeId ? { exchangeId: row.exchangeId } : undefined })), value.originalTemplateRefs, value.exchanges);
    if (applicable.length > 200) throw new ServiceUnavailableException('冻结检查适用关系超过只读上限');
    return { ...value, contractVersion: 'rental-order-inspection-basis-1',
      applicableTemplateRefs: applicable.map(row => ({ ...row, sourceTemplateId: row.sourceTemplateId ?? row.id })),
      recordResourceCoverage: 'not_projected', semantics: 'frozen_template_applicability_not_inspection_or_execution_authority' };
  }

  async readOrderExplanationState(tenantId: string, orderId: string) {
    const before = await this.readOrderFacts(tenantId, orderId);
    if (typeof this.factStore.readOrderExplanationState !== 'function') throw new ServiceUnavailableException('解释状态持久端口不可用');
    const value = await this.factStore.readOrderExplanationState(tenantId, before.workspaceId, orderId);
    const after = await this.readOrderFacts(tenantId, orderId);
    if (requestFingerprint(before) !== requestFingerprint(after) || value.orderId !== orderId
      || value.tenantId !== tenantId || value.workspaceId !== before.workspaceId || value.sourceOrderUpdatedAt !== before.updatedAt)
      throw new ConflictException('解释状态读取期间来源或范围变化');
    return value;
  }

  async getOrder(tenantId: string, orderId: string) {
    this.state(tenantId);
    return this.publicOrder(await this.requireOrder(tenantId, orderId));
  }

  /** Original persisted read under an existing caller transaction/Guard ALS.
   * No state initialization/config writes, default workspace, lock/lease, billing
   * or execution. Owner holds coherent fences; this is not a commit receipt. */
  async getOrderInTransaction(tenantId: string, orderId: string, native: RentalFactTx, signal: AbortSignal, assertCurrent?: () => void) {
    const before = getRequestIdentity();
    if (!before?.workspaceId || before.tenantId !== tenantId || !before.userId || before.isSaasAdmin
      || before.audience !== 'operator' || !native || '$transaction' in native
      || typeof native.businessWorkspace?.findFirst !== 'function' || typeof native.rentalOrder?.findFirst !== 'function') {
      throw new ForbiddenException('订单事务读取范围不可用');
    }
    const binding = requestFingerprint(structuredClone(before));
    const live = () => {
      if (signal.aborted || requestFingerprint(getRequestIdentity() ?? null) !== binding) throw new ForbiddenException('订单事务读取已停止或范围变化');
      assertCurrent?.();
    };
    live();
    // The original scope resolver awaits before order dispatch. Check at each
    // actual delegate invocation too; cancellation cannot start the next query.
    const guarded = <T extends object>(delegate: T) => new Proxy(delegate, { get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return property === 'findFirst' && typeof value === 'function'
        ? new Proxy(value, { apply(method, _owner, args) { live(); return Reflect.apply(method, target, args); } }) : value;
    } });
    const workspace = guarded(native.businessWorkspace), orders = guarded(native.rentalOrder);
    const transaction = new Proxy(native, { get(target, property, receiver) {
      return property === 'businessWorkspace' ? workspace : property === 'rentalOrder' ? orders : Reflect.get(target, property, receiver);
    } });
    const order = await this.factStore.findOrder(tenantId, orderId, transaction);
    live();
    if (!order || order.id !== orderId || order.tenantId !== tenantId) throw new NotFoundException('租赁订单不存在');
    return this.publicOrder(order);
  }

  /**
   * MKT-02D：记录一次增值服务的实际履约。
   *
   * 这条链故意不根据计划开始/结束时间自动推进状态。开始、完成、取消、失败和未到场
   * 都是运营动作；容量流水、退款审核单与订单服务发生项必须在同一事务内落下。
   */
  async updateServiceOccurrence(
    tenantId: string,
    orderId: string,
    occurrenceId: string,
    input: UpdateRentalServiceOccurrenceRequest,
    operator: string,
    tx: RentalFactTx
  ) {
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status === RentalCoreOrderStatus.Completed || order.status === RentalCoreOrderStatus.Cancelled) {
      throw new ConflictException("已完成或已取消的订单不能再记录服务履约");
    }
    const occurrences = [...(order.serviceSnapshots ?? [])];
    const index = occurrences.findIndex((row) => row.occurrenceId === occurrenceId);
    if (index < 0) throw new NotFoundException("服务发生项不存在");
    const previous = occurrences[index] as RentalOrderServiceOccurrence;
    const currentStatus = previous.executionStatus ?? "not_started";
    const at = input.actualAt ?? now();
    const atMs = Date.parse(at);
    if (!Number.isFinite(atMs)) throw new BadRequestException("实际履约时间无效");
    if (atMs > Date.now() + 60_000) throw new BadRequestException("实际履约时间不能晚于当前时间");
    if (input.evidenceAttachments?.some((value) => !value.trim())) throw new BadRequestException("证据引用不能为空");

    const activeStatuses = [RentalCoreOrderStatus.ReadyForPickup, RentalCoreOrderStatus.Renting, RentalCoreOrderStatus.Settling];
    if (!activeStatuses.includes(order.status)) throw new ConflictException("订单当前状态不允许记录服务履约");
    if (input.action === "start" && ![RentalCoreOrderStatus.ReadyForPickup, RentalCoreOrderStatus.Renting].includes(order.status)) {
      throw new ConflictException("订单已进入归还结算，不能再开始新的服务");
    }

    const netAmount = roundMoney(Math.max(0, previous.amount - (previous.discountAllocatedAmount ?? 0) - (previous.couponAllocatedAmount ?? 0)));
    const totalQuantity = Number.isInteger(previous.quantity) && previous.quantity > 0 ? previous.quantity : 1;
    const previousExecutedQuantity = Number(previous.executedQuantity);
    const alreadyExecutedQuantity = Number.isInteger(previousExecutedQuantity) && previousExecutedQuantity >= 0
      ? previousExecutedQuantity
      : 0;
    if (alreadyExecutedQuantity > totalQuantity) throw new ConflictException("服务已执行数量超过约定数量，拒绝继续处理");
    const executionSegments = Array.isArray(previous.executionSegments) ? [...previous.executionSegments] : [];
    let next: RentalOrderServiceOccurrence = { ...previous };
    let releaseCapacity = false;
    let useCapacity = false;

    if (input.action === "start") {
      if (currentStatus !== "not_started") throw new ConflictException("该服务已经开始或已结束，不能重复开始");
      next = { ...next, executionStatus: "in_progress", actualStartAt: at, executedBy: operator };
    } else if (input.action === "complete") {
      if (currentStatus !== "not_started" && currentStatus !== "in_progress") throw new ConflictException("该服务当前状态不能完成");
      if (!input.result?.trim()) throw new BadRequestException("完成服务必须填写执行结果");
      if (input.customerConfirmed === undefined) throw new BadRequestException("完成服务必须记录客户是否确认");
      const actualStartAt = previous.actualStartAt ?? at;
      if (Date.parse(actualStartAt) > atMs) throw new BadRequestException("完成时间不能早于开始时间");
      const remainingQuantity = totalQuantity - alreadyExecutedQuantity;
      const executedThisTime = input.executedQuantity ?? remainingQuantity;
      if (!Number.isInteger(executedThisTime) || executedThisTime < 1 || executedThisTime > remainingQuantity) {
        throw new BadRequestException(`本次执行数量必须在 1 到 ${remainingQuantity} 之间`);
      }
      const nextExecutedQuantity = alreadyExecutedQuantity + executedThisTime;
      const completed = nextExecutedQuantity === totalQuantity;
      executionSegments.push({
        quantity: executedThisTime,
        actualStartAt: previous.actualStartAt ?? at,
        actualEndAt: at,
        result: input.result.trim(),
        evidenceAttachments: input.evidenceAttachments ?? previous.evidenceAttachments,
        customerConfirmedAt: input.customerConfirmed ? at : undefined,
        executedBy: operator
      });
      next = {
        ...next,
        executionStatus: completed ? "completed" : "in_progress",
        actualStartAt,
        actualEndAt: completed ? at : undefined,
        executionResult: input.result.trim(),
        evidenceAttachments: input.evidenceAttachments ?? previous.evidenceAttachments,
        customerConfirmedAt: completed && input.customerConfirmed ? at : previous.customerConfirmedAt,
        executedBy: operator,
        executedQuantity: nextExecutedQuantity,
        executionSegments,
        refundStatus: completed ? "none" : previous.refundStatus
      };
      useCapacity = completed;
    } else {
      if (input.action === "cancel" && currentStatus !== "not_started" && !(currentStatus === "in_progress" && alreadyExecutedQuantity > 0)) {
        throw new ConflictException("已经开始的服务不能直接取消，请记录失败结果");
      }
      if (input.action === "no_show" && currentStatus !== "not_started") throw new ConflictException("已开始的服务不能记为未到场");
      if (currentStatus !== "not_started" && currentStatus !== "in_progress") throw new ConflictException("该服务已经结束，不能重复处理");
      if (currentStatus === "in_progress" && previous.actualStartAt) {
        const actualStartMs = Date.parse(previous.actualStartAt);
        if (Number.isFinite(actualStartMs) && actualStartMs > atMs) throw new BadRequestException("结束时间不能早于开始时间");
      }
      if (!input.reason?.trim()) throw new BadRequestException("取消、失败或未到场必须填写原因");
      const remainingQuantity = totalQuantity - alreadyExecutedQuantity;
      const remainingNetAmount = roundMoney(netAmount * remainingQuantity / totalQuantity);
      const refundAmount = roundMoney(Math.min(remainingNetAmount, Math.max(0, input.refundAmount ?? remainingNetAmount)));
      const terminalStatus = input.action === "cancel" ? "cancelled" : input.action === "no_show" ? "no_show" : "failed";
      next = {
        ...next,
        executionStatus: terminalStatus,
        actualEndAt: at,
        failureReason: input.reason.trim(),
        evidenceAttachments: input.evidenceAttachments ?? previous.evidenceAttachments,
        executedBy: operator,
        refundAmount,
        compensationAmount: input.compensationAmount === undefined ? previous.compensationAmount : roundMoney(input.compensationAmount),
        refundStatus: refundAmount > 0 ? "pending_review" : "none"
      };
      releaseCapacity = currentStatus === "not_started";
      useCapacity = currentStatus === "in_progress" && alreadyExecutedQuantity === totalQuantity;
      if (currentStatus === "in_progress" && alreadyExecutedQuantity > 0 && alreadyExecutedQuantity < totalQuantity
        && previous.requiresCapacity && previous.reservationKey) {
        if (!this.serviceCapacities) throw new ConflictException("服务容量履约组件未就绪，拒绝只写订单状态");
        await this.serviceCapacities.markPartiallyUsedForOccurrence(
          tenantId, orderId, previous.reservationKey, alreadyExecutedQuantity, input.reason.trim(), at, tx
        );
      }
      if (currentStatus === "in_progress" && alreadyExecutedQuantity === 0) useCapacity = true;
      if (refundAmount > 0) {
        const review = this.raiseFeeReview(order, "service_refund", refundAmount, [
          `服务：${previous.serviceName}`,
          `发生项：${occurrenceId}`,
          `履约结果：${terminalStatus}`,
          `客户实际净支付：${netAmount}`,
          `已执行数量：${alreadyExecutedQuantity}/${totalQuantity}`,
          `未执行净额：${remainingNetAmount}`,
          `退款建议：${refundAmount}`,
          input.reason.trim()
        ], occurrenceId);
        if (!review) throw new ConflictException("服务退款审核单创建失败");
        next.refundReviewId = review.id;
      }
    }

    if ((useCapacity || releaseCapacity) && previous.requiresCapacity && previous.reservationKey) {
      if (!this.serviceCapacities) throw new ConflictException("服务容量履约组件未就绪，拒绝只写订单状态");
      if (useCapacity) await this.serviceCapacities.markUsedForOccurrence(tenantId, orderId, previous.reservationKey, at, tx);
      if (releaseCapacity) await this.serviceCapacities.releaseForOccurrence(tenantId, orderId, previous.reservationKey, input.reason ?? input.action, at, tx);
    }
    occurrences[index] = next;
    order.serviceSnapshots = occurrences;
    order.updatedAt = at;
    await this.factStore.saveOrderAggregate(order, [], tx);
    return { order: this.publicOrder(order), occurrence: next };
  }

  /**
   * 锁住订单行后返回它的当前事实。同一业务动作的后续判定与写入都必须基于它，
   * 而不是锁之前读到的快照——页面预览只供展示。
   *
   * 归还计费是第一个落点：逾期费与提前归还退款此前全部在控制器**事务外**按快照算好
   * 再传进来，而订单行的锁要到 `createInspection` 内部的 `lockedOrder` 才加上。这段
   * 时间窗里一笔续租生效，归还就会按旧的约定归还时间判逾期——刚续上的单被多收一笔，
   * 退款也按错的租金基数算。
   *
   * 结算是第二个落点：待审异常与资金余额此前在拿到订单锁之前就查完了，等于用旧事实
   * 决定能不能关单。改成先锁再查，结算与费用裁定、收退款被同一把行锁串行化。
   *
   * 之所以"先锁再算"就够：改写 `effectiveEndAt` 的只有 `applyExtensionTo`，而它只有两个
   * 调用点——`requestOrderExtension`（月结等无需补款时直接生效）与 `payOrderExtension`，
   * 两者都先 `lockedOrder`；资金事件走 `lockedOrderScope`、费用裁定走 `reviewOrderFeeReview`
   * 的 `lockedOrder`，全部锁同一行订单，因此彼此串行。
   */
  async lockOrderForUpdate(tenantId: string, orderId: string, tx: RentalFactTx) {
    this.state(tenantId);
    return this.publicOrder(await this.lockedOrder(tenantId, orderId, tx));
  }

  /**
   * 已发出的承运包裹仍占用原资源，直到归还检查事务记录仓库实物验收。
   * 对写操作传入同一个订单事务，确保事件检查与后续状态/库存写入不会被并发发运穿透；
   * 只读预览可省略事务，但真正应用时仍会在写事务中再次检查。
   */
  async assertCarrierOrderResourcesMutable(tenantId: string, order: RentalOrder, tx?: RentalFactTx, requireTransaction = false): Promise<void> {
    if (order.fulfillmentMode !== "carrier_shipping") return;
    if (!tx && requireTransaction) throw new ConflictException("承运寄送订单的资源变更必须在事务内确认发运状态");
    const events = await this.factStore.listCarrierShipmentEventTypes(tenantId, order.id, tx);
    if (carrierShipmentInventoryMutationBlocked(events.map((type) => ({ type })))) {
      throw new ConflictException("承运包裹仍在途，库存持续锁定；仓库完成归还验收前不能取消、爽约或改配");
    }
  }

  private publicOrder(order: RentalOrder) {
    const result = redactDeliveryAddressPhone(structuredClone(order));
    if (result.assignment?.operationLock) result.assignment.operationLock.token = "";
    return result;
  }

  async getDeliveryAddressForReveal(tenantId: string, orderId: string) {
    const order = await this.requireOrder(tenantId, orderId);
    if (!order.deliveryAddressSnapshot) throw new NotFoundException("该订单没有配送收件地址");
    return structuredClone(order.deliveryAddressSnapshot);
  }

  /**
   * 校验下单条件并构造完整订单聚合，但不落库。
   * RC-02 由订单确认应用服务把该聚合与报价消费、优惠券锁定放进同一事务。
   */
  async prepareOrder(
    tenantId: string,
    input: CreateRentalOrderRequest,
    userName: string,
    quote: RentalQuoteSnapshotV1,
    /**
     * CUSTOMER-01C：已校验并解析好的四类主体。
     *
     * 由调用方（订单确认服务）先行解析后传入，本方法只负责原样固化——
     * Core 不去查客户、合同与授权，那属于客户域的判定。缺省时不写主体列，
     * 读取侧回落到 `customerId`，既有下单路径行为完全不变。
     */
    subjects?: CustomerOrderSubjects
  ) {
    const state = this.state(tenantId);
    const inventoryState = { itemGroups: inventoryBasisGroups(quote.inventoryBasis, tenantId, this.resolveWorkspaceId(tenantId), input.lines) };
    if (!input.customerName?.trim()) throw new BadRequestException("客户名称不能为空");
    // 能力版本仍消费原报价快照，不因能力升级改写承诺；地点/主体启用是
    // 另一项当前新业务准入，准备与最终提交均重读，归还善后不走该门。
    if (quote.ruleSnapshot.qualification.required) {
      if (quote.membershipSnapshot) {
        const evaluation = evaluateRentalQualification(
          quote.membershipSnapshot.qualifications,
          quote.ruleSnapshot.qualification,
          { validThroughAt: input.endAt, minimumValidityFromAt: input.startAt }
        );
        if (!evaluation.ok) throw new ConflictException(`当前品类要求先通过资质审核：${evaluation.message}`);
      } else {
        // 仅保留给迁移前旧调用方；新会员订单不接受前端声明资质已通过。
        if (!input.qualificationApproved) throw new ConflictException(`当前品类要求先通过资质审核：${quote.ruleSnapshot.qualification.documentTypes.join("、")}`);
        if (input.qualificationValidTo) {
          const validDays = (new Date(input.qualificationValidTo).getTime() - new Date(input.startAt).getTime()) / 86_400_000;
          if (validDays < quote.ruleSnapshot.qualification.minimumValidityDays) throw new ConflictException("资质有效期不满足租赁规则");
        }
      }
    }
    this.validatePeriod(input.startAt, input.endAt);
    const checked = this.computeAvailability(inventoryState, await this.loadInventorySnapshot(tenantId), {
      locationId: input.fulfillmentLocationId, startAt: input.startAt, endAt: input.endAt,
      lines: input.lines.map((line) => ({ itemGroupId: line.itemGroupId, quantity: line.quantity }))
    });
    if (!checked.available) throw new ConflictException("所选时间段库存不足");
    const fulfillment = await this.fulfillmentAdmission(tenantId, [
      { locationId: input.fulfillmentLocationId,
        capability: ["delivery", "onsite_delivery"].includes(input.fulfillmentMode) ? "delivery" : "pickup",
        partner: input.fulfillmentMode === "partner_pickup_return" },
      { locationId: input.returnLocationId ?? input.fulfillmentLocationId, capability: "return" }
    ]);
    const fulfillmentState = { ...state, locations: fulfillment.locations, operators: fulfillment.operators };
    const { fulfillmentLocation: location, returnLocation } = this.validateFulfillmentSelection(
      fulfillmentState, input.fulfillmentMode, input.fulfillmentLocationId, input.returnLocationId
    );
    const timestamp = now();
    const orderId = id("order");
    const unmatchedQuoteLines = new Set(quote.request.lines.map((_, index) => index));
    const orderLines = input.lines.map((line) => {
      const group = this.group(inventoryState, line.itemGroupId);
      const pricingGroup = line.pricingGroupId
        ? state.pricingGroups.find((row) => row.id === line.pricingGroupId)
        : undefined;
      const quoteIndex = [...unmatchedQuoteLines].find(index => {
        const row = quote.request.lines[index];
        return row.itemGroupId === line.itemGroupId && row.pricingGroupId === line.pricingGroupId && row.quantity === line.quantity;
      });
      if (quoteIndex === undefined) throw new BadRequestException("订单型号、分组或数量与服务端报价不一致");
      unmatchedQuoteLines.delete(quoteIndex);
      const { request: quotedLine, charge: rentalCharge } = quoteRentalLineSource(quote, quoteIndex);
      const quotedMembers = quotedLine.pricingGroupMemberItemGroupIds;
      if (line.pricingGroupId && (!pricingGroup || !(quotedMembers ?? pricingGroup.memberItemGroupIds).includes(group.id))) {
        throw new BadRequestException("订单行的产品型号不属于报价定价分组");
      }
      const amount = rentalCharge.amount;
      const reservationPrecision: "group" | "exact_model" = quotedLine.reservationPrecision === "exact_model" || !pricingGroup ? "exact_model" : "group";
      return {
        id: id("line"),
        pricingGroupId: pricingGroup?.id,
        pricingGroupCode: quotedLine.pricingGroupCode ?? pricingGroup?.code,
        pricingGroupName: quotedLine.pricingGroupName ?? pricingGroup?.name,
        reservationPrecision,
        // 即使旧读路径未识别预约精度，准确型号订单的允许替换范围也只能是自身。
        pricingGroupMemberItemGroupIds: pricingGroup
          ? reservationPrecision === "exact_model" ? [group.id] : [...(quotedMembers ?? pricingGroup.memberItemGroupIds)]
          : undefined,
        itemGroupId: group.id,
        itemGroupCode: group.code,
        itemGroupName: group.name,
        inventoryMode: group.inventoryMode,
        quantity: line.quantity,
        unitPrice: amount / line.quantity,
        amount,
        note: line.note
      };
    });
    const reservations: RentalReservation[] = [];
    for (const line of orderLines) {
      const group = this.group(inventoryState, line.itemGroupId);
      const reservationTargets = group.inventoryMode === RentalInventoryMode.Bundle
        ? group.bundleComponents.filter((component) => !component.optional).map((component) => ({ itemGroupId: component.itemGroupId, quantity: component.quantity * line.quantity }))
        : [{ itemGroupId: group.id, quantity: line.quantity }];
      for (const target of reservationTargets) reservations.push({
        id: id("reservation"), orderId, orderLineId: line.id, itemGroupId: target.itemGroupId,
        locationId: location.id, quantity: target.quantity, releasedQuantity: 0, status: RentalReservationStatus.Soft,
        expiresAt: new Date(Date.now() + quote.ruleSnapshot.payment.unpaidHoldMinutes * 60_000).toISOString(), createdAt: timestamp
      });
    }
    // Preparation is not a committed order. Confirmation assigns its human
    // number under a database lock before hooks or persistence can consume it.
    const order: RentalOrder = {
      id: orderId, tenantId, orderNo: "",
      categoryCode: state.profile.categoryCode, status: RentalCoreOrderStatus.Draft,
      categoryVersionId: quote.categoryVersionId,
      customerType: input.customerType, customerId: input.customerId, customerName: input.customerName.trim(), contactPhone: input.contactPhone?.trim(),
      membershipSnapshot: quote.membershipSnapshot ? structuredClone(quote.membershipSnapshot) : undefined,
      membershipBenefitEvaluations: quote.membershipBenefitEvaluations?.length ? structuredClone(quote.membershipBenefitEvaluations) : undefined,
      fulfillmentMode: input.fulfillmentMode,
      fulfillmentLocationId: location.id, fulfillmentLocationName: location.name,
      fulfillmentLocationSnapshot: this.locationSnapshot(fulfillmentState, location),
      returnLocationId: input.returnLocationId, returnLocationName: returnLocation.name,
      returnLocationSnapshot: this.locationSnapshot(fulfillmentState, returnLocation),
      deliveryAddressSnapshot: quote.deliveryAddressSnapshot ? structuredClone(quote.deliveryAddressSnapshot) : undefined,
      startAt: input.startAt, endAt: input.endAt,
      quoteId: quote.id, quoteNo: quote.quoteNo, pricingPlanVersion: quote.pricingPlanVersion,
      // PRICE-03：价格版本引用随订单固化，与 ruleSnapshot/calendarSnapshot 同理。
      priceVersionId: quote.priceVersionId, priceVersion: quote.priceVersion,
      inspectionTemplateSnapshots: structuredClone(quote.inspectionTemplateSnapshots),
      ruleVersion: quote.ruleVersion, ruleSnapshot: structuredClone(quote.ruleSnapshot), calendarVersion: quote.calendarVersion, calendarSnapshot: structuredClone(quote.calendarSnapshot), chargeLines: structuredClone(quote.chargeLines),
      // CORE-EXT-02D：能力版本快照随订单固化。在途环节的 Hook 判定都用它，
      // 因此升级或暂停能力都不改写这张已存在订单的履约规则。
      capabilitySnapshot: quote.capabilitySnapshot ? structuredClone(quote.capabilitySnapshot) : undefined,
      capabilityRequirementsSnapshot: structuredClone(quote.capabilityRequirementsSnapshot),
      // Review P1-5：判断记录从报价拷贝，下单侧**不重新构造**——重构一份就等于
      // 允许下单时给出与报价不同的判断，而客户看到的是报价里的那一份。
      capabilityDecisions: quote.capabilityDecisions ? structuredClone(quote.capabilityDecisions) : undefined,
      // Review P1-6：完整例外快照。风险代码之外还要留原因、确认人、权限、时间与
      // 被确认的判断 id，否则配货与后续履约无从还原「风险已被谁按什么依据裁决」。
      capabilityExceptions: this.buildExceptionSnapshots(input, quote),
      // MKT-02A：订单直接继承报价已经确认的服务事实，不回读可变服务主档。
      serviceSnapshots: quote.serviceSnapshots?.length ? structuredClone(quote.serviceSnapshots) : undefined,
      capabilityPolicy: quote.capabilitySnapshot?.length ? "snapshot" : "legacy_empty",
      // CUSTOMER-01C：四类主体原样固化。Core 不做客户域判定，只存已解析的结果。
      contractSubjectCustomerId: subjects?.contractSubjectCustomerId,
      payerSubjectCustomerId: subjects?.payerSubjectCustomerId,
      userSubjectCustomerId: subjects?.userSubjectCustomerId,
      agentId: subjects?.agentId,
      subjectSnapshot: subjects?.snapshot,
      rentalAmount: quote.rentalAmount, discountAmount: quote.discountAmount, couponAmount: quote.couponAmount,
      serviceAmount: quote.serviceAmount,
      // 履约费与预授权额度必须一并投影：订单只拿总额的话，
      // 逐项对账时会发现 payableAmount 里多出一笔说不清来源的钱。
      fulfillmentAmount: quote.fulfillmentAmount,
      depositAmount: quote.depositAmount,
      preAuthAmount: quote.preAuthAmount,
      payableAmount: quote.payableAmount,
      adjustmentAmount: 0, finalPayableAmount: quote.payableAmount,
      // 税率从报价快照继承（下单不重算税率）；税额此刻等于报价的税额，
      // 之后每次调账都会由 applyChargeTo 按新的最终应付重算。
      taxRate: quote.taxRate ?? 0,
      taxAmount: quote.taxAmount ?? 0,
      currency: quote.currency,
      totalAmount: quote.payableAmount, lines: orderLines,
      // 本人范围使用认证主体 ID；展示名和客户端 operator 不能决定数据归属。
      reservations, allocations: [], createdBy: requireRequestUserId(), createdAt: timestamp, updatedAt: timestamp
    };
    return order;
  }

  /**
   * Review P1-6：把请求里的例外确认与报价的判断记录**对齐**后固化成不可变快照。
   *
   * 每条确认都必须指向报价里真实存在的一条 **warn** 判断：`decisionId` 传了就必须同时
   * 匹配能力与风险代码，没传才按「能力 + 风险代码」回查。任何不匹配都 fail-closed，
   * 不能静默丢弃，否则 Hook 仍可能消费请求里的原始确认并形成绕过。
   *
   * 版本与器材组合从被确认的那条判断上取，不从当前实例取：确认针对的是报价当时的
   * 那个结论，事后升级能力不应改变这条确认的含义。
   */
  private buildExceptionSnapshots(
    input: CreateRentalOrderRequest,
    quote: RentalQuoteSnapshotV1
  ): RentalCapabilityExceptionSnapshot[] | undefined {
    const confirmations = input.capabilityExceptions ?? [];
    if (!confirmations.length) return undefined;
    const decisions = quote.capabilityDecisions ?? [];
    const snapshots: RentalCapabilityExceptionSnapshot[] = [];
    const confirmedRisks = new Set<string>();
    for (const confirmation of confirmations) {
      if (!confirmation.reason?.trim()) throw new BadRequestException("能力风险例外确认必须填写原因");
      const decision = confirmation.decisionId
        ? decisions.find((row) => row.id === confirmation.decisionId)
        : decisions.find(
            (row) => row.capability === confirmation.capability && row.notices.some((notice) => notice.code === confirmation.code)
          );
      if (
        !decision ||
        decision.decision !== "warn" ||
        decision.capability !== confirmation.capability ||
        !decision.notices.some((notice) => notice.code === confirmation.code)
      ) {
        throw new BadRequestException(
          `能力风险例外 ${confirmation.capability}/${confirmation.code} 未匹配报价中的可确认风险判断`
        );
      }
      if (!confirmation.confirmedBy || !confirmation.confirmedWithPermission || !confirmation.confirmedAt) {
        throw new BadRequestException("能力风险例外缺少服务端确认身份、权限或时间");
      }
      const confirmedAt = new Date(confirmation.confirmedAt);
      if (Number.isNaN(confirmedAt.getTime())) throw new BadRequestException("能力风险例外确认时间无效");
      const riskKey = `${confirmation.capability}:${confirmation.code}`;
      if (confirmedRisks.has(riskKey)) throw new BadRequestException(`能力风险例外 ${riskKey} 重复确认`);
      confirmedRisks.add(riskKey);
      snapshots.push({
        capability: confirmation.capability,
        riskCode: confirmation.code,
        reason: confirmation.reason.trim(),
        confirmedBy: confirmation.confirmedBy,
        confirmedWithPermission: confirmation.confirmedWithPermission,
        confirmedAt: confirmedAt.toISOString(),
        decisionId: decision.id,
        implementationVersion: decision.implementationVersion,
        configVersion: decision.configVersion,
        rulesetVersion: decision.rulesetVersion,
        equipment: decision.equipment
      });
    }
    return snapshots.length ? snapshots : undefined;
  }

  private async assertEnterpriseNewExpense(tenantId: string, order: RentalOrder, tx?: RentalFactTx, additionalAmount?: number) {
    if (order.membershipSnapshot?.bookingIdentity !== "enterprise_employee") return;
    if (!this.enterprisePolicies) throw new ConflictException("企业政策事务服务未就绪");
    await this.enterprisePolicies.assertOrderAction(tenantId, this.resolveWorkspaceId(tenantId), order, tx, additionalAmount);
  }

  async confirmOrder(tenantId: string, orderId: string, tx?: RentalFactTx, operator?: string) {
    this.state(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Draft) throw new ConflictException("只有草稿订单可以确认");
    await this.assertEnterpriseNewExpense(tenantId, order, tx);
    if (order.reservations.some((row) => row.expiresAt && new Date(row.expiresAt).getTime() < Date.now())) throw new ConflictException("软预占已过期，请重新下单");
    await this.assertOrderFulfillmentAdmission(tenantId, order, tx, true);
    // Hook 位置：状态与预占校验之后、改写之前。放在这里才能让阻止真正拦下本次确认；
    // 放在 saveOrderAggregate 之后就只是"事后告知"，订单已经变成 reserved 了。
    await this.runHook(tenantId, "order_confirmation", { type: "order", id: order.id }, order, tx, operator, this.orderHookInstances(tenantId, order));
    order.reservations.forEach((row) => { row.status = RentalReservationStatus.Confirmed; row.expiresAt = undefined; });
    order.status = RentalCoreOrderStatus.Reserved; order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order, [], tx);
    return order;
  }

  async allocateOrder(tenantId: string, orderId: string, tx?: RentalFactTx, operator?: string) {
    const state = await this.factContext(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Reserved) throw new ConflictException("只有已确认预占的订单可以配货");
    if (order.assignment) throw new ConflictException("请通过预分配和锁定入口管理该订单");
    await this.assertOrderFulfillmentAdmission(tenantId, order, tx);
    // Hook **不**在这里执行（Review P1-8）。
    //
    // 原先在取锁之前按**商品组**属性判定，检查的不是最终分配到的机身、镜头、电池。
    // 同商品组下某台资产存在属性覆盖、型号差异或附件缺失时，那种检查一个都发现不了。
    // 现在改为：先锁定并挑选候选资产 → 用**实际资产组合**在同一事务内判定 →
    // 判定通过才保存 Allocation。判定失败时事务回滚，锁与占用一起释放。
    //
    // 代价是被阻止的请求会短暂持有一批行锁直到回滚；这个代价必须付——
    // 在选出资产之前根本无法知道要判定什么。
    // 先锁候选资产行，再在**同一事务内**读资产与既有分配。
    //
    // 顺序不可反，也不能省锁：只锁订单行时两张订单锁的是不同的行、互不争锁，
    // 双方都读到"资产可用且无占用分配"，各自挑中同一台资产并提交，
    // 而 RentalAllocation 上没有 assetId 唯一约束，库层也拦不住。
    // E2E 实测过该缺陷：两个并发配货均返回 201，同一台资产被两张订单占住。
    //
    // 无 tx 的调用方（仍存在的旧路径）退回不加锁的读，行为与此前一致。
    if (tx) {
      const serializedTargets = new Map<string, string>();
      for (const reservation of order.reservations) {
        const group = this.group(state, reservation.itemGroupId);
        if (group.inventoryMode === RentalInventoryMode.Serialized) {
          serializedTargets.set(`${group.id}:${reservation.locationId}`, reservation.locationId);
        }
      }
      // 按 key 排序取锁，与库存锁同样的固定顺序，避免交叉死锁。
      for (const key of [...serializedTargets.keys()].sort()) {
        const [itemGroupId] = key.split(":");
        await this.factStore.lockAssetsForAllocation(tenantId, itemGroupId, serializedTargets.get(key)!, tx);
      }
    }
    const [assets, used] = await Promise.all([
      this.factStore.listAssets(tenantId, tx),
      this.factStore.allocatedAssetIds(tenantId, tx)
    ]);
    const allocations: RentalAllocation[] = [];
    const assetChanges: AssetStatusChange[] = [];
    for (const reservation of order.reservations) {
      const group = this.group(state, reservation.itemGroupId);
      if (group.inventoryMode === RentalInventoryMode.Serialized) {
        const picked = assets
          .filter((asset) => asset.itemGroupId === group.id && asset.locationId === reservation.locationId && asset.status === RentalAssetStatus.Available && !used.has(asset.id))
          .slice(0, reservation.quantity);
        if (picked.length < reservation.quantity) throw new ConflictException(`${group.name} 可分配资产不足`);
        for (const asset of picked) {
          // 必须把本次挑中的资产计入 used：内存实现靠就地改 asset.status 让后续过滤跳过，
          // 而这里的 assets 是取出的快照，改它不影响同一订单内下一个预占的筛选。
          used.add(asset.id);
          assetChanges.push({ assetId: asset.id, status: RentalAssetStatus.Reserved });
          allocations.push({ id: id("allocation"), orderId, orderLineId: reservation.orderLineId, itemGroupId: reservation.itemGroupId, assetId: asset.id, assetNo: asset.assetNo, quantity: 1, status: "allocated" });
        }
      } else {
        allocations.push({ id: id("allocation"), orderId, orderLineId: reservation.orderLineId, itemGroupId: reservation.itemGroupId, quantity: reservation.quantity, status: "allocated" });
      }
    }
    // Review P1-8：用**实际挑中的资产**判定，而不是商品组。
    //
    // 序列化行按资产逐台展开（带 assetId/assetNo 与「商品组属性 + 资产属性」合并结果）；
    // 数量库存行没有具体资产，仍按商品组展开——那类库存本来就不区分个体。
    // 判定所需的例外确认从**订单固化的例外快照**读（Review P1-6），
    // 不再传空数组：传空等于让配货重新判一遍风险，而下单时已经有人裁决过了。
    const pickedAssets = allocations
      .filter((row) => row.assetId)
      .map((row) => assets.find((asset) => asset.id === row.assetId))
      .filter((asset): asset is RentalAsset => Boolean(asset));
    const quantityLines = allocations
      .filter((row) => !row.assetId)
      .map((row) => ({ itemGroupId: row.itemGroupId!, quantity: row.quantity }));
    const groups = this.capabilityEquipmentGroups(tenantId);
    const executionFields = await this.orderCapabilityFields(order, tx);
    const actualEquipment = [
      ...buildCapabilityEquipmentFromAssets(groups, pickedAssets, executionFields),
      ...buildCapabilityEquipment(groups, quantityLines, executionFields)
    ];
    await this.runHook(
      tenantId,
      "allocation_dispatch",
      { type: "order", id: order.id },
      {
        ...order,
        equipment: actualEquipment,
        capabilityExceptions: (order.capabilityExceptions ?? []).map((row) => ({
          capability: row.capability,
          code: row.riskCode,
          reason: row.reason
        }))
      },
      tx,
      operator,
      this.orderHookInstances(tenantId, order)
    );
    order.allocations = allocations; order.status = RentalCoreOrderStatus.ReadyForPickup; order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order, assetChanges, tx);
    return order;
  }

  async substituteBundleComponent(
    tenantId: string,
    orderId: string,
    input: SubstituteRentalBundleComponentRequest,
    tx: RentalFactTx
  ) {
    const state = await this.factContext(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Reserved) throw new ConflictException("只有已确认且尚未配货的订单可以替换套装组成");
    if (order.allocations.some((a) => ACTIVE_ASSIGNMENTS.includes(a.status))) throw new ConflictException("请先释放分配，再替换套装组成");
    const line = order.lines.find((row) => row.id === input.orderLineId);
    if (!line || line.inventoryMode !== RentalInventoryMode.Bundle) throw new BadRequestException("目标订单行不是套装");
    const bundle = this.group(state, line.itemGroupId);
    const from = bundle.bundleComponents.find((component) => component.itemGroupId === input.fromItemGroupId);
    const to = bundle.bundleComponents.find((component) => component.itemGroupId === input.toItemGroupId);
    if (!from || !to || !from.substitutionGroup || from.substitutionGroup !== to.substitutionGroup) {
      throw new BadRequestException("只能在同一替代组内更换套装组成");
    }
    if (from.itemGroupId === to.itemGroupId) throw new BadRequestException("替代商品不能与当前商品相同");
    const reservation = order.reservations.find((row) =>
      row.orderLineId === line.id && row.itemGroupId === from.itemGroupId && row.status === RentalReservationStatus.Confirmed
    );
    if (!reservation) throw new ConflictException("当前套装组成没有可替换的有效预占");
    const targetGroup = this.group(state, to.itemGroupId);
    const targetQuantity = to.quantity * line.quantity;
    await this.factStore.lockInventoryTargets(tenantId, reservation.locationId, [{ itemGroupId: targetGroup.id, inventoryMode: targetGroup.inventoryMode }], tx);
    const snapshot = await this.loadInventorySnapshot(tenantId, tx);
    // 占用区间到**当前**归还时间为止：续租过的订单要按延长后的时间查可用量，
    // 否则会换进一台在续租那段时间已经被下一张订单占住的资产。
    const available = this.availableQuantity(state, snapshot, targetGroup, reservation.locationId, order.startAt, order.effectiveEndAt ?? order.endAt, new Set());
    if (available < targetQuantity) throw new ConflictException(`${targetGroup.name} 可替代库存不足`);
    reservation.itemGroupId = targetGroup.id;
    reservation.quantity = targetQuantity;
    reservation.releasedQuantity = 0;
    order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order, [], tx);
    return order;
  }

  async partialReturnOrder(
    tenantId: string,
    orderId: string,
    input: PartialReturnRentalOrderRequest,
    tx: RentalFactTx,
    charges: {
      overdue?: { amount: number; returnedAt: string; batchId?: string; review?: { maximumAmount?: number; basis: string[] } };
    } = {}
  ) {
    const state = await this.factContext(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.fulfillmentMode === "carrier_shipping") {
      throw new ConflictException("承运寄送订单不可部分归还，必须在仓库实物验收时整单收回");
    }
    if (order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以办理部分归还");
    if (order.ruleSnapshot.fulfillment.returnInspectionRequired) throw new ConflictException("当前规则要求归还检查；部分归还须走逐批检查流程，不能直接释放资产");
    if (!input.items?.length) throw new BadRequestException("至少选择一个归还分配项");
    if (new Set(input.items.map((item) => item.allocationId)).size !== input.items.length) throw new BadRequestException("归还分配项不能重复");
    const returnedAllocationIdsBefore = new Set(
      (order.allocations ?? []).filter((allocation) => allocation.status === "returned" || allocation.status === "released").map((allocation) => allocation.id)
    );
    const returnBatchKey = input.batchNo ?? `partial-${id("return")}`;
    const operator = getRequestUserId() ?? "系统";
    const releasedBeforeReturn = new Map(order.reservations.map((row) => [row.id, row.releasedQuantity]));
    await this.runHook(
      tenantId,
      "return_inspection",
      { type: "order", id: order.id },
      { order, partialReturn: input.items },
      tx,
      undefined,
      this.orderHookInstances(tenantId, order)
    );
    const assetChanges: AssetStatusChange[] = [];
    const returnedIds = await this.applyPartialReturnItems(tenantId, state, order, input.items, tx, assetChanges);
    this.stampPartialReturnReceipts(order, input.items, returnedIds, returnBatchKey, charges.overdue?.returnedAt ?? now());
    await this.recordReturnDispositions(
      tenantId,
      state,
      order,
      undefined,
      returnBatchKey,
      releasedBeforeReturn,
      undefined,
      tx,
      operator,
      returnedAllocationIdsBefore,
      assetChanges
    );
    if (charges.overdue) {
      this.applyOverdueTo(order, charges.overdue.amount, charges.overdue.returnedAt, charges.overdue.batchId, charges.overdue.review);
    }
    const stockQuarantines = this.quarantinedReturnQuantities(state, order, releasedBeforeReturn, returnBatchKey, undefined, operator);
    const stockTransfers = this.returnStockTransfers(state, order, releasedBeforeReturn, returnBatchKey, undefined, operator);
    order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order, assetChanges, tx, stockQuarantines, stockTransfers);
    return order;
  }

  /** The returned allocation is the immutable quantity for this physical batch.
   * Stamp server time/source in the same aggregate write; legacy absence cannot
   * be reconstructed from the last return or a later inspection timestamp. */
  private stampPartialReturnReceipts(order: RentalOrder, items: PartialReturnRentalOrderRequest["items"],
    returnedIds: Map<string, string>, batchId: string, returnedAt: string) {
    if (!batchId || !Number.isFinite(Date.parse(returnedAt))) throw new ConflictException("归还批次缺少服务端实际时点");
    for (const item of items) {
      const allocation = order.allocations.find(row => row.id === returnedIds.get(item.allocationId));
      if (!allocation || allocation.status !== "returned" || allocation.quantity !== item.quantity || allocation.metadata?.returnReceipt) {
        throw new ConflictException("本批归还数量与原分配来源不一致");
      }
      allocation.metadata = { source: "manual", protected: true, assignedAt: returnedAt, ...allocation.metadata,
        returnReceipt: { batchId, returnedAt, sourceAllocationId: item.allocationId, orderLineId: allocation.orderLineId, quantity: item.quantity } };
    }
  }

  /**
   * 只改变本批已领取分配项及对应预占。直接部分归还和“部分归还检查”共用它，
   * 防止两条路径对库存释放、最后一批判断出现不同口径。
   */
  private async applyPartialReturnItems(
    tenantId: string,
    state: TenantRentalState,
    order: RentalOrder,
    items: PartialReturnRentalOrderRequest["items"],
    tx: RentalFactTx | undefined,
    assetChanges: AssetStatusChange[]
  ) {
    if (!items?.length) throw new BadRequestException("至少选择一个归还分配项");
    if (new Set(items.map((item) => item.allocationId)).size !== items.length) throw new BadRequestException("归还分配项不能重复");
    const requestedByAllocationId = new Map(items.map((item) => [item.allocationId, item.quantity]));
    const pickedUp = order.allocations.filter((allocation) =>
      allocation.status === "picked_up" || (allocation.status === "locked" && Boolean(allocation.metadata?.exchangeId))
    );
    if (pickedUp.length && pickedUp.every((allocation) => (requestedByAllocationId.get(allocation.id) ?? 0) >= allocation.quantity)) {
      throw new ConflictException("最后一批必须通过整单归还或归还检查完成，以计算逾期和异常费用");
    }
    const assets = await this.factStore.listAssets(tenantId, tx);
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const returnedIds = new Map<string, string>();
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new BadRequestException("归还数量必须是正整数");
      const allocation = order.allocations.find((row) => row.id === item.allocationId);
      const exchangeHolding = allocation?.status === "locked" && Boolean(allocation.metadata?.exchangeId);
      if (!allocation || (allocation.status !== "picked_up" && !exchangeHolding)) throw new ConflictException("所选分配项已归还或不可归还");
      if (item.quantity > allocation.quantity) throw new BadRequestException("归还数量不能超过未归还数量");
      const actualItemGroupId = allocation.itemGroupId ?? (allocation.assetId ? assetById.get(allocation.assetId)?.itemGroupId : undefined);
      if (!actualItemGroupId) throw new ConflictException("历史套装分配缺少组成商品标识，请使用整单归还");
      const group = this.group(state, actualItemGroupId);
      if (group.inventoryMode === RentalInventoryMode.Consumable) throw new BadRequestException("一次性耗材已在领取时消耗，不进入归还流程");
      if (group.inventoryMode === RentalInventoryMode.Serialized && item.quantity !== 1) throw new BadRequestException("序列化资产必须按单件归还");
      const reservation = order.reservations.find((row) => allocation.metadata?.reservationId
        ? row.id === allocation.metadata.reservationId
        : row.orderLineId === allocation.orderLineId && row.itemGroupId === actualItemGroupId
          && row.status === RentalReservationStatus.Fulfilled
          && row.quantity - row.releasedQuantity >= item.quantity);
      if (!reservation || reservation.status !== RentalReservationStatus.Fulfilled) throw new ConflictException("归还项没有对应的履约预占");
      if (reservation.releasedQuantity + item.quantity > reservation.quantity) throw new ConflictException("累计归还数量超过原预占数量");
      if (item.quantity === allocation.quantity) {
        allocation.status = "returned";
        returnedIds.set(allocation.id, allocation.id);
      } else {
        allocation.quantity -= item.quantity;
        const returnedId = id("allocation");
        order.allocations.push({
          ...structuredClone(allocation), id: returnedId, itemGroupId: actualItemGroupId,
          quantity: item.quantity, status: "returned",
          metadata: { source: "manual", protected: true, assignedAt: now(), ...allocation.metadata, reservationId: reservation.id }
        });
        returnedIds.set(allocation.id, returnedId);
      }
      allocation.itemGroupId = actualItemGroupId;
      reservation.releasedQuantity += item.quantity;
      if (reservation.releasedQuantity === reservation.quantity) reservation.status = RentalReservationStatus.Released;
      if (allocation.assetId) assetChanges.push({ assetId: allocation.assetId, status: RentalAssetStatus.Available });
    }
    if (order.allocations.every((allocation) => allocation.status === "returned" || allocation.status === "released")) throw new ConflictException("部分归还不应释放最后一批，请使用整单归还");
    // 分批归还是一个完整的办理动作。成功提交后必须释放本次操作锁，
    // 否则管理端已经清掉本地凭证，订单聚合却仍保留旧锁，下一批归还会被
    // 自己的旧 token 卡成 409；直接部分归还和“部分归还检查”共用这里。
    if (order.assignment) order.assignment.operationLock = undefined;
    return returnedIds;
  }

  /**
   * 订单进入终态或已归还时，作废遗留的待补款续租申请。
   *
   * 不作废会留下一笔永远不可能生效的申请：`payOrderExtension` 会因订单状态拒绝，
   * 而资金侧仍把它的应付计入待收，于是页面上出现一个点了必然失败的补款按钮。
   *
   * 用 `cancelled` 而不是 `expired`：这不是超时，是被订单状态终结。`expired` 留给
   * 将来的待支付超时机制。`cancelExtensions` 只更新 `pending_payment` 行，重复调用幂等。
   */
  private async voidPendingExtensions(tenantId: string, orderId: string, tx?: RentalFactTx) {
    const rows = await this.factStore.listExtensions(tenantId, orderId, tx);
    const pending = rows.filter((row) => row.status === "pending_payment").map((row) => row.id);
    if (pending.length) await this.factStore.cancelExtensions(tenantId, pending, tx);
  }

  /** Preserve earned service net amounts from actual occurrence facts. Unknown
   * execution cannot be guessed from the plan or silently reversed on cancellation. */
  private cancelledOrderServiceBasis(order: RentalOrder) {
    let retained = 0;
    if ((order.feeReviews ?? []).some(review => review.type === "service_refund" && review.status === "pending")) {
      throw new ConflictException("服务退款尚待裁定，请先核对再取消订单，不能让终态丢失原审核");
    }
    const occurrences = (order.serviceSnapshots ?? []).map(row => {
      const gross = row.amount, discount = row.discountAllocatedAmount ?? 0, coupon = row.couponAllocatedAmount ?? 0;
      const net = roundMoney(gross - discount - coupon);
      if (![gross, discount, coupon].every(value => Number.isFinite(value) && value >= 0)
        || !Number.isFinite(net) || net < 0 || !Number.isInteger(row.quantity) || row.quantity < 1) {
        throw new ConflictException("原服务净额或数量无效，须核对后再取消订单");
      }
      const status = row.executionStatus;
      if (!status || !row.occurrenceId || !["not_started", "in_progress", "completed", "cancelled", "failed", "no_show"].includes(status)) {
        throw new ConflictException("原服务实际履约状态不明，须核对后再取消订单");
      }
      const executed = row.executedQuantity ?? (status === "completed" ? row.quantity : 0);
      if (!Number.isInteger(executed) || executed < 0 || executed > row.quantity
        || status === "completed" && executed !== row.quantity
        || ["not_started", "no_show"].includes(status) && executed > 0
        || status === "in_progress" && executed === 0
        || ["cancelled", "failed"].includes(status) && row.actualStartAt && row.executedQuantity === undefined) {
        throw new ConflictException("服务已有未明确执行过程，须核对实际完成数量后再取消订单");
      }
      if (row.executionSegments?.length && (row.executionSegments.some(segment => !Number.isInteger(segment.quantity) || segment.quantity < 1)
        || row.executionSegments.reduce((sum, segment) => sum + segment.quantity, 0) !== executed)) {
        throw new ConflictException("服务原执行段与累计数量不一致，拒绝冲销已履约费用");
      }
      if (row.requiresCapacity && (!row.reservationKey || row.capacityQuantity !== row.quantity)) {
        throw new ConflictException("原服务容量依据不支持安全取消，须核对后处理");
      }
      const earned = executed === row.quantity ? net : roundMoney(net * executed / row.quantity);
      const deducted = roundMoney((order.feeReviews ?? []).filter(review => review.type === "service_refund"
        && review.sourceId === row.occurrenceId && review.status === "approved").reduce((sum, review) => {
          if (!Number.isFinite(review.decidedAmount) || review.decidedAmount! < 0) throw new ConflictException("原服务核减事实无效");
          return sum + review.decidedAmount!;
        }, 0));
      if (deducted > net + 0.005) throw new ConflictException("原服务已核减超过净额，须财务核对");
      const earnedAfterReduction = roundMoney(Math.min(earned, Math.max(0, net - deducted)));
      retained = roundMoney(retained + earnedAfterReduction);
      return { row, executed, retained: earnedAfterReduction };
    });
    const payable = order.finalPayableAmount ?? order.payableAmount;
    if (!Number.isFinite(payable) || payable < retained - 0.005) throw new ConflictException("原应收已小于已履约服务净额，须核对既有核减记录");
    return { retained, occurrences };
  }

  async cancelOrder(
    tenantId: string,
    orderId: string,
    reason: string,
    chargeAmount: number | ((order: RentalOrder) => number | Promise<number>) = 0,
    tx?: RentalFactTx,
    operator?: string
  ) {
    this.state(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    await this.assertCarrierOrderResourcesMutable(tenantId, order, tx, true);
    if ([RentalCoreOrderStatus.Renting, RentalCoreOrderStatus.Settling, RentalCoreOrderStatus.Completed, RentalCoreOrderStatus.Cancelled, RentalCoreOrderStatus.NoShow].includes(order.status)) throw new ConflictException("当前订单状态不能取消");
    if (!reason?.trim()) throw new BadRequestException("取消原因不能为空");
    // 取消费必须基于同一事务里刚锁住的订单事实计算。保留 number 入参是为了兼容
    // 直接调用服务的旧测试/内存路径；生产控制器传 resolver，让价格快照和当前时间
    // 的读取发生在订单行锁之后。
    const resolvedChargeAmount = typeof chargeAmount === "function" ? await chargeAmount(order) : chargeAmount;
    const serviceBasis = this.cancelledOrderServiceBasis(order);
    // 结算 Hook：取消费用是一笔真实结算。能力可以给出费用**依据**或提示，
    // 但金额如何计入由下面的 Core 逻辑决定——能力拿到的是冻结快照，改不了 order。
    await this.runHook(
      tenantId,
      "settlement",
      { type: "order", id: order.id },
      { order, settlement: { kind: "cancellation", chargeAmount: resolvedChargeAmount, reason: reason.trim() } },
      tx,
      operator,
      this.orderHookInstances(tenantId, order)
    );
    const assetChanges: AssetStatusChange[] = [];
    order.reservations.forEach((row) => { row.status = RentalReservationStatus.Cancelled; });
    order.allocations.forEach((row) => {
      // 新排期不改变资产即时状态；取消未来订单不得释放前单正在使用的资产。
      if (row.assetId && row.status === "allocated") assetChanges.push({ assetId: row.assetId, status: RentalAssetStatus.Available });
      if (ACTIVE_ASSIGNMENTS.includes(row.status)) row.status = "released";
    });
    const cancelledAt = now();
    for (const { row, executed } of serviceBasis.occurrences) {
      if (row.executionStatus === "completed" && row.requiresCapacity) {
        if (!tx || !this.serviceCapacities) throw new ConflictException("服务容量善后组件未就绪，不能释放已用容量");
        await this.serviceCapacities.markUsedForOccurrence(tenantId, orderId, row.reservationKey, row.actualEndAt ?? cancelledAt, tx);
      }
      if (!["not_started", "in_progress"].includes(row.executionStatus ?? "")) continue;
      if (row.requiresCapacity) {
        if (!tx || !this.serviceCapacities) throw new ConflictException("服务容量善后组件未就绪，不能只取消订单");
        if (executed > 0 && executed < row.quantity) await this.serviceCapacities.markPartiallyUsedForOccurrence(
          tenantId, orderId, row.reservationKey, executed, reason.trim(), cancelledAt, tx);
        else if (executed === row.quantity) await this.serviceCapacities.markUsedForOccurrence(tenantId, orderId, row.reservationKey, cancelledAt, tx);
        else await this.serviceCapacities.releaseForOccurrence(tenantId, orderId, row.reservationKey, reason.trim(), cancelledAt, tx);
      }
      // Only stop the unperformed remainder; append-only original execution segments stay intact.
      row.executionStatus = executed === row.quantity ? "completed" : "cancelled";
      row.actualEndAt = cancelledAt;
      row.failureReason = reason.trim();
      row.refundStatus = "included_in_order_change";
    }
    // Original quote stays unchanged. Reverse only unearned charges, not the
    // already performed service net amounts retained by the original facts.
    this.applyChargeTo(order, { code: `cancellation_reversal:${order.id}`, name: "取消未履行费用核减", type: "early_return_refund",
      amount: -roundMoney((order.finalPayableAmount ?? order.payableAmount) - serviceBasis.retained), sourceVersion: order.ruleVersion,
      detail: `${reason.trim()}；保留已实际履约服务净额 ${serviceBasis.retained}` });
    // 取消费也走同一条追加路径：此前这里是 `adjustmentAmount = chargeAmount` 直接赋值，
    // 是四个写入点里唯一不累加、也唯一没有去重保护的一处。取消对 Renting/Settling/Completed
    // 都拒绝，所以目前不会覆盖掉已有调账，但没有理由留一个例外。
    if (resolvedChargeAmount > 0) {
      this.applyChargeTo(order, {
        code: `cancellation:${order.id}`,
        name: "晚取消费用",
        type: "cancellation",
        amount: resolvedChargeAmount,
        sourceVersion: order.ruleVersion,
        detail: reason.trim()
      });
    }
    order.cancellationReason = reason.trim(); order.cancelledAt = cancelledAt;
    order.status = RentalCoreOrderStatus.Cancelled; order.updatedAt = cancelledAt;
    // 取消后仍被订单持有的押金、预授权冻结与多收租金 → 挂一张 refund_due 审核单。
    // 这张单不动账（reviewOrderFeeReview 对 refund_due 已是金额中性），只把"还有钱扣在
    // 客户身上"变成运营侧可见、且阻止误结的待办；实际退款/释放仍由资金区按权限单独办理。
    // 待收多收必须用取消核减**之后**的最终应付判定，因此把内存订单的 finalPayableAmount 传入。
    if (this.funding && tx) {
      const held = await this.funding.computeHeldFunds(
        tenantId,
        this.resolveWorkspaceId(tenantId),
        orderId,
        tx,
        order.finalPayableAmount ?? order.payableAmount
      );
      const depositRefund = held.depositBalance > 0 ? roundMoney(held.depositBalance) : 0;
      const preauthRefund = held.preauthBalance > 0 ? roundMoney(held.preauthBalance) : 0;
      const overpaidRefund = held.rentalOverpaid < -0.005 ? roundMoney(-held.rentalOverpaid) : 0;
      const total = roundMoney(depositRefund + preauthRefund + overpaidRefund);
      if (total > 0) {
        this.raiseFeeReview(order, "refund_due", total, [
          `订单取消，仍持有押金/预授权/多收租金合计 ${total}`,
          ...(depositRefund > 0 ? [`押金余额 ${depositRefund}`] : []),
          ...(preauthRefund > 0 ? [`预授权冻结余额 ${preauthRefund}`] : []),
          ...(overpaidRefund > 0 ? [`多收租金 ${overpaidRefund}`] : []),
          "退款/释放已获认可后仍需在资金区按权限单独办理，本单不动账"
        ], "cancel");
      }
    }
    // 订单取消后遗留的待补款续租不该继续可补款，也不该继续计入待收。
    await this.voidPendingExtensions(tenantId, orderId, tx);
    await this.factStore.saveOrderAggregate(order, assetChanges, tx);
    return order;
  }

  async completeHandoverWithoutInspection(
    tenantId: string,
    orderId: string,
    stage: "pickup" | "return",
    overdueCharge = 0,
    tx?: RentalFactTx,
    operator?: string,
    earlyReturnRefund?: { amount: number | null; maximumAmount?: number; requiresReview: boolean; basis: string[] },
    overdueReview?: { maximumAmount?: number; basis: string[]; returnedAt: string }
  ) {
    const state = this.state(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.fulfillmentMode === "carrier_shipping") {
      throw new ConflictException(stage === "pickup"
        ? "承运寄送必须凭客户实际签收时间和签收证据办理领取检查，不能直接起租"
        : "承运寄送必须先登记客户交寄凭证，再由仓库完成实物归还检查；不能直接完成归还或提前释放库存");
    }
    const assetChanges: AssetStatusChange[] = [];
    let returnStockQuarantines: StockQuarantineChange[] = [];
    let returnStockTransfers: StockReturnTransfer[] = [];
    if (stage === "pickup") {
      if (order.ruleSnapshot.fulfillment.pickupInspectionRequired) throw new ConflictException("当前规则要求完成领取检查");
      if (order.status !== RentalCoreOrderStatus.ReadyForPickup) throw new ConflictException("订单尚未完成配货");
      await this.assertOrderQualification(tenantId, order, "pickup", order.effectiveEndAt ?? order.endAt, tx);
      await this.assertOrderFulfillmentAdmission(tenantId, order, tx);
      await this.assertAllocatedPickupReady(tenantId, order, tx);
      // 领取/交付与归还检查是两个不同的触发点，因此按 stage 分发。
      // 这不是品类分支：stage 是履约阶段，与经营品类无关。
      await this.runHook(
        tenantId,
        "pickup_delivery",
        { type: "order", id: order.id },
        { order, inspectionSkipped: true },
        tx,
        operator,
        this.orderHookInstances(tenantId, order)
      );
      await this.markPickedUp(tenantId, order, assetChanges, tx, operator);
    } else {
      if (order.ruleSnapshot.fulfillment.returnInspectionRequired) throw new ConflictException("当前规则要求完成归还检查");
      if (order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以归还");
      await this.runHook(
        tenantId,
        "return_inspection",
        { type: "order", id: order.id },
        { order, inspectionSkipped: true },
        tx,
        operator,
        this.orderHookInstances(tenantId, order)
      );
      const returnedAllocationIdsBefore = new Set(
        (order.allocations ?? []).filter((allocation) => allocation.status === "returned" || allocation.status === "released").map((allocation) => allocation.id)
      );
      const releasedBeforeReturn = new Map(order.reservations.map((row) => [row.id, row.releasedQuantity]));
      const returnBatchKey = `handover-${id("return")}`;
      this.finishReturn(order, overdueReview ? 0 : overdueCharge, assetChanges);
      if (overdueReview) this.applyOverdueTo(order, 0, overdueReview.returnedAt, undefined, overdueReview);
      // 整单归还后订单进入待结算，`payOrderExtension` 会因状态拒绝生效——
      // 遗留的待补款续租就此作废，不再显示补款入口也不再计入待收。
      await this.voidPendingExtensions(tenantId, orderId, tx);
      if (earlyReturnRefund) this.applyEarlyReturnRefundTo(order, earlyReturnRefund);
      await this.recordReturnDispositions(
        tenantId,
        state,
        order,
        undefined,
        returnBatchKey,
        releasedBeforeReturn,
        undefined,
        tx,
        operator,
        returnedAllocationIdsBefore,
        assetChanges
      );
      const returnOperator = operator || getRequestUserId() || "系统";
      returnStockQuarantines = this.quarantinedReturnQuantities(state, order, releasedBeforeReturn, returnBatchKey, undefined, returnOperator);
      returnStockTransfers = this.returnStockTransfers(state, order, releasedBeforeReturn, returnBatchKey, undefined, returnOperator);
    }
    order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order, assetChanges, tx, returnStockQuarantines, returnStockTransfers);
    return order;
  }

  async listInspectionTemplates(tenantId: string, stage?: "pickup" | "return", order?: RentalOrder, tx?: RentalFactTx,
    returnAllocationIds?: readonly string[]) {
    const state = this.state(tenantId);
    if (order && order.tenantId !== tenantId) throw new ForbiddenException("订单不属于当前租户");
    if (order) {
      if (stage === "return") {
        const active = (order.allocations ?? []).filter(row => row.status === "picked_up" || row.status === "locked" && row.metadata?.exchangeId);
        const selected = returnAllocationIds === undefined ? active : active.filter(row => returnAllocationIds.includes(row.id));
        if (returnAllocationIds !== undefined && (!returnAllocationIds.length || new Set(returnAllocationIds).size !== returnAllocationIds.length
          || selected.length !== returnAllocationIds.length)) throw new BadRequestException("检查分配项不属于本单可归还资源");
        // Replacement-only checks use their own recorded change basis. Missing
        // unrelated original history must not be invented or block this batch.
        if (selected.length && selected.every(row => row.metadata?.exchangeId)) {
          if (typeof this.factStore?.listOrderChanges !== "function") throw new ServiceUnavailableException("替换商品检查依据读取端口未装配");
          const changes = await this.factStore.listOrderChanges(tenantId, order.id, tx);
          for (const changeId of new Set(selected.map(row => row.metadata!.exchangeId!))) {
            const change = changes.find(row => row.id === changeId), basis = change && exchangeBasis(change);
            if (!basis || basis.categoryCode !== order.categoryCode || order.categoryVersionId && !basis.categoryVersionId)
              throw new ConflictException("替换商品缺少原检查执行依据");
            readFrozenInspectionTemplates(basis.inspectionTemplateSnapshots, tenantId, order.categoryCode);
          }
          return exchangeInspectionTemplates({ ...order, allocations: selected }, [], changes).filter(row => row.stage === "return");
        }
      }
      let frozen: unknown = order.inspectionTemplateSnapshots;
      if (frozen === undefined) {
        if (typeof this.factStore?.readQuotedInspectionTemplates !== "function")
          throw new ServiceUnavailableException("历史检查依据缺失，原报价检查读取端口未装配");
        const quoted = await this.factStore.readQuotedInspectionTemplates(tenantId, order.id, tx);
        if (!quoted || quoted.quoteId !== order.quoteId || quoted.categoryCode !== order.categoryCode
          || quoted.categoryVersionId !== order.categoryVersionId) throw new ConflictException("原订单/报价没有可核对的冻结检查依据");
        frozen = quoted.templates;
      }
      const originals = readFrozenInspectionTemplates(frozen, tenantId, order.categoryCode).filter((row) => !stage || row.stage === stage);
      if (stage === "pickup" || !(order.allocations ?? []).some((row) => (row.status === "picked_up" || row.status === "locked") && row.metadata?.exchangeId)) return structuredClone(originals);
      return exchangeInspectionTemplates(order, originals, await this.factStore.listOrderChanges(tenantId, order.id, tx)).filter((row) => !stage || row.stage === stage);
    }
    const definition = await this.getWorkspaceCategory(tenantId);
    const originals = state.inspectionTemplates
      .filter((row) => !stage || row.stage === stage)
      .map((row) => this.inspectionTemplateForRead(definition, row));
    return originals;
  }

  async listInspections(tenantId: string, orderId: string) {
    this.state(tenantId);
    await this.requireOrder(tenantId, orderId);
    return this.factStore.listInspections(tenantId, orderId);
  }

  /** Bounded persisted observations; original order access and workspace are
   * still required. No pricing, inspection submission or liability decision. */
  /** R0 records only. Keep the normal Core inspection page/aggregate for its
   * original consumers; AI uses the separately bounded metadata projection. */
  async readInspectionFactsPage(tenantId: string, orderId: string, value: RentalInspectionPageQuery) {
    const query = parseRentalInspectionPageQuery(value), before = await this.readOrderFacts(tenantId, orderId);
    if (typeof this.factStore.readInspectionFactsPage !== 'function') throw new ServiceUnavailableException('检查事实持久投影不可用');
    const page = await this.factStore.readInspectionFactsPage(tenantId, before.workspaceId, orderId, query);
    const after = await this.readOrderFacts(tenantId, orderId);
    if (requestFingerprint(before) !== requestFingerprint(after) || page.coverage !== 'page_not_total'
      || page.items.length > query.limit || new Set(page.items.map(row => row.id)).size !== page.items.length
      || page.items.some(row => row.tenantId !== tenantId || row.orderId !== orderId)
      || (page.nextCursor !== null && (page.items.length !== query.limit || page.nextCursor !== page.items.at(-1)?.id)))
      throw new ConflictException('检查事实读取期间来源或范围变化');
    return page;
  }

  async listInspectionsPage(tenantId: string, orderId: string, value: RentalInspectionPageQuery): Promise<RentalInspectionPage> {
    const query = parseRentalInspectionPageQuery(value), workspaceId = this.workspaceOf(tenantId);
    const order = await this.requireOrder(tenantId, orderId);
    if (order.id !== orderId || order.tenantId !== tenantId) throw new ForbiddenException('订单不属于当前租户');
    if (!this.factStore.listInspectionsPage) throw new ServiceUnavailableException('检查记录持久分页读取不可用');
    const page = structuredClone(await this.factStore.listInspectionsPage(tenantId, orderId, query));
    if (workspaceId !== this.workspaceOf(tenantId) || page.coverage !== 'page_not_total'
      || !Array.isArray(page.items) || page.items.length > query.limit
      || new Set(page.items.map(item => item.id)).size !== page.items.length
      || page.items.some(item => item.tenantId !== tenantId || item.orderId !== orderId)
      || (page.nextCursor !== null && (!page.items.length || page.nextCursor !== page.items[page.items.length - 1].id))) {
      throw new ServiceUnavailableException('检查记录分页来源不一致');
    }
    return page;
  }

  /** Bounded original inspection evidence in the caller-owned transaction.
   * Reuses the guarded order and persisted page; no template/config initialization,
   * inspection execution, liability or settlement. Owner supplies current fences. */
  async listInspectionsPageInTransaction(tenantId: string, orderId: string, value: RentalInspectionPageQuery,
    native: RentalFactTx, signal: AbortSignal, assertCurrent?: () => void): Promise<RentalInspectionPage> {
    const identity = getRequestIdentity();
    if (!identity?.workspaceId || identity.tenantId !== tenantId || !identity.userId || identity.isSaasAdmin
      || identity.audience !== 'operator' || !native || '$transaction' in native
      || typeof native.businessWorkspace?.findFirst !== 'function' || typeof native.rentalOrder?.findFirst !== 'function'
      || typeof native.rentalInspectionRecord?.findFirst !== 'function' || typeof native.rentalInspectionRecord?.findMany !== 'function'
      || typeof this.factStore.listInspectionsPage !== 'function') throw new ServiceUnavailableException('检查记录事务读取范围不可用');
    const binding = requestFingerprint(structuredClone(identity));
    const live = () => {
      if (signal.aborted || requestFingerprint(getRequestIdentity() ?? null) !== binding) throw new ForbiddenException('检查记录事务读取已停止或范围变化');
      assertCurrent?.();
    };
    live();
    const query = parseRentalInspectionPageQuery(value);
    const before = await this.getOrderInTransaction(tenantId, orderId, native, signal, live);
    live();
    // The scope resolver/cursor check await before the actual page. Revalidate at
    // delegate dispatch, so cancellation or callback closure cannot start it late.
    const guarded = <T extends object>(delegate: T) => new Proxy(delegate, { get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return (property === 'findFirst' || property === 'findMany') && typeof value === 'function'
        ? new Proxy(value, { apply(method, _owner, args) { live(); return Reflect.apply(method, target, args); } }) : value;
    } });
    const workspace = guarded(native.businessWorkspace), inspections = guarded(native.rentalInspectionRecord);
    const transaction = new Proxy(native, { get(target, property, receiver) {
      return property === 'businessWorkspace' ? workspace : property === 'rentalInspectionRecord' ? inspections : Reflect.get(target, property, receiver);
    } });
    const page = structuredClone(await this.factStore.listInspectionsPage(tenantId, orderId, query, transaction));
    live();
    if (page.coverage !== 'page_not_total' || !Array.isArray(page.items) || page.items.length > query.limit
      || new Set(page.items.map(item => item.id)).size !== page.items.length
      || page.items.some(item => item.tenantId !== tenantId || item.orderId !== orderId)
      || (page.nextCursor !== null && (page.items.length !== query.limit || page.nextCursor !== page.items.at(-1)?.id))) {
      throw new ServiceUnavailableException('检查记录分页来源不一致');
    }
    const after = await this.getOrderInTransaction(tenantId, orderId, native, signal, live);
    live();
    if (requestFingerprint(before) !== requestFingerprint(after)) throw new ServiceUnavailableException('检查记录关联订单已变化');
    return page;
  }

  async correctInspectionUsage(
    tenantId: string,
    orderId: string,
    inspectionId: string,
    input: CorrectRentalInspectionUsageRequest,
    operator: string,
    tx?: RentalFactTx
  ) {
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if ([RentalCoreOrderStatus.Completed, RentalCoreOrderStatus.Cancelled].includes(order.status)) {
      throw new ConflictException("已完成或已取消的订单不能修正使用量读数");
    }
    return this.factStore.correctInspectionUsage(tenantId, orderId, inspectionId, input, operator, tx);
  }

  /**
   * 办理检查并推进履约状态。
   *
   * `charges` 由控制器按订单报价预先算好后一次传入：迁库后每次「加载订单→改→存」都是一次
   * 独立事务，若仍像内存实现那样分成"建检查、加逾期费、加损坏费"三次调用，
   * 一个业务动作会拆成三个事务，中途失败就留下状态已推进但费用没记上的订单。
   */
  async createInspection(
    tenantId: string,
    orderId: string,
    input: CreateRentalInspectionRequest,
    userName: string,
    charges: {
      overdue?: { amount: number; returnedAt: string; batchId?: string; review?: { maximumAmount?: number; basis: string[] } };
      damage?: { amount: number; detail: string };
      /** 提前归还退款（需求 4.6.8）。`requiresReview` 时只记录不落账，等人工审批。 */
      earlyReturn?: { amount: number | null; maximumAmount?: number; requiresReview: boolean; basis: string[] };
      /** SHIP-01：按签收至客户交寄重算的租金差额。 */
      carrierRentalAdjustment?: { amount: number; signedAt: string; handoffAt: string; priceVersion?: string };
    } = {},
    tx?: RentalFactTx
  ) {
    const state = this.state(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    const stage = order.status === RentalCoreOrderStatus.ReadyForPickup ? "pickup" : order.status === RentalCoreOrderStatus.Renting ? "return" : undefined;
    const frozenTemplates = await this.listInspectionTemplates(tenantId, stage, order, tx, input.returnItems?.map(row => row.allocationId));
    const storedTemplate = frozenTemplates.find((row) => row.id === input.templateId && row.enabled);
    let template = storedTemplate ? structuredClone(storedTemplate) : undefined;
    if (!template) throw new NotFoundException("检查模板不存在或已停用");
    if (order.capabilityRequirementsSnapshot && !template.exchangeId) {
      if (!order.categoryVersionId || !this.categoryResolver) throw new ConflictException("历史条件检查缺少原品类执行依据");
      const inspectionCategory = await this.categoryResolver.forVersion(order.categoryCode, order.categoryVersionId, tx);
      const requested = input.returnItems?.length ? new Set(input.returnItems.map(item => item.allocationId)) : undefined;
      const inspectedLines = order.lines.filter(line => order.allocations.some(allocation => allocation.orderLineId === line.id &&
        (requested ? requested.has(allocation.id) : template!.allocationIds ? template!.allocationIds.includes(allocation.id)
          : template!.stage === "pickup" ? allocation.status === "locked" : allocation.status === "picked_up" || allocation.status === "locked" && allocation.metadata?.exchangeId)));
      template = snapshotInspectionTemplate(inspectionCategory, template, order.capabilityRequirementsSnapshot, capabilityRequirementRoots(inspectedLines));
    }
    assertInspectionObservations(template, input.results);
    assertInspectionRequiredResults(template, input.results);
    if (template.stage === "pickup" && order.status !== RentalCoreOrderStatus.ReadyForPickup) throw new ConflictException("订单尚未完成配货，不能办理取件检查");
    if (template.stage === "return" && order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以办理归还检查");
    if (input.returnItems?.length && template.stage !== "return") throw new BadRequestException("只有归还检查可以指定部分归还项");
    if (order.fulfillmentMode === "carrier_shipping" && template.stage === "return" && input.returnItems?.length) {
      throw new ConflictException("承运寄送订单必须在仓库实物验收时整单结算，不能通过部分归还提前释放在途库存");
    }
    const partialReturnItems = template.stage === "return" && input.returnItems?.length ? input.returnItems : undefined;
    const returnableAllocationIds = new Set(
      partialReturnItems?.map((item) => item.allocationId)
        ?? order.allocations.filter((allocation) => template.stage === "pickup"
          ? allocation.status === "locked"
          : allocation.status === "picked_up" || (allocation.status === "locked" && allocation.metadata?.exchangeId)).map((allocation) => allocation.id)
    );
    assertInspectionAllocationScope(template, [...returnableAllocationIds]);
    const replacementChange = template.exchangeId ? (await this.factStore.listOrderChanges(tenantId, order.id, tx)).find((row) => row.id === template.exchangeId) : undefined;
    const replacementBasis = replacementChange && exchangeBasis(replacementChange);
    if (template.exchangeId && (!replacementBasis || replacementBasis.categoryCode !== order.categoryCode
      || order.categoryVersionId && !replacementBasis.categoryVersionId)) throw new ConflictException("替换商品缺少原检查执行依据");
    const hookOrder = template.stage === "return" && (template.allocationIds || partialReturnItems) ? {
      ...order,
      lines: order.lines.filter((row) => order.allocations.some((allocation) => returnableAllocationIds.has(allocation.id) && allocation.orderLineId === row.id)),
      allocations: order.allocations.filter((row) => returnableAllocationIds.has(row.id)),
      reservations: order.reservations.filter((row) => order.allocations.some((allocation) => returnableAllocationIds.has(allocation.id) && allocation.orderLineId === row.orderLineId && allocation.itemGroupId === row.itemGroupId)),
      ...(replacementBasis ? { categoryVersionId: replacementBasis.categoryVersionId, capabilitySnapshot: replacementBasis.capabilitySnapshot,
        capabilityRequirementsSnapshot: replacementBasis.capabilityRequirementsSnapshot,
        lines: order.lines.filter(line => order.allocations.some(allocation => returnableAllocationIds.has(allocation.id) && allocation.orderLineId === line.id)).map(line => {
          const allocation = order.allocations.find(allocation => returnableAllocationIds.has(allocation.id) && allocation.orderLineId === line.id)!;
          if (!allocation.itemGroupId) throw new ConflictException("替换商品缺少实际型号依据");
          return { ...line, itemGroupId: allocation.itemGroupId, pricingGroupId: undefined, reservationPrecision: "exact_model" as const,
            itemGroupName: String(allocation.metadata?.itemGroupName ?? line.itemGroupName) };
        }),
        capabilityPolicy: replacementBasis.capabilitySnapshot?.length ? "snapshot" as const : "legacy_empty" as const } : {})
    } : order;
    const invalidExceptionAllocation = (input.exceptions ?? []).find(
      (exception) => exception.allocationId && !returnableAllocationIds.has(exception.allocationId)
    );
    if (invalidExceptionAllocation?.allocationId) {
      throw new ConflictException("异常关联的分配项不属于本次检查批次");
    }
    if (template.stage === "pickup") {
      const actualStartAt = order.fulfillmentMode === "carrier_shipping" ? input.carrierActualAt : undefined;
      const carrierDueAt = actualStartAt ? shiftedCarrierDueAt(order, actualStartAt) : undefined;
      if (order.fulfillmentMode === "carrier_shipping") {
        if (!actualStartAt) throw new ConflictException("承运寄送必须登记并核验客户实际签收时间，暂不自动起租");
        if (!carrierDueAt) throw new ConflictException("承运订单租期或签收时间无效，需人工核对后再办理起租");
      }
      // Match creation/extension lock ordering: customers, workspace, inventory.
      await this.assertOrderQualification(tenantId, order, "pickup", carrierDueAt ?? order.effectiveEndAt ?? order.endAt, tx);
      await this.assertOrderFulfillmentAdmission(tenantId, order, tx);
      if (actualStartAt && carrierDueAt) {
        await this.assertCarrierPickupWindowAvailable(tenantId, order, actualStartAt, carrierDueAt, tx);
        order.actualRentalStartAt = new Date(actualStartAt).toISOString();
        order.carrierRentalDueAt = carrierDueAt;
        order.effectiveEndAt = carrierDueAt;
      }
      await this.assertAllocatedPickupReady(tenantId, order, tx);
    }
    // 检查项校验通过后、写检查记录前判定。传入检查结果与异常项：能力要能据此
    // 给出提示或费用依据（例如按异常项主张损坏费依据），但不得自己改写订单金额。
    await this.runHook(
      tenantId,
      template.stage === "pickup" ? "pickup_delivery" : "return_inspection",
      { type: "order", id: order.id },
      { order: hookOrder, stage: template.stage, results: input.results, exceptions: input.exceptions ?? [], charges, partialReturn: partialReturnItems },
      tx,
      input.operator || userName,
      this.orderHookInstances(tenantId, hookOrder)
    );
    // Replacement baselines must cover the exact new allocation from the same
    // exchange. Legacy missing evidence never falls back to the original asset.
    const pickupRecords = template.stage === "return" ? await this.factStore.listInspections(tenantId, orderId, tx) : [];
    const matchingPickups = pickupRecords.filter(row => row.stage === "pickup" && (template.exchangeId
      ? row.exchangeId === template.exchangeId && [...returnableAllocationIds].every(allocationId => {
        const actual = order.allocations.find(allocation => allocation.id === allocationId);
        return row.pickupItems?.some(item => item.allocationId === allocationId && item.itemGroupId === actual?.itemGroupId
          && item.assetId === actual?.assetId && Number.isInteger(item.quantity) && actual.quantity > 0 && item.quantity >= actual.quantity);
      }) : !row.exchangeId));
    if (template.exchangeId && matchingPickups.length > 1) throw new ConflictException("换货领取基线不唯一，须核对原检查");
    const pickupBaseline = matchingPickups[0];
    const comparisons = template.stage === "return"
      ? template.fields.map((field) => ({
          fieldCode: field.code,
          baseline: pickupBaseline?.results[field.code],
          current: input.results[field.code],
          changed: JSON.stringify(pickupBaseline?.results[field.code]) !== JSON.stringify(input.results[field.code])
        }))
      : undefined;
    const usageFields = template.fields.filter((field) => field.usageMetric);
    const usageReadings = usageFields.flatMap((field) => {
      const current = optionalUsageReading(input.results[field.code], field.label);
      if (current === undefined) return [];
      const baselineReading = pickupBaseline?.usageReadings?.find((reading) => reading.fieldCode === field.code);
      const baseline = optionalUsageReading(baselineReading?.current ?? pickupBaseline?.results[field.code], `${field.label}领取基线`);
      return [{ fieldCode: field.code, baseline, current, delta: usageDelta(current, baseline) }];
    });
    const record: RentalInspectionRecord = {
      id: id("inspection"), tenantId, orderId, stage: template.stage, templateId: template.sourceTemplateId ?? template.id,
      exchangeId: template.exchangeId,
      templateCode: template.code, templateVersion: template.version, results: input.results,
      baselineInspectionId: pickupBaseline?.id,
      comparisons,
      usageReadings,
      returnedItems: partialReturnItems,
      exceptions: (input.exceptions ?? []).map((exception) => ({
        ...(template.stage === 'return' ? { id: randomUUID() } : {}),
        code: exception.code,
        description: exception.description,
        allocationId: exception.allocationId,
        suggestedChargeAmount: exception.chargeAmount,
        evidenceAttachments: exception.evidenceAttachments ?? input.attachments ?? [],
        reviewStatus: "pending" as const
      })),
      attachments: input.attachments ?? [], operator: input.operator || userName, createdAt: now()
    };
    const assetChanges: AssetStatusChange[] = [];
    let stockQuarantines: StockQuarantineChange[] = [];
    let stockTransfers: StockReturnTransfer[] = [];
    // 归还前的已释放量快照：隔离数量必须是"本批刚释放的量"，不是累计量。
    // 分批归还会多次进入这里，用累计量会把前几批已经放回可用池的数量再隔离一遍。
    const releasedBeforeReturn = new Map(order.reservations.map((row) => [row.id, row.releasedQuantity]));
    const returnedAllocationIdsBefore = new Set(
      (order.allocations ?? []).filter((allocation) => allocation.status === "returned" || allocation.status === "released").map((allocation) => allocation.id)
    );
    if (template.stage === "pickup") {
      await this.markPickedUp(tenantId, order, assetChanges, tx, input.operator || userName);
    } else {
      if (partialReturnItems) {
        const returnedIds = await this.applyPartialReturnItems(tenantId, state, order, partialReturnItems, tx, assetChanges);
        this.stampPartialReturnReceipts(order, partialReturnItems, returnedIds, input.returnBatchNo ?? record.id,
          charges.overdue?.returnedAt ?? record.createdAt);
        // 请求仍保留原分配 ID 参与幂等；检查和处置绑定本批拆出的实物，不能绑定剩余在租量。
        record.returnedItems = partialReturnItems.map(item => ({ ...item, allocationId: returnedIds.get(item.allocationId)! }));
        record.exceptions = record.exceptions.map(exception => ({ ...exception,
          allocationId: exception.allocationId ? returnedIds.get(exception.allocationId)! : undefined }));
      } else {
        this.finishReturn(order, 0, assetChanges);
      // 整单归还后订单进入待结算，`payOrderExtension` 会因状态拒绝生效——
      // 遗留的待补款续租就此作废，不再显示补款入口也不再计入待收。
      await this.voidPendingExtensions(tenantId, orderId, tx);
      }
      if (this.hasReturnHold(order)) {
        // 有异常的序列化资产先进入维护，不能在工单处理前重新出租。
        for (const change of assetChanges) change.status = RentalAssetStatus.Maintenance;
        // 数量库存此前完全没有对应处理：预占一释放，数量就回到可用池，下一单就能把
        // 坏的租出去。序列化资产靠上面这行进维护，数量库存必须靠维修量隔离。
      }
      // 逾时按本批实际归还数量落账；提前归还退款仍只在整单归还时按规则处理。
      if (charges.overdue) this.applyOverdueTo(order, charges.overdue.amount, charges.overdue.returnedAt, charges.overdue.batchId, charges.overdue.review);
      if (!partialReturnItems && charges.earlyReturn) this.applyEarlyReturnRefundTo(order, charges.earlyReturn);
      if (!partialReturnItems && charges.carrierRentalAdjustment) this.applyCarrierRentalAdjustmentTo(order, charges.carrierRentalAdjustment);
      // 检查员提交的是损失建议，不能直接决定客户应付；审核通过后才追加订单费用。
    }
    order.updatedAt = now();
    // 检查记录与订单状态推进必须同事务：分两次写时中途失败会留下
    // "检查已记录、订单未推进"的中间态。
    await this.factStore.insertInspection(record, tx);
    if (template.stage === "return") {
      const returnBatchKey = input.returnBatchNo ?? record.id;
      const scopedExceptionReasons = record.exceptions.length && record.exceptions.every((exception) => exception.allocationId)
        ? new Map(record.exceptions.map((exception) => [exception.allocationId!, `${exception.code}；${exception.description}`]))
        : undefined;
      const dispositionReason = input.exceptions?.length && !scopedExceptionReasons
        ? input.exceptions
          .flatMap((exception) => [exception.code, exception.description])
          .filter((value): value is string => Boolean(value?.trim()))
          .join("；") || "归还检查发现异常"
        : undefined;
      await this.recordReturnDispositions(
        tenantId,
        state,
        order,
        record.id,
        returnBatchKey,
        releasedBeforeReturn,
        dispositionReason,
        tx,
        input.operator || userName,
        returnedAllocationIdsBefore,
        assetChanges,
        scopedExceptionReasons
      );
      stockQuarantines = this.quarantinedReturnQuantities(state, order, releasedBeforeReturn, returnBatchKey, record.id, input.operator || userName, dispositionReason, scopedExceptionReasons, returnedAllocationIdsBefore);
      stockTransfers = this.returnStockTransfers(state, order, releasedBeforeReturn, returnBatchKey, record.id, input.operator || userName);
    }
    await this.factStore.saveOrderAggregate(order, assetChanges, tx, stockQuarantines, stockTransfers);
    return { inspection: record, order };
  }

  /**
   * 往在途订单上追加一笔费用明细。
   *
   * 四步是既有约定：按 code 去重 → 推明细 → 累加 `adjustmentAmount` →
   * 由 `payableAmount + adjustmentAmount` **重算** `finalPayableAmount`。
   * `payableAmount` 是报价冻结值，永远不动；`finalPayableAmount` 永远是重算而不是累加。
   *
   * 去重键就是 `code` 本身，因此**每一种可能重复发生的费用都必须带判别符**——
   * 逾期一单一次，用 orderId 够了；续租一单可以多次，必须带序号。
   *
   * 金额允许为负：提前归还退款走同一条路，负值让 `finalPayableAmount` 自然减少。
   * 取整统一用 `roundMoney`（带 `Number.EPSILON`），此前这四处各写一遍裸
   * `Math.round(v * 100) / 100`，恰好全落在最该稳的两个字段上。
   */
  private applyChargeTo(order: RentalOrder, line: RentalOrder["chargeLines"][number]) {
    if (!Number.isFinite(line.amount) || !Number.isFinite(order.adjustmentAmount) || !Number.isFinite(order.payableAmount)
      || !Number.isFinite(order.adjustmentAmount + line.amount) || !Number.isFinite(order.payableAmount + order.adjustmentAmount + line.amount)) {
      throw new BadRequestException("费用及订单金额必须为有限数字，不能写入无效账目");
    }
    // 与报价一致：先舍入每条明细，再汇总；不能累计舍入却保存原始半分金额。
    const amount = roundMoney(line.amount);
    if (amount === 0 || order.chargeLines.some((row) => row.code === line.code)) return false;
    const nextAdjustment = roundMoney(order.adjustmentAmount + amount);
    const nextPayable = roundMoney(order.payableAmount + nextAdjustment);
    const nextTax = inclusiveTaxAmount(nextPayable, order.taxRate ?? 0);
    if (![nextAdjustment, nextPayable, nextTax].every(Number.isFinite)) {
      throw new BadRequestException("费用重算超出有效金额范围，不能写入无效账目");
    }
    order.chargeLines.push({ ...line, amount });
    order.adjustmentAmount = nextAdjustment;
    order.finalPayableAmount = nextPayable;
    order.totalAmount = order.finalPayableAmount;
    // 价内税跟着最终应付重算：逾期费、损坏费、续租费、提前归还退款都会改含税总额，
    // 税额不跟着走的话，报表里「不含税收入 + 税额」凑不回实收。
    order.taxAmount = nextTax;
    return true;
  }

  /**
   * 押金与预授权是订单上的独立标量字段（不是费用明细），任何增减都必须走这里：
   * 统一 `roundMoney` 取整并在 0 处封底。此前四处各自裸写 `roundMoney(x + delta)`
   * 或 `Math.max(0, roundMoney(...))`，其中部分取消那两处漏了封底——负 delta 叠加
   * 出负押金就会被当成"倒欠客户"。收敛成一处后，续租的保证金增额逻辑（走资金侧
   * 续租明细，不改这两个字段）保持不变。
   */
  private applySecurityDeltaTo(order: RentalOrder, delta: { deposit?: number; preAuth?: number }) {
    if (delta.deposit !== undefined) order.depositAmount = Math.max(0, roundMoney(order.depositAmount + delta.deposit));
    if (delta.preAuth !== undefined) order.preAuthAmount = Math.max(0, roundMoney(order.preAuthAmount + delta.preAuth));
  }

  /** 订单的续租记录，按序号升序。订单详情与幂等重放都读它。 */
  async listOrderExtensions(tenantId: string, orderId: string, tx?: RentalFactTx) {
    this.state(tenantId);
    return this.factStore.listExtensions(tenantId, orderId, tx);
  }

  /** 订单变更历史只读；原订单与原报价快照不从这里重写。 */
  async listOrderChanges(tenantId: string, orderId: string, tx?: RentalFactTx) {
    this.state(tenantId);
    return this.factStore.listOrderChanges(tenantId, orderId, tx);
  }

  /**
   * ORDER-CHANGE-01A/01B：应用一次取货前部分取消。
   *
   * 这条内核只负责把已在控制器完成的重算结果与订单资源放进同一事务：
   * - 原始行的 quantity / unitPrice / amount 不改，只写 cancelledQuantity；
   * - 预占、分配、资产状态、订单差额和变更历史一起提交；
   * - 正差额或新增保证金本轮拒绝，避免“订单已变更但还没收钱”；
   * - 同一订单首期只允许一笔部分取消；本轮仅扩展数量库存和一次性耗材的数量拆分，序列化资产仍整行处理。
   */
  async applyPartialLineCancellation(
    tenantId: string,
    orderId: string,
    priced: RentalOrderExtensionPreview & { rateSnapshot: RentalPricingRate[]; ruleSnapshot: RentalRuleConfig },
    input: { type: "partial_line_cancel" | "service_cancel"; lineIds?: string[]; items?: Array<{ lineId: string; quantity: number }>; serviceOccurrenceIds?: string[]; serviceItems?: ServiceCancellationSelection[]; reason: string; customerConfirmed: boolean; expectedUpdatedAt: string },
    idempotencyKey: string,
    operator: string,
    tx: RentalFactTx
  ): Promise<{ order: RentalOrder; change: RentalOrderChange }> {
    this.state(tenantId);
    if (!input.customerConfirmed) throw new ConflictException("必须先取得客户确认才能应用订单变更");
    if (!input.reason?.trim()) throw new BadRequestException("订单变更原因不能为空");
    const order = await this.lockedOrder(tenantId, orderId, tx);
    await this.assertCarrierOrderResourcesMutable(tenantId, order, tx, true);
    if (![RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(order.status)) {
      throw new ConflictException("只有取货前的待确认或待领取订单可以部分取消");
    }
    if (order.updatedAt !== input.expectedUpdatedAt) {
      throw new ConflictException("订单已发生变化，请重新试算后再提交");
    }
    if (priced.orderId !== order.id || Date.parse(priced.newEndAt) !== Date.parse(order.endAt)) {
      throw new ConflictException("订单变更试算基准已失效，请重新试算");
    }
    if (input.type === "partial_line_cancel" && order.effectiveEndAt && Date.parse(order.effectiveEndAt) !== Date.parse(order.endAt)) {
      throw new ConflictException("已有生效续租的订单不能在本轮部分取消，请人工处理");
    }
    if (input.type === "partial_line_cancel" && order.serviceSnapshots?.length) {
      throw new ConflictException("已包含增值服务的订单暂不能自动部分取消，请人工处理服务释放与退款");
    }
    if (input.type === "partial_line_cancel" && order.adjustmentAmount !== 0) {
      throw new ConflictException("订单已有其他费用调整，请先完成现有调整后再部分取消");
    }
    const previousChanges = await this.factStore.listOrderChanges(tenantId, orderId, tx);
    if (previousChanges.some((row) => row.status === "applied")) {
      throw new ConflictException("本轮一个订单只允许一次整行部分取消，后续拆分变更请使用专用变更流程");
    }
    if (input.type === "service_cancel") {
      return this.applyServiceCancellation(tenantId, order, priced, {
        type: "service_cancel",
        serviceOccurrenceIds: input.serviceOccurrenceIds,
        serviceItems: input.serviceItems,
        reason: input.reason,
        customerConfirmed: input.customerConfirmed,
        expectedUpdatedAt: input.expectedUpdatedAt
      }, previousChanges, idempotencyKey, operator, tx);
    }
    const activeLines = order.lines.filter((line) => (line.cancelledQuantity ?? 0) < line.quantity);
    const cancellationItems = (input.items ?? []).map((item) => ({ lineId: item.lineId.trim(), quantity: Number(item.quantity) }));
    if (!cancellationItems.length || cancellationItems.some((item) => !item.lineId || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
      throw new BadRequestException("请选择有效的订单行和取消数量");
    }
    if (new Set(cancellationItems.map((item) => item.lineId)).size !== cancellationItems.length) throw new BadRequestException("同一订单行只能出现一次");
    const selected = activeLines.filter((line) => cancellationItems.some((item) => item.lineId === line.id));
    if (selected.length !== cancellationItems.length) throw new ConflictException("存在无效、已取消或不属于当前订单的订单行");
    for (const item of cancellationItems) {
      const line = selected.find((row) => row.id === item.lineId)!;
      const activeQuantity = line.quantity - (line.cancelledQuantity ?? 0);
      if (item.quantity > activeQuantity) throw new ConflictException(`${line.itemGroupName}最多可取消 ${activeQuantity} 件`);
      if (!["quantity", "consumable"].includes(line.inventoryMode) && item.quantity !== activeQuantity) throw new ConflictException(`${line.itemGroupName}是序列化资产，本轮只能整行取消`);
      const availableReservation = order.reservations
        .filter((row) => row.orderLineId === line.id && !["released", "expired", "cancelled"].includes(row.status))
        .reduce((sum, row) => sum + row.quantity - row.releasedQuantity, 0);
      if (availableReservation < item.quantity) throw new ConflictException(`${line.itemGroupName}的可释放预占数量不足`);
    }
    const activeTotal = activeLines.reduce((sum, line) => sum + line.quantity - (line.cancelledQuantity ?? 0), 0);
    const cancelledTotal = cancellationItems.reduce((sum, item) => sum + item.quantity, 0);
    if (cancelledTotal >= activeTotal) throw new ConflictException("整单取消请使用订单取消操作，部分取消必须保留至少一件有效商品");
    const lineIds = cancellationItems.map((item) => item.lineId);
    if (order.reservations.some((row) => lineIds.includes(row.orderLineId) && row.releasedQuantity > 0)) {
      throw new ConflictException("已有部分归还或释放记录的订单行不能自动部分取消");
    }

    const differenceAmount = roundMoney(priced.pricingSnapshot?.differenceAmount ?? priced.payableAmount);
    const depositDelta = roundMoney(priced.depositDelta);
    const preAuthDelta = roundMoney(priced.preAuthDelta);
    if (differenceAmount > 0.005 || depositDelta > 0.005 || preAuthDelta > 0.005) {
      throw new ConflictException("本次取消会产生补款或新增保证金，暂不能自动应用，请人工核价");
    }

    const beforeSnapshot: Record<string, unknown> = {
      updatedAt: order.updatedAt,
      status: order.status,
      payableAmount: order.payableAmount,
      finalPayableAmount: order.finalPayableAmount,
      adjustmentAmount: order.adjustmentAmount,
      depositAmount: order.depositAmount,
      preAuthAmount: order.preAuthAmount,
      lines: order.lines.map((line) => ({ id: line.id, quantity: line.quantity, cancelledQuantity: line.cancelledQuantity ?? 0, amount: line.amount })),
      reservations: order.reservations.filter((row) => lineIds.includes(row.orderLineId)).map((row) => ({ id: row.id, quantity: row.quantity, releasedQuantity: row.releasedQuantity, status: row.status })),
      allocations: order.allocations.filter((row) => lineIds.includes(row.orderLineId)).map((row) => ({ id: row.id, quantity: row.quantity, status: row.status, assetId: row.assetId }))
    };

    const selectedAllocations = order.allocations.filter((row) => lineIds.includes(row.orderLineId));
    const allocationBefore = structuredClone(selectedAllocations);
    const requestedByLine = new Map(cancellationItems.map((item) => [item.lineId, item.quantity]));
    // 套装只允许整行取消；按本单冻结的每个组件预占释放，父套数不是组件数量。
    const bundleLineIds = new Set(selected.filter(line => line.inventoryMode === RentalInventoryMode.Bundle).map(line => line.id));
    const reservationRemaining = new Map(requestedByLine);
    for (const reservation of order.reservations) {
      if (!lineIds.includes(reservation.orderLineId) || ["released", "expired", "cancelled"].includes(reservation.status)) continue;
      if (bundleLineIds.has(reservation.orderLineId)) {
        reservation.releasedQuantity = reservation.quantity;
        reservation.status = RentalReservationStatus.Released;
        reservationRemaining.set(reservation.orderLineId, 0);
        continue;
      }
      const remaining = reservationRemaining.get(reservation.orderLineId) ?? 0;
      if (remaining <= 0) continue;
      const release = Math.min(remaining, reservation.quantity - reservation.releasedQuantity);
      reservation.releasedQuantity += release;
      reservationRemaining.set(reservation.orderLineId, remaining - release);
      if (reservation.releasedQuantity >= reservation.quantity) reservation.status = RentalReservationStatus.Released;
    }
    if ([...reservationRemaining.values()].some((quantity) => quantity > 0)) throw new ConflictException("订单预占数量不足，不能安全释放");
    const allocationRemaining = new Map(requestedByLine);
    for (const allocation of order.allocations) {
      if (bundleLineIds.has(allocation.orderLineId) && ["pre_assigned", "locked", "allocated"].includes(allocation.status)) {
        allocation.status = "released";
        allocationRemaining.set(allocation.orderLineId, 0);
        continue;
      }
      const remaining = allocationRemaining.get(allocation.orderLineId) ?? 0;
      if (remaining <= 0 || !["pre_assigned", "locked", "allocated"].includes(allocation.status)) continue;
      const release = Math.min(remaining, allocation.quantity);
      if (release === allocation.quantity) allocation.status = "released";
      else {
        if (allocation.assetId) throw new ConflictException("序列化资产不能拆分分配数量，请按整行取消");
        allocation.quantity -= release;
      }
      allocationRemaining.set(allocation.orderLineId, remaining - release);
    }
    for (const item of cancellationItems) {
      const hasActiveAllocation = order.allocations.some((row) => row.orderLineId === item.lineId && ["pre_assigned", "locked", "allocated"].includes(row.status));
      if (hasActiveAllocation && (allocationRemaining.get(item.lineId) ?? 0) > 0) throw new ConflictException("已分配资源数量不足，请重新配货后再部分取消");
    }
    for (const line of order.lines) {
      const quantity = requestedByLine.get(line.id);
      if (quantity !== undefined) line.cancelledQuantity = (line.cancelledQuantity ?? 0) + quantity;
    }
    const assets = await this.factStore.listAssets(tenantId, tx);
    const otherAllocatedAssetIds = await this.factStore.allocatedAssetIds(tenantId, tx, order.id);
    const releasableAssetIds = new Set(
      allocationBefore
        .filter((row) => row.assetId && ["pre_assigned", "locked", "allocated"].includes(row.status))
        .filter((row) => order.allocations.find((after) => after.id === row.id)?.status === "released")
        .map((row) => row.assetId as string)
    );
    const assetChanges: AssetStatusChange[] = assets
      .filter((asset) => releasableAssetIds.has(asset.id) && asset.status === RentalAssetStatus.Reserved && !otherAllocatedAssetIds.has(asset.id))
      .map((asset) => ({ assetId: asset.id, status: RentalAssetStatus.Available, reason: `订单 ${order.orderNo} 部分取消释放资源`, operator }));
    if (order.status === RentalCoreOrderStatus.ReadyForPickup && !allocationComplete(order, true)) {
      order.status = RentalCoreOrderStatus.Reserved;
    }
    const at = now();
    const previousAssignment = order.assignment;
    const history = previousAssignment?.history ?? [];
    order.assignment = {
      revision: (previousAssignment?.revision ?? 0) + 1,
      issue: previousAssignment?.issue,
      operationLock: previousAssignment?.operationLock,
      history: [...history, {
        id: randomUUID(), at, actor: operator, action: "order_change_partial_cancel", reason: input.reason.trim(),
        before: allocationBefore,
        after: structuredClone(order.allocations.filter((row) => lineIds.includes(row.orderLineId)))
      }]
    };
    this.applyChargeTo(order, {
      code: `order-change:${previousChanges.length + 1}`,
      name: "订单部分取消差额",
      type: "order_change",
      amount: differenceAmount,
      sourceVersion: priced.priceVersion ?? priced.ruleVersion,
      detail: input.reason.trim()
    });
    this.applySecurityDeltaTo(order, { deposit: depositDelta, preAuth: preAuthDelta });
    order.updatedAt = at;

    const afterSnapshot: Record<string, unknown> = {
      updatedAt: order.updatedAt,
      status: order.status,
      payableAmount: order.payableAmount,
      finalPayableAmount: order.finalPayableAmount,
      adjustmentAmount: order.adjustmentAmount,
      depositAmount: order.depositAmount,
      preAuthAmount: order.preAuthAmount,
      lines: order.lines.map((line) => ({ id: line.id, quantity: line.quantity, cancelledQuantity: line.cancelledQuantity ?? 0, amount: line.amount })),
      reservations: order.reservations.filter((row) => lineIds.includes(row.orderLineId)).map((row) => ({ id: row.id, quantity: row.quantity, releasedQuantity: row.releasedQuantity, status: row.status })),
      allocations: order.allocations.filter((row) => lineIds.includes(row.orderLineId)).map((row) => ({ id: row.id, quantity: row.quantity, status: row.status, assetId: row.assetId }))
    };
    const change: RentalOrderChange = {
      id: randomUUID(), tenantId, workspaceId: this.resolveWorkspaceId(tenantId), orderId: order.id,
      sequence: previousChanges.length + 1, type: "partial_line_cancel", status: "applied",
      request: { ...input, lineIds, items: cancellationItems.map((item) => ({ lineId: item.lineId, quantity: item.quantity })) }, beforeSnapshot, afterSnapshot,
      diff: {
        lineIds,
        items: cancellationItems.map((item) => ({ lineId: item.lineId, quantity: item.quantity })),
        differenceAmount, refundAmount: Math.max(0, -differenceAmount), additionalAmount: Math.max(0, differenceAmount),
        depositDelta, preAuthDelta, pricingSnapshot: priced.pricingSnapshot ?? null,
        releasedAssetIds: assetChanges.map((row) => row.assetId)
      },
      refundAmount: roundMoney(Math.max(0, -differenceAmount)),
      additionalAmount: roundMoney(Math.max(0, differenceAmount)),
      depositDelta, preAuthDelta, idempotencyKey, requestedBy: operator, appliedBy: operator,
      requestedAt: at, appliedAt: at, createdAt: at
    };
    await this.factStore.saveOrderAggregate(order, assetChanges, tx);
    await this.factStore.insertOrderChange(change, tx);
    if (change.refundAmount > 0) await this.releaseReducedCredit(order, { kind: "change", id: change.id }, tx, operator);
    return { order, change };
  }

  /** 原订单操作权限下的当前服务选项，不授目录维护或容量编辑权限。 */
  async exchangeServiceOptions(tenantId: string, orderId: string, tx: RentalFactTx) {
    const order = await this.lockOrderForUpdate(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以选择换货服务");
    if (!this.businessConfigStore?.readServicesForExchange) throw new ConflictException("换货当前服务权威未装配");
    return (await this.businessConfigStore.readServicesForExchange(tenantId, this.resolveWorkspaceId(tenantId), tx))
      .filter(row => row.status === "enabled");
  }

  /** Inspect only original completed uploads under the current transaction;
   * client references cannot confer file ownership or a completed upload. */
  private async assertExchangePickupFiles(tenantId: string, order: RentalOrder, ids: string[], signatureId: string | undefined,
    batchId: string, tx: RentalFactTx, preparedMedia?: Array<{ side: "original_return" | "replacement_pickup"; fileAssetId: string; contentHash: string }>) {
    const identity = getRequestIdentity();
    if (identity?.staffApi && !signatureId) throw new BadRequestException("员工端换货领取须客户现场签字");
    if (!ids.length) return;
    if (ids.length > 50 || ids.some(value => value.length > 191)) throw new BadRequestException("换货检查凭证引用无效或超限");
    const files = await tx.$queryRaw<Array<{ id: string; tenantId: string; status: string; businessModule: string; businessType: string;
      businessId: string | null; mimeType: string; uploadedBy: string | null; uploadScene: string;
      storageProvider: string; storageKey: string; checksum: string | null; metadata: unknown }>>(Prisma.sql`
      SELECT * FROM FileAsset WHERE tenantId = ${tenantId} AND id IN (${Prisma.join([...ids].sort())}) ORDER BY id LOCK IN SHARE MODE
    `);
    if (files.length !== ids.length || new Set(files.map(file => file.id)).size !== ids.length) throw new BadRequestException("换货检查凭证未完成或不属于本订单");
    for (const file of files) {
      const metadata = file.metadata && typeof file.metadata === "object" && !Array.isArray(file.metadata)
        ? file.metadata as Record<string, unknown> : {};
      const dedicated = file.uploadScene === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE
        && preparedMedia?.some(row => row.side === "replacement_pickup" && row.fileAssetId === file.id && row.contentHash === frozenFileContentHash(file));
      if (!ids.includes(file.id) || file.tenantId !== tenantId || file.status !== "active"
        || file.businessModule !== "rental-core" || file.businessType !== "rental_order" || file.businessId !== order.id
        || metadata.workspaceId !== this.resolveWorkspaceId(tenantId)
        || !["pickup-evidence", "handover-signature"].includes(file.uploadScene) && !dedicated
        || !file.mimeType.startsWith("image/") && !file.mimeType.startsWith("video/") || !frozenFileContentHash(file)) {
        throw new BadRequestException("换货检查须使用本空间、本订单已冻结的领取影像凭证");
      }
      if (file.id === signatureId && (file.uploadScene !== "handover-signature" || metadata.handoverStage !== "pickup"
        || metadata.handoverBatchId !== batchId || metadata.handoverLocationId !== order.fulfillmentLocationId)) {
        throw new BadRequestException("换货签字与本次领取批次或地点不一致");
      }
      if (identity?.staffApi && (file.uploadedBy !== identity.userId || metadata.uploadedByUserId !== identity.userId
        || metadata.handoverStage !== "pickup" || metadata.handoverBatchId !== batchId
        || metadata.handoverLocationId !== order.fulfillmentLocationId)) throw new BadRequestException("换货影像与当前员工或领取批次不一致");
    }
  }

  /**
   * ORDER-CHANGE-01E：取货后换货。
   *
   * 预览只提供金额与候选事实；这里在订单锁内重新验证状态、完整订单行、库存、
   * 旧物处置与客户确认，再把旧资源释放、新资源锁定、服务释放、差额和追加变更
   * 记录写进同一事务。正差额只追加订单变更费用，资金仍留到归还结算；负差额挂
   * 退款审核，绝不直接伪造退款成功。
   */
  async applyPostPickupExchange(
    tenantId: string,
    orderId: string,
    priced: RentalOrderChangePreview,
    input: {
      type: "post_pickup_exchange";
      orderLineId?: string;
      allocationId?: string;
      replacementItemGroupId?: string;
      replacementAssetId?: string;
      replacementPricingGroupId?: string;
      priceBasis?: RentalOrderExchangePriceBasis;
      originalDisposition?: RentalOrderExchangeDisposition;
      exchangeLocationId?: string;
      inspectionSnapshot?: RentalOrderExchangeInspectionSnapshot;
      cancelServiceOccurrenceIds?: string[];
      services?: RentalQuoteRequest["services"];
      serviceConfirmationHash?: string;
      replacementPickupInspection?: RentalExchangePickupInspectionRequest;
      reason: string;
      customerConfirmed: boolean;
      expectedUpdatedAt: string;
    },
    idempotencyKey: string,
    operator: string,
    tx: RentalFactTx,
    approvalAuthority?: ApprovedExchangeAuthority
  ): Promise<{ order: RentalOrder; change: RentalOrderChange }> {
    if (!input.customerConfirmed) throw new ConflictException("必须先取得客户确认才能应用换货");
    if (!input.reason?.trim()) throw new BadRequestException("换货原因不能为空");
    if (!input.inspectionSnapshot?.customerConfirmed) throw new ConflictException("换货检查必须取得客户确认");
    const state = await this.factContext(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以办理取货后换货");
    // The extra path is an in-process authority issued only after Core verifies
    // the exact approval/consent/preparation in this transaction. A body flag or
    // the original booking approval cannot replace the ordinary spending gate.
    const approved = approvalAuthority ? approvedExchangeEvidence(approvalAuthority, tx, tenantId, this.resolveWorkspaceId(tenantId), order,
      priced, input, idempotencyKey) : undefined;
    if (priced.additionalAmount > 0 && !approved) await this.assertEnterpriseNewExpense(tenantId, order, tx, priced.additionalAmount);
    if (order.updatedAt !== input.expectedUpdatedAt) throw new ConflictException("订单已发生变化，请重新试算换货费用");
    if (!hasOriginalRentalCurrency(order.currency, priced.currency)) throw new ConflictException("换货币种与原订单不一致或缺失，不能追加其他币种金额");
    if (!priced.exchange || priced.exchange.orderLineId !== input.orderLineId || priced.exchange.allocationId !== input.allocationId) {
      throw new ConflictException("换货试算基准已失效，请重新试算");
    }
    const exchange = priced.exchange;
    const line = order.lines.find((row) => row.id === input.orderLineId);
    const allocation = order.allocations.find((row) => row.id === input.allocationId);
    if (!line || !allocation || allocation.orderLineId !== line.id || allocation.status !== "picked_up") {
      throw new ConflictException("所选商品已归还、已换过或不属于当前订单");
    }
    const activeQuantity = line.quantity - (line.cancelledQuantity ?? 0);
    if (allocation.quantity !== activeQuantity) throw new ConflictException("本轮只能整行换货，不能拆换部分数量");
    if (exchange.replacementItemGroupId !== input.replacementItemGroupId || exchange.replacementPricingGroupId !== (input.replacementPricingGroupId ?? exchange.replacementPricingGroupId)) throw new ConflictException("换货目标已变化，请重新试算");
    const replacement = this.group(state, input.replacementItemGroupId!);
    if (replacement.inventoryMode !== line.inventoryMode) throw new ConflictException("换货前后库存方式必须一致");
    if (replacement.inventoryMode === RentalInventoryMode.Bundle || replacement.inventoryMode === RentalInventoryMode.Consumable) throw new ConflictException("套装和一次性耗材暂不支持取货后换货");
    const locationId = input.exchangeLocationId ?? order.fulfillmentLocationId;
    if (locationId !== order.fulfillmentLocationId) throw new ConflictException("首期换货必须在订单领取地点办理");
    if (input.originalDisposition !== exchange.originalDisposition || input.priceBasis !== exchange.priceBasis) throw new ConflictException("换货价格或旧物处置选择已变化，请重新试算");

    const dueAt = order.effectiveEndAt ?? order.endAt;
    const basis = exchange.executionBasis;
    if (!basis || !basis.linePricing || basis.linePricing.version !== 1 || basis.linePricing.orderLineId !== line.id
      || basis.priceBasis !== exchange.priceBasis || basis.linePricing.originalAmount !== exchange.originalAmount
      || basis.linePricing.replacementAmount !== exchange.replacementAmount) {
      throw new ConflictException("换货缺少冻结的稳定行剩余计价依据");
    }
    assertExchangePricingSegments(basis.linePricing.previousSegments, line.id, allocation.quantity,
      order.startAt, dueAt, exchange.originalAmount);
    assertExchangePricingSegments(basis.linePricing.segments, line.id, allocation.quantity,
      order.startAt, dueAt, exchange.replacementAmount);
    assertExchangeMembershipPricing(basis.linePricing);
    assertExchangeCouponPricing(basis.linePricing);
    assertExchangeDiscountPricing(basis.linePricing);
    const marketing = basis.linePricing.discountPricing;
    const discountDelta = marketing ? roundMoney(marketing.replacementReduction - marketing.originalReduction) : 0;
    const membership = basis.linePricing.membershipPricing;
    const coupon = basis.linePricing.couponPricing;
    const membershipDelta = membership ? roundMoney(membership.replacementReduction - membership.originalReduction) : 0;
    const couponDelta = coupon ? roundMoney(coupon.replacementReduction - coupon.originalReduction) : 0;
    const overdueBasis = basis.linePricing.overdueBasis;
    if (!overdueBasis) throw new ConflictException("换货缺少已计费单位与逾期来源");
    assertExchangePricingSegments([overdueBasis], line.id, allocation.quantity, overdueBasis.startAt, overdueBasis.endAt, overdueBasis.amount);
    if (overdueBasis.itemGroupId !== replacement.id || overdueBasis.pricingGroupId !== exchange.replacementPricingGroupId
      || roundMoney(priced.differenceAmount) !== roundMoney(priced.pricingSnapshot?.differenceAmount ?? priced.differenceAmount)) {
      throw new ConflictException("换货计价与替换商品或差额不一致");
    }
    const replacementOrder: RentalOrder = { ...order,
      lines: [{ ...line, itemGroupId: replacement.id, itemGroupCode: replacement.code, itemGroupName: replacement.name,
        pricingGroupId: undefined, reservationPrecision: "exact_model" }],
      categoryVersionId: basis.categoryVersionId, ruleSnapshot: basis.ruleSnapshot,
      capabilityRequirementsSnapshot: basis.capabilityRequirementsSnapshot,
      capabilitySnapshot: basis.capabilitySnapshot, capabilityPolicy: basis.capabilitySnapshot?.length ? "snapshot" : "legacy_empty"
    };
    if (basis.capabilityRequirementsSnapshot) await validateQuotedCapabilityRequirements(tx, this.workspaceOf(tenantId), {
      tenantId, categoryCode: basis.categoryCode, categoryVersionId: basis.categoryVersionId,
      request: { fulfillmentMode: order.fulfillmentMode, lines: [{ itemGroupId: replacement.id, quantity: allocation.quantity }] },
      capabilityRequirementsSnapshot: basis.capabilityRequirementsSnapshot, capabilitySnapshot: basis.capabilitySnapshot
    });
    await this.assertOrderQualification(tenantId, replacementOrder, "pickup", dueAt, tx);
    await this.assertOrderFulfillmentAdmission(tenantId, order, tx);
    if (!this.businessConfigStore?.readServicesForExchange) throw new ConflictException("换货当前服务权威未装配，不能略过强制服务");
    const services = await this.businessConfigStore.readServicesForExchange(tenantId, this.resolveWorkspaceId(tenantId), tx);
    const serviceContext = {
      itemGroupIds: order.lines.filter(row => (row.cancelledQuantity ?? 0) < row.quantity)
        .map(row => row.id === line.id ? replacement.id : row.itemGroupId),
      fulfillmentMode: order.fulfillmentMode,
      locationIds: [order.fulfillmentLocationId, order.returnLocationId].filter((id): id is string => Boolean(id)),
      customerType: order.customerType, startAt: basis.effectiveFrom, endAt: dueAt,
      timeZone: basis.linePricing.segments.at(-1)!.context.timeZone,
      rentalAmount: roundMoney(order.lines.reduce((sum, row) => sum + (row.id === line.id ? exchange.replacementAmount : row.amount), 0)),
      workspaceId: this.resolveWorkspaceId(tenantId)
    };
    const resolvedServices = resolveExchangeServices(services, serviceContext, order.serviceSnapshots ?? [],
      input.cancelServiceOccurrenceIds ?? [], input.services ?? []);
    const serviceHash = exchangeServiceConfirmationHash({ orderId, expectedUpdatedAt: order.updatedAt, orderLineId: line.id,
      replacementItemGroupId: replacement.id, cancelledIds: input.cancelServiceOccurrenceIds ?? [] }, resolvedServices.snapshots);
    if (resolvedServices.snapshots.length && (input.serviceConfirmationHash !== serviceHash
      || exchange.serviceConfirmationHash !== serviceHash)) throw new ConflictException("新服务价格或条款已变化，须重新试算并取得客户确认");
    const exchangeId = randomUUID();
    const serviceRequestKey = `exchange:${exchangeId}`;
    const newServiceOccurrences = stampOccurrences(resolvedServices.snapshots, {
      origin: "exchange", ownerId: exchangeId, exchangeId, requestKey: serviceRequestKey
    }).map(row => ({ ...row, customerConfirmedAt: basis.effectiveFrom, customerConfirmationRecordedBy: operator,
      customerConfirmationChannel: "admin_recorded" as const }));
    const retainedServices = assertExchangeServices(services, serviceContext,
      [...(order.serviceSnapshots ?? []), ...newServiceOccurrences], input.cancelServiceOccurrenceIds ?? [])
      .filter(row => row.exchangeId !== exchangeId);
    // 统一强制门已由原发生项+新增项核对；原容量与被取消容量都须来自本单确认收据。
    const cancelledCapacityServices = (order.serviceSnapshots ?? []).filter(row =>
      (input.cancelServiceOccurrenceIds ?? []).includes(row.occurrenceId ?? "") && row.requiresCapacity);
    if (newServiceOccurrences.some(row => row.requiresCapacity) && !this.serviceCapacities) {
      throw new ConflictException("换货服务容量组件未装配，不能只提交服务费用");
    }
    if (retainedServices.some(row => row.requiresCapacity) || cancelledCapacityServices.length) {
      if (!this.serviceCapacities) throw new ConflictException("换货服务容量组件未装配，不能只提交资源");
      await this.serviceCapacities.assertServiceChangeForExchange(tenantId, order.id, retainedServices, cancelledCapacityServices, tx);
    }
    const originalServiceRefund = (input.cancelServiceOccurrenceIds ?? []).reduce((sum, occurrenceId) => {
      const occurrence = order.serviceSnapshots!.find(row => row.occurrenceId === occurrenceId)!;
      return sum + serviceCancellationAmounts(occurrence, occurrence.quantity).refundAmount;
    }, 0);
    const expectedDifference = roundMoney(exchange.replacementAmount - exchange.originalAmount - membershipDelta - couponDelta - discountDelta + resolvedServices.totalAmount - originalServiceRefund);
    if (roundMoney(priced.differenceAmount) !== expectedDifference) throw new ConflictException("换货差额与当前服务及原净退款不一致");
    await this.factStore.lockInventoryTargets(tenantId, locationId, [{ itemGroupId: replacement.id, inventoryMode: replacement.inventoryMode }], tx);
    const inventory = await this.loadInventorySnapshot(tenantId, tx);
    const exchangeAt = basis.effectiveFrom;
    if (!Number.isFinite(Date.parse(exchangeAt)) || Date.parse(exchangeAt) < Date.parse(order.startAt)
      || Date.parse(exchangeAt) >= Date.parse(dueAt) || Date.parse(exchangeAt) > Date.now()) {
      throw new ConflictException("换货生效时点不属于原租期，须重新核价");
    }
    // 价格与实物资源共同使用锁内重报价的确认时点，不再另取时间造成两段事实错位。
    const period = bufferedRentalPeriod(exchangeAt, dueAt, order.ruleSnapshot);
    const periodStart = period.startAt;
    const periodEnd = period.endAt;
    const activeReservations = inventory.reservations.filter((row) => row.orderId !== order.id);
    if (replacement.inventoryMode === RentalInventoryMode.Serialized) {
      if (!input.replacementAssetId) throw new BadRequestException("序列化资产换货必须选择具体资产");
      const asset = inventory.assets.find((row) => row.id === input.replacementAssetId);
      if (!asset || asset.itemGroupId !== replacement.id || asset.locationId !== locationId) throw new ConflictException("换货目标资产不存在或不在领取地点");
      if (![RentalAssetStatus.Available, RentalAssetStatus.Reserved].includes(asset.status)) throw new ConflictException("换货目标资产尚未回库、正在租用或不可用");
      if (activeReservations.some((row) => (row.assetIds ?? []).includes(asset.id) && Date.parse(row.startAt) < Date.parse(periodEnd) && Date.parse(row.endAt) > Date.parse(periodStart))) {
        throw new ConflictException("换货目标资产与其他订单的租期或缓冲时间冲突");
      }
      if (order.allocations.some((row) => row.assetId === asset.id && ACTIVE_ASSIGNMENTS.includes(row.status))) throw new ConflictException("换货目标资产已被当前订单占用");
    } else {
      const available = this.availableQuantity(state, inventory, replacement, locationId, periodStart, periodEnd, new Set());
      if (available < allocation.quantity) throw new ConflictException(`${replacement.name} 当前可用库存不足`);
    }

    const pickupRequirements = exchangePickupInspectionRequirements({ orderId, expectedUpdatedAt: order.updatedAt,
      orderLineId: line.id, allocationId: allocation.id, replacementItemGroupId: replacement.id,
      replacementAssetId: input.replacementAssetId, locationId, basis });
    const pickupInput = input.replacementPickupInspection;
    if (pickupRequirements.required && !pickupInput) {
      throw new ConflictException("替换商品要求独立领取检查，原商品换货检查不能替代，请先核定新交付依据");
    }
    let pickupRecord: RentalInspectionRecord | undefined;
    const replacementAllocationId = `allocation_${randomUUID().replace(/-/g, "")}`;
    if (pickupInput) {
      const template = pickupRequirements.templates.find(row => row.id === pickupInput.templateId);
      if (!template || template.tenantId !== tenantId || template.categoryCode !== basis.categoryCode
        || template.version !== pickupInput.templateVersion || pickupInput.confirmationHash !== pickupRequirements.confirmationHash) {
        throw new ConflictException("替换商品或领取检查模板已变化，请重新试算并检查");
      }
      if (!this.configStore?.listInspectionTemplates) throw new ConflictException("换货领取检查权威读取未装配");
      const currentTemplates = await this.configStore.listInspectionTemplates(tenantId, this.resolveWorkspaceId(tenantId), tx);
      const definition = basis.categoryPolicySnapshot ?? await this.getWorkspaceCategory(tenantId);
      const currentPickups = currentTemplates.filter(row => row.stage === "pickup" && row.enabled)
        .map(row => snapshotInspectionTemplate(definition, row));
      const byId = (rows: RentalInspectionTemplate[]) => [...rows].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      if (currentPickups.some(row => row.tenantId !== tenantId || row.categoryCode !== basis.categoryCode)
        || requestFingerprint(byId(currentPickups)) !== requestFingerprint(byId(pickupRequirements.templates))) {
        throw new ConflictException("领取检查模板已变化，请重新试算并检查");
      }
      if (pickupInput.customerConfirmed !== true) throw new ConflictException("新商品领取检查须取得客户确认");
      assertInspectionObservations(template, pickupInput.results, true);
      const evidenceIds = inspectionEvidenceIds(pickupInput);
      const evidenceError = inspectionEvidenceRequiredError(basis.ruleSnapshot.fulfillment?.evidenceRequired === true, evidenceIds);
      if (evidenceError) throw new BadRequestException(evidenceError);
      await this.assertExchangePickupFiles(tenantId, order, evidenceIds, pickupInput.handoverSignatureFileAssetId, idempotencyKey, tx, approved?.preparation.acceptedMedia);
      pickupRecord = { id: id("inspection"), tenantId, orderId, stage: "pickup", exchangeId,
        templateId: template.id, templateCode: template.code, templateVersion: template.version,
        pickupItems: [{ allocationId: replacementAllocationId, itemGroupId: replacement.id,
          ...(input.replacementAssetId ? { assetId: input.replacementAssetId } : {}), quantity: allocation.quantity }],
        results: structuredClone(pickupInput.results), usageReadings: template.fields.filter(field => field.usageMetric).flatMap(field => {
          const current = optionalUsageReading(pickupInput.results[field.code], field.label);
          return current === undefined ? [] : [{ fieldCode: field.code, current }];
        }), exceptions: [], attachments: evidenceIds, customerConfirmedAt: approved?.consent.confirmedAt ?? exchangeAt, operator, createdAt: exchangeAt };
    }
    const replacementAllocation: RentalAllocation = { ...allocation, id: replacementAllocationId, itemGroupId: replacement.id, assetId: input.replacementAssetId,
      assetNo: input.replacementAssetId ? inventory.assets.find(asset => asset.id === input.replacementAssetId)?.assetNo : undefined,
      metadata: { source: "manual", protected: true, assignedAt: exchangeAt, exchangeId } };
    await this.validateAllocationEquipment(tenantId, replacementOrder, [replacementAllocation], tx, operator);
    // A replacement is a new handover. Allocation compatibility does not run
    // delivery-only capabilities; the old asset's return inspection cannot stand
    // in for a replacement pickup check. Scope the hook to the replacement only.
    await this.runHook(tenantId, "pickup_delivery", { type: "order", id: order.id }, {
      order: { ...replacementOrder, allocations: [replacementAllocation], serviceSnapshots: [...retainedServices, ...newServiceOccurrences] },
      stage: "pickup", inspectionSkipped: !pickupRecord, exchange: true,
      ...(pickupRecord ? { results: pickupRecord.results, exceptions: [] } : {})
    }, tx, operator, this.orderHookInstances(tenantId, replacementOrder));

    const oldReservations = order.reservations.filter((row) => row.orderLineId === line.id && !["released", "expired", "cancelled"].includes(row.status));
    const reservedForLine = oldReservations.reduce((sum, row) => sum + row.quantity - row.releasedQuantity, 0);
    if (reservedForLine < allocation.quantity) throw new ConflictException("原商品预占数量不足，不能安全换货");
    const originalReservations = structuredClone(oldReservations);
    const releasedBeforeExchange = new Map(order.reservations.map(row => [row.id, row.releasedQuantity]));
    const returnedBeforeExchange = new Set(order.allocations.filter(row => ["returned", "released"].includes(row.status)).map(row => row.id));
    for (const reservation of oldReservations) {
      reservation.releasedQuantity = reservation.quantity;
      reservation.status = RentalReservationStatus.Released;
    }

    const at = exchangeAt;
    if (!order.inspectionTemplateSnapshots) throw new ConflictException("旧商品缺少冻结检查模板，不能用当前配置冒充历史依据");
    const originalTemplates = (await this.listInspectionTemplates(tenantId, "return", order, tx))
      .filter(template => template.enabled && (!template.allocationIds || template.allocationIds.includes(allocation.id)));
    if (originalTemplates.length !== 1) throw new ConflictException("旧商品缺少唯一的冻结换货检查依据，请先核对原检查模板");
    if (!this.factStore.upsertWorkOrder) throw new ConflictException("返库处置工单未装配，不能直接释放换货旧物");
    const originalTemplate = originalTemplates[0];
    let originalResults: Record<string, unknown> | undefined;
    if (approved) {
      const preparedTemplate = approved.preparation.templates.find(row => row.side === "original_return")?.template;
      const preparedResult = approved.preparation.inspections.find(row => row.side === "original_return");
      if (!preparedTemplate || !preparedResult || preparedResult.templateId !== originalTemplate.id
        || requestFingerprint(preparedTemplate) !== requestFingerprint(originalTemplate)) throw new ConflictException("原商品检查与本人同意的准备不一致");
      originalResults = structuredClone(preparedResult.results);
      for (const field of originalTemplate.fields.filter(field => field.type === "photo")) {
        if (typeof originalResults[field.code] === "string") originalResults[field.code] = [originalResults[field.code]];
      }
      assertInspectionObservations(originalTemplate, originalResults, true);
    }
    const inspection: RentalInspectionRecord = {
      id: id("inspection"), tenantId, orderId, stage: "return", exchangeId,
      templateId: originalTemplate.sourceTemplateId ?? originalTemplate.id,
      templateCode: originalTemplate.code, templateVersion: originalTemplate.version,
      // 原模板仅作来源引用；这是换货检查原文，不冒充已完成模板必填项和返库整备。
      results: originalResults ?? { exchangeInspectionSnapshot: structuredClone(input.inspectionSnapshot) },
      ...(approved ? { customerConfirmedAt: approved.consent.confirmedAt } : {}),
      returnedItems: [{ allocationId: allocation.id, quantity: allocation.quantity }],
      exceptions: (input.inspectionSnapshot.exceptions ?? []).map(exception => ({
        id: randomUUID(), code: exception.code, description: exception.description, allocationId: allocation.id,
        suggestedChargeAmount: exception.chargeAmount, evidenceAttachments: input.inspectionSnapshot!.attachments ?? [],
        reviewStatus: "pending" as const
      })),
      attachments: input.inspectionSnapshot.attachments ?? [], operator, createdAt: at
    };
    await this.factStore.insertInspection(inspection, tx);
    if (pickupRecord) await this.factStore.insertInspection(pickupRecord, tx);
    const beforeSnapshot: Record<string, unknown> = {
      updatedAt: order.updatedAt,
      status: order.status,
      finalPayableAmount: order.finalPayableAmount,
      adjustmentAmount: order.adjustmentAmount,
      depositAmount: order.depositAmount,
      preAuthAmount: order.preAuthAmount,
      line: structuredClone(line),
      allocation: structuredClone(allocation),
      reservations: originalReservations,
      serviceSnapshots: structuredClone(order.serviceSnapshots ?? [])
    };

    const cancellationIds = [...new Set(input.cancelServiceOccurrenceIds ?? [])];
    const cancelledServices: Array<{ occurrenceId: string; serviceName: string; quantity: number; refundAmount: number }> = [];
    if (cancellationIds.length) {
      const occurrences = [...(order.serviceSnapshots ?? [])];
      for (const occurrenceId of cancellationIds) {
        const index = occurrences.findIndex((row) => row.occurrenceId === occurrenceId);
        if (index < 0) throw new ConflictException("要取消的服务发生项不属于当前订单");
        const row = occurrences[index];
        if ((row.executionStatus ?? "not_started") !== "not_started") throw new ConflictException(`服务「${row.serviceName}」已经开始，不能随换货取消`);
        // 强制服务只能在统一规则门已确认替代承诺后取消，不能单独绕过。
        const amounts = serviceCancellationAmounts(row, row.quantity);
        if (row.requiresCapacity && row.reservationKey) {
          if (!this.serviceCapacities) throw new ConflictException("服务容量组件未就绪，拒绝只写换货状态");
          await this.serviceCapacities.releaseForOccurrence(tenantId, order.id, row.reservationKey, "post_pickup_exchange_service_cancel", at, tx, true);
        }
        occurrences[index] = { ...row, executionStatus: "cancelled", actualEndAt: at, failureReason: input.reason.trim(), executedBy: operator, refundAmount: amounts.refundAmount, refundStatus: amounts.refundAmount > 0 ? "included_in_order_change" : "none" };
        cancelledServices.push({ occurrenceId, serviceName: row.serviceName, quantity: row.quantity, refundAmount: amounts.refundAmount });
      }
      order.serviceSnapshots = occurrences;
    }

    if (newServiceOccurrences.length) {
      if (newServiceOccurrences.some(row => row.requiresCapacity)) {
        if (!this.serviceCapacities) throw new ConflictException("换货服务容量组件未装配，不能只提交服务费用");
        await this.serviceCapacities.reserveForOrder(tenantId,
          { id: order.id, serviceSnapshots: newServiceOccurrences, reservations: [] }, serviceRequestKey, tx, true);
        await this.serviceCapacities.confirmForOrder(tenantId, order.id, at, tx, true,
          newServiceOccurrences.map(row => row.reservationKey).filter((key): key is string => Boolean(key)));
        await this.serviceCapacities.assertRetainedForExchange(tenantId, order.id, newServiceOccurrences, tx);
      }
      order.serviceSnapshots = appendOccurrences(order.serviceSnapshots, newServiceOccurrences);
    }

    const oldLocationId = input.exchangeLocationId ?? order.fulfillmentLocationId;
    const oldAsset = allocation.assetId ? inventory.assets.find((asset) => asset.id === allocation.assetId) : undefined;
    const assetChanges: AssetStatusChange[] = [];
    const exchangeHoldReason = input.originalDisposition === "off_shelf"
      ? "换货旧商品下架，须完成关联处置验收后独立核准恢复"
      : "换货旧商品返库检查与整备待完成";
    allocation.status = "returned";
    allocation.metadata = {
      source: allocation.metadata?.source ?? "manual",
      protected: allocation.metadata?.protected ?? true,
      assignedAt: allocation.metadata?.assignedAt ?? at,
      ...allocation.metadata,
      exchangeId,
      exchangeDisposition: input.originalDisposition
    };
    const newReservation: RentalReservation = {
      id: `reservation_${randomUUID().replace(/-/g, "")}`,
      orderId: order.id,
      orderLineId: line.id,
      itemGroupId: replacement.id,
      locationId,
      quantity: allocation.quantity,
      releasedQuantity: 0,
      status: RentalReservationStatus.Fulfilled,
      createdAt: at
    };
    order.reservations.push(newReservation);
    const replacementAsset = input.replacementAssetId ? inventory.assets.find((asset) => asset.id === input.replacementAssetId) : undefined;
    order.allocations.push({
      id: replacementAllocationId,
      orderId: order.id,
      orderLineId: line.id,
      itemGroupId: replacement.id,
      assetId: replacementAsset?.id,
      assetNo: replacementAsset?.assetNo,
      quantity: allocation.quantity,
      // Customer-confirmed replacement is already handed over, not merely
      // reserved. Retain the lock receipt and allow a later formal exchange.
      status: "picked_up",
      metadata: { source: "manual", protected: true, assignedAt: at, lockedAt: at, reservationId: newReservation.id, itemGroupName: replacement.name, locationId, exchangeId, exchangeDisposition: input.originalDisposition }
    });
    if (replacementAsset) assetChanges.push({ assetId: replacementAsset.id, status: RentalAssetStatus.Rented, reason: "取货后换货立即锁定新资产", operator });
    line.itemGroupId = replacement.id;
    line.itemGroupCode = replacement.code;
    line.itemGroupName = replacement.name;
    line.inventoryMode = replacement.inventoryMode;
    const effectiveReplacementPricingGroupId = input.replacementPricingGroupId ?? exchange.replacementPricingGroupId;
    const effectiveReplacementPricingGroup = effectiveReplacementPricingGroupId
      ? state.pricingGroups.find((group) => group.id === effectiveReplacementPricingGroupId)
      : undefined;
    line.pricingGroupId = effectiveReplacementPricingGroupId;
    line.pricingGroupCode = effectiveReplacementPricingGroup?.code;
    line.pricingGroupName = effectiveReplacementPricingGroup?.name;
    line.pricingGroupMemberItemGroupIds = effectiveReplacementPricingGroup?.memberItemGroupIds;
    const replacementAmount = roundMoney(exchange.replacementAmount);
    if (!Number.isFinite(replacementAmount) || replacementAmount < 0) throw new ConflictException("换货试算缺少有效的新商品金额");
    line.amount = replacementAmount;
    line.unitPrice = roundMoney(replacementAmount / Math.max(1, line.quantity));

    const differenceAmount = roundMoney(priced.differenceAmount);
    const serviceRefund = roundMoney(cancelledServices.reduce((sum, row) => sum + row.refundAmount, 0));
    if (differenceAmount !== roundMoney(exchange.replacementAmount - exchange.originalAmount - membershipDelta - couponDelta - discountDelta + resolvedServices.totalAmount - serviceRefund)) {
      throw new ConflictException("换货差额与原保留租金、新剩余租金及服务净退款不一致");
    }
    const changeId = exchangeId;
    if (differenceAmount > 0) {
      this.applyChargeTo(order, {
        code: `exchange:${changeId}`,
        name: "换货差额（归还结算）",
        type: "order_change",
        amount: differenceAmount,
        sourceVersion: exchange.replacementPriceVersion ?? exchange.originalPriceVersion ?? order.pricingPlanVersion,
        detail: `${exchange.priceBasis === "original_order_price" ? "按原订单价格" : "按换货时新商品价格"}；归还时统一结算；${input.reason.trim()}`
      });
    } else if (differenceAmount < 0) {
      this.raiseFeeReview(order, "early_return_refund", -differenceAmount, [
        `取货后换货退款差额 ${-differenceAmount}`,
        exchange.priceBasis === "original_order_price" ? "按原订单价格重算" : `按换货时价格版本 ${exchange.replacementPriceVersion ?? "unknown"} 重算`,
        "归还结算前需人工审核退款"
      ], changeId);
    }
    this.applySecurityDeltaTo(order, { deposit: priced.depositDelta, preAuth: priced.preAuthDelta });
    order.updatedAt = at;
    const afterSnapshot: Record<string, unknown> = {
      updatedAt: order.updatedAt,
      status: order.status,
      finalPayableAmount: order.finalPayableAmount,
      adjustmentAmount: order.adjustmentAmount,
      depositAmount: order.depositAmount,
      preAuthAmount: order.preAuthAmount,
      line: structuredClone(line),
      allocations: structuredClone(order.allocations.filter((row) => row.orderLineId === line.id)),
      reservations: structuredClone(order.reservations.filter((row) => row.orderLineId === line.id)),
      serviceSnapshots: structuredClone(order.serviceSnapshots ?? [])
    };
    const change: RentalOrderChange = {
      id: changeId,
      tenantId,
      workspaceId: this.resolveWorkspaceId(tenantId),
      orderId: order.id,
      sequence: (await this.factStore.listOrderChanges(tenantId, order.id, tx)).length + 1,
      type: "post_pickup_exchange",
      status: "applied",
      request: input,
      beforeSnapshot,
      afterSnapshot,
      diff: {
        exchange: { ...structuredClone(exchange), serviceSnapshots: structuredClone(resolvedServices.snapshots), serviceConfirmationHash: serviceHash },
        addedServices: structuredClone(newServiceOccurrences),
        differenceAmount,
        additionalAmount: Math.max(0, differenceAmount),
        refundAmount: Math.max(0, -differenceAmount),
        depositDelta: priced.depositDelta,
        preAuthDelta: priced.preAuthDelta,
        cancelledServices
      },
      refundAmount: roundMoney(Math.max(0, -differenceAmount)),
      additionalAmount: roundMoney(Math.max(0, differenceAmount)),
      depositDelta: roundMoney(priced.depositDelta),
      preAuthDelta: roundMoney(priced.preAuthDelta),
      idempotencyKey,
      requestedBy: operator,
      appliedBy: operator,
      requestedAt: at,
      appliedAt: at,
      createdAt: at
    };
    // 复用正常返库处置，而非直接把旧物设可租。地点是本次实收地点，不是订单未来的归还地点。
    const returnedOrder = { ...order, returnLocationId: oldLocationId };
    await this.recordReturnDispositions(tenantId, state, returnedOrder, inspection.id, `exchange:${changeId}`,
      releasedBeforeExchange, exchangeHoldReason, tx, operator, returnedBeforeExchange, assetChanges);
    const stockQuarantines = this.quarantinedReturnQuantities(state, returnedOrder, releasedBeforeExchange,
      `exchange:${changeId}`, inspection.id, operator, exchangeHoldReason, undefined, returnedBeforeExchange);
    if (oldAsset && input.originalDisposition === "off_shelf") {
      const change = assetChanges.find(row => row.assetId === oldAsset.id);
      if (change) change.status = RentalAssetStatus.Disabled;
    }
    await this.factStore.saveOrderAggregate(order, assetChanges, tx, stockQuarantines);
    await this.factStore.insertOrderChange(change, tx);
    return { order, change };
  }

  /** ORDER-CHANGE-01C/01D：在同一订单事务中取消服务发生项并释放它自己的容量预留。 */
  private async applyServiceCancellation(
    tenantId: string,
    order: RentalOrder,
    priced: RentalOrderExtensionPreview & { rateSnapshot: RentalPricingRate[]; ruleSnapshot: RentalRuleConfig },
    input: { type: "service_cancel"; serviceOccurrenceIds?: string[]; serviceItems?: ServiceCancellationSelection[]; reason: string; customerConfirmed: boolean; expectedUpdatedAt: string },
    previousChanges: RentalOrderChange[],
    idempotencyKey: string,
    operator: string,
    tx: RentalFactTx
  ): Promise<{ order: RentalOrder; change: RentalOrderChange }> {
    const ids = [...new Set((input.serviceOccurrenceIds ?? []).map((value) => value.trim()).filter(Boolean))];
    const requested = input.serviceItems?.length
      ? input.serviceItems.map((item) => ({ occurrenceId: item.occurrenceId.trim(), quantity: Number(item.quantity) }))
      : ids.map((occurrenceId) => ({ occurrenceId, quantity: 0 }));
    if (!requested.length || new Set(requested.map((item) => item.occurrenceId)).size !== requested.length) throw new BadRequestException("请选择至少一项且不重复的增值服务");
    const occurrences = [...(order.serviceSnapshots ?? [])];
    const selected = requested.map((selection) => {
      const row = occurrences.find((item) => item.occurrenceId === selection.occurrenceId);
      if (!row) throw new ConflictException("存在不存在或不属于当前订单的服务发生项");
      if ((row.executionStatus ?? "not_started") !== "not_started") throw new ConflictException(`服务「${row.serviceName}」已经开始或结束，不能取消`);
      if (row.requiredByRule) throw new ConflictException(`服务「${row.serviceName}」属于业务规则要求，不能直接取消`);
      if (row.refundStatus && row.refundStatus !== "none") throw new ConflictException(`服务「${row.serviceName}」已有退款处理记录`);
      if (row.requiresCapacity && !row.reservationKey) throw new ConflictException(`服务「${row.serviceName}」缺少容量预留依据，拒绝安全取消`);
      const quantity = selection.quantity || row.quantity;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > row.quantity) throw new ConflictException(`服务「${row.serviceName}」最多可取消 ${row.quantity} 份`);
      if (row.requiresCapacity && row.capacityQuantity !== row.quantity) throw new ConflictException(`服务「${row.serviceName}」的容量快照不支持安全拆分，请人工处理`);
      return { row, quantity };
    });
    const reservationKeys = selected.map(({ row }) => row.reservationKey).filter((value): value is string => Boolean(value));
    if (new Set(reservationKeys).size !== reservationKeys.length) throw new ConflictException("多个服务发生项共用了同一容量预留，拒绝重复释放");
    const expectedRefund = roundMoney(selected.reduce((sum, selection) => sum + serviceCancellationAmounts(selection.row, selection.quantity).refundAmount, 0));
    const differenceAmount = roundMoney(priced.pricingSnapshot?.differenceAmount ?? priced.payableAmount);
    if (differenceAmount !== roundMoney(-expectedRefund)) throw new ConflictException("服务退款试算与订单快照不一致，请重新试算");
    if (differenceAmount > 0.005 || priced.depositDelta > 0.005 || priced.preAuthDelta > 0.005) {
      throw new ConflictException("服务取消不能产生补款或新增押金/预授权");
    }
    const at = now();
    const beforeServices = selected.map(({ row }) => structuredClone(row));
    const beforeFinalPayableAmount = order.finalPayableAmount;
    const beforeAdjustmentAmount = order.adjustmentAmount;
    for (const selection of selected) {
      const { row, quantity } = selection;
      const index = occurrences.findIndex((item) => item.occurrenceId === row.occurrenceId);
      const amounts = serviceCancellationAmounts(row, quantity);
      const fullCancellation = quantity === row.quantity;
      const remainingQuantity = row.quantity - quantity;
      occurrences[index] = fullCancellation
        ? {
            ...row,
            executionStatus: "cancelled",
            actualEndAt: at,
            failureReason: input.reason.trim(),
            executedBy: operator,
            refundAmount: amounts.refundAmount,
            refundStatus: amounts.refundAmount > 0 ? "included_in_order_change" : "none"
          }
        : {
            ...row,
            quantity: remainingQuantity,
            amount: amounts.remainingGross,
            discountAllocatedAmount: amounts.remainingDiscount,
            couponAllocatedAmount: amounts.remainingCoupon,
            capacityQuantity: row.requiresCapacity ? row.capacityQuantity - quantity : row.capacityQuantity,
            cancelledQuantity: (row.cancelledQuantity ?? 0) + quantity,
            formula: `${row.unitPrice} × ${remainingQuantity} × ${row.billingUnits}`
          };
      if (row.requiresCapacity && row.reservationKey) {
        if (!this.serviceCapacities) throw new ConflictException("服务容量履约组件未就绪，拒绝只写服务取消状态");
        if (fullCancellation) {
          await this.serviceCapacities.releaseForOccurrence(tenantId, order.id, row.reservationKey, "order_change_service_cancel", at, tx);
        } else {
          await this.serviceCapacities.releaseQuantityForOccurrence(tenantId, order.id, row.reservationKey, quantity, "order_change_service_partial_cancel", at, tx);
        }
      }
    }
    order.serviceSnapshots = occurrences;
    this.applyChargeTo(order, {
      code: `order-change:${previousChanges.length + 1}`,
      name: "订单增值服务取消差额",
      type: "order_change",
      amount: differenceAmount,
      sourceVersion: priced.priceVersion ?? priced.ruleVersion,
      detail: input.reason.trim()
    });
    order.updatedAt = at;
    const selectedIds = selected.map(({ row }) => row.occurrenceId).filter((value): value is string => Boolean(value));
    const afterServices = occurrences.filter((row) => selectedIds.includes(row.occurrenceId ?? "")).map((row) => structuredClone(row));
    const beforeSnapshot: Record<string, unknown> = {
      updatedAt: input.expectedUpdatedAt,
      status: order.status,
      finalPayableAmount: beforeFinalPayableAmount,
      adjustmentAmount: beforeAdjustmentAmount,
      serviceSnapshots: beforeServices
    };
    const afterSnapshot: Record<string, unknown> = {
      updatedAt: order.updatedAt,
      status: order.status,
      finalPayableAmount: order.finalPayableAmount,
      adjustmentAmount: order.adjustmentAmount,
      serviceSnapshots: afterServices
    };
    const change: RentalOrderChange = {
      id: randomUUID(), tenantId, workspaceId: this.resolveWorkspaceId(tenantId), orderId: order.id,
      sequence: previousChanges.length + 1, type: "service_cancel", status: "applied",
      request: { ...input, serviceOccurrenceIds: ids.length ? ids : undefined, serviceItems: selected.map(({ row, quantity }) => ({ occurrenceId: row.occurrenceId!, quantity })) }, beforeSnapshot, afterSnapshot,
      diff: {
        scope: "services",
        serviceOccurrenceIds: selectedIds,
        services: selected.map(({ row, quantity }) => ({ occurrenceId: row.occurrenceId, serviceName: row.serviceName, quantity, refundAmount: serviceCancellationAmounts(row, quantity).refundAmount, remainingQuantity: row.quantity - quantity })),
        differenceAmount, refundAmount: Math.max(0, -differenceAmount), additionalAmount: 0,
        releasedServiceOccurrenceIds: selected.filter(({ row }) => row.requiresCapacity).map(({ row }) => row.occurrenceId)
      },
      refundAmount: roundMoney(Math.max(0, -differenceAmount)), additionalAmount: 0,
      depositDelta: 0, preAuthDelta: 0, idempotencyKey, requestedBy: operator, appliedBy: operator,
      requestedAt: at, appliedAt: at, createdAt: at
    };
    await this.factStore.saveOrderAggregate(order, [], tx);
    await this.factStore.insertOrderChange(change, tx);
    if (change.refundAmount > 0) await this.releaseReducedCredit(order, { kind: "change", id: change.id }, tx, operator);
    return { order, change };
  }

  /**
   * 受理续租申请（需求 4.6.9）。
   *
   * 金额由 `RentalBusinessService.quoteOrderExtension` 在事务外算好传进来，与逾期费、
   * 取消费同一形态（控制器负责组合）。本方法只做闸门、落记录与推进占用。
   *
   * 闸门顺序：状态 → 归还时间基准未被别的续租改过 → 时间有效 → 规则准入
   * → **后续库存占用** → 金额 > 0。库存那一步最容易漏：延长出来的那段时间可能
   * 已经被下一张订单占住，不查就会出现两张订单同时占用同一台资产。
   *
   * 结算方式从原单确认依据与当前授信门解析，不信试算字段自授权。
   * 账期费用可挂账，但押金/预授权增额仍待补齐；零差额直接生效也核对原资金缺口。
   * 待补款申请不改变占用与租期，所有生效路径在同一事务中核对资金、授信和库存。
   */
  async requestOrderExtension(
    tenantId: string,
    orderId: string,
    priced: RentalOrderExtensionPreview & { rateSnapshot: RentalPricingRate[]; ruleSnapshot: RentalRuleConfig },
    input: { idempotencyKey: string; memo?: string; operator: string; approval?: import("./approved-extension.ports").ApprovedExtensionBinding },
    tx: RentalFactTx
  ): Promise<{ order: RentalOrder; extension: RentalOrderExtension }> {
    const state = this.state(tenantId);
    if (input.approval && input.approval.idempotencyKey !== input.idempotencyKey) throw new ForbiddenException("续租原执行键与批准绑定不一致");
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Renting && order.status !== RentalCoreOrderStatus.ReadyForPickup) {
      throw new ConflictException(`只有待${state.profile.terminology.pickupLabel}或租用中的订单可以续租`);
    }
    const from = order.effectiveEndAt ?? order.endAt;
    // 试算与受理之间订单可能已被另一次续租推进过，那金额基准就不成立了。
    if (priced.originalEndAt !== from) throw new ConflictException("订单归还时间已变化，请重新试算续租费用");
    this.validatePeriod(from, priced.newEndAt);
    if (!hasOriginalRentalCurrency(order.currency, priced.currency)) throw new ConflictException("续租币种与原订单不一致或缺失，不能追加或补收其他币种金额");
    if (priced.payableAmount < 0) throw new BadRequestException("补款金额不能为负，负差额必须走退款审核");
    const exchangeIds = currentExchangePricingIds(order);
    if (exchangeIds.size && !priced.executionBasis?.incrementalPricing) {
      throw new ConflictException("换货后续租缺少原稳定行计价收据，请重新试算");
    }
    if (priced.executionBasis?.incrementalPricing !== undefined) {
      if (priced.executionBasis.pricingMode !== "incremental" || priced.pricingSnapshot) throw new ConflictException("独立续租来源不能用于全租期重算");
      if (priced.orderId !== order.id) throw new ConflictException("独立续租试算不属于原订单");
      assertIncrementalPricingSnapshot(priced.executionBasis.incrementalPricing, priced.rentalAmount, priced.billableUnits,
        { tenantId, startAt: from, endAt: priced.newEndAt, lines: order.lines, rates: priced.rateSnapshot,
          exchangeIds });
    }
    if (order.membershipSnapshot?.bookingIdentity === "enterprise_employee") {
      if (!this.enterprisePolicies) throw new ConflictException("企业续租政策服务未装配");
      const approved = await this.enterprisePolicies.assertExtensionAction(tenantId, this.resolveWorkspaceId(tenantId), order, priced, tx, input.approval);
      if (approved) {
        if (priced.settlementMode === "monthly" && (priced.depositDelta > 0 || priced.preAuthDelta > 0)) throw new ConflictException("账期新增保证金须原真实补足合同，企业批准不能代收或冻结");
        if (!this.extensionPrices) throw new ConflictException("续租原价格校验未装配");
        const current = await this.extensionPrices.quoteEnterpriseExtension(tenantId, order, await this.factStore.listExtensions(tenantId, orderId, tx), approved.request, priced.settlementMode, tx);
        if (requestFingerprint(current) !== requestFingerprint(approved.preview)) throw new ConflictException("续租原价格、规则或品类已变化，须重新试算与批准");
      }
    }
    const rule = effectiveExtensionRule(priced.ruleSnapshot);
    if (!rule.enabled) throw new ConflictException("当前经营空间的规则不允许续租");
    await this.assertOrderQualification(tenantId, order, "extension", priced.newEndAt, tx);
    await this.assertExtensionMembershipSecurity(tenantId, order, priced.pricingSnapshot, tx);
    const existing = await this.factStore.listExtensions(tenantId, orderId, tx);
    this.assertExtensionPriceBase(order, existing, priced.pricingSnapshot);
    const effectiveCount = existing.filter((row) => row.status === "effective").length;
    if (rule.maxTimes !== undefined && effectiveCount >= rule.maxTimes) {
      throw new ConflictException(`本订单的续租次数已达规则上限 ${rule.maxTimes} 次`);
    }
    if (rule.maxTotalDays !== undefined) {
      // 累计延长按**原始** endAt 起算，不是上一次续租后的时间——否则多次小额续租可以绕过上限。
      const totalDays = Math.ceil((new Date(priced.newEndAt).getTime() - new Date(order.endAt).getTime()) / 86_400_000);
      if (totalDays > rule.maxTotalDays) {
        throw new ConflictException(`累计延长 ${totalDays} 天，超过规则上限 ${rule.maxTotalDays} 天`);
      }
    }
    await this.assertOrderExtensionAvailable(tenantId, order, priced.newEndAt, tx);
    await this.assertExtensionCapabilityExecution(tenantId, order, priced.executionBasis, tx, true);

    const sequence = existing.length + 1;
    // 同一订单上更早的待补款申请就此作废：客户改主意重新申请后，旧那条不该继续可补款。
    // 不作废它们，`pending_payment` 就没有任何自然终态，界面会一直给出补款按钮。
    const superseded = existing.filter((row) => row.status === "pending_payment").map((row) => row.id);
    if (superseded.length) await this.factStore.cancelExtensions(tenantId, superseded, tx);
    // 与试算侧同一判据：押金/预授权差额同样要求先补款，否则押金会随续租直接生效而漏收。
    const creditAllowed = await this.extensionCreditAllowed(tenantId, order, priced.settlementMode, tx);
    const paymentRequired = extensionPaymentRequired({ ...priced, settlementMode: creditAllowed ? "monthly" : "immediate" });
    if (!paymentRequired) await this.assertExtensionFunding(tenantId, order, priced, creditAllowed, tx);
    const at = now();
    const extension: RentalOrderExtension = {
      id: randomUUID(),
      tenantId,
      // 真正落库的 workspaceId 由仓储按当前请求作用域解析，这里的值只用于本次返回。
      workspaceId: getRequestWorkspaceId() ?? "",
      orderId,
      sequence,
      status: paymentRequired ? "pending_payment" : "effective",
      originalEndAt: from,
      newEndAt: priced.newEndAt,
      billableUnits: priced.billableUnits,
      rentalAmount: priced.rentalAmount,
      serviceAmount: priced.serviceAmount,
      depositDelta: priced.depositDelta,
      preAuthDelta: priced.preAuthDelta,
      payableAmount: priced.payableAmount,
      currency: priced.currency,
      priceVersionId: priced.priceVersionId,
      priceVersion: priced.priceVersion,
      ruleVersion: priced.ruleVersion,
      executionBasis: structuredClone(priced.executionBasis),
      rateSnapshot: priced.rateSnapshot,
      ruleSnapshot: priced.ruleSnapshot,
      calendarSnapshot: priced.calendarSnapshot,
      // 本次新增服务的快照必须随申请固化：申请与生效之间隔着客户补款，
      // 生效时要靠它确认服务容量并合并进订单快照。
      serviceSnapshots: priced.serviceSnapshots,
      pricingSnapshot: priced.pricingSnapshot,
      settlementMode: creditAllowed ? "monthly" : "immediate",
      memo: input.memo,
      paidAt: undefined,
      effectiveAt: paymentRequired ? undefined : at,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.operator,
      createdAt: at
    };
    await this.factStore.insertExtension(extension, tx);
    if (!paymentRequired) await this.applyExtensionTo(order, extension, at, existing, tx);
    await this.factStore.saveOrderAggregate(order, [], tx);
    return { order, extension };
  }

  /**
   * 续租补款到账 → 记录生效 → 延长占用与租期（需求 4.6.9）。
   *
   * 补款前订单的占用与归还时间一律不动，因此「申请中但未成功」不会被误读成已经延期。
   *
   * 闸门与申请时**同样严**，不能因为"申请时已经查过"就省掉：申请与补款之间隔着一次
   * 客户支付，这中间订单可能已经取消或结算完，延长出来的那段时间也可能被下一张订单占住。
   * 少一道就会出现「已取消的订单被追加了一笔续租费」和「两张订单同时占用同一台资产」。
   */
  async payOrderExtension(
    tenantId: string,
    orderId: string,
    extensionId: string,
    tx: RentalFactTx
  ): Promise<{ order: RentalOrder; extension: RentalOrderExtension }> {
    this.state(tenantId);
    const order = await this.lockedOrder(tenantId, orderId, tx);
    const rows = await this.factStore.listExtensions(tenantId, orderId, tx);
    const extension = rows.find((row) => row.id === extensionId);
    if (!extension) throw new NotFoundException("续租记录不存在");
    if (extension.status === "effective") return { order, extension };
    if (extension.status !== "pending_payment") throw new ConflictException("该续租记录已不可补款");
    if (order.membershipSnapshot?.bookingIdentity === "enterprise_employee") {
      if (!this.enterprisePolicies) throw new ConflictException("企业续租政策服务未装配");
      const approved = await this.enterprisePolicies.assertExtensionAction(tenantId, this.resolveWorkspaceId(tenantId), order, extension, tx);
      if (approved) {
        if (!this.extensionPrices) throw new ConflictException("续租原价格校验未装配");
        const current = await this.extensionPrices.quoteEnterpriseExtension(tenantId, order, rows, approved.request, extension.settlementMode, tx);
        if (requestFingerprint(current) !== requestFingerprint(approved.preview)) throw new ConflictException("续租价格、规则或品类在补款前已变化，不能据旧批准生效；须商户核对原款项");
      }
    }
    if (order.status !== RentalCoreOrderStatus.Renting && order.status !== RentalCoreOrderStatus.ReadyForPickup) {
      throw new ConflictException("订单当前状态不允许续租生效，请先确认订单未取消或已结算");
    }
    const from = order.effectiveEndAt ?? order.endAt;
    // 期间可能有另一次续租先生效了，基准变了就不能再按原金额延长。
    if (extension.originalEndAt !== from) throw new ConflictException("订单归还时间已变化，请重新申请续租");
    if (!hasOriginalRentalCurrency(order.currency, extension.currency)) throw new ConflictException("续租币种与原订单不一致或缺失，不能追加或补收其他币种金额");
    const exchangeIds = currentExchangePricingIds(order);
    if (exchangeIds.size && !extension.executionBasis?.incrementalPricing) {
      throw new ConflictException("换货后续租缺少原稳定行计价收据，请重新试算");
    }
    if (extension.executionBasis?.incrementalPricing !== undefined) {
      if (extension.executionBasis.pricingMode !== "incremental" || extension.pricingSnapshot) throw new ConflictException("独立续租来源不能用于全租期重算");
      if (extension.tenantId !== tenantId || extension.orderId !== order.id || extension.workspaceId !== this.resolveWorkspaceId(tenantId)) {
        throw new ConflictException("独立续租收据不属于原订单空间");
      }
      this.validatePeriod(extension.originalEndAt, extension.newEndAt);
      assertIncrementalPricingSnapshot(extension.executionBasis.incrementalPricing, extension.rentalAmount, extension.billableUnits,
        { tenantId, startAt: from, endAt: extension.newEndAt, lines: order.lines, rates: extension.rateSnapshot,
          exchangeIds });
    }
    if (effectiveExtensionRule(order.ruleSnapshot).pricingMode === "original_total" && Date.parse(now()) > Date.parse(from)) throw new ConflictException("补款时已超过原约定归还时间，请先人工处理逾时，不能直接生效原价全租期续租");
    await this.assertOrderQualification(tenantId, order, "extension", extension.newEndAt, tx);
    await this.assertExtensionMembershipSecurity(tenantId, order, extension.pricingSnapshot, tx);
    this.assertExtensionPriceBase(order, rows, extension.pricingSnapshot);
    await this.assertOrderExtensionAvailable(tenantId, order, extension.newEndAt, tx);
    await this.assertExtensionCapabilityExecution(tenantId, order, extension.executionBasis, tx, false);
    const creditAllowed = await this.extensionCreditAllowed(tenantId, order, extension.settlementMode, tx);
    await this.assertExtensionFunding(tenantId, order, extension, creditAllowed, tx);
    const at = now();
    await this.factStore.markExtensionEffective(tenantId, extension.id, at, at, tx);
    const applied: RentalOrderExtension = { ...extension, status: "effective", paidAt: at, effectiveAt: at };
    await this.applyExtensionTo(order, applied, at, rows, tx);
    await this.factStore.saveOrderAggregate(order, [], tx);
    return { order, extension: applied };
  }

  /** Core保存确定核减后沿原账追加释放；缺真实组件时企业订单拒绝半提交。 */
  private async releaseReducedCredit(order: RentalOrder, source: { kind: "change" | "fee_review" | "extension_refund"; id: string },
    tx: RentalFactTx, operator: string) {
    if (!order.membershipSnapshot?.enterpriseContractAndPayer) return;
    if (!this.corporateSettlement) throw new ConflictException("企业授信核减组件未就绪，不能只更新订单金额");
    await this.corporateSettlement.releaseReducedOrderCredit(order.tenantId, this.resolveWorkspaceId(order.tenantId), order.id, source, tx, operator);
  }

  private async extensionCreditAllowed(tenantId: string, order: RentalOrder, settlementMode: "immediate" | "monthly", tx: RentalFactTx) {
    // 逾期强制先付仍可使用更严格的现金门；只有要豁免租金时才核准原账期与当前授信。
    if (settlementMode === "immediate") return false;
    if (!this.corporateSettlement) throw new ConflictException("企业授信核验组件未就绪，不能批准续租挂账");
    if (!await this.corporateSettlement.allowsExtensionCredit(tenantId, order.id, tx)) {
      throw new ConflictException("续租结算方式与原订单依据不一致，请重新试算");
    }
    return true;
  }

  private async assertExtensionFunding(tenantId: string, order: RentalOrder,
    extension: { payableAmount: number; depositDelta: number; preAuthDelta: number }, creditAllowed: boolean, tx: RentalFactTx) {
    if (!this.funding) throw new ConflictException("续租资金核验组件未就绪，不能延长租期与资源占用");
    await this.funding.assertReadyForExtension(tenantId, this.resolveWorkspaceId(tenantId), order.id, extension, tx,
      { skipRentalPayment: creditAllowed });
  }

  /**
   * 把一次已生效的续租落到订单上：追加费用明细 + 推进当前归还时间。
   *
   * `endAt` 不动（需求 4.6.9），推进的是 `effectiveEndAt`；预占的结束端在仓储里跟着
   * `effectiveEndAt` 写，因此保存聚合时占用会自动延长。
   */
  private async applyExtensionTo(order: RentalOrder, extension: RentalOrderExtension, at: string, previous: RentalOrderExtension[], tx: RentalFactTx) {
    for (const row of previous) {
      if (row.status === "effective" && row.pricingSnapshot?.refundReview?.status === "pending") {
        await this.factStore.updateExtensionPricingSnapshot(order.tenantId, order.id, row.id, {
          ...row.pricingSnapshot, refundReview: { ...row.pricingSnapshot.refundReview, status: "superseded", reason: `已由第 ${extension.sequence} 次续租重算替代` }
        }, tx);
      }
    }
    if (extension.pricingSnapshot) {
      // 负差额只生成待审退款，不提前核减应收；零/正差额分项落账，保留租金、服务、优惠边界。
      if (extension.pricingSnapshot.differenceAmount >= 0) {
        for (const line of extension.pricingSnapshot.chargeLines) this.applyChargeTo(order, {
          ...line, code: `extension:${extension.sequence}:${line.code}`, sourceId: extension.id, sourceVersion: extension.priceVersion
        });
      }
    } else {
      if (![extension.rentalAmount, extension.serviceAmount, extension.payableAmount].every(Number.isFinite)
        || Math.abs(roundMoney(extension.rentalAmount + extension.serviceAmount) - extension.payableAmount) > 0.005) {
        throw new ConflictException("续租租金与服务分项不一致，须核对原续租记录");
      }
      for (const [type, amount] of [["extension", extension.rentalAmount], ["service", extension.serviceAmount]] as const) {
        this.applyChargeTo(order, {
          code: `extension:${extension.sequence}:${type === "extension" ? "rental" : "service"}`,
          name: `续租第 ${extension.sequence} 次${type === "extension" ? "租金" : "服务"}`,
          type, amount, sourceId: extension.id, sourceVersion: extension.ruleVersion,
          detail: `${extension.originalEndAt} → ${extension.newEndAt}（${extension.settlementMode === "monthly" ? "计入月结账单" : "已补款"}）`
        });
      }
    }
    if (extension.settlementMode === "monthly") {
      if (!this.corporateSettlement) throw new ConflictException("企业授信组件未就绪，不能延长挂账订单");
      await this.corporateSettlement.reserveExtensionCredit(order.tenantId, order.id, extension.id, extension.payableAmount, tx, extension.createdBy);
    }
    order.effectiveEndAt = extension.newEndAt;
    if (order.fulfillmentMode === "carrier_shipping" && order.actualRentalStartAt) order.carrierRentalDueAt = extension.newEndAt;
    // 本次续租新增的服务作为**独立发生项**追加到订单上（MKT-02C）。
    //
    // 早先这里按 serviceId 合并、并把时段取并集。合并挡住了「容量被错放」那个坑，但代价是
    // 后一次的服务版本、条款版本、单价与净额覆盖前一次，账上有服务费却找不到对应的那次
    // 履约承诺。现在改成追加：配对不再靠 serviceId，而靠发生项自带的容量依据
    // （reservationKey，与预留行的幂等键同源），因此两条同服务的发生项各自判定、互不干扰。
    if (extension.serviceSnapshots?.length) {
      order.serviceSnapshots = appendOccurrences(
        order.serviceSnapshots,
        stampOccurrences(extension.serviceSnapshots, {
          origin: "extension",
          ownerId: extension.id,
          requestKey: extensionRequestKey(extension.id),
          extensionId: extension.id,
          extensionSequence: extension.sequence
        })
      );
    }
    order.updatedAt = at;
  }

  private assertExtensionPriceBase(order: RentalOrder, rows: RentalOrderExtension[], snapshot: RentalOrderExtension["pricingSnapshot"]) {
    if (!snapshot) return; // 旧版待补款记录仍按已经确认的原快照生效。
    const expected = roundMoney(order.payableAmount + rows.filter((row) => row.status === "effective").reduce((sum, row) => sum + row.payableAmount -
      (row.pricingSnapshot?.refundReview?.status === "approved" ? row.pricingSnapshot.refundReview.amount : 0), 0));
    assertOriginalTotalExtensionLedger(order, rows, expected);
    assertCurrentExtensionReductionBasis(snapshot, rows);
    if (expected !== snapshot.previousPayableAmount) throw new ConflictException("已计金额或退款审核状态已变化，请重新试算续租差额");
  }

  async reviewExtensionRefund(tenantId: string, orderId: string, extensionId: string, input: { decision: "approved" | "rejected"; reason: string }, operator: string, tx: RentalFactTx) {
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status === RentalCoreOrderStatus.Completed || order.status === RentalCoreOrderStatus.Cancelled) throw new ConflictException("已关闭或取消的订单不能审核续租退款");
    if (!input.reason.trim()) throw new BadRequestException("请填写退款审核原因");
    const rows = await this.factStore.listExtensions(tenantId, orderId, tx);
    const extension = rows.find((row) => row.id === extensionId);
    const snapshot = extension?.pricingSnapshot;
    const review = snapshot?.refundReview;
    if (!extension || extension.status !== "effective" || !snapshot || review?.status !== "pending") throw new ConflictException("该续租没有待审核退款，或已被后续续租替代");
    if (input.decision === "approved") {
      this.assertExtensionPriceBase(order, rows, snapshot);
      if (review.amount > order.finalPayableAmount) throw new ConflictException("原续租核减超过当前应收，须核对已有核减");
    }
    const at = now();
    if (input.decision === "approved") this.applyChargeTo(order, {
      code: `extension:${extension.sequence}:refund`, name: "续租重算差额核减（实际退款另办）", type: "early_return_refund",
      amount: -review.amount, sourceId: extension.id, sourceVersion: extension.priceVersion, detail: input.reason.trim()
    });
    const next = { ...snapshot, refundReview: { ...review, status: input.decision, reason: input.reason.trim(), reviewedBy: operator, reviewedAt: at } };
    await this.factStore.updateExtensionPricingSnapshot(tenantId, orderId, extensionId, next, tx);
    order.updatedAt = at;
    await this.factStore.saveOrderAggregate(order, [], tx);
    if (input.decision === "approved" && review.amount > 0) await this.releaseReducedCredit(order, { kind: "extension_refund", id: extensionId }, tx, operator);
    return { order, extension: { ...extension, pricingSnapshot: next } };
  }

  /**
   * 往订单挂一张待人工裁定的费用审核单（需求 4.6.10 / 4.6.8）。
   *
   * 同一来源只保留一张待审单：重复归还或重复服务动作不该堆出多条待办，后一次的金额与依据覆盖前一次；
   * 服务退款按发生项 sourceId 分开，避免同一订单的多次服务互相覆盖。已审完（approved/rejected）的保留为历史。
   */
  private raiseFeeReview(
    order: RentalOrder,
    type: RentalOrderFeeReview["type"],
    suggestedAmount: number | null,
    basis: string[],
    sourceId?: string,
    maximumAmount?: number
  ) {
    if (suggestedAmount === null) {
      if (type === "overdue" && sourceId === "bundle-return") {
        if (maximumAmount !== undefined && (!Number.isFinite(maximumAmount) || maximumAmount < 0)) throw new BadRequestException("套装逾期费用上限无效");
      } else if (type !== "early_return_refund" || maximumAmount === undefined || !Number.isFinite(maximumAmount) || maximumAmount < 0) {
        throw new BadRequestException("金额待核定的退款必须有原快照最大核减依据");
      }
    } else if (!Number.isFinite(suggestedAmount) || suggestedAmount < 0) throw new BadRequestException("费用审核建议额必须为有限的非负数字");
    else if (suggestedAmount <= 0 && type !== "early_return_refund") return undefined;
    const at = now();
    const kept = (order.feeReviews ?? []).filter((row) => !(row.type === type && row.sourceId === sourceId && row.status === "pending"));
    const review: RentalOrderFeeReview = { id: randomUUID(), type, sourceId,
      suggestedAmount: suggestedAmount === null ? null : roundMoney(suggestedAmount),
      ...(suggestedAmount === null && maximumAmount !== undefined ? { maximumAmount: roundMoney(maximumAmount) } : {}), basis, status: "pending", createdAt: at };
    order.feeReviews = [
      ...kept,
      review
    ];
    return review;
  }

  /**
   * 逾期费落账（需求 4.6.10）。
   *
   * 规则选 `manual_review` 时**不落账**，改挂一张待审核单：落多少由催收或减免的结论决定。
   * 早前这条路径由计算侧直接返回 0，等于把逾期费静默免除，运营侧连一条待办都看不到。
   */
  private applyOverdueTo(order: RentalOrder, amount: number, returnedAt: string, batchId?: string,
    review?: { maximumAmount?: number; basis: string[] }) {
    if (review) {
      const previous = (order.feeReviews ?? []).find(row => row.type === "overdue" && row.sourceId === "bundle-return");
      if (previous && previous.status !== "pending") throw new ConflictException("套装逾期已裁定，须核对原收据，不能再次归还计费");
      const pending = this.raiseFeeReview(order, "overdue", null, [...new Set([...(previous?.basis ?? []), ...review.basis])], "bundle-return", review.maximumAmount);
      if (previous && pending) { pending.id = previous.id; pending.createdAt = previous.createdAt; }
      return;
    }
    if (amount <= 0) return;
    const mode = order.ruleSnapshot?.overdue?.feeMode;
    const sourceId = batchId ? `return:${batchId}` : undefined;
    const basis = [
      ...(batchId ? [`归还批次 ${batchId}`] : []),
      `实际归还时间 ${returnedAt}`,
      `按规则 ${mode ?? "unknown"} 算出建议逾期费 ${roundMoney(amount)}`
    ];
    if (mode === "manual_review") {
      this.raiseFeeReview(order, "overdue", amount, basis, sourceId);
      return;
    }
    this.applyChargeTo(order, {
      code: batchId ? `overdue:${order.id}:return:${batchId}` : `overdue:${order.id}`,
      name: "逾期费用",
      type: "overdue",
      amount,
      sourceVersion: order.ruleVersion,
      detail: `${batchId ? `归还批次 ${batchId}；` : ""}实际归还时间 ${returnedAt}`
    });
  }

  /**
   * 提前归还退款落账（需求 4.6.8）：一条**负数**费用明细，直接冲减应收。
   *
   * `requiresReview` 时不落账——规则选了人工审批，金额只是建议，与检查异常"只记录建议、
   * 审核通过后才计费"是同一条纪律。需求要求保存调整前后金额，因此说明里带上落账前的最终应付。
   */
  private applyEarlyReturnRefundTo(
    order: RentalOrder,
    refund: { amount: number | null; maximumAmount?: number; requiresReview: boolean; basis: string[] }
  ) {
    if (hasWholeEarlyReturnReduction(order)) return;
    if (refund.amount === null) {
      if (!refund.requiresReview) throw new ConflictException("退款金额尚待核定，不能自动落账");
      this.raiseFeeReview(order, "early_return_refund", null, refund.basis, undefined, refund.maximumAmount);
      return;
    }
    if (!Number.isFinite(refund.amount) || refund.amount < 0) throw new BadRequestException("退款金额必须为有限的非负数字");
    if (refund.amount <= 0) {
      // 已知零额仍可待人工确认，但它不能授权正额核减。新版未知结果必须显式为null。
      if (refund.requiresReview) this.raiseFeeReview(order, "early_return_refund", 0, refund.basis);
      return;
    }
    if (refund.requiresReview) {
      this.raiseFeeReview(order, "early_return_refund", refund.amount, refund.basis);
      return;
    }
    const before = order.finalPayableAmount ?? order.payableAmount;
    this.applyChargeTo(order, {
      code: `early_return_refund:${order.id}`,
      name: "提前归还退租金",
      type: "early_return_refund",
      amount: -refund.amount,
      sourceVersion: order.ruleVersion,
      detail: `${refund.basis.join("；")}；落账前最终应付 ${before}`
    });
  }

  /** 承运实际租期正差额统一到仓库归还结算；负差额必须先人工核减，再另行办理资金退款。 */
  private applyCarrierRentalAdjustmentTo(
    order: RentalOrder,
    adjustment: { amount: number; signedAt: string; handoffAt: string; priceVersion?: string }
  ) {
    const amount = roundMoney(adjustment.amount);
    if (amount > 0) {
      this.applyChargeTo(order, {
        code: `carrier-rental:${order.id}`,
        name: "承运寄送租期重算差额（归还统一结算）",
        type: "extension",
        amount,
        sourceVersion: adjustment.priceVersion ?? order.pricingPlanVersion,
        detail: `按原价格版本及优惠快照，客户签收 ${adjustment.signedAt} 至交寄 ${adjustment.handoffAt} 重算；补款 ${amount}`
      });
      return;
    }
    if (amount < 0) {
      this.raiseFeeReview(order, "carrier_rental_refund", -amount, [
        `原价格版本 ${adjustment.priceVersion ?? order.pricingPlanVersion}`,
        `客户签收 ${adjustment.signedAt}`,
        `客户交承运商并有揽收凭证 ${adjustment.handoffAt}`,
        `全租期重算建议核减/退款 ${-amount}；需人工审核，实际退款另走资金流程`
      ], "carrier-rental");
    }
  }

  /**
   * 裁定一张费用审核单（需求 4.6.10 人工催收 / 4.6.8 人工审核退款）。
   *
   * 批准才落账，且认定金额不得超过规则算出的建议额——超出就不是"审核"而是另立一笔费用，
   * 那要走异常费用流程并留下自己的依据。驳回只记录结论，不产生任何金额。
   */
  async reviewOrderFeeReview(
    tenantId: string,
    orderId: string,
    reviewId: string,
    input: { decision: "approved" | "rejected"; reason: string; amount?: number },
    operator: string,
    tx: RentalFactTx
  ) {
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (!input.reason.trim()) throw new BadRequestException("请填写审核原因");
    const review = (order.feeReviews ?? []).find((row) => row.id === reviewId);
    if (!review || review.status !== "pending") throw new ConflictException("该费用审核单不存在或已处理");
    // `refund_due` 的宿主订单本就处于取消/爽约终态，且裁定金额中性（不落费用明细），
    // 因此对它放开终态闸门；其余类型仍禁止在已关闭/已取消订单上裁定，避免给终态订单再加收入。
    if (review.type !== "refund_due" && (order.status === RentalCoreOrderStatus.Completed || order.status === RentalCoreOrderStatus.Cancelled)) {
      throw new ConflictException("已关闭或已取消的订单不能再裁定费用审核");
    }
    if (input.decision === "approved" && review.type === "early_return_refund" && !review.sourceId
      && hasWholeEarlyReturnReduction(order)) throw new ConflictException("原提前归还来源已经核减，请驳回重复待办并核对原收据");
    const unknownAmount = review.suggestedAmount === null;
    const bundleOverdue = review.type === "overdue" && review.sourceId === "bundle-return" && unknownAmount;
    if (bundleOverdue && order.status !== RentalCoreOrderStatus.Settling) throw new ConflictException("套装须整单归还后统一裁定逾期费用");
    if (input.decision === "approved") {
      if (unknownAmount) {
        if ((!bundleOverdue && review.type !== "early_return_refund") || review.maximumAmount === undefined
          || !Number.isFinite(review.maximumAmount) || review.maximumAmount < 0 || input.amount === undefined) {
          throw new BadRequestException("建议金额待核定，须依据原快照显式填写认定金额");
        }
      } else if (!Number.isFinite(review.suggestedAmount) || review.suggestedAmount! < 0) {
        throw new BadRequestException("费用审核建议额无效，不能批准计费或退款");
      }
    }
    if (input.decision === "approved" && input.amount !== undefined && (!Number.isFinite(input.amount) || input.amount < 0)) {
      throw new BadRequestException("认定金额必须为有限的非负数字，不将空值当作零");
    }
    const decidedAmount = input.decision === "rejected" ? 0 : input.amount === undefined ? review.suggestedAmount! : roundMoney(input.amount);
    if (!Number.isFinite(decidedAmount) || decidedAmount < 0) throw new BadRequestException("认定金额必须为有限的非负数字");
    const ceiling = unknownAmount ? review.maximumAmount : review.suggestedAmount;
    if (input.decision === "approved" && ceiling !== undefined && ceiling !== null && decidedAmount > ceiling) {
      throw new BadRequestException(bundleOverdue ? `认定金额不能超过原规则费用上限 ${ceiling}` : unknownAmount ? `认定金额不能超过原快照最大核减额 ${ceiling}`
        : `认定金额不能超过规则建议的 ${ceiling}；需要多收请另立异常费用`);
    }
    if (input.decision === "approved" && unknownAmount && !bundleOverdue && decidedAmount > Math.max(0, order.finalPayableAmount ?? order.payableAmount)) {
      throw new ConflictException("当前剩余应收不足以核减该金额，请核对已办理的核减与退款");
    }
    const at = now();
    // `refund_due` 是取消/爽约后遗留资金的退款审核：批准只表示"退款/释放已获认可"，
    // 不动账（押金/预授权/多收租金的实际动作由资金区按权限单独办理）。因此它不进费用明细，
    // 也不进入下面按 review.type 映射费用明细 type 的分支——那个联合类型里没有 refund_due。
    if (input.decision === "approved" && decidedAmount > 0 && review.type !== "refund_due") {
      const isRefund = review.type === "early_return_refund" || review.type === "service_refund" || review.type === "carrier_rental_refund";
      const applied = this.applyChargeTo(order, {
        code: `${review.type}:${order.id}:${review.sourceId ?? "order"}`,
        name: review.type === "service_refund" ? "增值服务退款（已审核）" : review.type === "carrier_rental_refund" ? "承运寄送租期重算核减（已审核）" : isRefund ? "提前归还退租金（已审核）" : "逾期费用（已审核）",
        // 共享订单费用行把审核通过的租金核减统一记为提前归还退款类型；
        // 具体成因仍由费用名称、编码和审核单类型区分，避免把后台审核类型泄漏成新费用枚举。
        type: review.type === "service_refund" || review.type === "carrier_rental_refund" ? "early_return_refund" : review.type,
        amount: isRefund ? -decidedAmount : decidedAmount,
        sourceVersion: order.ruleVersion,
        detail: `${review.basis.join("；")}；审核认定 ${decidedAmount}（${unknownAmount ? "建议金额待核定" : `建议 ${review.suggestedAmount}`}）：${input.reason.trim()}`
      });
      if (!applied) throw new ConflictException("该来源费用已入账，不能重复批准另一张审核单；请核对历史后驳回重复待办");
    }
    order.feeReviews = (order.feeReviews ?? []).map((row) => row.id === reviewId
      ? { ...row, status: input.decision, decidedAmount, reason: input.reason.trim(), reviewedBy: operator, reviewedAt: at }
      : row);
    if (review.type === "service_refund" && review.sourceId) {
      order.serviceSnapshots = (order.serviceSnapshots ?? []).map((row) => row.occurrenceId === review.sourceId
        ? {
            ...row,
            refundStatus: input.decision === "approved" ? "approved_pending_refund" : "rejected",
            refundAmount: input.decision === "approved" ? decidedAmount : 0,
            refundReviewId: review.id
          }
        : row);
    }
    order.updatedAt = at;
    await this.factStore.saveOrderAggregate(order, [], tx);
    if (input.decision === "approved" && decidedAmount > 0 && ["early_return_refund", "service_refund", "carrier_rental_refund"].includes(review.type)) {
      await this.releaseReducedCredit(order, { kind: "fee_review", id: reviewId }, tx, operator);
    }
    return order;
  }

  /**
   * MKT-02D：办理已批准的服务退款。
   *
   * 审核只核减订单应收，不能冒充退款到账；本方法由控制器与 rental funding
   * event 放在同一事务中调用，只有资金事件成功后才把发生项推进到 refunded。
   */
  async refundServiceOccurrence(
    tenantId: string,
    orderId: string,
    occurrenceId: string,
    amount: number,
    operator: string,
    tx: RentalFactTx
  ) {
    const order = await this.lockedOrder(tenantId, orderId, tx);
    const occurrences = [...(order.serviceSnapshots ?? [])];
    const index = occurrences.findIndex((row) => row.occurrenceId === occurrenceId);
    if (index < 0) throw new NotFoundException("服务发生项不存在");
    const occurrence = occurrences[index] as RentalOrderServiceOccurrence;
    if (occurrence.refundStatus !== "approved_pending_refund") {
      throw new ConflictException("该服务退款尚未批准，或已经办理过实际退款");
    }
    const approvedAmount = roundMoney(Number(occurrence.refundAmount ?? 0));
    const requestedAmount = roundMoney(Number(amount));
    if (approvedAmount <= 0) throw new ConflictException("该服务没有可办理的退款金额");
    if (requestedAmount !== approvedAmount) {
      throw new ConflictException(`实际退款必须等于已批准金额 ${approvedAmount.toFixed(2)}`);
    }
    const review = (order.feeReviews ?? []).find((row) => row.id === occurrence.refundReviewId);
    if (!review || review.type !== "service_refund" || review.status !== "approved" || roundMoney(Number(review.decidedAmount ?? 0)) !== approvedAmount) {
      throw new ConflictException("服务退款审核事实不完整，不能办理实际退款");
    }
    const at = now();
    const next = { ...occurrence, refundStatus: "refunded" as const, refundedAt: at, refundedBy: operator };
    occurrences[index] = next;
    order.serviceSnapshots = occurrences;
    order.updatedAt = at;
    await this.factStore.saveOrderAggregate(order, [], tx);
    return { order: this.publicOrder(order), occurrence: next };
  }

  private async markPickedUp(
    tenantId: string,
    order: RentalOrder,
    assetChanges: AssetStatusChange[],
    tx: RentalFactTx | undefined,
    operator = "系统"
  ) {
    if (order.assignment) order.assignment.operationLock = undefined;
    const state = this.state(tenantId);
    const consumptions = new Map<string, { itemGroupId: string; locationId: string; quantity: number }>();
    for (const allocation of order.allocations) {
      if (!["locked", "allocated"].includes(allocation.status) || allocation.assetId) continue;
      const group = state.itemGroups.find((row) => row.id === allocation.itemGroupId);
      if (group?.inventoryMode !== RentalInventoryMode.Consumable) continue;
      const locationId = allocation.metadata?.locationId
        ?? order.reservations.find((row) => row.orderLineId === allocation.orderLineId && row.itemGroupId === allocation.itemGroupId)?.locationId
        ?? order.fulfillmentLocationId;
      const key = `${allocation.itemGroupId}:${locationId}`;
      const current = consumptions.get(key);
      if (current) current.quantity += allocation.quantity;
      else consumptions.set(key, { itemGroupId: allocation.itemGroupId!, locationId, quantity: allocation.quantity });
    }
    if (consumptions.size) {
      if (!tx || !this.factStore.consumeStockForOrder) throw new ConflictException("耗材库存组件未就绪，拒绝完成领取");
      await this.factStore.consumeStockForOrder(tenantId, order.id, [...consumptions.values()], operator, tx);
    }
    order.status = RentalCoreOrderStatus.Renting;
    order.reservations.forEach((row) => {
      const group = state.itemGroups.find((item) => item.id === row.itemGroupId);
      if (group?.inventoryMode === RentalInventoryMode.Consumable) {
        row.releasedQuantity = row.quantity;
        row.status = RentalReservationStatus.Released;
      } else {
        row.status = RentalReservationStatus.Fulfilled;
      }
    });
    order.allocations.forEach((row) => {
      if (!["locked", "allocated"].includes(row.status)) return;
      const group = state.itemGroups.find((item) => item.id === row.itemGroupId);
      if (group?.inventoryMode === RentalInventoryMode.Consumable) row.status = "consumed";
      else {
        row.status = "picked_up";
        if (row.assetId) assetChanges.push({ assetId: row.assetId, status: RentalAssetStatus.Rented });
      }
    });
  }

  private finishReturn(order: RentalOrder, overdueCharge: number, assetChanges: AssetStatusChange[]) {
    if (order.assignment) order.assignment.operationLock = undefined;
    // 归还只代表实物已回库。资金余额和异常费用仍须独立结算，不能直接冒充订单已关闭。
    order.status = RentalCoreOrderStatus.Settling;
    order.reservations.forEach((row) => { row.status = RentalReservationStatus.Released; row.releasedQuantity = row.quantity; });
    order.allocations.forEach((row) => {
      if (row.status !== "picked_up" && !(row.status === "locked" && Boolean(row.metadata?.exchangeId))) return;
      row.status = "returned";
      if (row.assetId) assetChanges.push({ assetId: row.assetId, status: RentalAssetStatus.Available });
    });
    if (overdueCharge > 0) this.applyOverdueTo(order, overdueCharge, now());
  }

  /**
   * 带异常归还时，本批归还的**数量库存**要进维修隔离，而不是回到可用池。
   *
   * 为什么是一刀切：检查异常（`CreateRentalInspectionRequest.exceptions`）只有
   * code/description/建议金额，不带商品或分配项标识，因此无法知道坏的是哪一件。
   * 序列化资产早就是同样的一刀切——有异常就把本批全部资产置维护——数量库存却什么
   * 都不做。宁可多隔离等人工核减，也不能把可能损坏的货直接算进下一单的可用量。
   *
   * 隔离量取"本批刚释放的量"（`releasedQuantity` 前后差值），不是预占总量：分批归还
   * 会多次走到这里，用总量会把前几批早已放回可用池的数量再隔离一遍。
   *
   * 处置地点取订单实际归还地点。跨地点归还的数量库存会在同一订单事务内从预占地点
   * 转入归还地点，并写成有来源的出入库流水；异常隔离随后记在实收地点，避免把尚未
   * 实际收回的库存重新放入原地点可租池。
   *
   * 出口是人工：`setStockBalance` 可以把维修量降回去（修好或核销后）。
   */
  private async recordReturnDispositions(
    tenantId: string,
    state: TenantRentalState,
    order: RentalOrder,
    inspectionId: string | undefined,
    returnBatchKey: string,
    releasedBefore: Map<string, number>,
    blockedReason: string | undefined,
    tx: RentalFactTx | undefined,
    operator = "系统",
    returnedAllocationIdsBefore = new Set<string>(),
    assetChanges: AssetStatusChange[] = [],
    scopedExceptionReasons?: Map<string, string>
  ) {
    const receivedAt = now();
    const bufferUntil = new Date(Date.parse(receivedAt) + Math.max(0, order.ruleSnapshot.fulfillment.returnBufferMinutes ?? 0) * 60_000).toISOString();
    const returnLocationId = order.returnLocationId ?? order.fulfillmentLocationId;
    const returnedAllocations = (order.allocations ?? []).filter((allocation) =>
      !returnedAllocationIdsBefore.has(allocation.id) && (allocation.status === "returned" || allocation.status === "released")
    );
    const workspaceId = getRequestWorkspaceId() ?? "";
    for (const reservation of order.reservations) {
      const quantity = Math.max(0, reservation.releasedQuantity - (releasedBefore.get(reservation.id) ?? 0));
      if (quantity <= 0) continue;
      const matching = returnedAllocations
        .filter((allocation) => {
          if (allocation.metadata?.reservationId) return allocation.metadata.reservationId === reservation.id;
          return allocation.orderLineId === reservation.orderLineId
            && allocation.itemGroupId === reservation.itemGroupId
            && (!allocation.metadata?.locationId || allocation.metadata.locationId === reservation.locationId);
        })
        .map((allocation) => ({ allocation, remaining: allocation.quantity }));
      const dispositionParts: Array<{ quantity: number; assetId?: string }> = [];
      let remaining = quantity;
      for (const match of matching) {
        if (remaining <= 0) break;
        const part = Math.min(remaining, match.remaining);
        if (part <= 0) continue;
        dispositionParts.push({ quantity: part, assetId: match.allocation.assetId });
        remaining -= part;
      }
      if (remaining > 0) dispositionParts.push({ quantity: remaining });
      for (const [partIndex, part] of dispositionParts.entries()) {
        const allocationKey = matching[partIndex]?.allocation.id ?? "fallback";
        const dedupeKey = `${returnBatchKey}:${reservation.id}:${allocationKey}`;
        const itemGroup = state.itemGroups.find((item) => item.id === reservation.itemGroupId);
        const unsafeHighRisk = itemGroup?.attributes?.securityRiskLevel === "high"
          && !order.ruleSnapshot.fulfillment.returnInspectionRequired
          && !this.hasReturnHold(order)
          && !inspectionId;
        const effectiveBlockReason = blockedReason ?? scopedExceptionReasons?.get(allocationKey) ?? (unsafeHighRisk ? "高风险商品未配置必需的归还检查或周转缓冲，需人工复核后方可恢复可租" : undefined);
        const shouldHold = Boolean(effectiveBlockReason) || this.hasReturnHold(order);
        const disposition: RentalStockDisposition = {
          id: id("disposition"), tenantId, workspaceId, orderId: order.id, inspectionId,
          returnBatchKey, dedupeKey, itemGroupId: reservation.itemGroupId, locationId: returnLocationId,
          assetId: part.assetId, quantity: part.quantity, receivedAt, bufferUntil,
          status: effectiveBlockReason ? "blocked" : shouldHold ? "buffered" : "restored",
          blockReason: effectiveBlockReason,
          restoredQuantity: shouldHold ? 0 : part.quantity,
          restoredAt: shouldHold ? undefined : receivedAt,
          restoredBy: shouldHold ? undefined : operator,
          createdAt: receivedAt, updatedAt: receivedAt
        };
        const persisted = await this.factStore.upsertStockDisposition(disposition, tx);
        // 处置事实本身不能阻止序列化资产被候选分配选中；在同一订单事务里先
        // 把它置为维护，待受控恢复入口把对应处置恢复后再改回可用。
        // 异常归还即使没有缓冲时间也必须保持维护，正常归还只在周转缓冲有效时保持维护。
        if (part.assetId) {
          const change = assetChanges.find((item) => item.assetId === part.assetId);
          if (change) {
            change.locationId = returnLocationId;
            if (shouldHold) change.status = RentalAssetStatus.Maintenance;
          } else {
            assetChanges.push({ assetId: part.assetId, status: shouldHold ? RentalAssetStatus.Maintenance : RentalAssetStatus.Available, locationId: returnLocationId });
          }
        }
        if (effectiveBlockReason && this.factStore.upsertWorkOrder) {
          const persistedDisposition = persisted ?? disposition;
          const workTimestamp = now();
          await this.factStore.upsertWorkOrder({
            id: id("work"), tenantId, workspaceId, workNo: `WO${workTimestamp.replace(/\D/g, "").slice(0, 14)}${randomUUID().slice(0, 4).toUpperCase()}`,
            type: workOrderTypeForReason(effectiveBlockReason), status: "pending", dispositionId: persistedDisposition.id,
            orderId: order.id, inspectionId, itemGroupId: reservation.itemGroupId, locationId: returnLocationId,
            assetId: part.assetId, quantity: part.quantity, reason: effectiveBlockReason, attachments: [],
            createdBy: operator, createdAt: workTimestamp, updatedAt: workTimestamp
          }, tx);
        }
      }
    }
  }

  private hasReturnHold(order: RentalOrder) {
    return Math.max(0, order.ruleSnapshot.fulfillment.returnBufferMinutes ?? 0) > 0;
  }

  private quarantinedReturnQuantities(
    state: TenantRentalState,
    order: RentalOrder,
    releasedBefore: Map<string, number>,
    returnBatchKey: string,
    sourceInspectionId: string | undefined,
    operator: string,
    blockedReason?: string,
    scopedExceptionReasons?: Map<string, string>,
    returnedAllocationIdsBefore = new Set<string>()
  ): StockQuarantineChange[] {
    const result: StockQuarantineChange[] = [];
    const returnLocationId = order.returnLocationId ?? order.fulfillmentLocationId;
    for (const reservation of order.reservations) {
      let quantity = reservation.releasedQuantity - (releasedBefore.get(reservation.id) ?? 0);
      if (quantity <= 0) continue;
      // 序列化资产已经通过 assetChanges 置维护；再按数量隔离一次就是同一件货扣两遍。
      // 用不抛异常的查找：归还路径不该因为配置里少一个分组就整单失败。
      const group = state.itemGroups.find((row) => row.id === reservation.itemGroupId);
      if ([RentalInventoryMode.Serialized, RentalInventoryMode.Consumable].includes(group?.inventoryMode as RentalInventoryMode)) continue;
      const unsafeHighRisk = group?.attributes?.securityRiskLevel === "high"
        && !order.ruleSnapshot.fulfillment.returnInspectionRequired && !this.hasReturnHold(order) && !sourceInspectionId;
      const affected = (order.allocations ?? []).filter((allocation) => !returnedAllocationIdsBefore.has(allocation.id)
        && ["returned", "released"].includes(allocation.status) && scopedExceptionReasons?.has(allocation.id)
        && (allocation.metadata?.reservationId ? allocation.metadata.reservationId === reservation.id
          : allocation.orderLineId === reservation.orderLineId && allocation.itemGroupId === reservation.itemGroupId
            && (!allocation.metadata?.locationId || allocation.metadata.locationId === reservation.locationId)));
      const scopedReason = affected.map((allocation) => scopedExceptionReasons?.get(allocation.id)).join("；") || undefined;
      if (!blockedReason && !this.hasReturnHold(order) && !unsafeHighRisk) {
        quantity = Math.min(quantity, affected.reduce((sum, allocation) => sum + allocation.quantity, 0));
        if (quantity <= 0) continue;
      }
      const reason = blockedReason ?? scopedReason ?? (unsafeHighRisk
        ? "高风险商品未配置必需的归还检查或周转缓冲，隔离待人工复核"
        : `订单归还后周转缓冲（${order.ruleSnapshot.fulfillment.returnBufferMinutes ?? 0} 分钟）`);
      result.push({
        itemGroupId: reservation.itemGroupId,
        locationId: returnLocationId,
        quantity,
        idempotencyKey: `return-quarantine:${createHash("sha256").update(`${order.id}:${returnBatchKey}:${reservation.id}`).digest("hex")}`,
        sourceOrderId: order.id,
        sourceOrderNo: order.orderNo,
        sourceInspectionId,
        batchNo: returnBatchKey,
        reason,
        operator
      });
    }
    return result;
  }

  private returnStockTransfers(
    state: TenantRentalState,
    order: RentalOrder,
    releasedBefore: Map<string, number>,
    returnBatchKey: string,
    sourceInspectionId: string | undefined,
    operator: string
  ): StockReturnTransfer[] {
    const targetLocationId = order.returnLocationId ?? order.fulfillmentLocationId;
    const transfers: StockReturnTransfer[] = [];
    for (const reservation of order.reservations) {
      const quantity = reservation.releasedQuantity - (releasedBefore.get(reservation.id) ?? 0);
      if (quantity <= 0 || reservation.locationId === targetLocationId) continue;
      const group = state.itemGroups.find((item) => item.id === reservation.itemGroupId);
      if (![RentalInventoryMode.Quantity, RentalInventoryMode.Bundle].includes(group?.inventoryMode as RentalInventoryMode)) continue;
      transfers.push({
        itemGroupId: reservation.itemGroupId,
        fromLocationId: reservation.locationId,
        toLocationId: targetLocationId,
        quantity,
        idempotencyKey: `return-transfer:${createHash("sha256").update(`${order.id}:${returnBatchKey}:${reservation.id}`).digest("hex")}`,
        sourceOrderId: order.id,
        sourceOrderNo: order.orderNo,
        sourceInspectionId,
        batchNo: returnBatchKey,
        reason: `订单 ${order.orderNo} 异地归还实物调拨`,
        operator
      });
    }
    return transfers;
  }

  /**
   * 把客户选择的定价分组解析为真正占用库存的产品型号。
   *
   * 解析使用同一份库存快照，并把此前已选行的需求一起计算；因此两个有重叠成员的
   * 定价分组不会各自看到同一份库存后同时承诺。报价快照保留 pricingGroupId，订单
   * 再把当时成员范围固化，后续修改分组不影响已成立订单。
   */
  async resolvePricingGroupQuoteRequest(tenantId: string, input: RentalQuoteRequest): Promise<RentalQuoteRequest> {
    const state = await this.factContext(tenantId);
    const snapshot = await this.loadInventorySnapshot(tenantId);
    type ResolvedLine = RentalQuoteRequest["lines"][number] & { itemGroupId: string };
    const resolved: Array<ResolvedLine | undefined> = new Array(input.lines.length);
    const choices: Array<{
      index: number;
      line: RentalQuoteRequest["lines"][number];
      pricingGroup: RentalPricingGroup;
      candidates: RentalItemGroup[];
    }> = [];
    const seenPricingGroups = new Set<string>();
    for (const [index, line] of input.lines.entries()) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new BadRequestException("租赁数量必须是正整数");
      if (!line.pricingGroupId) {
        if (!line.itemGroupId) throw new BadRequestException("请选择定价分组");
        this.group(state, line.itemGroupId);
        resolved[index] = { ...line, itemGroupId: line.itemGroupId,
          pricingUnit: line.pricingUnit ?? state.businessSettings.pricing.defaultUnit, reservationPrecision: "exact_model" };
        continue;
      }
      if (seenPricingGroups.has(line.pricingGroupId)) throw new BadRequestException("同一定价分组在一次报价中只能出现一行");
      seenPricingGroups.add(line.pricingGroupId);
      const pricingGroup = state.pricingGroups.find((row) => row.id === line.pricingGroupId && row.status === "enabled");
      if (!pricingGroup) throw new NotFoundException("定价分组不存在或已停用");
      const candidateIds = line.itemGroupId
        ? pricingGroup.memberItemGroupIds.filter((id) => id === line.itemGroupId)
        : pricingGroup.memberItemGroupIds;
      if (!candidateIds.length) throw new BadRequestException("所选产品型号不属于该定价分组");
      const candidates = candidateIds
        .map((memberId) => this.group(state, memberId))
        .filter((member) => member.status === "enabled")
        .sort((left, right) => {
          const leftAvailable = this.availableQuantity(state, snapshot, left, input.fulfillmentLocationId, input.startAt, input.endAt, new Set());
          const rightAvailable = this.availableQuantity(state, snapshot, right, input.fulfillmentLocationId, input.startAt, input.endAt, new Set());
          return rightAvailable - leftAvailable || left.code.localeCompare(right.code);
        });
      if (!candidates.length) throw new ConflictException(`${pricingGroup.name} 没有启用的承接产品型号`);
      const pricingUnit = line.pricingUnit ?? pricingGroup.defaultPricingUnit;
      if (!pricingUnit) throw new ConflictException(`${pricingGroup.name} 缺少默认计价单位，请先核对定价配置`);
      choices.push({ index, line: { ...line, pricingUnit }, pricingGroup, candidates });
    }

    // 先分配候选最少的分组，并在冲突时回溯。只按单行贪心会把公共型号先给
    // 选择较多的分组，导致另一个只有该型号可用的分组被误报无库存。
    choices.sort((left, right) => left.candidates.length - right.candidates.length || left.index - right.index);
    const assign = (position: number): boolean => {
      if (position >= choices.length) return true;
      const choice = choices[position];
      for (const candidate of choice.candidates) {
        resolved[choice.index] = {
          ...choice.line,
          itemGroupId: candidate.id,
          reservationPrecision: choice.line.itemGroupId ? "exact_model" : "group",
          pricingGroupMemberItemGroupIds: [...choice.pricingGroup.memberItemGroupIds],
          pricingGroupCode: choice.pricingGroup.code,
          pricingGroupName: choice.pricingGroup.name
        };
        const demand = resolved.filter((row): row is ResolvedLine => Boolean(row));
        const available = this.computeAvailability(state, snapshot, {
          locationId: input.fulfillmentLocationId,
          startAt: input.startAt,
          endAt: input.endAt,
          lines: demand.map((row) => ({ itemGroupId: row.itemGroupId, quantity: row.quantity }))
        }).available;
        if (available && assign(position + 1)) return true;
        resolved[choice.index] = undefined;
      }
      return false;
    };
    if (!assign(0)) {
      throw new ConflictException("所选定价分组在该时段没有可同时承接的产品型号库存");
    }
    return { ...input, lines: resolved.filter((row): row is ResolvedLine => Boolean(row)) };
  }

  async approveInspectionException(
    tenantId: string,
    orderId: string,
    inspectionId: string,
    exceptionIndex: number,
    amount: number,
    detail: string,
    tx: RentalFactTx,
    inspectionAt = now(),
    waiverReview?: { waiverDecision?: "covered" | "excluded"; allocationId?: string; liability?: "customer" | "normal_wear" | "lessor" | "third_party" | "undetermined";
      incidentAt?: string; incidentBasis?: string; waiverOccurrenceId?: string }
  ) {
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Settling) throw new ConflictException("只有待结算订单可以审核异常费用");
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException("异常费用必须为非负数字");
    if (amount > 0 && waiverReview?.liability !== "customer") {
      throw new ConflictException("计费前必须明确客户赔偿责任；正常损耗、非客户责任或责任未明不能向客户计费");
    }
    const waivers = (order.serviceSnapshots ?? []).filter((service) => service.serviceType === "damage_waiver");
    if (amount > 0 && waivers.length && !waiverReview?.waiverDecision) {
      throw new BadRequestException("必须根据冻结条款明确审核损坏免赔是否适用，并在审核理由中记录依据");
    }
    if (amount > 0 && waivers.length && (!waiverReview?.incidentAt || !waiverReview.incidentBasis?.trim())) {
      throw new BadRequestException("免赔裁定必须记录实际事故时间与核实依据，不能用检查时间代替");
    }
    const affectedGroupId = (order.allocations ?? []).find((allocation) => allocation.id === waiverReview?.allocationId)?.itemGroupId;
    const checkedAtMs = Date.parse(inspectionAt);
    if (!Number.isFinite(checkedAtMs)) throw new BadRequestException("检查时间无效，不能判定免赔保障");
    const damagedAtMs = waiverReview?.incidentAt ? Date.parse(waiverReview.incidentAt) : checkedAtMs;
    const rentalStartMs = Date.parse(order.actualRentalStartAt ?? order.startAt);
    if (!Number.isFinite(damagedAtMs) || damagedAtMs > checkedAtMs
      || (amount > 0 && Number.isFinite(rentalStartMs) && damagedAtMs < rentalStartMs)) {
      throw new BadRequestException("事故时间必须在实际起租至检查之间；既有损伤或归还后损伤须另行核实责任");
    }
    if (waiverReview?.waiverOccurrenceId && !waivers.some((service) => service.occurrenceId === waiverReview.waiverOccurrenceId)) {
      throw new BadRequestException("所选免赔发生项不属于该订单冻结快照");
    }
    // 使用已核实的事故时间，选择结果不得由延迟归还/延迟审核的时间改变。
    const eligibleWaivers = waiverReview?.waiverOccurrenceId
      ? waivers.filter((service) => service.occurrenceId === waiverReview.waiverOccurrenceId) : waivers;
    const selected = amount > 0 && waiverReview?.waiverDecision === "covered"
      ? selectDamageWaiver(eligibleWaivers, amount, damagedAtMs, affectedGroupId) : undefined;
    const waiver = selected?.service;
    if (amount > 0 && waiverReview?.waiverDecision === "covered" && !waiver) {
      throw new ConflictException("没有覆盖该事故时点及异常商品的免赔快照，请核对异常关联资源和条款");
    }
    const coveredAmount = roundMoney(selected?.customerAmount ?? amount);
    const existingDamage = order.chargeLines.filter((line) => line.type === "damage").reduce((sum, line) => sum + roundMoney(line.amount), 0);
    const limit = order.ruleSnapshot.damage.chargeLimit;
    if (limit !== undefined && existingDamage + coveredAmount > limit) throw new ConflictException(`异常费用超过订单规则上限 ${limit}`);
    if (coveredAmount > 0) {
      const applied = this.applyChargeTo(order, {
        code: `damage:${order.id}:${inspectionId}:${exceptionIndex}`,
        name: "检查异常费用",
        type: "damage",
        amount: coveredAmount,
        sourceVersion: order.ruleVersion,
        detail: `${detail}；责任认定：${waiverReview?.liability ?? "undetermined"}${waiverReview?.incidentAt ? `；事故时间：${waiverReview.incidentAt}；核实依据：${waiverReview.incidentBasis?.trim()}` : ""}${waiverReview?.waiverDecision ? `；免赔审核：${waiverReview.waiverDecision}${waiver ? `；服务：${waiver.serviceCode}；条款：${waiver.termsVersion}` : ""}` : ""}`
      });
      if (!applied) throw new ConflictException("该异常费用来源已入账，须核对原裁定或走正式复核，不能再次初审");
    }
    order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order, [], tx);
    return { order, approvedChargeAmount: coveredAmount, assessedDamageAmount: amount,
      waiverCustomerChargeCeiling: waiver ? coveredAmount : undefined,
      waiverOccurrenceId: waiver?.occurrenceId, waiverServiceId: waiver?.serviceId, waiverTermsVersion: waiver?.termsVersion,
      incidentAt: waiverReview?.incidentAt, incidentBasis: waiverReview?.incidentBasis?.trim() };
  }

  /**
   * 客户申诉后的正式金额复核（需求 4.6.12 / 4.6.13）。
   *
   * 原检查异常费用行不可编辑：先追加一条反向冲销，再追加新的损坏费用行。
   * 这样订单最终应收会按差额变化，原金额、调整后金额和原因仍可从订单与检查记录
   * 两处历史还原；实际补款或退款仍由资金链另行处理。
   */
  async adjustInspectionExceptionCharge(
    tenantId: string,
    orderId: string,
    inspectionId: string,
    exceptionIndex: number,
    previousAmount: number,
    suggestedAmount: number | undefined,
    amount: number,
    reason: string,
    operator: string,
    adjustmentSequence: number,
    tx: RentalFactTx,
    waiverCustomerChargeCeiling?: number
  ) {
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Settling) throw new ConflictException("只有待结算订单可以复核异常费用");
    if (!Number.isFinite(previousAmount) || previousAmount <= 0) throw new ConflictException("当前异常费用没有可复核的正数裁定");
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException("复核后的异常费用必须是非负数字");
    previousAmount = roundMoney(previousAmount);
    amount = roundMoney(amount);
    if (previousAmount <= 0) throw new ConflictException("当前异常费用没有可复核的正数入账");
    if (!reason.trim()) throw new BadRequestException("金额复核必须填写原因");
    if (Math.abs(amount - previousAmount) <= 0.005) throw new ConflictException("复核后的金额没有变化");
    if (waiverCustomerChargeCeiling !== undefined && (!Number.isFinite(waiverCustomerChargeCeiling)
      || waiverCustomerChargeCeiling < 0 || amount > waiverCustomerChargeCeiling + 0.005)) {
      throw new ConflictException("复核金额不能超过原免赔裁定的客户承担上限；须先重新审核免赔条款与责任依据");
    }
    if (suggestedAmount !== undefined && Number.isFinite(suggestedAmount) && amount - suggestedAmount > 0.005) {
      throw new BadRequestException(`复核金额不能超过检查员建议额 ${suggestedAmount}`);
    }
    const sourceCode = `damage:${order.id}:${inspectionId}:${exceptionIndex}`;
    const sourceLines = order.chargeLines.filter((line) => line.code === sourceCode || line.code.startsWith(`${sourceCode}:adjustment:`));
    if (!sourceLines.length) {
      throw new ConflictException("原异常费用行不存在，不能复核金额");
    }
    const sourceNet = roundMoney(sourceLines.reduce((sum, line) => sum + roundMoney(line.amount), 0));
    if (!Number.isFinite(sourceNet) || Math.abs(sourceNet - previousAmount) > 0.005) {
      throw new ConflictException("检查裁定金额与订单费用净额不一致，须先核对账目，不能重复冲销");
    }
    const existingDamage = order.chargeLines.filter((line) => line.type === "damage").reduce((sum, line) => sum + roundMoney(line.amount), 0);
    const nextDamage = roundMoney(existingDamage - previousAmount + amount);
    const limit = order.ruleSnapshot.damage.chargeLimit;
    if (limit !== undefined && nextDamage > limit + 0.005) throw new ConflictException(`复核后的异常费用超过订单规则上限 ${limit}`);
    if (!Number.isInteger(adjustmentSequence) || adjustmentSequence <= 0
      || sourceLines.some((line) => line.code.startsWith(`${sourceCode}:adjustment:${adjustmentSequence}:`))) {
      throw new ConflictException("金额复核序号无效或已使用，不能重复写入费用");
    }
    const sequence = adjustmentSequence;
    const detail = `客户申诉后金额复核：${previousAmount} → ${amount}；复核人：${operator}；${reason.trim()}`;
    this.applyChargeTo(order, {
      code: `${sourceCode}:adjustment:${sequence}:reversal`,
      name: "检查异常费用复核冲销",
      type: "damage",
      amount: -previousAmount,
      sourceVersion: order.ruleVersion,
      detail
    });
    if (amount > 0) {
      this.applyChargeTo(order, {
        code: `${sourceCode}:adjustment:${sequence}:replacement`,
        name: "检查异常费用复核后金额",
        type: "damage",
        amount,
        sourceVersion: order.ruleVersion,
        detail
      });
    }
    order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order, [], tx);
    return { order, previousAmount, approvedChargeAmount: amount };
  }

  async settleOrder(tenantId: string, orderId: string, tx: RentalFactTx, operator?: string) {
    const order = await this.lockedOrder(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Settling) throw new ConflictException("只有已归还待结算的订单可以关闭");
    const extensions = await this.factStore.listExtensions(tenantId, orderId, tx);
    if (extensions.some((row) => row.status === "effective" && row.pricingSnapshot?.refundReview?.status === "pending")) {
      throw new ConflictException("还有续租差额退款待审核，请先处理后关闭订单");
    }
    // 人工审核的逾期费与提前归还退款同理：未裁定就关单等于静默免除，
    // 这也是「人工审核」这个规则选项唯一能兑现的地方。
    if ((order.feeReviews ?? []).some((row) => row.status === "pending")) {
      throw new ConflictException("还有费用审核单待处理，请先裁定后关闭订单");
    }
    // MKT-02D：未收口的增值服务（未开始/执行中）不能静默关单——
    // 容量与净额退款必须先通过 开始/完成/取消/失败/未到场 落定，
    // 否则会出现「订单已完结、服务还挂着」的孤儿履约。
    // 存量订单的服务快照没有 occurrenceId，也没有实际履约字段；它们不能被新状态机操作，
    // 不能把缺省值当成“未开始”从而永久阻断历史订单结算。只有已被新链路标记为发生项的
    // 服务，才由 MKT-02D 的状态机负责收口。
    const openOccurrences = (order.serviceSnapshots ?? []).filter((row) =>
      Boolean(row.occurrenceId) && ["not_started", "in_progress"].includes(row.executionStatus ?? "not_started")
    );
    if (openOccurrences.length) {
      throw new ConflictException(
        `还有 ${openOccurrences.length} 项增值服务未收口（未开始或执行中），请先完成、取消或记录失败后再关闭订单`
      );
    }
    const inspections = await this.factStore.listInspections(tenantId, orderId, tx);
    const inspectionError = inspectionClosureError(inspections);
    if (inspectionError) throw new ConflictException(inspectionError);
    await this.runHook(
      tenantId,
      "settlement",
      { type: "order", id: order.id },
      { order, settlement: { kind: "close", finalPayableAmount: order.finalPayableAmount } },
      tx,
      operator,
      this.orderHookInstances(tenantId, order)
    );
    order.status = RentalCoreOrderStatus.Completed;
    order.completedAt = now();
    order.updatedAt = order.completedAt;
    // 关单前作废遗留的待补款续租：留着就是一个点了必然失败的补款按钮。
    await this.voidPendingExtensions(tenantId, orderId, tx);
    await this.factStore.saveOrderAggregate(order, [], tx);
    return order;
  }

  /**
   * 当前请求应当读写的经营空间。
   *
   * 有会话取会话空间（守卫已 fail-closed 保证经营域必然有值）；
   * 无会话（启动预热、快照回填、seed）取该租户的默认空间。
   * 两者都拿不到就明确拒绝——绝不猜一个空间。
   */
  /**
   * 该空间的配置 id 前缀。默认空间沿用 tenantId（保持升级前的既有 id 不变），
   * 其余空间用自己的 id，避免同租户多空间生成相同 id 后互相 upsert 覆盖。
   */
  private seedPrefix(tenantId: string, workspaceId: string): string {
    return this.defaultWorkspaceByTenant.get(tenantId) === workspaceId ? tenantId : workspaceId;
  }

  /**
   * 当前请求应当读写的经营空间。供同模块的其他服务（订单确认）复用同一口径，
   * 避免它们各自再实现一次「会话空间优先、否则租户默认空间」的解析。
   */
  resolveWorkspaceId(tenantId: string): string {
    return this.workspaceOf(tenantId);
  }

  /**
   * CAM-01A：把订单/报价的行解析成「已解析器材行」供能力 Hook 判定。
   *
   * 实现委托给与品类无关的公共富化（`capability-equipment.ts`），报价、订单与配货三处
   * 共用同一份逻辑与同一套错误处理——早前报价侧另有一份实现，找不到商品时用 id
   * 冒充名称，于是同一条脏数据在报价与下单得出不同结果。
   */
  buildCapabilityEquipment(
    tenantId: string,
    lines: Array<{ itemGroupId: string; quantity: number }>
  ): RentalCapabilityEquipmentLine[] {
    return buildCapabilityEquipment(this.capabilityEquipmentGroups(tenantId), lines);
  }

  async buildOrderCapabilityEquipment(tenantId: string, order: RentalOrder, tx?: RentalFactTx) {
    const fields = await this.orderCapabilityFields(order, tx);
    return buildCapabilityEquipment(this.capabilityEquipmentGroups(tenantId), order.lines.map((line) => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })), fields);
  }

  private async orderCapabilityFields(order: RentalOrder, tx?: RentalFactTx) {
    if (!order.categoryVersionId) return undefined; // Historical legacy orders have an empty capability execution list.
    if (!this.categoryResolver) throw new ConflictException("订单品类版本解析器不可用，不能执行能力检查");
    const definition = await this.categoryResolver.forVersion(order.categoryCode, order.categoryVersionId, tx);
    return definition.businessModel.assetFields;
  }

  /** 商品组查找表，供公共富化使用。 */
  private capabilityEquipmentGroups(tenantId: string): Map<string, CapabilityEquipmentGroup> {
    const state = this.state(tenantId);
    return new Map(
      state.itemGroups.map((group) => [
        group.id,
        { id: group.id, name: group.name, inventoryMode: group.inventoryMode, attributes: group.attributes }
      ])
    );
  }

  /** 供订单确认应用服务复用：把订单固化的能力快照还原成 Hook 执行名单（CORE-EXT-02D）。 */
  capabilityInstancesFromSnapshot(
    tenantId: string,
    snapshot: NonNullable<RentalOrder["capabilitySnapshot"]>
  ): WorkspaceCapabilityInstance[] {
    return WorkspaceCapabilityService.instancesFromSnapshot(tenantId, this.workspaceOf(tenantId), snapshot);
  }

  private workspaceOf(tenantId: string): string {
    const fromSession = getRequestWorkspaceId();
    if (fromSession) return fromSession;
    const fallback = this.defaultWorkspaceByTenant.get(tenantId);
    if (!fallback) throw new ConflictException("当前 SaaS 租户尚未建立经营空间");
    return fallback;
  }

  private state(tenantId: string) {
    const workspaceId = this.workspaceOf(tenantId);
    let state = this.states.get(workspaceId);
    if (!state) {
      // 品类以**经营空间**为准（需求 3），不再按租户猜测。
      const categoryCode = this.categoryByWorkspace.get(workspaceId);
      if (!categoryCode) throw new ConflictException("当前经营空间尚未初始化经营品类");
      state = this.seedState(tenantId, categoryCode, this.seedPrefix(tenantId, workspaceId));
      this.states.set(workspaceId, state);
    }
    // 快照 JSON 直接当 TenantRentalState 装载，早于某字段引入的快照不含它。
    // 这里统一补默认值，否则读路径上会抛 "Cannot read properties of undefined"。
    //
    // 两类都要补，实测各自炸过一次：
    //   - 数组字段：`state.sampleAssets.length`（/rental/v1/assets 500）
    //   - businessSettings：`state.businessSettings.updatedBy`（persistConfig 500）
    // 补 businessSettings 用 defaultBusinessSettings 重建而不是留空对象——
    // 它有十余个下游读取点，空对象只会把崩溃点往后推。
    state.operators ??= [];
    state.sampleAssets ??= [];
    state.sampleStockBalances ??= [];
    state.couponTemplates ??= [];
    state.inspectionTemplates ??= [];
    state.itemGroups ??= [];
    state.pricingGroups ??= state.itemGroups.map((group) => this.defaultPricingGroup(group));
    state.locations ??= [];
    if (!state.businessSettings) {
      const definition = this.category(state.profile.categoryCode);
      state.businessSettings = defaultBusinessSettings(state.profile.tenantId, definition);
    }
    return state;
  }
  private category(code: RentalCategoryCode) { const found = categories.find((row) => row.code === code); if (!found) throw new BadRequestException("未知经营品类"); return found; }
  private async effectiveCategory(tenantId: string, code: RentalCategoryCode): Promise<RentalCategoryDefinition> {
    // 单测可直接构造 RentalCoreService；正式装配必须由 AppModule 注入解析器。
    if (!this.categoryResolver) return this.category(code);
    const resolved = await this.categoryResolver.forWorkspace(tenantId, this.workspaceOf(tenantId));
    if (resolved.definition.code !== code) throw new ConflictException("经营空间品类与商品资料不一致");
    return resolved.definition;
  }
  private async categoryWriteContext(tenantId: string, code: RentalCategoryCode, allowProfileInitialization = false) {
    const current = await this.refreshCommittedWorkspace(tenantId);
    if (current) {
      if (current.definition.code !== code) throw new ConflictException("经营空间品类与商品资料不一致");
      if (!current.effectiveProfile && !allowProfileInitialization) throw new ConflictException("经营空间档案尚未持久化，请先明确保存档案");
      return { definition: current.definition, binding: current.binding };
    }
    if (!this.categoryResolver) return { definition: this.category(code), binding: undefined };
    const resolved = await this.categoryResolver.forWorkspace(tenantId, this.workspaceOf(tenantId));
    if (resolved.definition.code !== code) throw new ConflictException("经营空间品类与商品资料不一致");
    return { definition: resolved.definition, binding: { categoryVersionId: resolved.categoryVersionId, adoptionRevision: resolved.adoptionRevision } };
  }
  private group<T extends Pick<RentalItemGroup, 'id'>>(state: { itemGroups: T[] }, groupId: string) { const found = state.itemGroups.find((row) => row.id === groupId); if (!found) throw new NotFoundException("标的分组不存在"); return found; }
  private location(state: TenantRentalState, locationId: string) { const found = state.locations.find((row) => row.id === locationId); if (!found) throw new NotFoundException("履约网点不存在"); return found; }

  private activeLocation(state: TenantRentalState, locationId: string, capability?: RentalFulfillmentLocation["capabilities"][number]) {
    const location = this.location(state, locationId);
    const operator = location.operatorId ? state.operators.find((row) => row.id === location.operatorId) : undefined;
    if (location.status !== "enabled") throw new ConflictException(`${location.name}已停用`);
    if (!operator || operator.status !== "enabled") throw new ConflictException(`${location.name}所属经营主体已停用或不存在`);
    if (capability && !location.capabilities.includes(capability)) throw new ConflictException(`${location.name}不支持${capability === "pickup" ? "领取" : capability === "return" ? "归还" : capability === "delivery" ? "配送" : "仓储"}`);
    return location;
  }

  private validateFulfillmentSelection(
    state: TenantRentalState,
    mode: RentalFulfillmentMode,
    fulfillmentLocationId: string,
    returnLocationId?: string
  ) {
    const outboundCapability = mode === "delivery" || mode === "onsite_delivery" ? "delivery" : "pickup";
    const fulfillmentLocation = this.activeLocation(state, fulfillmentLocationId, outboundCapability);
    const fulfillmentOperator = fulfillmentLocation.operatorId ? state.operators.find((row) => row.id === fulfillmentLocation.operatorId) : undefined;
    if (mode === "partner_pickup_return" && fulfillmentOperator?.type !== "partner") throw new ConflictException("合作点取还必须选择合作经营主体的地点");
    const returnLocation = this.activeLocation(state, returnLocationId ?? fulfillmentLocationId, "return");
    return { fulfillmentLocation, returnLocation };
  }

  private locationSnapshot(state: TenantRentalState, location: RentalFulfillmentLocation): RentalFulfillmentLocationSnapshot {
    const operator = location.operatorId ? state.operators.find((row) => row.id === location.operatorId) : undefined;
    if (!operator) throw new ConflictException(`${location.name}缺少经营主体，不能生成订单快照`);
    return {
      id: location.id, code: location.code, name: location.name, type: location.type,
      capabilities: [...location.capabilities], address: location.address, contactName: location.contactName,
      contactPhone: location.contactPhone, businessHours: location.businessHours,
      operator: { id: operator.id, code: operator.code, name: operator.name, type: operator.type, settlementMode: operator.settlementMode }
    };
  }

  /** Reads only current admission facts, never overwrites an order's historical
   * location/operator snapshot. A missing authority must not trust the cache. */
  private async fulfillmentAdmission(tenantId: string, requirements: RentalFulfillmentRequirement[], tx?: RentalFactTx) {
    if (!this.configStore?.readFulfillmentAdmission) throw new ConflictException("履约地点权威读取不可用，不能承接新业务");
    return this.configStore.readFulfillmentAdmission(tenantId, this.resolveWorkspaceId(tenantId), requirements, tx);
  }

  async assertOrderFulfillmentAdmission(tenantId: string, order: RentalOrder, tx?: RentalFactTx, includeReturn = false) {
    const requirements: RentalFulfillmentRequirement[] = [{ locationId: order.fulfillmentLocationId,
      capability: order.fulfillmentMode === "delivery" || order.fulfillmentMode === "onsite_delivery" ? "delivery" : "pickup",
      partner: order.fulfillmentMode === "partner_pickup_return" }];
    if (includeReturn) requirements.push({ locationId: order.returnLocationId ?? order.fulfillmentLocationId, capability: "return" });
    return this.fulfillmentAdmission(tenantId, requirements, tx);
  }

  /** Only the uncommitted new aggregate receives current creation snapshots.
   * Later admission reads never refresh an existing order's historical facts. */
  async bindOrderCreationFulfillment(tenantId: string, order: RentalOrder, tx: RentalFactTx) {
    const current = await this.assertOrderFulfillmentAdmission(tenantId, order, tx, true);
    const state = { ...this.state(tenantId), locations: current.locations, operators: current.operators };
    const location = current.locations.find(row => row.id === order.fulfillmentLocationId)!;
    const returnLocation = current.locations.find(row => row.id === (order.returnLocationId ?? order.fulfillmentLocationId))!;
    order.fulfillmentLocationName = location.name;
    order.fulfillmentLocationSnapshot = this.locationSnapshot(state, location);
    order.returnLocationName = returnLocation.name;
    order.returnLocationSnapshot = this.locationSnapshot(state, returnLocation);
  }
  private async requireOrder(tenantId: string, orderId: string) {
    const order = await this.factStore.findOrder(tenantId, orderId);
    if (!order) throw new NotFoundException("租赁订单不存在");
    return order;
  }
  /**
   * 取订单聚合用于状态推进：先锁订单行，再**在同一事务内**重读。
   *
   * 顺序不能反。若先读后锁，读到的是锁等待之前的旧快照，拿到锁时状态可能已被
   * 并发动作改掉，状态机据旧状态放行并整体写回，直接覆盖对方的结果。
   * 也不能沿用 requireOrder：它走 this.prisma，读根本不在事务内。
   */
  private async lockedOrder(tenantId: string, orderId: string, tx?: RentalFactTx) {
    if (!tx) return this.requireOrder(tenantId, orderId);
    await this.factStore.lockOrder(tenantId, orderId, tx);
    const order = await this.factStore.findOrder(tenantId, orderId, tx);
    if (!order) throw new NotFoundException("租赁订单不存在");
    const lock = order.assignment?.operationLock;
    const identity = getRequestIdentity();
    if (lock && (lock.ownerId !== identity?.userId || lock.token !== identity?.operationToken || Date.parse(lock.expiresAt) <= Date.now())) {
      throw new ConflictException(`订单由 ${lock.ownerName} 办理中，或办理凭证已过期，请重新接手`);
    }
    return order;
  }

  /** Preview risk checks cannot authorize a later free or paid extension. Reuse
   * the original customer locks/risk reader before any extension write. */
  private async assertExtensionMembershipSecurity(
    tenantId: string, order: RentalOrder, pricing: RentalOrderExtension["pricingSnapshot"], tx: RentalFactTx
  ) {
    const adopted = (pricing?.membershipBenefitEvaluations ?? order.membershipBenefitEvaluations ?? []).filter(row =>
      (row.appliesTo === "deposit" || row.appliesTo === "preauthorization") && row.appliedAmount > 0);
    if (!adopted.length) return;
    if (!order.membershipSnapshot || !this.memberships?.hasOpenRiskForBooking) {
      throw new ConflictException("当前会员风险读取不可用，不能生效保留保证金减免的续租");
    }
    const groups = this.state(tenantId).itemGroups;
    for (const benefit of adopted) {
      if (benefit.securityRiskCheck !== "clear" || !benefit.securityPolicySnapshot?.enabled || !benefit.securityRiskAssessments?.length) {
        throw new ConflictException("原保证金减免缺少风控依据，续租须人工核定");
      }
      for (const assessment of benefit.securityRiskAssessments) {
        const currentRisk = groups.find(group => group.id === assessment.itemGroupId)?.attributes.securityRiskLevel ?? "unclassified";
        if (currentRisk !== assessment.riskLevel) throw new ConflictException("商品风险等级已变化，不能生效原保证金减免续租");
      }
    }
    let openRisk: boolean;
    try {
      openRisk = await this.memberships.hasOpenRiskForBooking(tenantId, this.resolveWorkspaceId(tenantId), order.membershipSnapshot, tx);
    } catch { throw new ConflictException("当前会员风险无法核实，续租须人工核定"); }
    if (openRisk) throw new ConflictException("会员存在未关闭风险，不能自动生效保证金减免续租");
  }

  /** 资格闸门只看订单的规则快照，会员/员工关系由 MembershipService 按当前空间重读。 */
  private async assertOrderQualification(
    tenantId: string,
    order: RentalOrder,
    action: "pickup" | "extension",
    validThroughAt: string,
    tx?: RentalFactTx
  ) {
    const rule = order.ruleSnapshot.qualification;
    // 没有证件要求不等于原会员/企业关系仍有效；旧非会员单不伪造会员身份。
    if (!rule.required && !order.membershipSnapshot) return;
    if (!this.memberships) throw new ConflictException("当前服务未装配会员资格校验，不能继续办理该订单");
    await this.memberships.assertBookingQualificationForAction(
      tenantId,
      this.resolveWorkspaceId(tenantId),
      order.membershipSnapshot,
      rule,
      action,
      { validThroughAt, minimumValidityFromAt: order.actualRentalStartAt ?? order.startAt },
      tx
    );
  }

  async validateAllocationEquipment(tenantId: string, order: RentalOrder, allocations: RentalAllocation[], tx: RentalFactTx, operator?: string) {
    await this.assertOrderFulfillmentAdmission(tenantId, order, tx);
    const assets = await this.factStore.listAssets(tenantId, tx);
    const groups = this.capabilityEquipmentGroups(tenantId);
    const picked = allocations.filter((a) => a.assetId).map((a) => {
      const asset = assets.find((s) => s.id === a.assetId);
      const itemGroupId = a.itemGroupId ?? order.lines.find(line => line.id === a.orderLineId)?.itemGroupId;
      if (!asset || !itemGroupId || asset.itemGroupId !== itemGroupId) throw new ConflictException("实际交付资产缺失或商品归属已变化，不能略过安全检查");
      return asset;
    });
    for (const asset of picked) this.assertAssetDocumentsCoverPeriod(this.state(tenantId), asset, rentalOrderDueAt(order));
    const executionFields = await this.orderCapabilityFields(order, tx);
    const equipment = [...buildCapabilityEquipmentFromAssets(groups, picked, executionFields), ...buildCapabilityEquipment(groups, allocations.filter((a) => !a.assetId).map((a) => ({ itemGroupId: a.itemGroupId!, quantity: a.quantity })), executionFields)];
    await this.runHook(tenantId, "allocation_dispatch", { type: "order", id: order.id }, { ...order, equipment, capabilityExceptions: (order.capabilityExceptions ?? []).map((a) => ({ capability: a.capability, code: a.riskCode, reason: a.reason })) }, tx, operator, this.orderHookInstances(tenantId, order));
  }

  /**
   * SHIP-01：签收晚于预约开始时，先对平移后的实际租期和缓冲期做冲突复核。
   * 有后续订单占用相同序列化资产或数量库存时拒绝自动起租，交运营改配/人工协调。
   */
  private async assertCarrierPickupWindowAvailable(
    tenantId: string,
    order: RentalOrder,
    actualStartAt: string,
    dueAt: string,
    tx?: RentalFactTx
  ) {
    const state = this.state(tenantId);
    const period = bufferedRentalPeriod(actualStartAt, dueAt, order.ruleSnapshot);
    const groups = new Map(state.itemGroups.map((row) => [row.id, row]));
    if (tx) {
      const targets = new Map<string, { itemGroupId: string; locationId: string; inventoryMode: RentalInventoryMode }>();
      for (const row of order.reservations) {
        const group = groups.get(row.itemGroupId);
        if (!group) throw new ConflictException("承运订单商品已不存在，需人工核对配货");
        targets.set(`${row.itemGroupId}:${row.locationId}`, { itemGroupId: row.itemGroupId, locationId: row.locationId, inventoryMode: group.inventoryMode });
      }
      for (const row of [...targets.values()].sort((a, b) => `${a.itemGroupId}:${a.locationId}`.localeCompare(`${b.itemGroupId}:${b.locationId}`))) {
        await this.factStore.lockInventoryTargets(tenantId, row.locationId, [{ itemGroupId: row.itemGroupId, inventoryMode: row.inventoryMode }], tx);
        await this.factStore.lockAssetsForAllocation(tenantId, row.itemGroupId, row.locationId, tx);
      }
    }
    const [reservations, balances, assets] = await Promise.all([
      this.factStore.activeReservations(tenantId, tx),
      this.factStore.listStockBalances(tenantId, tx),
      this.factStore.listAssets(tenantId, tx)
    ]);
    const demands = new Map<string, { itemGroupId: string; locationId: string; quantity: number }>();
    for (const reservation of order.reservations) {
      if (reservation.status === RentalReservationStatus.Released) continue;
      const quantity = Math.max(0, reservation.quantity - reservation.releasedQuantity);
      if (!quantity) continue;
      const key = `${reservation.itemGroupId}:${reservation.locationId}`;
      const demand = demands.get(key) ?? { itemGroupId: reservation.itemGroupId, locationId: reservation.locationId, quantity: 0 };
      demand.quantity += quantity;
      demands.set(key, demand);
    }
    for (const demand of demands.values()) {
      const overlapping = reservations.filter((row) => row.orderId !== order.id && row.itemGroupId === demand.itemGroupId
        && row.locationId === demand.locationId && Date.parse(row.startAt) < Date.parse(period.endAt)
        && Date.parse(row.endAt) > Date.parse(period.startAt));
      const group = groups.get(demand.itemGroupId);
      if (!group) throw new ConflictException("承运订单商品已不存在，需人工核对配货");
      if (group.inventoryMode === RentalInventoryMode.Quantity || group.inventoryMode === RentalInventoryMode.Consumable) {
        const balance = balances.find((row) => row.itemGroupId === demand.itemGroupId && row.locationId === demand.locationId);
        const otherReservations = reservations.filter((row) => row.orderId !== order.id && row.itemGroupId === demand.itemGroupId && row.locationId === demand.locationId);
        const reserved = group.inventoryMode === RentalInventoryMode.Consumable
          ? otherReservations.reduce((sum, row) => sum + row.quantity, 0)
          : peakReservedQuantity(overlapping, period.startAt, period.endAt);
        if (!balance || balance.onHandQuantity - balance.maintenanceQuantity - reserved < demand.quantity) {
          throw new ConflictException(group.inventoryMode === RentalInventoryMode.Consumable
            ? "客户签收时可用耗材库存已被其他订单预留，请先人工协调，不能自动起租"
            : "客户签收时间导致租期/缓冲期与后续数量库存冲突，请先人工协调，不能自动起租");
        }
        continue;
      }
      const assignedAssetIds = new Set(order.allocations.filter((row) => row.itemGroupId === demand.itemGroupId && row.assetId
        && ["locked", "allocated"].includes(row.status)).map((row) => row.assetId!));
      const eligibleAssetIds = assets.filter((asset) => asset.itemGroupId === demand.itemGroupId && asset.locationId === demand.locationId
        && [RentalAssetStatus.Available, RentalAssetStatus.Reserved].includes(asset.status)).map((asset) => asset.id);
      if (carrierSerializedCapacityConflict({
        eligibleAssetIds,
        currentOrderAssetIds: [...assignedAssetIds],
        overlappingReservations: overlapping.map((row) => ({ quantity: row.quantity, assetIds: row.assetIds }))
      })) {
        throw new ConflictException("客户签收时间导致已锁定单件资产与后续订单冲突，请先改配或人工协调，不能自动起租");
      }
    }
  }

  private async assertAllocatedPickupReady(tenantId: string, order: RentalOrder, tx?: RentalFactTx) {
    if (!allocationComplete(order, true)) throw new ConflictException("必须锁定全部必要资源才能领取");
    await this.assertOrderFulfillmentAdmission(tenantId, order, tx);
    const state = this.state(tenantId);
    const active = order.allocations.filter((a) => ["locked", "allocated"].includes(a.status));
    if (tx) for (const r of [...order.reservations].sort((a, b) => `${a.itemGroupId}:${a.locationId}`.localeCompare(`${b.itemGroupId}:${b.locationId}`))) await this.factStore.lockAssetsForAllocation(tenantId, r.itemGroupId, r.locationId, tx);
    const assets = await this.factStore.listAssets(tenantId, tx);
    const stock = await this.factStore.listStockBalances(tenantId, tx);
    const reservations = await this.factStore.activeReservations(tenantId, tx);
    const rentalStartAt = order.actualRentalStartAt ?? order.startAt;
    const rentalDueAt = rentalOrderDueAt(order);
    const period = bufferedRentalPeriod(rentalStartAt, rentalDueAt, order.ruleSnapshot);
    for (const a of active.filter((a) => !a.assetId)) {
      const balance = stock.find((s) => s.itemGroupId === a.itemGroupId && s.locationId === order.fulfillmentLocationId);
      const needed = active.filter((x) => !x.assetId && x.itemGroupId === a.itemGroupId).reduce((sum, x) => sum + x.quantity, 0);
      const other = reservations.filter((r) => r.orderId !== order.id && r.itemGroupId === a.itemGroupId && r.locationId === order.fulfillmentLocationId);
      const group = state.itemGroups.find((row) => row.id === a.itemGroupId);
      const reserved = group?.inventoryMode === RentalInventoryMode.Consumable
        ? other.reduce((sum, row) => sum + row.quantity, 0)
        : peakReservedQuantity(other, period.startAt, period.endAt);
      if (!balance || balance.onHandQuantity - balance.maintenanceQuantity - reserved < needed) throw new ConflictException("数量库存不足或存在维护占用，不能交付");
    }
    for (const a of active) {
      if (!a.assetId) continue;
      const asset = assets.find((s) => s.id === a.assetId);
      if (!asset || ![RentalAssetStatus.Available, RentalAssetStatus.Reserved].includes(asset.status) || asset.locationId !== order.fulfillmentLocationId) throw new ConflictException("锁定资产尚未回库、正在维护或不在领取地点，请先改配或处理整备");
      this.assertAssetDocumentsCoverPeriod(state, asset, rentalDueAt);
    }
    if (tx) await this.validateAllocationEquipment(tenantId, order, active, tx);
  }
  private validatePeriod(startAt: string, endAt: string) { const start = new Date(startAt).getTime(); const end = new Date(endAt).getTime(); if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new BadRequestException("租赁起止时间无效"); }
  private assertAssetDocumentsCoverPeriod(state: TenantRentalState, asset: RentalAsset, rentalEndAt: string) {
    const error = assetValidityError(
      state.profile.categoryCode,
      asset.attributes ?? {},
      rentalEndAt,
      state.businessSettings.calendar.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE
    );
    if (error) throw new ConflictException(`${asset.assetNo}：${error}`);
  }
  private validateAttributes(
    fields: RentalAttributeDefinition[],
    scope: "item_group" | "asset",
    attributes: Record<string, unknown>,
    aliases: Record<string, unknown> = {},
    validateRequired = true
  ) {
    validateRentalCategoryAttributes(fields, scope, attributes, aliases, validateRequired);
  }

  private assertUniqueAttributes<T extends { id: string; attributes: Record<string, unknown> }>(
    fields: RentalAttributeDefinition[],
    scope: "item_group" | "asset",
    attributes: Record<string, unknown>,
    records: T[],
    currentId?: string,
    aliases: Record<string, unknown> = {},
    aliasesOf: (record: T) => Record<string, unknown> = () => ({})
  ) {
    for (const field of fields.filter((item) => item.scope === scope && item.unique)) {
      const candidate = this.normalizedUniqueValue(aliases[field.code] ?? attributes[field.code]);
      if (!candidate) continue;
      const duplicate = records.find((record) => {
        if (record.id === currentId) return false;
        const recordAliases = aliasesOf(record);
        return this.normalizedUniqueValue(recordAliases[field.code] ?? record.attributes[field.code]) === candidate;
      });
      if (duplicate) throw new ConflictException(`${field.label}已存在`);
    }
  }

  private normalizedUniqueValue(value: unknown): string | undefined {
    return normalizedRentalAttributeValue(value);
  }

  private uniqueAttributeClaims(
    fields: RentalAttributeDefinition[],
    scope: "item_group" | "asset",
    attributes: Record<string, unknown>,
    aliases: Record<string, unknown> = {}
  ): RentalUniqueAttributeClaim[] {
    return fields
      .filter((field) => field.scope === scope && field.unique)
      .map((field) => ({
        fieldCode: field.code,
        label: field.label,
        normalizedValue: this.normalizedUniqueValue(aliases[field.code] ?? attributes[field.code])
      }))
      .filter((claim): claim is RentalUniqueAttributeClaim => Boolean(claim.normalizedValue));
  }
  /**
   * 可用量计算所需的库存事实。一次取齐后计算全程同步——套装展开是递归的，
   * 若在递归里逐层查库会放大成 N 次查询，且让纯算术逻辑变得难以复核和单测。
   */
  private async loadInventorySnapshot(tenantId: string, tx?: RentalFactTx): Promise<InventorySnapshot> {
    const [reservations, assets, stocks] = await Promise.all([
      this.factStore.activeReservations(tenantId, tx),
      this.factStore.listAssets(tenantId, tx),
      this.factStore.listStockBalances(tenantId, tx)
    ]);
    return { reservations, assets, stocks };
  }

  private reservedQuantity(reservations: ActiveReservationRow[], itemGroupId: string, locationId: string, startAt?: string, endAt?: string) {
    const rows = reservations.filter((row) => row.itemGroupId === itemGroupId && row.locationId === locationId);
    return startAt && endAt ? peakReservedQuantity(rows, startAt, endAt) : rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  private computeAvailability(state: { itemGroups: RentalQuoteInventoryBasis['groups'] }, snapshot: RentalAvailabilitySnapshot, input: RentalAvailabilityRequest): RentalAvailabilityResult {
    const lines = input.lines.map((line) => {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new BadRequestException("租赁数量必须是正整数");
      const group = this.group(state, line.itemGroupId);
      const availableQuantity = this.availableQuantity(state, snapshot, group, input.locationId, input.startAt, input.endAt, new Set());
      return {
        itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, inventoryMode: group.inventoryMode,
        requestedQuantity: line.quantity, availableQuantity, available: availableQuantity >= line.quantity,
        reasons: availableQuantity >= line.quantity ? [] : [`可用 ${availableQuantity}，需求 ${line.quantity}`]
      };
    });
    const demand = new Map<string, number>();
    for (const line of input.lines) {
      const group = this.group(state, line.itemGroupId);
      const targets = group.inventoryMode === RentalInventoryMode.Bundle
        ? group.bundleComponents.filter((component) => !component.optional).map((component) => ({ itemGroupId: component.itemGroupId, quantity: component.quantity * line.quantity }))
        : [{ itemGroupId: group.id, quantity: line.quantity }];
      for (const target of targets) demand.set(target.itemGroupId, (demand.get(target.itemGroupId) ?? 0) + target.quantity);
    }
    for (const [itemGroupId, requested] of demand) {
      const dependency = this.group(state, itemGroupId);
      const available = this.availableQuantity(state, snapshot, dependency, input.locationId, input.startAt, input.endAt, new Set());
      if (available < requested) {
        for (const line of lines) {
          const source = this.group(state, line.itemGroupId);
          if (source.id === itemGroupId || source.bundleComponents.some((component) => component.itemGroupId === itemGroupId && !component.optional)) {
            line.available = false;
            line.reasons.push(`${dependency.name} 合并需求 ${requested}，可用 ${available}`);
          }
        }
      }
    }
    return { available: lines.every((line) => line.available), locationId: input.locationId, startAt: input.startAt, endAt: input.endAt, lines };
  }

  private availableQuantity(state: { itemGroups: RentalQuoteInventoryBasis['groups'] }, snapshot: RentalAvailabilitySnapshot, group: RentalQuoteInventoryBasis['groups'][number], locationId: string, startAt: string, endAt: string, visited: Set<string>): number {
    if (visited.has(group.id)) throw new BadRequestException("检测到套装组成循环");
    if (group.status !== "enabled") return 0;
    if (group.inventoryMode === RentalInventoryMode.Serialized) {
      const total = snapshot.assets.filter((row) => row.itemGroupId === group.id && row.locationId === locationId && ![RentalAssetStatus.Maintenance, RentalAssetStatus.Disabled].includes(row.status)).length;
      return Math.max(0, total - this.reservedQuantity(snapshot.reservations, group.id, locationId, startAt, endAt));
    }
    if (group.inventoryMode === RentalInventoryMode.Quantity || group.inventoryMode === RentalInventoryMode.Consumable) {
      const stock = snapshot.stocks.find((row) => row.itemGroupId === group.id && row.locationId === locationId);
      const reserved = group.inventoryMode === RentalInventoryMode.Consumable
        ? this.reservedQuantity(snapshot.reservations, group.id, locationId)
        : this.reservedQuantity(snapshot.reservations, group.id, locationId, startAt, endAt);
      return Math.max(0, (stock?.onHandQuantity ?? 0) - (stock?.maintenanceQuantity ?? 0) - reserved);
    }
    const next = new Set(visited); next.add(group.id);
    const capacities = group.bundleComponents.filter((row) => !row.optional).map((component) => Math.floor(this.availableQuantity(state, snapshot, this.group(state, component.itemGroupId), locationId, startAt, endAt, next) / component.quantity));
    return capacities.length ? Math.min(...capacities) : 0;
  }
  private resolveComponents(state: TenantRentalState, rows: SaveRentalItemGroupRequest["bundleComponents"], selfId?: string): RentalBundleComponent[] {
    return (rows ?? []).map((row) => {
      if (row.itemGroupId === selfId) throw new BadRequestException("套装不能包含自身");
      if (!Number.isInteger(row.quantity) || row.quantity <= 0) throw new BadRequestException("套装组成数量必须是正整数");
      const group = this.group(state, row.itemGroupId);
      if (group.inventoryMode === RentalInventoryMode.Bundle) throw new BadRequestException("v0.1 暂不支持嵌套套装");
      return { itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, quantity: row.quantity, optional: Boolean(row.optional), substitutionGroup: row.substitutionGroup?.trim() || undefined };
    });
  }

  private validateBundleComponentRules(components: RentalBundleComponent[]) {
    if (new Set(components.map((component) => component.itemGroupId)).size !== components.length) {
      throw new BadRequestException("同一商品不能在套装组成中重复出现");
    }
    if (components.some((component) => component.optional && !component.substitutionGroup)) {
      throw new BadRequestException("替代候选必须填写替代组；当前阶段不支持无替代组的可选加购项");
    }
    const groups = new Map<string, RentalBundleComponent[]>();
    for (const component of components) {
      if (!component.substitutionGroup) continue;
      groups.set(component.substitutionGroup, [...(groups.get(component.substitutionGroup) ?? []), component]);
    }
    for (const [groupCode, candidates] of groups) {
      if (candidates.length < 2 || candidates.filter((candidate) => !candidate.optional).length !== 1) {
        throw new BadRequestException(`替代组 ${groupCode} 必须且只能有一个默认组成，并至少配置一个替代候选`);
      }
    }
  }

  /**
   * 生成一个经营空间的默认配置。
   *
   * `idPrefix` 必须按**经营空间**取值，不能一律用 tenantId：同租户第二个空间
   * 会生成同样的 id，而配置写入是按 id upsert 的——那会把默认空间的商品组、
   * 地点、券模板直接改挂到新空间上（实测表现为新建空间后原空间数据消失）。
   * 默认空间沿用 tenantId 前缀以保持既有 id 不变，其余空间用自己的 id。
   */
  private seedState(tenantId: string, categoryCode: RentalCategoryCode, idPrefix: string = tenantId, currency: RentalCurrency = "CNY", resolvedDefinition?: RentalCategoryDefinition): TenantRentalState {
    // 固定样本只属于未装配持久化解析器的内存演示宿主；正式空间由明确建档产生事实。
    // 不能因租户ID相同就把旧四品类样本注入另一个动态品类或新空间。
    const isSampleTenant = !this.categoryResolver && (tenantId === "tenant_001" || tenantId === "tenant_002");
    const definition = resolvedDefinition ?? this.category(categoryCode); const timestamp = now(); const locationId = `${idPrefix}_location_01`;
    const initialSetup = definition.businessModel.defaults.initialSetup;
    const operator: RentalFulfillmentOperator = { id: `${idPrefix}_operator_01`, tenantId, code: "SELF", name: initialSetup.operatorName, type: "self_operated", contactName: "运营负责人", contactPhone: "13800000000", settlementMode: "self", status: "enabled", createdAt: timestamp, updatedAt: timestamp };
    const location: RentalFulfillmentLocation = { id: locationId, tenantId, code: "MAIN", name: initialSetup.locationName, type: initialSetup.locationType, operatorId: operator.id, operatorType: operator.type, operatorName: operator.name, capabilities: ["pickup", "return", "storage", "delivery"], address: "演示地址 1 号", province: "上海市", city: "上海市", district: "徐汇区", timezone: "Asia/Shanghai", contactName: "值班负责人", contactPhone: "13800000000", businessHours: "09:00-20:00", status: "enabled" };
    const samples = isSampleTenant
      ? buildRentalCategorySamples({ tenantId, idPrefix, categoryCode, location, timestamp })
      : { itemGroups: [], assets: [], stockBalances: [] };
    const templates = this.buildInspectionTemplates(tenantId, categoryCode, idPrefix, definition);
    return {
      profile: { tenantId, categoryCode, capabilities: [...definition.defaultCapabilities] as RentalCapability[], terminology: { ...definition.terminology }, configVersion: definition.version, initializedAt: timestamp, updatedAt: timestamp },
      businessSettings: defaultBusinessSettings(tenantId, definition, currency),
      couponTemplates: [],
      // 只有明确的演示租户才生成演示经营主体与地址。普通租户/新空间保持待配置，
      // 避免把虚构电话和地址当成真实履约事实进入报价与订单快照。
      operators: isSampleTenant ? [operator] : [],
      locations: isSampleTenant ? [location] : [],
      itemGroups: samples.itemGroups,
      pricingGroups: samples.itemGroups.map((group) => this.defaultPricingGroup(group, samples.pricingGroupNames?.[group.id])),
      inspectionTemplates: templates,
      sampleAssets: samples.assets,
      sampleStockBalances: samples.stockBalances
    };
  }

  private storedItemGroupImages(group: RentalItemGroup): StoredItemGroupImage[] {
    const media = group.attributes[ITEM_GROUP_MEDIA_KEY];
    if (!media || typeof media !== "object" || Array.isArray(media)) return [];
    const images = (media as { images?: unknown }).images;
    if (!Array.isArray(images)) return [];
    return images.filter((image): image is StoredItemGroupImage => Boolean(
      image && typeof image === "object" &&
      typeof (image as StoredItemGroupImage).id === "string" &&
      typeof (image as StoredItemGroupImage).fileName === "string" &&
      typeof (image as StoredItemGroupImage).mimeType === "string" &&
      typeof (image as StoredItemGroupImage).sizeBytes === "number"
    ));
  }

  private publicItemGroupImages(group: RentalItemGroup, images = this.storedItemGroupImages(group)): RentalItemGroupImage[] {
    return images.map((image) => {
      const { fileAssetId: _fileAssetId, ...publicImage } = image;
      return {
      ...publicImage,
      url: `/api/rental/v1/item-groups/${encodeURIComponent(group.id)}/images/${encodeURIComponent(image.id)}`
      };
    });
  }

  private publicItemGroup(group: RentalItemGroup): RentalItemGroup {
    const { [ITEM_GROUP_MEDIA_KEY]: _media, ...attributes } = group.attributes;
    return {
      ...group,
      attributes,
      images: this.publicItemGroupImages(group)
    };
  }

  private async persistItemGroupImages(group: RentalItemGroup, images: StoredItemGroupImage[]) {
    group.attributes = { ...group.attributes, [ITEM_GROUP_MEDIA_KEY]: { images } };
    group.images = this.publicItemGroupImages(group, images);
    group.updatedAt = now();
    await this.configStore.upsertItemGroup(group, undefined, undefined, undefined, true);
  }

  private itemGroupUploadRoot() {
    return resolve(process.env.RENTAL_UPLOAD_DIR ?? resolve(process.cwd(), "var", "uploads"));
  }

  private itemGroupImagePath(group: RentalItemGroup, image: StoredItemGroupImage) {
    const mimeExtensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    };
    const extension = mimeExtensions[image.mimeType];
    if (!extension) throw new BadRequestException("不支持的产品型号图片格式");
    const workspaceId = getRequestWorkspaceId() ?? "memory";
    const storageKey = [
      this.safePathSegment(group.tenantId),
      this.safePathSegment(workspaceId),
      "item-groups",
      this.safePathSegment(group.id),
      `${this.safePathSegment(image.id)}.${extension}`
    ].join("/");
    return this.itemGroupUploadPath(storageKey);
  }

  private matchesImageSignature(mimeType: string, content: Buffer) {
    if (mimeType === "image/jpeg") return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
    if (mimeType === "image/png") return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === "image/webp") return content.length >= 12 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
    return false;
  }

  private itemGroupUploadPath(storageKey: string) {
    const root = this.itemGroupUploadRoot();
    const target = resolve(root, ...storageKey.split("/"));
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new BadRequestException("非法的图片存储路径");
    }
    return target;
  }

  private safePathSegment(value: string) {
    const safe = value.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!safe) throw new BadRequestException("非法的图片归属标识");
    return safe;
  }

  private defaultPricingGroup(group: RentalItemGroup, sampleName?: string): RentalPricingGroup {
    return {
      id: group.id,
      tenantId: group.tenantId,
      categoryCode: group.categoryCode,
      code: group.code,
      name: sampleName ?? group.name,
      description: group.description,
      memberItemGroupIds: [group.id],
      members: [{
        id: group.id,
        code: group.code,
        name: group.name,
        inventoryMode: group.inventoryMode,
        unit: group.unit,
        status: group.status
      }],
      status: group.status,
      version: 1,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt
    };
  }

  private buildInspectionTemplates(tenantId: string, categoryCode: RentalCategoryCode, idPrefix: string, resolvedDefinition?: RentalCategoryDefinition): RentalInspectionTemplate[] {
    const definition = resolvedDefinition ?? this.category(categoryCode);
    return (["pickup", "return"] as const).map((stage) => ({
      id: `${idPrefix}_${stage}_template`, tenantId, categoryCode,
      code: `${categoryCode.toUpperCase()}_${stage.toUpperCase()}_V1`,
      name: `${stage === "pickup" ? definition.terminology.pickupLabel : definition.terminology.returnLabel}检查`,
      stage, version: "1.0", enabled: true,
      fields: definition.businessModel.defaults.inspectionFields.map((field) => ({ ...field }))
    }));
  }

  /** 旧空间的系统默认模板不在启动时回写；读取时按明确采用的品类版本补齐可选项。
   * 自建/另行发布的模板不受此兼容逻辑影响，运营方仍可为特定型号制定更严格模板。 */
  private inspectionTemplateForRead(definition: RentalCategoryDefinition, template: RentalInspectionTemplate): RentalInspectionTemplate {
    return snapshotInspectionTemplate(definition, template);
  }
}
