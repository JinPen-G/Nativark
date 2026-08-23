import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnApplicationBootstrap, OnModuleInit, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  RentalCategoryCode,
  type GrantRentalRewardRequest,
  type ImportRentalCalendarRequest,
  type RentalCalendarDay,
  type RentalCalendarYear,
  type RentalCategoryDefinition,
  type RentalCouponTemplate,
  type RentalCustomerBenefitAccount,
  type RentalCustomerCoupon,
  type RentalDayType,
  type RentalDiscountPlan,
  type RentalItemGroup,
  type RentalNotificationSendLogV1,
  type RentalNotificationTemplateV1,
  type RentalPricingPlanV1,
  type RentalPricingRate,
  type RentalPricingUnit,
  type RentalQuoteRequest,
  type RentalQuoteSnapshotV1,
  type RentalRewardLedgerEntry,
  type RentalRuleConfig,
  type RentalRuleVersion,
  type RentalValueAddedService,
  type SaveRentalCalendarDayRequest,
  type SaveRentalDiscountPlanRequest,
  type SaveRentalNotificationTemplateRequest,
  type SaveRentalPricingPlanRequest,
  type SaveRentalRuleVersionRequest,
  type SaveRentalValueAddedServiceRequest,
  type SendRentalNotificationRequest,
  type TenantRentalBusinessSettings,
  type TenantRentalProfile
} from "@store-rental/shared";
import { getRequestWorkspaceId } from "../../common/request-identity";
import { RentalStateRepository } from "./rental-state.repository";
import {
  RentalBusinessConfigRepository,
  type RentalBusinessConfigStore
} from "./rental-business-config.repository";
import {
  RentalBusinessFactRepository,
  type RentalBusinessFactStore,
  type RentalBusinessFactTx
} from "./rental-business-fact.repository";
import { RentalCoreConfigRepository, type RentalConfigStore, type RentalConfigTx } from "./rental-core-config.repository";

interface RentalBusinessState {
  categoryCode: RentalCategoryCode;
  pricingPlans: RentalPricingPlanV1[];
  discountPlans: RentalDiscountPlan[];
  services: RentalValueAddedService[];
  calendars: RentalCalendarYear[];
  ruleVersions: RentalRuleVersion[];
  customerCoupons: RentalCustomerCoupon[];
  rewardLedger: RentalRewardLedgerEntry[];
  benefitAccounts: RentalCustomerBenefitAccount[];
  referrals: Array<{ inviteeCustomerId: string; referrerCustomerId: string; registeredAt: string }>;
  notificationTemplates: RentalNotificationTemplateV1[];
  notificationLogs: RentalNotificationSendLogV1[];
  quotes: RentalQuoteSnapshotV1[];
  /** 该租户的业务配置是否已确认落库。懒加载 seedState 只灌内存，需要一次补落。 */
  configPersisted?: boolean;
}

interface BusinessContext {
  profile: TenantRentalProfile;
  category: RentalCategoryDefinition;
  settings: TenantRentalBusinessSettings;
  groups: RentalItemGroup[];
  couponTemplates: RentalCouponTemplate[];
}

const stamp = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const dayMs = 24 * 60 * 60 * 1000;

function versionAfter(current?: string) {
  if (!current) return "1.0";
  const [major, minor] = current.split(".").map(Number);
  return `${Number.isFinite(major) ? major : 1}.${(Number.isFinite(minor) ? minor : 0) + 1}`;
}

function defaultRuleConfig(category: RentalCategoryDefinition, settings: TenantRentalBusinessSettings): RentalRuleConfig {
  return {
    payment: {
      ...settings.payment,
      unpaidHoldMinutes: 15
    },
    fulfillment: {
      pickupInspectionRequired: true,
      returnInspectionRequired: true,
      evidenceRequired: [RentalCategoryCode.Vehicle, RentalCategoryCode.Camera, RentalCategoryCode.Construction].includes(category.code),
      allowDifferentReturnLocation: settings.fulfillment.allowDifferentReturnLocation
    },
    overdue: { ...settings.overdue },
    cancellation: {
      freeBeforeHours: category.code === RentalCategoryCode.Construction ? 48 : 24,
      lateFeeType: "percentage",
      lateFeeValue: category.code === RentalCategoryCode.Camping ? 10 : 20,
      weatherExceptionEnabled: category.code === RentalCategoryCode.Camping
    },
    qualification: {
      required: category.businessModel.supportsQualificationReview,
      documentTypes: category.code === RentalCategoryCode.Vehicle ? ["驾驶证"] : category.code === RentalCategoryCode.Construction ? ["操作资格证"] : [],
      minimumValidityDays: 1
    },
    damage: {
      manualReviewRequired: true,
      chargeLimit: undefined
    }
  };
}

function serviceType(name: string): RentalValueAddedService["serviceType"] {
  if (name.includes("保险")) return "insurance";
  if (name.includes("免赔")) return "damage_waiver";
  if (name.includes("配送") || name.includes("运输")) return "delivery";
  if (name.includes("操作员")) return "operator";
  if (name.includes("耗材") || name.includes("电池") || name.includes("座椅")) return "consumable";
  if (name.includes("支持") || name.includes("救援")) return "support";
  return "other";
}

@Injectable()
export class RentalBusinessService implements OnModuleInit, OnApplicationBootstrap {
  /** SPACE-03：业务状态以**经营空间**为键，与核心服务同构。 */
  private readonly states = new Map<string, RentalBusinessState>();
  /** 「租户 → 默认经营空间」。state() 是同步的，无会话路径需要它解析空间。 */
  private readonly defaultWorkspaceByTenant = new Map<string, string>();
  /** 启动预热时从库中收集的租户品类，用于业务快照行丢失后重建状态。 */
  private readonly bootstrapCategoryByTenant = new Map<string, RentalCategoryCode>();

  constructor(
    @Inject(RentalBusinessConfigRepository) private readonly configStore: RentalBusinessConfigStore,
    @Inject(RentalBusinessFactRepository) private readonly factStore: RentalBusinessFactStore,
    @Inject(RentalCoreConfigRepository) private readonly coreConfigStore: RentalConfigStore,
    @Optional() private readonly stateRepository?: RentalStateRepository
  ) {}

  /**
   * 业务配置写穿缓存的启动预热。
   * 与核心配置同理放在 OnApplicationBootstrap：快照回填是 OnModuleInit，
   * 在它之前预热会读到还没回填的空表。
   */
  async onApplicationBootstrap() {
    const [configs, facts, coreConfigs] = await Promise.all([
      this.configStore.loadAll(),
      this.factStore.loadAll(),
      this.coreConfigStore.loadAll()
    ]);

    this.bootstrapCategoryByTenant.clear();
    // 租户经营品类的事实源是核心档案，不能从“是否仍有定价/规则行”反推。
    // 这样即使业务快照及部分业务配置同时损坏，规范化事实仍能装载到正确品类状态。
    for (const snapshot of coreConfigs) {
      if (snapshot.profile?.categoryCode) {
        this.bootstrapCategoryByTenant.set(snapshot.tenantId, snapshot.profile.categoryCode);
      }
    }
    for (const snapshot of configs) {
      if (snapshot.categoryCode) this.bootstrapCategoryByTenant.set(snapshot.tenantId, snapshot.categoryCode);
    }

    // 配置与事实必须在同一轮里处理，且状态重建要发生在两者之前。
    //
    // 早前实现分成两轮、且配置那轮遇到内存缺失就 continue：整条业务快照行丢失时，
    // 状态只在事实那轮才被重建，于是定价、优惠、增值服务、日历、规则和通知模板
    // 全部留空——只恢复了事实，配置照样丢。
    // SPACE-03：改为按**经营空间**处理。空间集合取自两个 loadAll 的并集，
    // 它们都已以 business_workspaces 为基准，因此新建但尚无数据的空间也在内。
    for (const workspace of await this.coreConfigStore.listWorkspaces()) {
      if (workspace.isDefault) this.defaultWorkspaceByTenant.set(workspace.tenantId, workspace.id);
    }
    // 只处理**确实有数据可装载**的空间。
    //
    // 不能对所有空间都建状态：loadAll 现在为每个空间都返回一条，而这里会把
    // 内存状态设成库中内容。对一个还没写过任何配置的空间，那等于塞进一个空状态，
    // 于是 state() 认为状态已存在、不再走 seedState —— 表现为报价时
    // 「当前租户没有已启用的基础定价计划」。
    const factHasRows = (row: (typeof facts)[number]) =>
      Boolean(
        row.quotes.length ||
          row.customerCoupons.length ||
          row.rewardLedger.length ||
          row.benefitAccounts.length ||
          row.referrals.length ||
          row.notificationLogs.length
      );
    const workspaceIds = new Set<string>([
      ...configs.filter((row) => row.hasPersistedConfig).map((row) => row.workspaceId),
      ...facts.filter(factHasRows).map((row) => row.workspaceId),
      // 已有内存状态的空间也要参与，让库内容覆盖它。
      ...this.states.keys()
    ]);
    const configByWorkspace = new Map(configs.map((row) => [row.workspaceId, row]));
    const factsByWorkspace = new Map(facts.map((row) => [row.workspaceId, row]));
    const tenantByWorkspace = new Map<string, string>([
      ...configs.map((row) => [row.workspaceId, row.tenantId] as const),
      ...facts.map((row) => [row.workspaceId, row.tenantId] as const)
    ]);

    for (const workspaceId of workspaceIds) {
      const tenantId = tenantByWorkspace.get(workspaceId)!;
      const state = this.states.get(workspaceId) ?? this.stateFromFacts(tenantId);
      if (!state) continue;
      const config = configByWorkspace.get(workspaceId);
      // 只有真的写过库的空间才覆盖：否则会把 seedState 的默认配置抹成空。
      if (config?.hasPersistedConfig) {
        // 无条件覆盖，包括空数组：库里没有就是没有。
        // 「非空才覆盖」会让合法为空的配置继续保留快照或 seedState 的演示数据，
        // 使快照在读路径上静默胜出。
        state.pricingPlans = config.pricingPlans;
        state.discountPlans = config.discountPlans;
        state.services = config.services;
        state.calendars = config.calendars;
        state.ruleVersions = config.ruleVersions;
        state.notificationTemplates = config.notificationTemplates;
      }
      const fact = factsByWorkspace.get(workspaceId);
      if (fact) {
        state.quotes = fact.quotes;
        state.customerCoupons = fact.customerCoupons;
        state.rewardLedger = fact.rewardLedger;
        state.benefitAccounts = fact.benefitAccounts;
        state.referrals = fact.referrals;
        state.notificationLogs = fact.notificationLogs;
      }
      this.states.set(workspaceId, state);
    }
  }

