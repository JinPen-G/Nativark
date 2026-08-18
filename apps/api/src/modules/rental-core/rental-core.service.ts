import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnApplicationBootstrap, OnModuleInit, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  RENTAL_CATEGORY_DEFINITIONS,
  RentalAssetStatus,
  type RentalAttributeDefinition,
  RentalCategoryCode,
  RentalCoreOrderStatus,
  RentalInventoryMode,
  RentalReservationStatus,
  type CreateRentalInspectionRequest,
  type CreateRentalOrderRequest,
  type RentalAllocation,
  type RentalAsset,
  type RentalAvailabilityRequest,
  type RentalAvailabilityResult,
  type RentalBundleComponent,
  type RentalCapability,
  type RentalCategoryDefinition,
  type RentalCouponTemplate,
  type RentalFulfillmentOperator,
  type RentalFulfillmentLocation,
  type RentalInspectionRecord,
  type RentalInspectionTemplate,
  type RentalItemGroup,
  type RentalOrder,
  type RentalQuoteSnapshotV1,
  type RentalReservation,
  type RentalStockBalance,
  type SaveRentalAssetRequest,
  type SaveRentalCouponTemplateRequest,
  type SaveRentalFulfillmentLocationRequest,
  type SaveRentalFulfillmentOperatorRequest,
  type SaveRentalItemGroupRequest,
  type SaveRentalStockBalanceRequest,
  type SaveTenantRentalBusinessSettingsRequest,
  type SaveTenantRentalProfileRequest,
  type TenantRentalBusinessSettings,
  type TenantRentalProfile
} from "@store-rental/shared";
import { RentalStateRepository } from "./rental-state.repository";
import { RentalCoreConfigRepository, type RentalConfigStore, type RentalConfigTx } from "./rental-core-config.repository";
import {
  RentalCoreFactRepository,
  type ActiveReservationRow,
  type AssetStatusChange,
  type RentalCoreFactStore
} from "./rental-core-fact.repository";

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
  inspectionTemplates: RentalInspectionTemplate[];
  /** 演示租户的样本资产/库存模板，仅在该租户库中尚无事实时落库一次。 */
  sampleAssets: RentalAsset[];
  sampleStockBalances: RentalStockBalance[];
  sampleFactsEnsured?: boolean;
  /** 该租户的配置是否已确认落库。initializeTenant 会置为 true；懒加载路径为 false。 */
  configPersisted?: boolean;
}

/** 一次取齐的库存事实，供同步的可用量计算使用。 */
interface InventorySnapshot {
  reservations: ActiveReservationRow[];
  assets: RentalAsset[];
  stocks: RentalStockBalance[];
}

const categories: RentalCategoryDefinition[] = RENTAL_CATEGORY_DEFINITIONS;

function now() { return new Date().toISOString(); }
function id(prefix: string) { return `${prefix}_${randomUUID().slice(0, 8)}`; }
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();
}

function defaultBusinessSettings(tenantId: string, definition: RentalCategoryDefinition): TenantRentalBusinessSettings {
  const supportsPreauthorization = definition.businessModel.supportsPreauthorization;
  return {
    tenantId,
    categoryCode: definition.code,
    configVersion: definition.version,
    pricing: {
      enabledUnits: [...definition.businessModel.pricingUnits],
      defaultUnit: definition.businessModel.defaultPricingUnit,
      currency: "CNY",
      taxIncluded: true,
      holidayPricingEnabled: definition.businessModel.supportsHolidayPricing
    },
    fulfillment: {
      enabledModes: [...definition.businessModel.fulfillmentModes],
      allowDifferentReturnLocation: definition.code === RentalCategoryCode.Vehicle
    },
    payment: {
      timing: definition.code === RentalCategoryCode.Construction ? "confirmation" : "order",
      depositMode: supportsPreauthorization ? "preauthorization" : "fixed",
      preauthorizationRequired: supportsPreauthorization
    },
    overdue: {
      graceMinutes: definition.code === RentalCategoryCode.Construction ? 60 : 30,
      feeMode: definition.code === RentalCategoryCode.Construction ? "manual_review" : "next_period",
      feeMultiplier: 1
    },
    calendar: {
      weekendDays: [0, 6],
      holidayPricingEnabled: definition.businessModel.supportsHolidayPricing,
      officialCalendarRegion: "CN"
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
      enabledEvents: ["member.registered", "order.created", "order.confirmed", "order.cancelled", "pickup.completed", "return.completed", "pickup.reminder", "return.reminder", "order.overdue"],
      editableChannels: ["sms", "app_push", "wechat"]
    },
    updatedAt: now(),
    updatedBy: "system"
  };
}

@Injectable()
export class RentalCoreService implements OnModuleInit, OnApplicationBootstrap {
  private readonly states = new Map<string, TenantRentalState>();