  /**
   * 业务快照行丢失时，按库中该租户的品类重建空业务状态，供事实覆盖使用。
   * 品类取自业务配置表；若连配置也没有则无法判定品类，返回 undefined 交由
   * 后续请求经 `state(tenantId, context)` 用登录上下文的品类正常建立。
   */
  private stateFromFacts(tenantId: string): RentalBusinessState | undefined {
    const categoryCode = this.bootstrapCategoryByTenant.get(tenantId);
    if (!categoryCode) return undefined;
    return {
      categoryCode,
      pricingPlans: [],
      discountPlans: [],
      services: [],
      calendars: [],
      ruleVersions: [],
      customerCoupons: [],
      rewardLedger: [],
      benefitAccounts: [],
      referrals: [],
      notificationTemplates: [],
      notificationLogs: [],
      quotes: []
    };
  }

  async onModuleInit() {
    for (const row of await this.stateRepository?.loadBusinessStates() ?? []) {
      const state = row.state as unknown as RentalBusinessState;
      // 快照行自带 workspaceId，直接按空间键装载。
      if (state?.categoryCode) this.states.set(row.workspaceId, state);
    }
  }

  async persist(tenantId: string) {
    // 快照已按经营空间存档：直接存**当前**空间的状态。
    // 此前因为快照按 tenantId 键，这里必须固定挑默认空间，否则在第二个空间触发
    // persist 会覆盖默认空间的存档；主键换成空间后该权衡消失。
    const workspaceId = this.workspaceOf(tenantId);
    const state = this.states.get(workspaceId);
    if (!state) return;
    // 懒加载的默认业务配置只在内存里，必须补落库。与核心配置同一类缺陷：
    // seedState 生成默认定价/优惠/服务/日历/规则/模板，但只有各 save* 写方法会写穿，
    // 从未被显式保存过的租户在库中就是空的——阶段 4b 的通知记录外键指向通知模板，
    // 那时才发现就晚了。
    if (!state.configPersisted) {
      await this.persistBusinessConfig(state);
      state.configPersisted = true;
    }
    await this.stateRepository?.saveBusinessState(tenantId, workspaceId, state);
  }

  /** 把整份业务配置落库。仅用于补落懒加载默认值；此后各 save* 方法按条写穿。 */
  /** 奖励入账会改权益账户余额，这里把受影响客户的账户刷进库。 */
  /**
   * 撤回 applyRewardBenefit 在内存里做过的权益兑付。
   *
   * 仅用于「并发同键落败、转而回放先到者流水」这一条路径：那时本次的内存改动
   * 不会落库，留着会让本进程的余额与库长期不一致（直到重启才自愈）。
   *
   * 刻意按本次实际发生的数额逐项回退，而不是重算余额：重算需要重放全部历史流水，
   * 而并发下另一路可能同时在改同一个账户，重算会把对方的入账也一并抹掉。
   */
  private revertRewardBenefits(
    state: RentalBusinessState,
    context: BusinessContext,
    rows: RentalRewardLedgerEntry[],
    grantedCoupons: RentalCustomerCoupon[],
    touchedTemplates: Map<string, RentalCouponTemplate>
  ) {
    for (const row of rows) {
      const account = state.benefitAccounts.find((item) => item.customerId === row.customerId);
      if (!account) continue;
      if (row.rewardType === "points") account.pointsBalance -= row.amount;
      else if (row.rewardType === "balance") account.marketingBalance = roundMoney(account.marketingBalance - row.amount);
      else account.availableRewardCouponCount -= row.amount;
    }
    const revokedIds = new Set(grantedCoupons.map((coupon) => coupon.id));
    if (revokedIds.size) {
      state.customerCoupons = state.customerCoupons.filter((coupon) => !revokedIds.has(coupon.id));
    }
    // 模板配额同样要退回。context.couponTemplates 与 state 共享同一批对象引用，
    // 因此改这里等于改缓存里的那一份。
    for (const template of touchedTemplates.values()) {
      const revoked = grantedCoupons.filter((coupon) => coupon.templateId === template.id).length;
      if (revoked) template.claimedQuantity = Math.max(0, template.claimedQuantity - revoked);
    }
  }

  private async flushBenefitAccounts(state: RentalBusinessState, customerIds: string[]) {
    for (const customerId of new Set(customerIds)) {
      const account = state.benefitAccounts.find((row) => row.customerId === customerId);
      if (account) await this.factStore.upsertBenefitAccount(account);
    }
  }

  private async persistBusinessConfig(state: RentalBusinessState) {
    for (const plan of state.pricingPlans) await this.configStore.upsertPricingPlan(plan);
    for (const plan of state.discountPlans) await this.configStore.upsertDiscountPlan(plan);
    for (const service of state.services) await this.configStore.upsertService(service);
    for (const calendar of state.calendars) await this.configStore.upsertCalendar(calendar);
    for (const version of state.ruleVersions) await this.configStore.upsertRuleVersion(version);
    for (const template of state.notificationTemplates) await this.configStore.upsertNotificationTemplate(template);
  }

  listPricingPlans(tenantId: string, context: BusinessContext) { return this.state(tenantId, context).pricingPlans; }

  async savePricingPlan(tenantId: string, context: BusinessContext, input: SaveRentalPricingPlanRequest) {
    const state = this.state(tenantId, context);
    if (!input.code?.trim() || !input.name?.trim() || !input.changeReason?.trim()) throw new BadRequestException("定价编码、名称和变更原因不能为空");
    if (!input.rates.length) throw new BadRequestException("定价计划至少需要一条价格");
    // effectiveFrom 在 DTO 里是必填，但此前只校验了它与 effectiveTo 的先后关系。
    // 内存实现能容忍缺失（存 undefined），落库后 DateTime NOT NULL 列会直接报错，
    // 因此这里显式 fail-closed：没有生效时间的价格/优惠方案本身没有业务含义。
    if (!Number.isFinite(new Date(input.effectiveFrom).getTime())) throw new BadRequestException("定价计划生效时间无效");
    if (input.effectiveTo && new Date(input.effectiveFrom).getTime() >= new Date(input.effectiveTo).getTime()) throw new BadRequestException("定价计划有效期无效");
    const supportedUnits = new Set(context.settings.pricing.enabledUnits);
    const groupMap = new Map(context.groups.map((group) => [group.id, group]));
    const seen = new Set<string>();
    const rates: RentalPricingRate[] = input.rates.map((row) => {
      const group = groupMap.get(row.itemGroupId);
      if (!group) throw new BadRequestException("定价包含不存在的商品");
      if (!supportedUnits.has(row.unit)) throw new BadRequestException(`${group.name} 使用了当前品类未启用的计价单位`);
      const unique = `${row.itemGroupId}:${row.unit}`;
      if (seen.has(unique)) throw new BadRequestException("同一商品和计价单位不能重复配置");
      seen.add(unique);
      for (const value of [row.baseAmount, row.weekendMultiplier, row.holidayMultiplier, row.depositAmount, row.minimumUnits]) {
        if (!Number.isFinite(value) || value < 0) throw new BadRequestException("价格、倍率、押金和最低计费单位必须是非负数");
      }
      return { ...row, id: uid("rate"), itemGroupCode: group.code, itemGroupName: group.name };
    });
    const existing = input.id ? state.pricingPlans.find((plan) => plan.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("定价计划不存在");
    if (state.pricingPlans.some((plan) => plan.code === input.code.trim() && plan.id !== input.id)) throw new ConflictException("定价计划编码已存在");
    const timestamp = stamp();
    const result: RentalPricingPlanV1 = {
      id: existing?.id ?? uid("pricing"), tenantId, categoryCode: context.profile.categoryCode,
      code: input.code.trim(), name: input.name.trim(), currency: "CNY", status: input.status ?? "draft",
      version: versionAfter(existing?.version), effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
      rates, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    await this.configStore.upsertPricingPlan(result);

    if (existing) Object.assign(existing, result); else state.pricingPlans.unshift(result);
    return result;
  }

  listDiscountPlans(tenantId: string, context: BusinessContext) { return this.state(tenantId, context).discountPlans; }

  async saveDiscountPlan(tenantId: string, context: BusinessContext, input: SaveRentalDiscountPlanRequest) {
    const state = this.state(tenantId, context);
    if (!input.code?.trim() || !input.name?.trim() || !input.changeReason?.trim()) throw new BadRequestException("优惠编码、名称和变更原因不能为空");
    if (input.discountType === "percentage" && (input.discountValue <= 0 || input.discountValue > 100)) throw new BadRequestException("百分比优惠必须大于 0 且不超过 100");
    if (input.discountType === "fixed_amount" && input.discountValue <= 0) throw new BadRequestException("固定减免必须大于 0");
    if (!Number.isFinite(new Date(input.effectiveFrom).getTime())) throw new BadRequestException("优惠方案生效时间无效");
    if (input.effectiveTo && new Date(input.effectiveFrom).getTime() >= new Date(input.effectiveTo).getTime()) throw new BadRequestException("优惠方案有效期无效");
    const groupIds = new Set(context.groups.map((group) => group.id));
    if (input.applicableItemGroupIds.some((id) => !groupIds.has(id))) throw new BadRequestException("优惠方案包含不存在的商品");
    const existing = input.id ? state.discountPlans.find((plan) => plan.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("优惠方案不存在");
    if (state.discountPlans.some((plan) => plan.code === input.code.trim() && plan.id !== input.id)) throw new ConflictException("优惠方案编码已存在");
    const timestamp = stamp();
    const { changeReason: _changeReason, ...data } = input;
    const result: RentalDiscountPlan = {
      ...data, id: existing?.id ?? uid("discount"), tenantId, categoryCode: context.profile.categoryCode,
      code: input.code.trim(), name: input.name.trim(), version: versionAfter(existing?.version),
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    await this.configStore.upsertDiscountPlan(result);

    if (existing) Object.assign(existing, result); else state.discountPlans.unshift(result);
    return result;
  }

  listServices(tenantId: string, context: BusinessContext) { return this.state(tenantId, context).services; }

  async saveService(tenantId: string, context: BusinessContext, input: SaveRentalValueAddedServiceRequest) {
    const state = this.state(tenantId, context);
    if (!input.code?.trim() || !input.name?.trim() || !input.terms?.trim() || !input.termsVersion?.trim()) throw new BadRequestException("服务编码、名称及条款不能为空");
    if (input.price < 0 || input.maximumQuantity < 1) throw new BadRequestException("服务价格或数量限制无效");
    if ((input.coverageLimit !== undefined && input.coverageLimit < 0) || (input.deductible !== undefined && input.deductible < 0)) throw new BadRequestException("保障额度和免赔额不能为负数");
    const groupIds = new Set(context.groups.map((group) => group.id));
    if (input.applicableItemGroupIds.some((id) => !groupIds.has(id))) throw new BadRequestException("增值服务包含不存在的商品");
    const existing = input.id ? state.services.find((service) => service.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("增值服务不存在");
    if (state.services.some((service) => service.code === input.code.trim() && service.id !== input.id)) throw new ConflictException("服务编码已存在");
    const timestamp = stamp();
    const result: RentalValueAddedService = {
      ...input, id: existing?.id ?? uid("service"), tenantId, categoryCode: context.profile.categoryCode,
      code: input.code.trim(), name: input.name.trim(), version: versionAfter(existing?.version),
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    await this.configStore.upsertService(result);

    if (existing) Object.assign(existing, result); else state.services.unshift(result);
    return result;
  }

  getCalendar(tenantId: string, context: BusinessContext, year: number) {
    const state = this.state(tenantId, context);
    return state.calendars.find((item) => item.year === year)
      ?? this.buildCalendar(tenantId, context.settings, year);
  }

  private cacheCalendar(state: RentalBusinessState, calendar: RentalCalendarYear) {
    const index = state.calendars.findIndex((item) => item.year === calendar.year);
    if (index >= 0) state.calendars.splice(index, 1, calendar);
    else state.calendars.push(calendar);
  }

  async importOfficialCalendar(tenantId: string, context: BusinessContext, input: ImportRentalCalendarRequest) {
    if (!/^https:\/\//.test(input.sourceUrl)) throw new BadRequestException("官方日历来源必须使用 HTTPS 地址");
    if (!input.days.length) throw new BadRequestException("官方日历数据不能为空");
    const state = this.state(tenantId, context);
    const calendar = structuredClone(this.getCalendar(tenantId, context, input.year));
    const dayMap = new Map(calendar.days.map((day) => [day.date, day]));
    for (const row of input.days) {
      if (!row.date.startsWith(`${input.year}-`)) throw new BadRequestException("日历日期与年度不一致");
      if (!["statutory_holiday", "makeup_workday"].includes(row.dayType)) throw new BadRequestException("官方数据只允许法定节假日或调休工作日");
      dayMap.set(row.date, {
        date: row.date, dayType: row.dayType, name: row.name,
        pricingMultiplier: row.pricingMultiplier ?? (row.dayType === "statutory_holiday" ? 1.25 : 1),
        closed: row.closed ?? false, source: "official_cn"
      });
    }
    calendar.days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    calendar.region = "CN";
    calendar.status = "draft";
    calendar.version = versionAfter(calendar.version);
    calendar.sourceName = input.sourceName;
    calendar.sourceUrl = input.sourceUrl;
    calendar.sourcePublishedAt = input.sourcePublishedAt;
    calendar.importedAt = stamp();
    calendar.publishedAt = undefined;
    await this.configStore.upsertCalendar(calendar);
    this.cacheCalendar(state, calendar);
    return calendar;
  }

  async saveCalendarDay(tenantId: string, context: BusinessContext, year: number, input: SaveRentalCalendarDayRequest) {
    const state = this.state(tenantId, context);
    const calendar = structuredClone(this.getCalendar(tenantId, context, year));
    if (!input.date.startsWith(`${year}-`) || input.pricingMultiplier < 0) throw new BadRequestException("日期年度或价格系数无效");
    const day: RentalCalendarDay = { ...input, source: "tenant_override" };
    const index = calendar.days.findIndex((item) => item.date === input.date);
    if (index >= 0) calendar.days[index] = day; else calendar.days.push(day);
    calendar.days.sort((a, b) => a.date.localeCompare(b.date));
    calendar.status = "draft";
    calendar.version = versionAfter(calendar.version);
    calendar.publishedAt = undefined;
    await this.configStore.upsertCalendar(calendar);
    this.cacheCalendar(state, calendar);
    return day;
  }

  async publishCalendar(tenantId: string, context: BusinessContext, year: number) {
    const state = this.state(tenantId, context);
    const calendar = structuredClone(this.getCalendar(tenantId, context, year));
    if (calendar.region === "CN" && !calendar.sourceName) throw new ConflictException("中国大陆日历发布前必须导入并记录官方来源");
    calendar.status = "published";
    calendar.publishedAt = stamp();
    await this.configStore.upsertCalendar(calendar);
    this.cacheCalendar(state, calendar);
    return calendar;
  }

  listRuleVersions(tenantId: string, context: BusinessContext) { return this.state(tenantId, context).ruleVersions; }

  currentRule(tenantId: string, context: BusinessContext) {
    return this.state(tenantId, context).ruleVersions.find((item) => item.status === "published") ?? this.state(tenantId, context).ruleVersions[0];
  }

  async saveRuleVersion(tenantId: string, context: BusinessContext, input: SaveRentalRuleVersionRequest, operator: string) {
    const state = this.state(tenantId, context);
    this.validateRule(context, input.config);
    if (!input.changeReason?.trim()) throw new BadRequestException("规则变更原因不能为空");
    // 退役旧版本延后到写库成功之后：早前在此处直接改内存，
    // 一旦新版本写库失败，缓存里的旧规则已被改成 retired，
    // 而库中仍是 published，重启后会重新加载出多个 published 版本。
    const retiring = input.publish
      ? state.ruleVersions.filter((row) => row.status === "published")
      : [];
    const result: RentalRuleVersion = {
      id: uid("rule"), tenantId, categoryCode: context.profile.categoryCode,
      version: versionAfter(state.ruleVersions[0]?.version), status: input.publish ? "published" : "draft",
      config: structuredClone(input.config), changeReason: input.changeReason.trim(), createdBy: operator,
      createdAt: stamp(), publishedAt: input.publish ? stamp() : undefined
    };
    // 新版本与旧版本退役必须一起落库，否则库里会同时存在多个 published。
    await this.configStore.replacePublishedRuleVersion(
      result,
      retiring.map((row) => ({ ...row, status: "retired" as const }))
    );
    for (const row of retiring) row.status = "retired";

    state.ruleVersions.unshift(result);
    return result;
  }

  listCustomerCoupons(tenantId: string, context: BusinessContext, customerId?: string) {
    return this.state(tenantId, context).customerCoupons.filter((coupon) => !customerId || coupon.customerId === customerId);
  }

  /**
   * 领券。传入 `tx` 时（幂等执行器包裹的路径）数据库写入全部走该事务，
   * 且**不碰内存缓存**——缓存必须等事务提交成功后由调用方用
   * `applyCouponClaimToCache` 落地。否则事务回滚后内存里会留下一张库中并不存在的
   * 幽灵券，以及一个多加过的 claimedQuantity。
   *
   * 不传 `tx` 时保持原语义（无事务、写完即更新缓存）。
   */
  async claimCoupon(tenantId: string, context: BusinessContext, templateId: string, customerId: string, tx?: RentalBusinessFactTx) {
    const state = this.state(tenantId, context);
    const template = context.couponTemplates.find((item) => item.id === templateId && item.status === "enabled");
    if (!template) throw new NotFoundException("优惠券模板不存在或未启用");
    const now = Date.now();
    if (now < new Date(template.effectiveFrom).getTime() || now > new Date(template.effectiveTo).getTime()) throw new ConflictException("优惠券不在可领取有效期");
    if (template.claimedQuantity >= template.totalQuota) throw new ConflictException("优惠券已领完");
    if (state.customerCoupons.filter((item) => item.templateId === templateId && item.customerId === customerId && item.status !== "void").length >= template.perCustomerLimit) throw new ConflictException("已达到每客限领数量");
    const coupon: RentalCustomerCoupon = {
      id: uid("customer_coupon"), tenantId, customerId, templateId, templateCode: template.code,
      templateName: template.name, status: "claimed", claimedAt: stamp(), effectiveFrom: template.effectiveFrom, effectiveTo: template.effectiveTo
    };
    // 构造候选模板而不是就地改 template：就地改会在事务回滚后留下多加的配额。
    const nextTemplate: RentalCouponTemplate = { ...template, claimedQuantity: template.claimedQuantity + 1, updatedAt: stamp() };
    await this.factStore.upsertCustomerCoupon(coupon, tx);
    // 领取会递增模板已领数量，那是核心配置对象；不一并写穿的话重启后配额回退，
    // 同一张券可以被反复领完。
    await this.coreConfigStore.upsertCouponTemplate(nextTemplate, tx as RentalConfigTx | undefined);
    if (!tx) this.applyCouponClaimToCache(tenantId, context, coupon, nextTemplate);
    return { coupon, template: nextTemplate };
  }

  /** 事务提交成功后把领券结果落进内存缓存。提交前调用会产生幽灵券。 */
  applyCouponClaimToCache(tenantId: string, context: BusinessContext, coupon: RentalCustomerCoupon, template: RentalCouponTemplate) {
    const state = this.state(tenantId, context);
    if (!state.customerCoupons.some((item) => item.id === coupon.id)) state.customerCoupons.unshift(coupon);
    const cached = context.couponTemplates.find((item) => item.id === template.id);
    if (cached) {
      cached.claimedQuantity = template.claimedQuantity;
      cached.updatedAt = template.updatedAt;
    }
  }

  validateCouponForOrder(
    tenantId: string,
    context: BusinessContext,
    couponId: string | undefined,
    customerId: string | undefined,
    at = stamp()
  ): RentalCustomerCoupon | undefined {
    if (!couponId) return undefined;
    const coupon = this.customerCoupon(this.state(tenantId, context), couponId);
    if (customerId && coupon.customerId !== customerId) throw new ConflictException("优惠券不属于当前客户");
    if (coupon.status !== "claimed") throw new ConflictException("优惠券当前不能锁定");
    const timestamp = new Date(at).getTime();
    if (timestamp < new Date(coupon.effectiveFrom).getTime() || timestamp > new Date(coupon.effectiveTo).getTime()) {
      throw new ConflictException("优惠券不在有效期");
    }
    return coupon;
  }

  /** 数据库事务提交后再更新内存副本，事务失败时不得留下幽灵消费或幽灵锁定。 */
  applyOrderConfirmationToCache(
    quote: RentalQuoteSnapshotV1,
    coupon: RentalCustomerCoupon | undefined,
    orderId: string,
    committedAt: string
  ) {
    quote.consumedAt = committedAt;
    quote.consumedOrderId = orderId;
    if (coupon) {
      coupon.status = "locked";
      coupon.lockedOrderId = orderId;
      coupon.lockedAt = committedAt;
      coupon.releasedAt = undefined;
    }
  }

  async lockCoupon(tenantId: string, context: BusinessContext, couponId: string | undefined, orderId: string) {
    if (!couponId) return undefined;
    const coupon = this.validateCouponForOrder(tenantId, context, couponId, undefined);
    if (!coupon) return undefined;
    coupon.status = "locked"; coupon.lockedOrderId = orderId; coupon.lockedAt = stamp();
    await this.factStore.upsertCustomerCoupon(coupon);
    return coupon;
  }

  async redeemCoupon(tenantId: string, context: BusinessContext, orderId: string) {
    const coupons = this.state(tenantId, context).customerCoupons;
    // 已按本订单核销过：属于同一次意图的重复核销，幂等返回而不是报错。
    //
    // 订单动作被幂等执行器保护后，重试会走回放路径正常返回，但控制器随后仍会
    // 调用本方法；若这里对已核销状态抛 409，整个重试请求就失败了——
    // 幂等保护了订单本体，却被它的副作用破功。RC-04 要求的正是"重复请求不重复核销"，
    // 而不是"重复请求报错"。
    const alreadyRedeemed = coupons.find((item) => item.redeemedOrderId === orderId && item.status === "redeemed");
    if (alreadyRedeemed) return alreadyRedeemed;
    const coupon = coupons.find((item) => item.lockedOrderId === orderId);
    if (!coupon) return undefined;
    if (coupon.status !== "locked") throw new ConflictException("优惠券不是锁定状态");
    coupon.status = "redeemed"; coupon.redeemedOrderId = orderId; coupon.redeemedAt = stamp();
    await this.factStore.upsertCustomerCoupon(coupon);
    return coupon;
  }

  async releaseCoupon(tenantId: string, context: BusinessContext, orderId: string) {
    const coupon = this.state(tenantId, context).customerCoupons.find((item) => item.lockedOrderId === orderId || item.redeemedOrderId === orderId);
    if (!coupon) return undefined;
    coupon.status = "claimed"; coupon.lockedOrderId = undefined; coupon.lockedAt = undefined;
    coupon.redeemedOrderId = undefined; coupon.redeemedAt = undefined; coupon.releasedAt = stamp();
    await this.factStore.upsertCustomerCoupon(coupon);
    return coupon;
  }

  listRewards(tenantId: string, context: BusinessContext, customerId?: string) {
    return this.state(tenantId, context).rewardLedger.filter((row) => !customerId || row.customerId === customerId);
  }

  listBenefitAccounts(tenantId: string, context: BusinessContext, customerId?: string) {
    return this.state(tenantId, context).benefitAccounts.filter((row) => !customerId || row.customerId === customerId);
  }

  async grantReward(tenantId: string, context: BusinessContext, input: GrantRentalRewardRequest) {
    const state = this.state(tenantId, context);
    if (!input.customerId || !input.idempotencyKey) throw new BadRequestException("客户和幂等键不能为空");
    // 判重以库为准，不靠内存 rewardLedger。
    //
    // 早前只查内存：库上虽有 (tenantId, idempotencyKey) 唯一约束，但那只会在写入时
    // 抛错，而不是幂等返回既有流水。缓存冷启动或多实例部署下，重复发放会变成 500。
    // 关掉内存判重跑 E2E 可复现——「重复发放应幂等返回既有流水」当场失败。
    const existing = await this.factStore.findRewardsByIdempotencyKey(tenantId, input.idempotencyKey);
    if (existing.length) {
      // 顺带把缺失的条目回填进缓存，使后续读取与库一致。
      for (const row of existing) {
        if (!state.rewardLedger.some((cached) => cached.id === row.id)) state.rewardLedger.unshift(row);
      }
      return existing;
    }
    const membership = context.settings.membership;
    const rows: RentalRewardLedgerEntry[] = [];
    const planned: Array<{ customerId: string; type: RentalRewardLedgerEntry["rewardType"]; amount: number; couponTemplateId?: string }> = [];
    if (input.triggerType === "registration" && membership.signupRewardEnabled) planned.push({ customerId: input.customerId, type: membership.signupRewardType, amount: membership.signupRewardAmount, couponTemplateId: membership.signupRewardCouponTemplateId });
    const matchesReferralTrigger = input.triggerType === "referral" || input.triggerType === membership.referralTrigger;
    if (matchesReferralTrigger && membership.referralRewardEnabled && input.relatedCustomerId) {
      planned.push({ customerId: input.customerId, type: membership.referralRewardType, amount: membership.referrerRewardAmount, couponTemplateId: membership.referralRewardCouponTemplateId });
      planned.push({ customerId: input.relatedCustomerId, type: membership.referralRewardType, amount: membership.inviteeRewardAmount, couponTemplateId: membership.referralRewardCouponTemplateId });
    }
    this.validateRewardBatch(state, context, planned.filter((item) => item.amount > 0));
    // 奖励券与被改动的券模板必须与流水一起落库，否则它们只存在于内存里：
    // 重启后券凭空消失、模板配额回退，同一批券可被反复发放。
    const grantedCoupons: RentalCustomerCoupon[] = [];
    const touchedTemplates = new Map<string, RentalCouponTemplate>();
    const add = (customerId: string, type: RentalRewardLedgerEntry["rewardType"], amount: number, key: string, reason: string, relatedCustomerId?: string, couponTemplateId?: string) => {
      if (amount <= 0) return;
      const applied = this.applyRewardBenefit(state, context, customerId, type, amount, couponTemplateId);
      grantedCoupons.push(...applied.grantedCoupons);
      // 用 Map 去重：双边邀请奖励会两次命中同一个模板，配额已在内存累加完，
      // 落库只需按最终值写一次。
      if (applied.touchedTemplate) touchedTemplates.set(applied.touchedTemplate.id, applied.touchedTemplate);
      const row: RentalRewardLedgerEntry = { id: uid("reward"), tenantId, customerId, rewardType: type, amount, triggerType: input.triggerType, idempotencyKey: key, relatedCustomerId, status: "granted", reason, benefitReferenceIds: applied.referenceIds, appliedAt: applied.appliedAt, createdAt: applied.appliedAt };
      state.rewardLedger.unshift(row); rows.push(row);
    };
    if (input.triggerType === "registration" && membership.signupRewardEnabled) add(input.customerId, membership.signupRewardType, membership.signupRewardAmount, input.idempotencyKey, "新会员注册赠礼", undefined, membership.signupRewardCouponTemplateId);
    if (matchesReferralTrigger && membership.referralRewardEnabled && input.relatedCustomerId) {
      add(input.customerId, membership.referralRewardType, membership.referrerRewardAmount, `${input.idempotencyKey}:referrer`, "邀请人奖励", input.relatedCustomerId, membership.referralRewardCouponTemplateId);
      add(input.relatedCustomerId, membership.referralRewardType, membership.inviteeRewardAmount, `${input.idempotencyKey}:invitee`, "被邀请人奖励", input.customerId, membership.referralRewardCouponTemplateId);
    }
    if (!rows.length) throw new ConflictException("当前激励规则未启用或触发条件不匹配");
    try {
      for (const row of rows) await this.factStore.upsertRewardEntry(row);
    } catch (error) {
      // 并发同键：两边都通过了库查询，写入时撞唯一约束。
      // 先到者已入账，这里回放它的流水而不是把 500 抛给调用方。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.factStore.findRewardsByIdempotencyKey(tenantId, input.idempotencyKey);
        if (winner.length) {
          // 落败者必须撤回它在内存里已经兑付的权益。
          //
          // applyRewardBenefit 在写库之前就加过积分/余额、造过券、递增过模板配额；
          // 本分支直接返回先到者的流水，那些内存改动却留了下来，且永远不会落库——
          // 于是本进程读到的余额比库里高，重启才会"自愈"。必须显式回滚。
          this.revertRewardBenefits(state, context, rows, grantedCoupons, touchedTemplates);
          for (const row of winner) {
            if (!state.rewardLedger.some((cached) => cached.id === row.id)) state.rewardLedger.unshift(row);
          }
          return winner;
        }
      }
      throw error;
    }
    // 券与模板配额随流水一起落库。放在流水之后：流水的唯一约束是并发判重的
    // 唯一可靠关口，先过了那一关再写券，避免落败者也写出券来。
    for (const coupon of grantedCoupons) await this.factStore.upsertCustomerCoupon(coupon);
    for (const template of touchedTemplates.values()) await this.coreConfigStore.upsertCouponTemplate(template);
    await this.flushBenefitAccounts(state, rows.map((row) => row.customerId));
    return rows;
  }

  async registerReferral(tenantId: string, context: BusinessContext, inviteeCustomerId: string, referrerCustomerId?: string) {
    const state = this.state(tenantId, context);
    if (!referrerCustomerId) return undefined;
    if (inviteeCustomerId === referrerCustomerId) throw new BadRequestException("客户不能邀请自己");
    const current = state.referrals.find((row) => row.inviteeCustomerId === inviteeCustomerId);
    if (current && current.referrerCustomerId !== referrerCustomerId) throw new ConflictException("邀请关系建立后不能更换邀请人");
    if (current) return current;
    const relation = { inviteeCustomerId, referrerCustomerId, registeredAt: stamp() };
    state.referrals.unshift(relation);
    await this.factStore.upsertReferral(tenantId, relation);
    return relation;
  }

  async handleCustomerEvent(tenantId: string, context: BusinessContext, customerId: string, triggerType: "registration" | "identity_verified" | "first_order_completed") {
    const state = this.state(tenantId, context);
    const membership = context.settings.membership;
    const rows: RentalRewardLedgerEntry[] = [];
    if (triggerType === "registration" && membership.signupRewardEnabled) {
      rows.push(...await this.grantReward(tenantId, context, { customerId, triggerType, idempotencyKey: `signup:${customerId}` }));
    }
    const relation = state.referrals.find((row) => row.inviteeCustomerId === customerId);
    if (relation && membership.referralRewardEnabled && membership.referralTrigger === triggerType) {
      rows.push(...await this.grantReward(tenantId, context, { customerId: relation.referrerCustomerId, relatedCustomerId: customerId, triggerType, idempotencyKey: `referral:${triggerType}:${customerId}` }));
    }
    return rows;
  }

  async reverseReward(tenantId: string, context: BusinessContext, id: string, reason: string) {
    const state = this.state(tenantId, context);
    const row = state.rewardLedger.find((item) => item.id === id);
    if (!row) throw new NotFoundException("奖励流水不存在");
    if (row.status === "reversed") return row;
    if (!reason?.trim()) throw new BadRequestException("撤销原因不能为空");
    this.reverseRewardBenefit(state, context, row);
    row.status = "reversed"; row.reason = `${row.reason}；撤销：${reason.trim()}`; row.reversedAt = stamp();
    await this.factStore.upsertRewardEntry(row);
    await this.flushBenefitAccounts(state, [row.customerId]);
    return row;
  }

  listNotificationTemplates(tenantId: string, context: BusinessContext) { return this.state(tenantId, context).notificationTemplates; }

  async saveNotificationTemplate(tenantId: string, context: BusinessContext, input: SaveRentalNotificationTemplateRequest) {
    const state = this.state(tenantId, context);
    if (!context.settings.notifications.enabledEvents.includes(input.eventCode)) throw new BadRequestException("通知事件未在租户经营设置中启用");
    if (!context.settings.notifications.editableChannels.includes(input.channel)) throw new BadRequestException("通知渠道未在租户经营设置中启用");
    const existing = input.id ? state.notificationTemplates.find((item) => item.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("通知模板不存在");
    const variables = new Set(Object.keys(input.variableSchema));
    const used = [...input.title.matchAll(/\{\{(\w+)\}\}/g), ...input.body.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
    if (used.some((key) => !variables.has(key))) throw new BadRequestException("模板使用了未注册变量");
    const result: RentalNotificationTemplateV1 = {
      ...input, id: existing?.id ?? uid("notification_template"), tenantId,
      version: versionAfter(existing?.version), updatedAt: stamp()
    };
    await this.configStore.upsertNotificationTemplate(result);

    if (existing) Object.assign(existing, result); else state.notificationTemplates.unshift(result);
    return result;
  }

  listNotificationLogs(tenantId: string, context: BusinessContext) { return this.state(tenantId, context).notificationLogs; }

  /**
   * 发送通知。传入 `tx` 时数据库写入走该事务，且**不碰内存缓存**——
   * 缓存由调用方在提交成功后用 `applyNotificationLogToCache` 落地。
   *
   * 注意边界：事务只能回滚**数据库记录**。当前 provider 是 mock adapter，
   * 没有真正的外部投递，所以"回滚"是完整的；接入真实 provider 后，事务
   * 撤不回已发出的短信，那时必须改用 provider 幂等键或 transactional outbox。
   * 本任务不虚构外部 provider，因此不在此实现 outbox。
   */
  async sendNotification(tenantId: string, context: BusinessContext, input: SendRentalNotificationRequest, tx?: RentalBusinessFactTx) {
    const state = this.state(tenantId, context);
    const template = state.notificationTemplates.find((item) => item.id === input.templateId && item.status === "enabled");
    if (!template) throw new NotFoundException("通知模板不存在或未启用");
    const missing = Object.entries(template.variableSchema).filter(([key, value]) => value.required && (input.variables[key] === undefined || input.variables[key] === ""));
    if (missing.length) throw new BadRequestException(`缺少通知变量：${missing.map(([key]) => key).join("、")}`);
    const render = (source: string) => source.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(input.variables[key] ?? ""));
    const timestamp = stamp();
    const log: RentalNotificationSendLogV1 = {
      id: uid("notification"), tenantId, templateId: template.id, templateVersion: template.version,
      eventCode: template.eventCode, channel: template.channel, recipient: input.recipient,
      renderedTitle: render(template.title), renderedBody: render(template.body), variables: structuredClone(input.variables),
      status: "sent", provider: "mock-notification-adapter", providerMessageId: uid("mock"), attempts: 1,
      createdAt: timestamp, sentAt: timestamp
    };
    // 事务路径下不动缓存：回滚后内存里会留下库中不存在的幽灵通知记录。
    if (!tx) state.notificationLogs.unshift(log);
    await this.factStore.insertNotificationLog(log, tx);
    return log;
  }

  /** 事务提交成功后把发送记录落进内存缓存。提交前调用会产生幽灵通知记录。 */
  applyNotificationLogToCache(tenantId: string, context: BusinessContext, log: RentalNotificationSendLogV1) {
    const state = this.state(tenantId, context);
    if (!state.notificationLogs.some((item) => item.id === log.id)) state.notificationLogs.unshift(log);
  }

  /**
   * 按事件码向所有启用模板发送通知。
   *
   * 必须逐个 await：`sendNotification` 现在落库后返回 Promise，而同步 `try/catch`
   * 捕不到异步拒绝——未处理的拒绝会直接终止 Node 进程（E2E 表现为 ECONNRESET）。
   * 单个模板失败不应中断其余模板与主业务动作，因此在循环内单独捕获。
   */
  async emitNotificationEvent(tenantId: string, context: BusinessContext, eventCode: string, recipient: string | undefined, variables: Record<string, unknown>) {
    if (!recipient || !context.settings.notifications.enabledEvents.includes(eventCode)) return [];
    const templates = this.state(tenantId, context).notificationTemplates.filter((item) => item.eventCode === eventCode && item.status === "enabled");
    const logs: RentalNotificationSendLogV1[] = [];
    for (const template of templates) {
      try {
        logs.push(await this.sendNotification(tenantId, context, { templateId: template.id, recipient, variables }));
      } catch {
        // 模板停用、渠道不可用等单点失败不冒泡到订单动作。
      }
    }
    return logs;
  }

  async createQuote(tenantId: string, context: BusinessContext, input: RentalQuoteRequest) {
    const state = this.state(tenantId, context);
    if (new Date(input.startAt).getTime() >= new Date(input.endAt).getTime()) throw new BadRequestException("租赁结束时间必须晚于开始时间");
    if (!input.lines.length) throw new BadRequestException("报价至少需要一个商品");
    if (new Set(input.lines.map((line) => line.itemGroupId)).size !== input.lines.length) throw new BadRequestException("同一商品在一次报价中只能出现一行");
    if (!context.settings.fulfillment.enabledModes.includes(input.fulfillmentMode)) throw new BadRequestException("当前租户未启用所选租赁履约方式");
    if (input.returnLocationId && input.returnLocationId !== input.fulfillmentLocationId && !context.settings.fulfillment.allowDifferentReturnLocation) throw new BadRequestException("当前租户未启用异地归还");
    const plan = input.pricingPlanId ? state.pricingPlans.find((item) => item.id === input.pricingPlanId && item.status === "enabled") : state.pricingPlans.find((item) => item.status === "enabled");
    if (!plan) throw new ConflictException("当前租户没有已启用的基础定价计划");
    const calendars = this.calendarsForDateRange(tenantId, context, input.startAt, input.endAt);
    const rule = this.currentRule(tenantId, context);
    if (!rule || rule.status !== "published") throw new ConflictException("当前租户没有已发布的租赁规则");
    const groups = new Map(context.groups.map((group) => [group.id, group]));
    const chargeLines: RentalQuoteSnapshotV1["chargeLines"] = [];
    let rentalAmount = 0;
    let depositAmount = 0;
    for (const line of input.lines) {
      const group = groups.get(line.itemGroupId);
      if (!group || line.quantity < 1 || !Number.isInteger(line.quantity)) throw new BadRequestException("报价商品或数量无效");
      const rate = plan.rates.find((item) => item.itemGroupId === line.itemGroupId && (!line.pricingUnit || item.unit === line.pricingUnit)) ?? plan.rates.find((item) => item.itemGroupId === line.itemGroupId);
      if (!rate) throw new ConflictException(`${group.name} 尚未配置基础价格`);
      const units = Math.max(rate.minimumUnits, this.billableUnits(rate.unit, input.startAt, input.endAt, line.usageQuantity));
      const multiplier = this.calendarMultiplier(calendars, context.settings, input.startAt, input.endAt, rate);
      const amount = roundMoney((rate.unit === "usage"
        ? rate.baseAmount + Math.max(0, units - (rate.includedUsage ?? 0)) * (rate.excessUsageAmount ?? rate.baseAmount)
        : rate.baseAmount * units) * line.quantity * multiplier);
      rentalAmount += amount;
      depositAmount += rate.depositAmount * line.quantity;
      chargeLines.push({ code: `rental:${group.code}`, name: `${group.name}租金`, type: "rental", amount, sourceId: plan.id, sourceVersion: plan.version, detail: `${line.quantity} × ${units} ${rate.unit} × 日历系数 ${multiplier.toFixed(2)}` });
    }
    rentalAmount = roundMoney(rentalAmount);
    depositAmount = rule.config.payment.depositMode === "none" ? 0 : roundMoney(depositAmount);
    if (rule.config.payment.preauthorizationRequired && depositAmount <= 0) throw new ConflictException("当前规则要求预授权，但所选商品未配置预授权额度");
    const quotedDayTypes = new Set(this.dayTypesForRange(calendars, input.startAt, input.endAt));
    const eligible = state.discountPlans.filter((item) => item.status === "enabled" && this.inPeriod(item.effectiveFrom, item.effectiveTo, input.startAt) && item.minimumSpend <= rentalAmount && (item.customerScope === "all" || item.customerScope === input.customerType || (item.customerScope === "member" && Boolean(input.customerId))) && (!item.applicableItemGroupIds.length || input.lines.some((line) => item.applicableItemGroupIds.includes(line.itemGroupId))) && (!item.applicableDayTypes.length || item.applicableDayTypes.some((dayType) => quotedDayTypes.has(dayType)))).sort((a, b) => a.priority - b.priority);
    const discountPlans = input.discountPlanId ? eligible.filter((item) => item.id === input.discountPlanId) : eligible.slice(0, 1);
    if (input.discountPlanId && !discountPlans.length) throw new ConflictException("指定优惠方案不满足本次报价条件");
    let discountAmount = 0;
    for (const discount of discountPlans) {
      const amount = this.discountAmount(rentalAmount - discountAmount, discount.discountType, discount.discountValue, discount.maximumDiscount);
      discountAmount += amount;
      chargeLines.push({ code: `discount:${discount.code}`, name: discount.name, type: "discount", amount: -amount, sourceId: discount.id, sourceVersion: discount.version });
    }
    const customerCoupon = input.customerCouponId ? this.customerCoupon(state, input.customerCouponId) : undefined;
    let couponAmount = 0;
    if (customerCoupon) {
      if (customerCoupon.customerId !== input.customerId || customerCoupon.status !== "claimed") throw new ConflictException("优惠券不属于当前客户或不可用");
      const template = context.couponTemplates.find((item) => item.id === customerCoupon.templateId && item.status === "enabled");
      if (!template || rentalAmount < template.minimumSpend || !this.inPeriod(template.effectiveFrom, template.effectiveTo, input.startAt) || (template.applicableItemGroupIds.length > 0 && !input.lines.some((line) => template.applicableItemGroupIds.includes(line.itemGroupId)))) throw new ConflictException("优惠券不满足本次报价条件");
      if (discountPlans.some((item) => !item.stackableWithCoupon)) throw new ConflictException("当前优惠方案不能与优惠券叠加");
      couponAmount = this.discountAmount(rentalAmount - discountAmount, template.discountType === "percentage" ? "percentage" : "fixed_amount", template.discountValue, template.maximumDiscount);
      chargeLines.push({ code: `coupon:${template.code}`, name: template.name, type: "coupon", amount: -couponAmount, sourceId: template.id, sourceVersion: template.version });
    }
    let serviceAmount = 0;
    for (const selected of input.services ?? []) {
      const service = state.services.find((item) => item.id === selected.serviceId && item.status === "enabled");
      if (!service || selected.quantity < 1 || selected.quantity > service.maximumQuantity) throw new BadRequestException("增值服务或数量无效");
      if (service.applicableItemGroupIds.length && !input.lines.some((line) => service.applicableItemGroupIds.includes(line.itemGroupId))) throw new ConflictException(`${service.name} 不适用于所选商品`);
      const units = service.billingUnit === "per_day" ? Math.max(1, Math.ceil((new Date(input.endAt).getTime() - new Date(input.startAt).getTime()) / dayMs)) : 1;
      const amount = roundMoney(service.price * selected.quantity * units);
      serviceAmount += amount;
      chargeLines.push({ code: `service:${service.code}`, name: service.name, type: "service", amount, sourceId: service.id, sourceVersion: `${service.version}/${service.termsVersion}`, detail: service.terms });
    }
    serviceAmount = roundMoney(serviceAmount);
    if (depositAmount > 0) chargeLines.push({ code: "deposit", name: rule.config.payment.preauthorizationRequired ? "预授权额度" : "押金", type: "deposit", amount: depositAmount, sourceId: rule.id, sourceVersion: rule.version });
    const timestamp = stamp();
    const quote: RentalQuoteSnapshotV1 = {
      id: uid("quote"), tenantId, quoteNo: `RQ${timestamp.replace(/\D/g, "").slice(0, 14)}${String(state.quotes.length + 1).padStart(3, "0")}`,
      categoryCode: context.profile.categoryCode, request: structuredClone(input), chargeLines,
      rentalAmount, discountAmount: roundMoney(discountAmount), couponAmount: roundMoney(couponAmount), serviceAmount,
      depositAmount, payableAmount: roundMoney(rentalAmount - discountAmount - couponAmount + serviceAmount),
      pricingPlanVersion: plan.version, ruleVersion: rule.version, ruleSnapshot: structuredClone(rule.config), calendarVersion: calendars.map((calendar) => `${calendar.year}:${calendar.status === "published" ? calendar.version : "draft"}`).join("|"),
      appliedDiscountPlanIds: discountPlans.map((item) => item.id), customerCouponId: customerCoupon?.id,
      expiresAt: new Date(Date.now() + rule.config.payment.unpaidHoldMinutes * 60_000).toISOString(), createdAt: timestamp
    };
    state.quotes.unshift(quote);
    await this.factStore.upsertQuote(quote);
    return quote;
  }

  getQuote(tenantId: string, context: BusinessContext, quoteId: string) {
    const quote = this.state(tenantId, context).quotes.find((item) => item.id === quoteId);
    if (!quote) throw new NotFoundException("报价不存在");
    return quote;
  }

  consumeQuote(tenantId: string, context: BusinessContext, quoteId: string) {
    const quote = this.getQuote(tenantId, context, quoteId);
    if (new Date(quote.expiresAt).getTime() < Date.now()) throw new ConflictException("报价已过期，请重新报价");
    if (quote.consumedAt) throw new ConflictException(`报价已用于订单 ${quote.consumedOrderId ?? ""}，请重新报价`);
    return quote;
  }

  async markQuoteConsumed(tenantId: string, context: BusinessContext, quoteId: string, orderId: string) {
    const quote = this.consumeQuote(tenantId, context, quoteId);
    quote.consumedAt = stamp();
    quote.consumedOrderId = orderId;
    await this.factStore.upsertQuote(quote);
    return quote;
  }

  /**
   * 当前请求应当读写的经营空间。有会话取会话空间，无会话取租户默认空间。
   * 与核心服务同一规则，两者皆无则明确拒绝，不猜。
   */
  /**
   * 解析并缓存租户的默认经营空间。
   *
   * 预热时建的表覆盖不到**启动后新建**的租户；那些租户的 persist 会因此查不到
   * 空间而静默跳过，业务配置就永远不落库（实测表现为第 19 节报「配置只落了一半」）。
   * 因此这里在缓存未命中时回查一次并补全缓存。
   */
  private async resolveDefaultWorkspace(tenantId: string): Promise<string | undefined> {
    const cached = this.defaultWorkspaceByTenant.get(tenantId);
    if (cached) return cached;
    for (const workspace of await this.coreConfigStore.listWorkspaces()) {
      if (workspace.isDefault) this.defaultWorkspaceByTenant.set(workspace.tenantId, workspace.id);
    }
    return this.defaultWorkspaceByTenant.get(tenantId);
  }

  private workspaceOf(tenantId: string): string {
    const fromSession = getRequestWorkspaceId();
    if (fromSession) return fromSession;
    const fallback = this.defaultWorkspaceByTenant.get(tenantId);
    if (!fallback) throw new ConflictException("当前 SaaS 租户尚未建立经营空间");
    return fallback;
  }

  /** 配置 id 前缀：默认空间沿用 tenantId 保持既有 id，其余空间用自己的 id。 */
  private seedPrefix(tenantId: string, workspaceId: string): string {
    return this.defaultWorkspaceByTenant.get(tenantId) === workspaceId ? tenantId : workspaceId;
  }

  private state(tenantId: string, context: BusinessContext) {
    const workspaceId = this.workspaceOf(tenantId);
    let state = this.states.get(workspaceId);
    if (!state || state.categoryCode !== context.profile.categoryCode) {
      state = this.seedState(tenantId, context, this.seedPrefix(tenantId, workspaceId));
      this.states.set(workspaceId, state);
    }
    state.referrals ??= [];
    state.benefitAccounts ??= [];
    return state;
  }

  /**
   * `idPrefix` 必须按经营空间取值：同租户第二个空间若生成相同 id，
   * 而配置写入按 id upsert，就会把默认空间的定价/优惠/服务改挂到新空间上。
   */
  private seedState(tenantId: string, context: BusinessContext, idPrefix: string = tenantId): RentalBusinessState {
    const timestamp = stamp();
    const rates: RentalPricingRate[] = context.groups.filter((group) => group.status === "enabled").map((group, index) => ({
      id: uid("rate"), itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name,
      unit: context.settings.pricing.defaultUnit, baseAmount: context.profile.categoryCode === RentalCategoryCode.Camping ? 80 + index * 20 : context.profile.categoryCode === RentalCategoryCode.Camera ? 180 + index * 80 : context.profile.categoryCode === RentalCategoryCode.Vehicle ? 380 + index * 100 : 680 + index * 180,
      weekendMultiplier: 1.1, holidayMultiplier: 1.25,
      depositAmount: context.category.businessModel.supportsPreauthorization ? 1000 + index * 500 : 200,
      minimumUnits: 1
    }));
    const pricingPlans: RentalPricingPlanV1[] = [{ id: `${idPrefix}_pricing_default`, tenantId, categoryCode: context.profile.categoryCode, code: "STANDARD", name: `${context.category.name}标准价格`, currency: "CNY", status: "enabled", version: "1.0", effectiveFrom: timestamp, rates, createdAt: timestamp, updatedAt: timestamp }];
    const discountPlans: RentalDiscountPlan[] = [{ id: `${idPrefix}_discount_long`, tenantId, categoryCode: context.profile.categoryCode, code: "LONG_RENTAL", name: "长期租赁优惠", status: "enabled", discountType: "percentage", discountValue: 5, minimumSpend: 500, customerScope: "all", applicableItemGroupIds: [], applicableDayTypes: [], priority: 100, stackableWithCoupon: true, effectiveFrom: timestamp, version: "1.0", createdAt: timestamp, updatedAt: timestamp }];
    const services: RentalValueAddedService[] = context.category.businessModel.valueAddedServicePresets.slice(0, 4).map((name, index) => ({ id: `${idPrefix}_service_${index + 1}`, tenantId, categoryCode: context.profile.categoryCode, code: `SERVICE_${index + 1}`, name, serviceType: serviceType(name), billingUnit: name.includes("配送") || name.includes("运输") ? "per_order" : "per_day", price: 20 + index * 30, maximumQuantity: 5, coverageLimit: name.includes("保险") || name.includes("免赔") ? 5000 : undefined, deductible: name.includes("免赔") ? 200 : undefined, termsVersion: "1.0", terms: `${name}服务条款：以订单保存的本版本范围、限额及除外责任为准。`, applicableItemGroupIds: [], status: "enabled", version: "1.0", createdAt: timestamp, updatedAt: timestamp }));
    const ruleVersions: RentalRuleVersion[] = [{ id: `${idPrefix}_rule_v1`, tenantId, categoryCode: context.profile.categoryCode, version: "1.0", status: "published", config: defaultRuleConfig(context.category, context.settings), changeReason: "品类初始化规则", createdBy: "system", createdAt: timestamp, publishedAt: timestamp }];
    const defaultVariables = { customerName: { label: "客户名称", required: true }, orderNo: { label: "订单号", required: true } };
    const notificationTemplates: RentalNotificationTemplateV1[] = context.settings.notifications.enabledEvents.slice(0, 12).map((eventCode, index) => {
      const memberEvent = eventCode === "member.registered";
      return { id: `${idPrefix}_template_${index + 1}`, tenantId, eventCode, channel: context.settings.notifications.editableChannels.includes("app_push") ? "app_push" : context.settings.notifications.editableChannels[0] ?? "email", name: `${eventCode} 默认模板`, title: memberEvent ? "欢迎加入" : `订单通知 {{orderNo}}`, body: memberEvent ? `{{customerName}}，欢迎注册成为会员。` : `{{customerName}}，您的订单 {{orderNo}} 状态已更新。`, variableSchema: memberEvent ? { customerName: defaultVariables.customerName } : defaultVariables, status: "enabled", version: "1.0", updatedAt: timestamp };
    });
    return { categoryCode: context.profile.categoryCode, pricingPlans, discountPlans, services, calendars: [], ruleVersions, customerCoupons: [], rewardLedger: [], benefitAccounts: [], referrals: [], notificationTemplates, notificationLogs: [], quotes: [] };
  }

  /**
   * 兑付奖励权益，并**回报它改动过的券与券模板**。
   *
   * 为什么必须回报：本方法只改内存对象，而奖励券与模板配额都是需要落库的事实。
   * 早前它只返回 `referenceIds`，调用方无从得知该写哪些行，于是券只存在于内存中——
   * 重启即凭空消失、模板配额回退，同一批券可以被反复发放（E2E 第 63 节实测库中 0 行）。
   */
  private applyRewardBenefit(state: RentalBusinessState, context: BusinessContext, customerId: string, type: RentalRewardLedgerEntry["rewardType"], amount: number, couponTemplateId?: string) {
    const appliedAt = stamp();
    const grantedCoupons: RentalCustomerCoupon[] = [];
    let touchedTemplate: RentalCouponTemplate | undefined;
    let account = state.benefitAccounts.find((row) => row.customerId === customerId);
    if (!account) {
      account = { tenantId: context.profile.tenantId, customerId, pointsBalance: 0, marketingBalance: 0, availableRewardCouponCount: 0, updatedAt: appliedAt };
      state.benefitAccounts.unshift(account);
    }
    const referenceIds: string[] = [];
    if (type === "points") account.pointsBalance += amount;
    else if (type === "balance") account.marketingBalance = roundMoney(account.marketingBalance + amount);
    else {
      if (!Number.isInteger(amount)) throw new BadRequestException("优惠券奖励数量必须是整数");
      if (!couponTemplateId) throw new BadRequestException("优惠券奖励必须选择优惠券模板");
      const template = context.couponTemplates.find((row) => row.id === couponTemplateId && row.status === "enabled");
      if (!template) throw new BadRequestException("奖励优惠券模板不存在或未启用");
      const existingCount = state.customerCoupons.filter((row) => row.templateId === template.id && row.customerId === customerId && row.status !== "void").length;
      if (existingCount + amount > template.perCustomerLimit) throw new ConflictException("奖励优惠券超过每客限领数量");
      if (template.claimedQuantity + amount > template.totalQuota) throw new ConflictException("奖励优惠券库存不足");
      for (let index = 0; index < amount; index += 1) {
        const coupon: RentalCustomerCoupon = { id: uid("reward_coupon"), tenantId: context.profile.tenantId, customerId, templateId: template.id, templateCode: template.code, templateName: template.name, status: "claimed", claimedAt: appliedAt, effectiveFrom: template.effectiveFrom, effectiveTo: template.effectiveTo };
        state.customerCoupons.unshift(coupon); referenceIds.push(coupon.id);
        grantedCoupons.push(coupon);
      }
      template.claimedQuantity += amount; template.updatedAt = appliedAt;
      touchedTemplate = template;
      account.availableRewardCouponCount += amount;
    }
    account.updatedAt = appliedAt;
    return { appliedAt, referenceIds, grantedCoupons, touchedTemplate };
  }

  private validateRewardBatch(state: RentalBusinessState, context: BusinessContext, planned: Array<{ customerId: string; type: RentalRewardLedgerEntry["rewardType"]; amount: number; couponTemplateId?: string }>) {
    const couponPlans = planned.filter((item) => item.type === "coupon");
    const byTemplate = new Map<string, number>();
    const byCustomerTemplate = new Map<string, number>();
    for (const plan of couponPlans) {
      if (!Number.isInteger(plan.amount)) throw new BadRequestException("优惠券奖励数量必须是整数");
      if (!plan.couponTemplateId) throw new BadRequestException("优惠券奖励必须选择优惠券模板");
      const template = context.couponTemplates.find((row) => row.id === plan.couponTemplateId && row.status === "enabled");
      if (!template) throw new BadRequestException("奖励优惠券模板不存在或未启用");
      byTemplate.set(template.id, (byTemplate.get(template.id) ?? 0) + plan.amount);
      const customerKey = `${plan.customerId}:${template.id}`;
      byCustomerTemplate.set(customerKey, (byCustomerTemplate.get(customerKey) ?? 0) + plan.amount);
      const existingCount = state.customerCoupons.filter((row) => row.templateId === template.id && row.customerId === plan.customerId && row.status !== "void").length;
      if (existingCount + (byCustomerTemplate.get(customerKey) ?? 0) > template.perCustomerLimit) throw new ConflictException("奖励优惠券超过每客限领数量");
    }
    for (const [templateId, amount] of byTemplate) {
      const template = context.couponTemplates.find((row) => row.id === templateId)!;
      if (template.claimedQuantity + amount > template.totalQuota) throw new ConflictException("奖励优惠券库存不足");
    }
  }

  private reverseRewardBenefit(state: RentalBusinessState, context: BusinessContext, row: RentalRewardLedgerEntry) {
    const account = state.benefitAccounts.find((item) => item.customerId === row.customerId);
    if (!account) throw new ConflictException("客户权益账户不存在，不能撤销奖励");
    if (row.rewardType === "points") {
      if (account.pointsBalance < row.amount) throw new ConflictException("积分余额不足，不能撤销奖励");
      account.pointsBalance -= row.amount;
    } else if (row.rewardType === "balance") {
      if (account.marketingBalance < row.amount) throw new ConflictException("营销余额不足，不能撤销奖励");
      account.marketingBalance = roundMoney(account.marketingBalance - row.amount);
    } else {
      const references = row.benefitReferenceIds ?? [];
      const coupons = references.map((id) => state.customerCoupons.find((coupon) => coupon.id === id));
      if (!references.length || coupons.some((coupon) => !coupon || coupon.status !== "claimed")) throw new ConflictException("奖励券已锁定、核销或不存在，不能撤销");
      coupons.forEach((coupon) => { coupon!.status = "void"; });
      const couponTemplate = context.couponTemplates.find((template) => template.id === coupons[0]!.templateId);
      if (couponTemplate) { couponTemplate.claimedQuantity = Math.max(0, couponTemplate.claimedQuantity - references.length); couponTemplate.updatedAt = stamp(); }
      account.availableRewardCouponCount = Math.max(0, account.availableRewardCouponCount - references.length);
    }
    account.updatedAt = stamp();
  }

  private buildCalendar(tenantId: string, settings: TenantRentalBusinessSettings, year: number): RentalCalendarYear {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("日历年度无效");
    const days: RentalCalendarDay[] = [];
    for (let cursor = new Date(Date.UTC(year, 0, 1)); cursor.getUTCFullYear() === year; cursor = new Date(cursor.getTime() + dayMs)) {
      const date = cursor.toISOString().slice(0, 10);
      const weekend = settings.calendar.weekendDays.includes(cursor.getUTCDay());
      days.push({ date, dayType: weekend ? "weekend" : "workday", name: weekend ? "周末" : "工作日", pricingMultiplier: weekend ? 1.1 : 1, closed: false, source: "week_rule" });
    }
    return { tenantId, year, region: settings.calendar.officialCalendarRegion, version: "1.0", status: "draft", days };
  }

  private validateRule(context: BusinessContext, config: RentalRuleConfig) {
    if (config.payment.preauthorizationRequired && !context.category.businessModel.supportsPreauthorization) throw new BadRequestException("当前品类不支持预授权");
    if (config.qualification.required && !context.category.businessModel.supportsQualificationReview) throw new BadRequestException("当前品类不支持资质审核");
    if (config.fulfillment.allowDifferentReturnLocation && !context.settings.fulfillment.allowDifferentReturnLocation) throw new BadRequestException("租户履约设置未启用异地归还");
    if (config.payment.unpaidHoldMinutes < 1 || config.overdue.graceMinutes < 0 || config.overdue.feeMultiplier < 0 || config.cancellation.freeBeforeHours < 0) throw new BadRequestException("规则中的时长或费用参数无效");
  }

  private customerCoupon(state: RentalBusinessState, id: string) {
    const coupon = state.customerCoupons.find((item) => item.id === id);
    if (!coupon) throw new NotFoundException("客户优惠券不存在");
    return coupon;
  }

  private inPeriod(from: string, to: string | undefined, target: string) {
    const time = new Date(target).getTime();
    return time >= new Date(from).getTime() && (!to || time <= new Date(to).getTime());
  }

  private discountAmount(base: number, type: "percentage" | "fixed_amount", value: number, maximum?: number) {
    const amount = type === "percentage" ? base * value / 100 : value;
    return roundMoney(Math.max(0, Math.min(base, maximum === undefined ? amount : Math.min(amount, maximum))));
  }

  calculateCancellationCharge(tenantId: string, context: BusinessContext, quote: RentalQuoteSnapshotV1, nowAt = stamp(), weatherException = false) {
    const rule = quote.ruleSnapshot ?? this.currentRule(tenantId, context)?.config;
    if (!rule) throw new ConflictException("订单缺少租赁规则快照");
    if (weatherException && rule.cancellation.weatherExceptionEnabled) return 0;
    const hoursBeforeStart = (new Date(quote.request.startAt).getTime() - new Date(nowAt).getTime()) / 3_600_000;
    if (hoursBeforeStart >= rule.cancellation.freeBeforeHours || rule.cancellation.lateFeeType === "none") return 0;
    return this.discountAmount(quote.payableAmount, rule.cancellation.lateFeeType === "percentage" ? "percentage" : "fixed_amount", rule.cancellation.lateFeeValue);
  }

  calculateOverdueCharge(tenantId: string, context: BusinessContext, quote: RentalQuoteSnapshotV1, returnedAt: string) {
    const rule = quote.ruleSnapshot ?? this.currentRule(tenantId, context)?.config;
    if (!rule) throw new ConflictException("订单缺少租赁规则快照");
    const overdueMinutes = Math.max(0, (new Date(returnedAt).getTime() - new Date(quote.request.endAt).getTime()) / 60_000 - rule.overdue.graceMinutes);
    if (overdueMinutes <= 0 || rule.overdue.feeMode === "none" || rule.overdue.feeMode === "manual_review") return 0;
    const hourlyBase = quote.rentalAmount / Math.max(1, (new Date(quote.request.endAt).getTime() - new Date(quote.request.startAt).getTime()) / 3_600_000);
    const amount = rule.overdue.feeMode === "hourly"
      ? hourlyBase * Math.ceil(overdueMinutes / 60) * rule.overdue.feeMultiplier
      : quote.rentalAmount * rule.overdue.feeMultiplier;
    return roundMoney(Math.min(amount, rule.overdue.maximumFee ?? amount));
  }

  calculateDamageCharge(tenantId: string, context: BusinessContext, quote: RentalQuoteSnapshotV1, exceptions: Array<{ chargeAmount?: number }>) {
    const rule = quote.ruleSnapshot ?? this.currentRule(tenantId, context)?.config;
    if (!rule) throw new ConflictException("订单缺少租赁规则快照");
    let amount = exceptions.reduce((sum, item) => sum + Math.max(0, Number(item.chargeAmount) || 0), 0);
    const state = this.state(tenantId, context);
    const selectedIds = new Set((quote.request.services ?? []).map((item) => item.serviceId));
    const waiver = state.services.find((service) => selectedIds.has(service.id) && service.serviceType === "damage_waiver" && service.status === "enabled");
    if (waiver && amount > 0) {
      const coverage = waiver.coverageLimit ?? 0;
      const deductible = waiver.deductible ?? 0;
      amount = Math.min(amount, deductible) + Math.max(0, amount - coverage);
    }
    return roundMoney(Math.min(amount, rule.damage.chargeLimit ?? amount));
  }

  private billableUnits(unit: RentalPricingUnit, startAt: string, endAt: string, usageQuantity?: number) {
    const hours = Math.max(0, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000);
    if (unit === "usage") {
      if (!Number.isFinite(usageQuantity) || Number(usageQuantity) < 0) throw new BadRequestException("按使用量计价时必须提供有效使用量");
      return Math.ceil(Number(usageQuantity));
    }
    if (unit === "hour") return Math.ceil(hours);
    if (unit === "shift") return Math.ceil(hours / 8);
    if (unit === "week") return Math.ceil(hours / 168);
    if (unit === "month") return Math.ceil(hours / 720);
    if (unit === "package") return 1;
    return Math.ceil(hours / 24);
  }

  private calendarsForDateRange(tenantId: string, context: BusinessContext, startAt: string, endAt: string) {
    const startYear = new Date(startAt).getUTCFullYear();
    const endYear = new Date(endAt).getUTCFullYear();
    const years = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
    return years.map((year) => this.state(tenantId, context).calendars.find((item) => item.year === year && item.status === "published") ?? this.getCalendar(tenantId, context, year));
  }

  private calendarMultiplier(calendars: RentalCalendarYear[], settings: TenantRentalBusinessSettings, startAt: string, endAt: string, rate: RentalPricingRate) {
    if (!settings.pricing.holidayPricingEnabled || !calendars.length) return 1;
    const values: number[] = [];
    for (let cursor = new Date(`${startAt.slice(0, 10)}T00:00:00.000Z`); cursor.getTime() < new Date(endAt).getTime(); cursor = new Date(cursor.getTime() + dayMs)) {
      const calendar = calendars.find((item) => item.year === cursor.getUTCFullYear());
      const day = calendar?.days.find((item) => item.date === cursor.toISOString().slice(0, 10));
      const type: RentalDayType = day?.dayType ?? "workday";
      if (day?.closed) throw new ConflictException(`${day.date} 为停业日，不能报价`);
      values.push(type === "statutory_holiday" || type === "tenant_special" ? rate.holidayMultiplier : type === "weekend" ? rate.weekendMultiplier : day?.pricingMultiplier ?? 1);
    }
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1;
  }

  private dayTypesForRange(calendars: RentalCalendarYear[], startAt: string, endAt: string) {
    const values: RentalDayType[] = [];
    for (let cursor = new Date(`${startAt.slice(0, 10)}T00:00:00.000Z`); cursor.getTime() < new Date(endAt).getTime(); cursor = new Date(cursor.getTime() + dayMs)) {
      const calendar = calendars.find((item) => item.year === cursor.getUTCFullYear());
      values.push(calendar?.days.find((item) => item.date === cursor.toISOString().slice(0, 10))?.dayType ?? "workday");
    }
    return values;
  }
}

export type { BusinessContext };