  // configStore 必填：配置的事实源是数据库，内存 states 只是写穿缓存。
  // 不设为可选，避免生产环境缺少注入时静默退回纯内存而无人察觉。
  constructor(
    @Inject(RentalCoreConfigRepository) private readonly configStore: RentalConfigStore,
    @Inject(RentalCoreFactRepository) private readonly factStore: RentalCoreFactStore,
    @Optional() private readonly stateRepository?: RentalStateRepository
  ) {}

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
      for (const asset of state.sampleAssets) await this.factStore.upsertAsset(asset);
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
    const state = this.state(tenantId);
    if (!state.configPersisted) {
      await this.persistConfig(state);
      state.configPersisted = true;
    }
    await this.ensureSampleFacts(state);
    return state;
  }

  async onModuleInit() {
    for (const row of await this.stateRepository?.loadCoreStates() ?? []) {
      const state = row.state as unknown as TenantRentalState;
      if (state?.profile?.tenantId === row.tenantId) this.states.set(row.tenantId, state);
    }
    for (const tenant of await this.stateRepository?.loadTenantProfiles() ?? []) {
      if (!tenant.categoryCode || this.states.has(tenant.tenantId)) continue;
      const categoryCode = String(tenant.categoryCode).toLowerCase() as RentalCategoryCode;
      if (Object.values(RentalCategoryCode).includes(categoryCode)) this.states.set(tenant.tenantId, this.seedState(tenant.tenantId, categoryCode));
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
    for (const snapshot of await this.configStore.loadAll()) {
      const cached = this.states.get(snapshot.tenantId);
      const categoryCode = snapshot.profile?.categoryCode ?? cached?.profile.categoryCode;
      if (!categoryCode) continue;
      const base = cached ?? this.seedState(snapshot.tenantId, categoryCode);
      if (snapshot.profile) base.profile = snapshot.profile;
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
        base.couponTemplates = snapshot.couponTemplates;
        base.inspectionTemplates = snapshot.inspectionTemplates;
        base.configPersisted = true;
      }
      this.states.set(snapshot.tenantId, base);
    }
  }

  async persist(tenantId: string) {
    const state = this.states.get(tenantId);
    if (state) await this.stateRepository?.saveCoreState(tenantId, state);
  }

  listCategories() { return categories; }
  /**
   * 初始化租户经营品类。
   *
   * `tx` 由租户 bootstrap 传入：需求 4.1 要求租户档案与唯一经营品类在同一事务内创建，
   * 否则会留下"租户和管理员已建、品类配置没建"的半成品租户——而阶段 3 的事实表
   * 全部外键指向这些配置，那种租户后续下单会撞外键且报错指向订单而非真正原因。
   * 内存缓存只在事务成功提交后才写入，避免回滚后缓存里留下并不存在的租户。
   */
  async initializeTenant(tenantId: string, categoryCode: RentalCategoryCode, tx?: RentalConfigTx) {
    const existing = this.states.get(tenantId);
    if (existing && existing.profile.categoryCode !== categoryCode) {
      throw new ConflictException("已有租赁数据的租户不能切换经营品类");
    }
    if (!existing) {
      const seeded = this.seedState(tenantId, categoryCode);
      await this.persistConfig(seeded, tx);
      seeded.configPersisted = true;
      this.states.set(tenantId, seeded);
      return seeded.profile;
    }
    return this.states.get(tenantId)!.profile;
  }

  /**
   * 把整份配置落库。用于租户初始化；此后各 save* 方法按条写穿。
   * 套装必须排在其组成项之后写入——组成项是独立表的外键，先写套装会违反约束。
   */
  private async persistConfig(state: TenantRentalState, tx?: RentalConfigTx) {
    await this.configStore.upsertProfile(state.profile, tx);
    await this.configStore.upsertBusinessSettings(state.businessSettings, state.businessSettings.updatedBy, tx);
    for (const operator of state.operators) await this.configStore.upsertOperator(operator, tx);
    for (const location of state.locations) await this.configStore.upsertLocation(location, tx);
    const ordered = [...state.itemGroups].sort(
      (left, right) => Number(left.inventoryMode === RentalInventoryMode.Bundle) - Number(right.inventoryMode === RentalInventoryMode.Bundle)
    );
    for (const group of ordered) await this.configStore.upsertItemGroup(group, tx);
    for (const template of state.couponTemplates) await this.configStore.upsertCouponTemplate(template, tx);
    for (const template of state.inspectionTemplates) await this.configStore.upsertInspectionTemplate(template, tx);
  }
  hasTenantState(tenantId: string) { return this.states.has(tenantId); }
  getProfile(tenantId: string) { return this.state(tenantId).profile; }
  getBusinessSettings(tenantId: string) { return this.state(tenantId).businessSettings; }

  async saveBusinessSettings(tenantId: string, input: SaveTenantRentalBusinessSettingsRequest, operator: string) {
    const state = this.state(tenantId);
    const definition = this.category(state.profile.categoryCode);
    const pricingUnits = new Set(definition.businessModel.pricingUnits);
    const fulfillmentModes = new Set(definition.businessModel.fulfillmentModes);
    if (!input.pricing.enabledUnits.length || input.pricing.enabledUnits.some((unit) => !pricingUnits.has(unit))) {
      throw new BadRequestException("存在当前经营品类不支持的计价单位");
    }
    if (!input.pricing.enabledUnits.includes(input.pricing.defaultUnit)) {
      throw new BadRequestException("默认计价单位必须处于已启用计价单位中");
    }
    if (!input.fulfillment.enabledModes.length || input.fulfillment.enabledModes.some((mode) => !fulfillmentModes.has(mode))) {
      throw new BadRequestException("存在当前经营品类不支持的履约方式");
    }
    if ((input.payment.preauthorizationRequired || input.payment.depositMode === "preauthorization") && !definition.businessModel.supportsPreauthorization) {
      throw new BadRequestException("当前经营品类不支持预授权");
    }
    if (input.payment.preauthorizationRequired && input.payment.depositMode !== "preauthorization") throw new BadRequestException("必须预授权时，押金方式也必须选择预授权");
    if (input.pricing.holidayPricingEnabled && !definition.businessModel.supportsHolidayPricing) {
      throw new BadRequestException("当前经营品类不支持节假日差异定价");
    }
    if (!Number.isInteger(input.overdue.graceMinutes) || input.overdue.graceMinutes < 0 || input.overdue.feeMultiplier < 0) {
      throw new BadRequestException("逾期宽限时间或费用系数无效");
    }
    if (input.calendar.weekendDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new BadRequestException("周末规则只能使用 0 到 6 的星期序号");
    const rewardAmounts = [input.membership.signupRewardAmount, input.membership.referrerRewardAmount, input.membership.inviteeRewardAmount];
    if (rewardAmounts.some((amount) => !Number.isFinite(amount) || amount < 0)) throw new BadRequestException("会员奖励数量不能为负数");
    const validateRewardCoupon = (enabled: boolean, type: string, amount: number, templateId: string | undefined) => {
      if (!enabled || type !== "coupon" || amount <= 0) return;
      if (!Number.isInteger(amount)) throw new BadRequestException("优惠券奖励数量必须是整数");
      if (!templateId || !state.couponTemplates.some((template) => template.id === templateId && template.status === "enabled")) throw new BadRequestException("优惠券奖励必须选择已启用的券模板");
    };
    validateRewardCoupon(input.membership.signupRewardEnabled, input.membership.signupRewardType, input.membership.signupRewardAmount, input.membership.signupRewardCouponTemplateId);
    validateRewardCoupon(input.membership.referralRewardEnabled, input.membership.referralRewardType, Math.max(input.membership.referrerRewardAmount, input.membership.inviteeRewardAmount), input.membership.referralRewardCouponTemplateId);
    const supportedNotificationEvents = new Set(["member.registered", "referral.rewarded", "order.created", "order.confirmed", "order.cancelled", "pickup.completed", "return.completed", "pickup.reminder", "return.reminder", "order.overdue", "qualification.reviewed", "refund.completed", "asset.exception"]);
    if (!input.notifications.editableChannels.length || input.notifications.enabledEvents.some((event) => !supportedNotificationEvents.has(event))) throw new BadRequestException("通知渠道不能为空，且只能启用已注册的系统事件");
    const nextSettings = {
      ...input,
      tenantId,
      categoryCode: definition.code,
      configVersion: definition.version,
      updatedAt: now(),
      updatedBy: operator
    };
    await this.configStore.upsertBusinessSettings(nextSettings, operator);
    state.businessSettings = nextSettings;
    return state.businessSettings;
  }

  listCouponTemplates(tenantId: string) { return this.state(tenantId).couponTemplates; }

  async saveCouponTemplate(tenantId: string, input: SaveRentalCouponTemplateRequest) {
    const state = this.state(tenantId);
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("优惠券编码和名称不能为空");
    if (!Number.isFinite(input.discountValue) || input.discountValue <= 0) throw new BadRequestException("优惠值必须大于 0");
    if (input.discountType === "percentage" && input.discountValue > 100) throw new BadRequestException("折扣百分比不能超过 100");
    if (!Number.isFinite(input.minimumSpend) || input.minimumSpend < 0 || (input.maximumDiscount !== undefined && input.maximumDiscount < 0)) throw new BadRequestException("优惠门槛或封顶金额无效");
    if (!Number.isInteger(input.totalQuota) || input.totalQuota < 0 || !Number.isInteger(input.perCustomerLimit) || input.perCustomerLimit <= 0) throw new BadRequestException("发行量或每客限领数量无效");
    if (new Date(input.effectiveFrom).getTime() >= new Date(input.effectiveTo).getTime()) throw new BadRequestException("优惠券有效期无效");
    const duplicate = state.couponTemplates.find((row) => row.code === input.code.trim() && row.id !== input.id);
    if (duplicate) throw new ConflictException("优惠券编码已存在");
    const invalidGroup = (input.applicableItemGroupIds ?? []).find((itemGroupId) => !state.itemGroups.some((group) => group.id === itemGroupId));
    if (invalidGroup) throw new BadRequestException("优惠券包含不存在的适用商品");
    const existing = input.id ? state.couponTemplates.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("优惠券模板不存在");
    if (existing && input.totalQuota < existing.claimedQuantity) throw new BadRequestException("发行量不能低于已领取数量");
    const timestamp = now();
    const nextVersion = existing ? `${Number(existing.version.split(".")[0] ?? 0) + 1}.0` : "1.0";
    const result: RentalCouponTemplate = {
      id: existing?.id ?? id("coupon"), tenantId, code: input.code.trim(), name: input.name.trim(),
      discountType: input.discountType, discountValue: input.discountValue, minimumSpend: input.minimumSpend,
      maximumDiscount: input.maximumDiscount, totalQuota: input.totalQuota, claimedQuantity: existing?.claimedQuantity ?? 0,
      perCustomerLimit: input.perCustomerLimit, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
      applicableItemGroupIds: [...new Set(input.applicableItemGroupIds ?? [])], status: input.status ?? existing?.status ?? "draft",
      version: nextVersion, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    await this.configStore.upsertCouponTemplate(result);

    if (existing) state.couponTemplates.splice(state.couponTemplates.indexOf(existing), 1, result); else state.couponTemplates.unshift(result);
    return result;
  }

  async saveProfile(tenantId: string, input: SaveTenantRentalProfileRequest) {
    const state = this.state(tenantId);
    const definition = this.category(input.categoryCode);
    const categoryChanged = state.profile.categoryCode !== input.categoryCode;
    if (categoryChanged) throw new ConflictException("SaaS 租户创建后经营品类固定，不能切换");
    const allowed = new Set(definition.defaultCapabilities);
    const capabilities = (input.capabilities ?? definition.defaultCapabilities).filter((item) => allowed.has(item));
    const nextProfile = {
      ...state.profile,
      categoryCode: input.categoryCode,
      capabilities,
      terminology: { ...definition.terminology, ...input.terminology },
      configVersion: definition.version,
      updatedAt: now()
    };
    // 先写库，成功后再落缓存：库写失败时缓存保持原状，
    // 不留只存在于当前进程的幽灵配置。
    await this.configStore.upsertProfile(nextProfile);
    state.profile = nextProfile;
    return state.profile;
  }

  listLocations(tenantId: string) { return this.state(tenantId).locations; }

  listOperators(tenantId: string) { return this.state(tenantId).operators; }

  async saveOperator(tenantId: string, input: SaveRentalFulfillmentOperatorRequest) {
    const state = this.state(tenantId);
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("经营主体编码和名称不能为空");
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
    await this.configStore.upsertOperator(result);

    if (existing) state.operators.splice(state.operators.indexOf(existing), 1, result); else state.operators.unshift(result);
    return result;
  }

  async saveLocation(tenantId: string, input: SaveRentalFulfillmentLocationRequest) {
    const state = this.state(tenantId);
    const definition = this.category(state.profile.categoryCode);
    if (!definition.businessModel.locationTypes.includes(input.type)) throw new BadRequestException("当前经营品类不支持该履约地点类型");
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("地点编码和名称不能为空");
    let operator = input.operatorId ? state.operators.find((row) => row.id === input.operatorId) : undefined;
    if (!operator && input.operatorName?.trim()) {
      operator = state.operators.find((row) => row.name === input.operatorName?.trim());
      if (!operator) operator = await this.saveOperator(tenantId, { code: `LEGACY-${state.operators.length + 1}`, name: input.operatorName.trim(), type: input.operatorType ?? "self_operated" });
    }
    if (!operator || operator.status !== "enabled") throw new BadRequestException("请选择已启用的经营主体");
    if (!input.capabilities?.length) throw new BadRequestException("履约地点至少需要一种能力");
    const duplicate = state.locations.find((row) => row.code === input.code.trim() && row.id !== input.id);
    if (duplicate) throw new ConflictException("履约地点编码已存在");
    if (input.id && input.parentLocationId === input.id) throw new BadRequestException("地点不能将自身设为上级");
    if (input.parentLocationId) this.location(state, input.parentLocationId);
    const existing = input.id ? state.locations.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("履约地点不存在");
    const result: RentalFulfillmentLocation = {
      id: existing?.id ?? id("location"),
      tenantId,
      code: input.code.trim(),
      name: input.name.trim(),
      type: input.type,
      operatorId: operator.id,
      operatorType: operator.type,
      operatorName: operator.name,
      parentLocationId: input.parentLocationId,
      capabilities: [...new Set(input.capabilities)],
      address: input.address?.trim(),
      contactName: input.contactName?.trim(),
      contactPhone: input.contactPhone?.trim(),
      businessHours: input.businessHours?.trim(),
      status: input.status ?? existing?.status ?? "enabled"
    };
    await this.configStore.upsertLocation(result);

    if (existing) state.locations.splice(state.locations.indexOf(existing), 1, result); else state.locations.unshift(result);
    return result;
  }
  listItemGroups(tenantId: string) { return this.state(tenantId).itemGroups; }

  async saveItemGroup(tenantId: string, input: SaveRentalItemGroupRequest) {
    const state = this.state(tenantId);
    const definition = this.category(state.profile.categoryCode);
    if (!definition.supportedInventoryModes.includes(input.inventoryMode)) throw new BadRequestException("当前经营品类不支持该库存模式");
    if (!input.code?.trim() || !input.name?.trim()) throw new BadRequestException("标的编码和名称不能为空");
    const duplicate = state.itemGroups.find((row) => row.code === input.code && row.id !== input.id);
    if (duplicate) throw new ConflictException("标的编码已存在");
    const components = this.resolveComponents(state, input.bundleComponents ?? [], input.id);
    if (input.inventoryMode === RentalInventoryMode.Bundle && components.length === 0) throw new BadRequestException("套装至少需要一个组成项");
    if (input.inventoryMode !== RentalInventoryMode.Bundle && components.length > 0) throw new BadRequestException("仅套装模式可以配置组成项");
    if (input.inventoryMode !== RentalInventoryMode.Bundle) this.validateAttributes(definition.businessModel.assetFields, "item_group", input.attributes ?? {});
    const timestamp = now();
    const existing = input.id ? state.itemGroups.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("标的分组不存在");
    const result: RentalItemGroup = {
      id: existing?.id ?? id("group"), tenantId, categoryCode: state.profile.categoryCode,
      code: input.code.trim(), name: input.name.trim(), inventoryMode: input.inventoryMode,
      unit: input.unit?.trim() || "件", description: input.description?.trim(), attributes: input.attributes ?? {},
      bundleComponents: components, status: input.status ?? existing?.status ?? "enabled",
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    await this.configStore.upsertItemGroup(result);

    if (existing) state.itemGroups.splice(state.itemGroups.indexOf(existing), 1, result); else state.itemGroups.unshift(result);
    return result;
  }

  async listAssets(tenantId: string) {
    await this.factContext(tenantId);
    return this.factStore.listAssets(tenantId);
  }

  async saveAsset(tenantId: string, input: SaveRentalAssetRequest) {
    const state = await this.factContext(tenantId);
    const group = this.group(state, input.itemGroupId);
    if (group.inventoryMode !== RentalInventoryMode.Serialized) throw new BadRequestException("只有序列化库存可以登记独立资产");
    const location = this.location(state, input.locationId);
    if (!input.assetNo?.trim()) throw new BadRequestException("资产编号不能为空");
    const definition = this.category(state.profile.categoryCode);
    this.validateAttributes(definition.businessModel.assetFields, "asset", input.attributes ?? {}, { serialNo: input.serialNo });
    const assetNo = input.assetNo.trim();
    const assets = await this.factStore.listAssets(tenantId);
    if (assets.some((row) => row.assetNo === assetNo && row.id !== input.id)) throw new ConflictException("资产编号已存在");
    const existing = input.id ? assets.find((row) => row.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("资产不存在");
    const timestamp = now();
    const result: RentalAsset = {
      id: existing?.id ?? id("asset"), tenantId, itemGroupId: group.id, itemGroupCode: group.code,
      itemGroupName: group.name, assetNo, serialNo: input.serialNo?.trim(),
      locationId: location.id, locationName: location.name, status: input.status ?? existing?.status ?? RentalAssetStatus.Available,
      attributes: input.attributes ?? {}, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    await this.factStore.upsertAsset(result);
    return result;
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

  async saveStockBalance(tenantId: string, input: SaveRentalStockBalanceRequest) {
    const state = await this.factContext(tenantId);
    const group = this.group(state, input.itemGroupId);
    if (group.inventoryMode !== RentalInventoryMode.Quantity) throw new BadRequestException("只有数量型库存可以维护库存余额");
    const location = this.location(state, input.locationId);
    if (!Number.isInteger(input.onHandQuantity) || input.onHandQuantity < 0) throw new BadRequestException("在手数量必须是非负整数");
    const maintenance = input.maintenanceQuantity ?? 0;
    if (!Number.isInteger(maintenance) || maintenance < 0 || maintenance > input.onHandQuantity) throw new BadRequestException("维护数量无效");
    const stocks = await this.factStore.listStockBalances(tenantId);
    const existing = stocks.find((row) => row.itemGroupId === group.id && row.locationId === location.id);
    const result: RentalStockBalance = {
      id: existing?.id ?? id("stock"), tenantId, itemGroupId: group.id, itemGroupCode: group.code,
      itemGroupName: group.name, locationId: location.id, locationName: location.name,
      onHandQuantity: input.onHandQuantity, reservedQuantity: existing?.reservedQuantity ?? 0,
      maintenanceQuantity: maintenance, availableQuantity: Math.max(0, input.onHandQuantity - maintenance), updatedAt: now()
    };
    await this.factStore.upsertStockBalance(result);
    return (await this.listStockBalances(tenantId)).find((row) => row.id === result.id)!;
  }

  async availability(tenantId: string, input: RentalAvailabilityRequest): Promise<RentalAvailabilityResult> {
    const state = await this.factContext(tenantId);
    this.validatePeriod(input.startAt, input.endAt);
    this.location(state, input.locationId);
    if (!input.lines?.length) throw new BadRequestException("至少需要一个租赁明细");
    return this.computeAvailability(state, await this.loadInventorySnapshot(tenantId), input);
  }

  async listOrders(tenantId: string) {
    this.state(tenantId);
    return this.factStore.listOrders(tenantId);
  }

  async getOrder(tenantId: string, orderId: string) {
    this.state(tenantId);
    return this.requireOrder(tenantId, orderId);
  }

  /**
   * 校验下单条件并构造完整订单聚合，但不落库。
   * RC-02 由订单确认应用服务把该聚合与报价消费、优惠券锁定放进同一事务。
   */
  async prepareOrder(tenantId: string, input: CreateRentalOrderRequest, userName: string, quote: RentalQuoteSnapshotV1) {
    const state = this.state(tenantId);
    if (!input.customerName?.trim()) throw new BadRequestException("客户名称不能为空");
    if (quote.ruleSnapshot.qualification.required) {
      if (!input.qualificationApproved) throw new ConflictException(`当前品类要求先通过资质审核：${quote.ruleSnapshot.qualification.documentTypes.join("、")}`);
      if (input.qualificationValidTo) {
        const validDays = (new Date(input.qualificationValidTo).getTime() - new Date(input.startAt).getTime()) / 86_400_000;
        if (validDays < quote.ruleSnapshot.qualification.minimumValidityDays) throw new ConflictException("资质有效期不满足租赁规则");
      }
    }
    const checked = await this.availability(tenantId, {
      locationId: input.fulfillmentLocationId, startAt: input.startAt, endAt: input.endAt,
      lines: input.lines.map((line) => ({ itemGroupId: line.itemGroupId, quantity: line.quantity }))
    });
    if (!checked.available) throw new ConflictException("所选时间段库存不足");
    const location = this.location(state, input.fulfillmentLocationId);
    const timestamp = now();
    const orderId = id("order");
    const orderLines = input.lines.map((line) => {
      const group = this.group(state, line.itemGroupId);
      const rentalCharge = quote.chargeLines.find((item) => item.code === `rental:${group.code}`);
      if (!rentalCharge) throw new BadRequestException(`${group.name} 缺少服务端租金明细`);
      const amount = rentalCharge.amount;
      return { id: id("line"), itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, inventoryMode: group.inventoryMode, quantity: line.quantity, unitPrice: amount / line.quantity, amount, note: line.note };
    });
    const reservations: RentalReservation[] = [];
    for (const line of orderLines) {
      const group = this.group(state, line.itemGroupId);
      const reservationTargets = group.inventoryMode === RentalInventoryMode.Bundle
        ? group.bundleComponents.map((component) => ({ itemGroupId: component.itemGroupId, quantity: component.quantity * line.quantity }))
        : [{ itemGroupId: group.id, quantity: line.quantity }];
      for (const target of reservationTargets) reservations.push({
        id: id("reservation"), orderId, orderLineId: line.id, itemGroupId: target.itemGroupId,
        locationId: location.id, quantity: target.quantity, status: RentalReservationStatus.Soft,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), createdAt: timestamp
      });
    }
    // 订单号序号取自库中该租户的订单数，迁库后不能再用内存数组长度。
    const sequence = (await this.factStore.countOrders(tenantId)) + 1;
    const order: RentalOrder = {
      id: orderId, tenantId, orderNo: `RC${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}${String(sequence).padStart(3, "0")}`,
      categoryCode: state.profile.categoryCode, status: RentalCoreOrderStatus.Draft,
      customerType: input.customerType, customerId: input.customerId, customerName: input.customerName.trim(), contactPhone: input.contactPhone?.trim(),
      fulfillmentMode: input.fulfillmentMode,
      fulfillmentLocationId: location.id, fulfillmentLocationName: location.name,
      returnLocationId: input.returnLocationId, returnLocationName: input.returnLocationId ? this.location(state, input.returnLocationId).name : location.name,
      startAt: input.startAt, endAt: input.endAt,
      quoteId: quote.id, quoteNo: quote.quoteNo, pricingPlanVersion: quote.pricingPlanVersion,
      ruleVersion: quote.ruleVersion, ruleSnapshot: structuredClone(quote.ruleSnapshot), calendarVersion: quote.calendarVersion, chargeLines: structuredClone(quote.chargeLines),
      rentalAmount: quote.rentalAmount, discountAmount: quote.discountAmount, couponAmount: quote.couponAmount,
      serviceAmount: quote.serviceAmount, depositAmount: quote.depositAmount, payableAmount: quote.payableAmount,
      adjustmentAmount: 0, finalPayableAmount: quote.payableAmount,
      totalAmount: quote.payableAmount, lines: orderLines,
      reservations, allocations: [], createdBy: input.operator || userName, createdAt: timestamp, updatedAt: timestamp
    };
    return order;
  }

  async confirmOrder(tenantId: string, orderId: string) {
    this.state(tenantId);
    const order = await this.requireOrder(tenantId, orderId);
    if (order.status !== RentalCoreOrderStatus.Draft) throw new ConflictException("只有草稿订单可以确认");
    if (order.reservations.some((row) => row.expiresAt && new Date(row.expiresAt).getTime() < Date.now())) throw new ConflictException("软预占已过期，请重新下单");
    order.reservations.forEach((row) => { row.status = RentalReservationStatus.Confirmed; row.expiresAt = undefined; });
    order.status = RentalCoreOrderStatus.Reserved; order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order);
    return order;
  }

  async allocateOrder(tenantId: string, orderId: string) {
    const state = await this.factContext(tenantId);
    const order = await this.requireOrder(tenantId, orderId);
    if (order.status !== RentalCoreOrderStatus.Reserved) throw new ConflictException("只有已确认预占的订单可以配货");
    const [assets, used] = await Promise.all([
      this.factStore.listAssets(tenantId),
      this.factStore.allocatedAssetIds(tenantId)
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
          allocations.push({ id: id("allocation"), orderId, orderLineId: reservation.orderLineId, assetId: asset.id, assetNo: asset.assetNo, quantity: 1, status: "allocated" });
        }
      } else {
        allocations.push({ id: id("allocation"), orderId, orderLineId: reservation.orderLineId, quantity: reservation.quantity, status: "allocated" });
      }
    }
    order.allocations = allocations; order.status = RentalCoreOrderStatus.ReadyForPickup; order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order, assetChanges);
    return order;
  }

  async cancelOrder(tenantId: string, orderId: string, reason: string, chargeAmount = 0) {
    this.state(tenantId);
    const order = await this.requireOrder(tenantId, orderId);
    if ([RentalCoreOrderStatus.Renting, RentalCoreOrderStatus.Completed, RentalCoreOrderStatus.Cancelled].includes(order.status)) throw new ConflictException("当前订单状态不能取消");
    if (!reason?.trim()) throw new BadRequestException("取消原因不能为空");
    const assetChanges: AssetStatusChange[] = [];
    order.reservations.forEach((row) => { row.status = RentalReservationStatus.Cancelled; });
    order.allocations.forEach((row) => {
      row.status = "released";
      if (row.assetId) assetChanges.push({ assetId: row.assetId, status: RentalAssetStatus.Available });
    });
    if (chargeAmount > 0) order.chargeLines.push({ code: `cancellation:${order.id}`, name: "晚取消费用", type: "cancellation", amount: chargeAmount, sourceVersion: order.ruleVersion, detail: reason.trim() });
    order.adjustmentAmount = chargeAmount;
    order.finalPayableAmount = Math.round((order.payableAmount + chargeAmount) * 100) / 100;
    order.totalAmount = order.finalPayableAmount;
    order.cancellationReason = reason.trim(); order.cancelledAt = now();
    order.status = RentalCoreOrderStatus.Cancelled; order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order, assetChanges);
    return order;
  }

  async completeHandoverWithoutInspection(tenantId: string, orderId: string, stage: "pickup" | "return", overdueCharge = 0) {
    this.state(tenantId);
    const order = await this.requireOrder(tenantId, orderId);
    const assetChanges: AssetStatusChange[] = [];
    if (stage === "pickup") {
      if (order.ruleSnapshot.fulfillment.pickupInspectionRequired) throw new ConflictException("当前规则要求完成领取检查");
      if (order.status !== RentalCoreOrderStatus.ReadyForPickup) throw new ConflictException("订单尚未完成配货");
      this.markPickedUp(order, assetChanges);
    } else {
      if (order.ruleSnapshot.fulfillment.returnInspectionRequired) throw new ConflictException("当前规则要求完成归还检查");
      if (order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以归还");
      this.finishReturn(order, overdueCharge, assetChanges);
    }
    order.updatedAt = now();
    await this.factStore.saveOrderAggregate(order, assetChanges);
    return order;
  }

  listInspectionTemplates(tenantId: string, stage?: "pickup" | "return") {
    return this.state(tenantId).inspectionTemplates.filter((row) => !stage || row.stage === stage);
  }

  async listInspections(tenantId: string, orderId: string) {
    this.state(tenantId);
    await this.requireOrder(tenantId, orderId);
    return this.factStore.listInspections(tenantId, orderId);
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
    charges: { overdue?: { amount: number; returnedAt: string }; damage?: { amount: number; detail: string } } = {}
  ) {
    const state = this.state(tenantId);
    const order = await this.requireOrder(tenantId, orderId);
    const template = state.inspectionTemplates.find((row) => row.id === input.templateId && row.enabled);
    if (!template) throw new NotFoundException("检查模板不存在或已停用");
    const missing = template.fields.filter((field) => field.required && (input.results[field.code] === undefined || input.results[field.code] === ""));
    if (missing.length) throw new BadRequestException(`缺少必填检查项：${missing.map((field) => field.label).join("、")}`);
    if (template.stage === "pickup" && order.status !== RentalCoreOrderStatus.ReadyForPickup) throw new ConflictException("订单尚未完成配货，不能办理取件检查");
    if (template.stage === "return" && order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以办理归还检查");
    const record: RentalInspectionRecord = {
      id: id("inspection"), tenantId, orderId, stage: template.stage, templateId: template.id,
      templateCode: template.code, templateVersion: template.version, results: input.results,
      exceptions: input.exceptions ?? [], attachments: input.attachments ?? [], operator: input.operator || userName, createdAt: now()
    };
    const assetChanges: AssetStatusChange[] = [];
    if (template.stage === "pickup") {
      this.markPickedUp(order, assetChanges);
    } else {
      this.finishReturn(order, 0, assetChanges);
      if (charges.overdue && charges.overdue.amount > 0) this.applyOverdueTo(order, charges.overdue.amount, charges.overdue.returnedAt);
      if (charges.damage && charges.damage.amount > 0) this.applyDamageTo(order, charges.damage.amount, charges.damage.detail);
    }
    order.updatedAt = now();
    await this.factStore.insertInspection(record);
    await this.factStore.saveOrderAggregate(order, assetChanges);
    return { inspection: record, order };
  }

  private applyOverdueTo(order: RentalOrder, amount: number, returnedAt: string) {
    if (amount <= 0 || order.chargeLines.some((line) => line.code === `overdue:${order.id}`)) return;
    order.chargeLines.push({ code: `overdue:${order.id}`, name: "逾期费用", type: "overdue", amount, sourceVersion: order.ruleVersion, detail: `实际归还时间 ${returnedAt}` });
    order.adjustmentAmount = Math.round((order.adjustmentAmount + amount) * 100) / 100;
    order.finalPayableAmount = Math.round((order.payableAmount + order.adjustmentAmount) * 100) / 100;
    order.totalAmount = order.finalPayableAmount;
  }

  private applyDamageTo(order: RentalOrder, amount: number, detail: string) {
    if (amount <= 0 || order.chargeLines.some((line) => line.code === `damage:${order.id}`)) return;
    order.chargeLines.push({ code: `damage:${order.id}`, name: "损坏费用", type: "damage", amount, sourceVersion: order.ruleVersion, detail });
    order.adjustmentAmount = Math.round((order.adjustmentAmount + amount) * 100) / 100;
    order.finalPayableAmount = Math.round((order.payableAmount + order.adjustmentAmount) * 100) / 100;
    order.totalAmount = order.finalPayableAmount;
  }

  private markPickedUp(order: RentalOrder, assetChanges: AssetStatusChange[]) {
    order.status = RentalCoreOrderStatus.Renting;
    order.reservations.forEach((row) => { row.status = RentalReservationStatus.Fulfilled; });
    order.allocations.forEach((row) => {
      row.status = "picked_up";
      if (row.assetId) assetChanges.push({ assetId: row.assetId, status: RentalAssetStatus.Rented });
    });
  }

  private finishReturn(order: RentalOrder, overdueCharge: number, assetChanges: AssetStatusChange[]) {
    order.status = RentalCoreOrderStatus.Completed; order.completedAt = now();
    order.reservations.forEach((row) => { row.status = RentalReservationStatus.Released; });
    order.allocations.forEach((row) => {
      row.status = "returned";
      if (row.assetId) assetChanges.push({ assetId: row.assetId, status: RentalAssetStatus.Available });
    });
    if (overdueCharge > 0) this.applyOverdueTo(order, overdueCharge, order.completedAt);
  }

  private state(tenantId: string) {
    let state = this.states.get(tenantId);
    if (!state) {
      const sampleCategory = tenantId === "tenant_001" ? RentalCategoryCode.Camera : tenantId === "tenant_002" ? RentalCategoryCode.Camping : undefined;
      if (!sampleCategory) throw new ConflictException("当前 SaaS 租户尚未初始化经营品类");
      state = this.seedState(tenantId, sampleCategory); this.states.set(tenantId, state);
    }
    state.operators ??= [];
    return state;
  }
  private category(code: RentalCategoryCode) { const found = categories.find((row) => row.code === code); if (!found) throw new BadRequestException("未知经营品类"); return found; }
  private group(state: TenantRentalState, groupId: string) { const found = state.itemGroups.find((row) => row.id === groupId); if (!found) throw new NotFoundException("标的分组不存在"); return found; }
  private location(state: TenantRentalState, locationId: string) { const found = state.locations.find((row) => row.id === locationId); if (!found) throw new NotFoundException("履约网点不存在"); return found; }
  private async requireOrder(tenantId: string, orderId: string) {
    const order = await this.factStore.findOrder(tenantId, orderId);
    if (!order) throw new NotFoundException("租赁订单不存在");
    return order;
  }
  private validatePeriod(startAt: string, endAt: string) { const start = new Date(startAt).getTime(); const end = new Date(endAt).getTime(); if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new BadRequestException("租赁起止时间无效"); }
  private validateAttributes(fields: RentalAttributeDefinition[], scope: "item_group" | "asset", attributes: Record<string, unknown>, aliases: Record<string, unknown> = {}) {
    for (const field of fields.filter((item) => item.scope === scope)) {
      const value = aliases[field.code] ?? attributes[field.code];
      const missing = value === undefined || value === null || value === "";
      if (field.required && missing) throw new BadRequestException(`${field.label}不能为空`);
      if (missing) continue;
      if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new BadRequestException(`${field.label}必须是有效数字`);
      if (field.type === "boolean" && typeof value !== "boolean") throw new BadRequestException(`${field.label}必须是布尔值`);
      if (field.type === "date" && !Number.isFinite(new Date(String(value)).getTime())) throw new BadRequestException(`${field.label}必须是有效日期`);
      if (field.type === "select" && field.options?.length && !field.options.includes(String(value))) throw new BadRequestException(`${field.label}不在允许选项中`);
    }
  }
  /**
   * 可用量计算所需的库存事实。一次取齐后计算全程同步——套装展开是递归的，
   * 若在递归里逐层查库会放大成 N 次查询，且让纯算术逻辑变得难以复核和单测。
   */
  private async loadInventorySnapshot(tenantId: string): Promise<InventorySnapshot> {
    const [reservations, assets, stocks] = await Promise.all([
      this.factStore.activeReservations(tenantId),
      this.factStore.listAssets(tenantId),
      this.factStore.listStockBalances(tenantId)
    ]);
    return { reservations, assets, stocks };
  }

  private reservedQuantity(reservations: ActiveReservationRow[], itemGroupId: string, locationId: string, startAt?: string, endAt?: string) {
    return reservations
      .filter((row) => row.itemGroupId === itemGroupId && row.locationId === locationId && (!startAt || !endAt || overlaps(row.startAt, row.endAt, startAt, endAt)))
      .reduce((sum, row) => sum + row.quantity, 0);
  }

  private computeAvailability(state: TenantRentalState, snapshot: InventorySnapshot, input: RentalAvailabilityRequest): RentalAvailabilityResult {
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

  private availableQuantity(state: TenantRentalState, snapshot: InventorySnapshot, group: RentalItemGroup, locationId: string, startAt: string, endAt: string, visited: Set<string>): number {
    if (visited.has(group.id)) throw new BadRequestException("检测到套装组成循环");
    if (group.status !== "enabled") return 0;
    if (group.inventoryMode === RentalInventoryMode.Serialized) {
      const total = snapshot.assets.filter((row) => row.itemGroupId === group.id && row.locationId === locationId && ![RentalAssetStatus.Maintenance, RentalAssetStatus.Disabled].includes(row.status)).length;
      return Math.max(0, total - this.reservedQuantity(snapshot.reservations, group.id, locationId, startAt, endAt));
    }
    if (group.inventoryMode === RentalInventoryMode.Quantity) {
      const stock = snapshot.stocks.find((row) => row.itemGroupId === group.id && row.locationId === locationId);
      const reserved = this.reservedQuantity(snapshot.reservations, group.id, locationId, startAt, endAt);
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
      return { itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, quantity: row.quantity, optional: row.optional, substitutionGroup: row.substitutionGroup };
    });
  }

  private seedState(tenantId: string, categoryCode: RentalCategoryCode): TenantRentalState {
    const isSampleTenant = tenantId === "tenant_001" || tenantId === "tenant_002";
    const definition = this.category(categoryCode); const timestamp = now(); const locationId = `${tenantId}_location_01`;
    const sampleNames: Record<RentalCategoryCode, { operator: string; location: string; locationType: RentalFulfillmentLocation["type"] }> = {
      [RentalCategoryCode.Camera]: { operator: "演示摄影器材行", location: "中心器材门店", locationType: "store" },
      [RentalCategoryCode.Camping]: { operator: "演示露营装备中心", location: "中心装备仓", locationType: "warehouse" },
      [RentalCategoryCode.Vehicle]: { operator: "演示车辆租赁门店", location: "中心车行门店", locationType: "store" },
      [RentalCategoryCode.Construction]: { operator: "演示工程设备中心", location: "中心设备场站", locationType: "project_site" }
    };
    const sampleName = sampleNames[categoryCode];
    const operator: RentalFulfillmentOperator = { id: `${tenantId}_operator_01`, tenantId, code: "SELF", name: sampleName.operator, type: "self_operated", contactName: "运营负责人", contactPhone: "13800000000", settlementMode: "self", status: "enabled", createdAt: timestamp, updatedAt: timestamp };
    const location: RentalFulfillmentLocation = { id: locationId, tenantId, code: "MAIN", name: sampleName.location, type: sampleName.locationType, operatorId: operator.id, operatorType: operator.type, operatorName: operator.name, capabilities: ["pickup", "return", "storage", "delivery"], address: "演示地址 1 号", contactName: "值班负责人", contactPhone: "13800000000", businessHours: "09:00-20:00", status: "enabled" };
    const base = (code: string, name: string, mode: RentalInventoryMode, unit: string, attributes: Record<string, unknown> = {}): RentalItemGroup => ({ id: `${tenantId}_${code.toLowerCase()}`, tenantId, categoryCode, code, name, inventoryMode: mode, unit, attributes, bundleComponents: [], status: "enabled", createdAt: timestamp, updatedAt: timestamp });
    const first = categoryCode === RentalCategoryCode.Camera
      ? base("CAM-BODY", "全画幅相机机身", RentalInventoryMode.Serialized, "台", { brand: "Sony", model: "Alpha 7 IV", mount: "E", sensor: "全画幅" })
      : base("CAMP-TENT", "四人露营帐篷", RentalInventoryMode.Quantity, "顶", { brand: "Naturehike", model: "Cloud Up 4", people: 4, season: "三季" });
    const second = categoryCode === RentalCategoryCode.Camera
      ? base("CAM-LENS", "24-70mm 标准镜头", RentalInventoryMode.Serialized, "支", { brand: "Sony", model: "FE 24-70mm F2.8 GM II", mount: "E" })
      : base("CAMP-CHAIR", "折叠露营椅", RentalInventoryMode.Quantity, "把", { brand: "Helinox", model: "Chair One" });
    const bundle = base(categoryCode === RentalCategoryCode.Camera ? "CAM-KIT" : "CAMP-KIT", categoryCode === RentalCategoryCode.Camera ? "标准拍摄套装" : "双人露营套装", RentalInventoryMode.Bundle, "套");
    bundle.bundleComponents = [first, second].map((row) => ({ itemGroupId: row.id, itemGroupCode: row.code, itemGroupName: row.name, quantity: row === second && categoryCode === RentalCategoryCode.Camping ? 2 : 1 }));
    const groups = isSampleTenant ? [first, second, bundle] : [];
    const assets: RentalAsset[] = isSampleTenant && categoryCode === RentalCategoryCode.Camera ? groups.filter((row) => row.inventoryMode === RentalInventoryMode.Serialized).flatMap((group, groupIndex) => Array.from({ length: 3 }, (_, index) => ({ id: `${group.id}_asset_${index + 1}`, tenantId, itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, assetNo: `${group.code}-${String(index + 1).padStart(3, "0")}`, serialNo: `SN${groupIndex + 1}${index + 1}0001`, locationId, locationName: location.name, status: RentalAssetStatus.Available, attributes: {}, createdAt: timestamp, updatedAt: timestamp }))) : [];
    const stocks: RentalStockBalance[] = isSampleTenant && categoryCode === RentalCategoryCode.Camping ? groups.filter((row) => row.inventoryMode === RentalInventoryMode.Quantity).map((group, index) => ({ id: `${group.id}_stock`, tenantId, itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, locationId, locationName: location.name, onHandQuantity: index === 0 ? 12 : 24, reservedQuantity: 0, maintenanceQuantity: index === 0 ? 1 : 2, availableQuantity: index === 0 ? 11 : 22, updatedAt: timestamp })) : [];
    const templates = this.buildInspectionTemplates(tenantId, categoryCode);
    return { profile: { tenantId, categoryCode, capabilities: [...definition.defaultCapabilities] as RentalCapability[], terminology: { ...definition.terminology }, configVersion: definition.version, initializedAt: timestamp, updatedAt: timestamp }, businessSettings: defaultBusinessSettings(tenantId, definition), couponTemplates: [], operators: [operator], locations: [location], itemGroups: groups, inspectionTemplates: templates, sampleAssets: assets, sampleStockBalances: stocks };
  }

  private buildInspectionTemplates(tenantId: string, categoryCode: RentalCategoryCode): RentalInspectionTemplate[] {
    const definition = this.category(categoryCode);
    return (["pickup", "return"] as const).map((stage) => ({
      id: `${tenantId}_${stage}_template`, tenantId, categoryCode,
      code: `${categoryCode.toUpperCase()}_${stage.toUpperCase()}_V1`,
      name: `${stage === "pickup" ? definition.terminology.pickupLabel : definition.terminology.returnLabel}检查`,
      stage, version: "1.0", enabled: true,
      fields: categoryCode === RentalCategoryCode.Camera
        ? [{ code: "appearance_ok", label: "外观完好", type: "boolean", required: true }, { code: "function_ok", label: "功能正常", type: "boolean", required: true }, { code: "shutter_count", label: "快门次数", type: "number", required: true, unit: "次" }]
        : categoryCode === RentalCategoryCode.Camping
          ? [{ code: "count_ok", label: "数量齐全", type: "boolean", required: true }, { code: "cleanliness", label: "清洁状态", type: "select", required: true, options: ["良好", "需清洁", "严重污损"] }, { code: "damage_note", label: "破损说明", type: "text", required: false }]
          : [{ code: "appearance_ok", label: "外观完好", type: "boolean", required: true }, { code: "function_ok", label: "功能正常", type: "boolean", required: true }, { code: "usage_reading", label: definition.terminology.usageMetricLabel ?? "使用量", type: "number", required: false }]
    }));
  }
}
