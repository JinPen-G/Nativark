import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnApplicationBootstrap, OnModuleInit, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { CapabilityBlockedException, CapabilityHookRuntime } from "./capability-hook.runtime";
import { CapabilityHookRepository } from "./capability-hook.repository";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import { buildCapabilityEquipment } from "./capability-equipment";
import {
  RentalCategoryCode,
  type GrantRentalRewardRequest,
  type ImportRentalCalendarRequest,
  type RentalCalendarBusinessStatus,
  type RentalBusinessHours,
  type RentalCalendarDay,
  type RentalCalendarDayOrigin,
  type RentalCalendarDaySnapshot,
  type RentalCalendarOverrideAudit,
  type RentalCalendarPublishDiff,
  type RentalCalendarPublishPreview,
  type RestoreRentalCalendarVersionRequest,
  type RentalCalendarPublishPreviewDate,
  type RentalCalendarPublishPreviewOrder,
  type RentalCalendarVersionSummary,
  type RentalDepositRule,
  type RentalPreauthorizationRule,
  type RentalCalendarYear,
  type RentalCategoryDefinition,
  type RentalCouponTemplate,
  type RentalCustomerBenefitAccount,
  type RentalCustomerCoupon,
  type RentalDayType,
  type RentalDiscountPlan,
  type RentalFulfillmentLocation,
  type RentalFulfillmentOperator,
  type RentalItemGroup,
  type RentalNotificationSendLogV1,
  type RentalNotificationTemplateV1,
  type RentalPricingPlanV1,
  type RentalPricingRate,
  type RentalQuoteCalendarDay,
  type RentalQuoteRequest,
  type RentalQuoteSnapshotV1,
  type RentalCapabilityDecisionSnapshot,
  type RentalRewardLedgerEntry,
  type RentalRuleConfig,
  type RentalTimeWindow,
  type RentalRuleVersion,
  type RentalValueAddedService,
  type SaveRentalCalendarDayRequest,
  type RemoveRentalCalendarDayOverrideRequest,
  type PreviewRentalCalendarRangeOverrideRequest,
  type ApplyRentalCalendarRangeOverrideRequest,
  type ApplyRentalCalendarRangeOverrideResult,
  type RentalCalendarRangeOverridePreview,
  type RentalCalendarRangePreviewRow,
  type PreviewRentalCalendarRangeRemoveRequest,
  type ApplyRentalCalendarRangeRemoveRequest,
  type ApplyRentalCalendarRangeRemoveResult,
  type RentalCalendarRangeRemovePreview,
  type RentalCalendarRangeRemovePreviewRow,
  type RentalCalendarRangeFields,
  type RentalCalendarOverrideScope,
  type RentalCalendarTimePriceDay,
  type PublishRentalCalendarRequest,
  type VoidRentalCalendarRequest,
  type SaveRentalDiscountPlanRequest,
  type SaveRentalNotificationTemplateRequest,
  type SaveRentalPricingPlanRequest,
  type SaveRentalRuleVersionRequest,
  type SaveRentalValueAddedServiceRequest,
  type CreateRentalPriceAdjustmentRequest,
  type RentalPriceAdjustmentChange,
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
import { PrismaService } from "../database/prisma.service";
import { DEFAULT_BUSINESS_TIME_ZONE, businessDateKey, businessTimeOfDay, businessDateKeyFromIndex, businessDayIndex, businessInstantAt, businessYearFromDateKey, isCalendarDateKey, businessHoursError } from "./rental-business-day";
import {
  applyRangeFieldsToDay,
  assertRangeDateTimeScope,
  changedFieldNames,
  deriveRestoredDay,
  expandCalendarRange,
  originSnapshotOf
} from "./calendar-range";
import { applyPriceAdjustment, assertNoDatetimeOverrideOverlap, assertNoPeriodicOverlap, periodicWindowCoversDate, periodicWindowHits } from "./rental-price-adjustments";
import { rentalPricingStrategy } from "./rental-pricing-strategy";

/**
 * 定时调价到期执行时，确认时锁定的基础版本已被别的调价推进。
 *
 * 单独一个错误类型而不是直接抛 ConflictException：这次失败要在**事务之外**
 * 把调价计划置为 failed 并记原因，因此 catch 里必须能把它和「并发撞序号」区分开。
 */
class StalePriceBaseError extends Error {}

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
  locations: RentalFulfillmentLocation[];
  operators: RentalFulfillmentOperator[];
}

/**
 * 营业状态的读取口径：优先用四态字段，缺省时由遗留的 `closed` 推导。
 *
 * 存量日历的 `days` JSON 里没有 `businessStatus`，直接读会得到 undefined，
 * 若把 undefined 当成"正常营业"，历史上标为停业的日期会突然变成可履约。
 */
function businessStatusOf(day: RentalCalendarDay): RentalCalendarBusinessStatus {
  return day.businessStatus ?? (day.closed ? "closed" : "open");
}

const stamp = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const dayMs = 24 * 60 * 60 * 1000;

/**
 * 配送类履约方式。这些方式的时点要按营业时段里的 `delivery` 判定（需求 4.5.1 把
 * 配送可用时段与领取/归还并列声明）；早前 `hours.delivery` 声明了却没有任何路径消费它。
 */
const DELIVERY_FULFILLMENT_MODES = new Set<string>(["delivery", "onsite_delivery"]);

/**
 * 应付押金规则：优先用显式的 `config.deposit`，缺省时由旧的 `payment.depositMode` 派生。
 *
 * 为什么需要派生：既有已发布规则快照里只有 `payment.depositMode`，而需求 4.4.7 要求押金与
 * 预授权独立配置。历史订单必须继续按原快照复算，不能因为新增字段就换一套押金口径。
 * 旧口径下 `depositMode === "preauthorization"` 表示「只冻结不收押金」，故押金为 none。
 */
function effectiveDepositRule(config: RentalRuleConfig): RentalDepositRule {
  if (config.deposit) return config.deposit;
  const mode = config.payment.depositMode;
  if (mode === "preauthorization" || mode === "none") return { mode: "none" };
  return { mode };
}

/**
 * 预授权规则：优先用显式的 `config.preauthorization`，缺省时由旧口径派生。
 *
 * 旧口径只有 `depositMode === "preauthorization"` 才真的产出过预授权金额；
 * `preauthorizationRequired` 在旧实现里只是个「金额必须非零」的校验位，从未单独计过额度。
 * 因此派生时**不**据它产生预授权，否则会给存量租户凭空加一笔冻结额度——那是改写历史金额。
 * 名实不符的明细命名问题在收费行侧单独修正。
 */
function effectivePreauthorizationRule(config: RentalRuleConfig): RentalPreauthorizationRule {
  if (config.preauthorization) return config.preauthorization;
  return config.payment.depositMode === "preauthorization" ? { mode: "fixed" } : { mode: "none" };
}

function versionAfter(current?: string) {
  if (!current) return "1.0";
  const [major, minor] = current.split(".").map(Number);
  return `${Number.isFinite(major) ? major : 1}.${(Number.isFinite(minor) ? minor : 0) + 1}`;
}

/**
 * 版本号大小比较。必须按段取数值，不能用 `localeCompare`：
 * 字典序下 `"1.10" < "1.9"`，于是第十次修订会被当成比第九次旧的版本，
 * 「取最新草稿」和「取最新已发布」两处都会挑错行。
 */
function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 两个年度日历之间的日期差异（需求 4.5.7 的版本可追溯）。
 *
 * 比较取值而不是整行：`overrideBy` / `overrideAt` 每次保存都会变，
 * 按整行比对会把「只是重新保存了一遍」也算成变更，差异列表就失去筛选价值。
 */
/**
 * 营业时段的规范化签名。
 *
 * 不能直接 `JSON.stringify(hours)`：键顺序与数组顺序都会进签名，于是语义完全相同的时段
 * 会被判成变更。两条真实触发路径——①MySQL 的 JSON 列会按自己的规则重排对象键，
 * 已发布版本重启后读回的键序与进程内新写入的 payload 原序不同；②运营把两个营业时段
 * 前后顺序调换（校验用排序、判定用 some，两者对顺序都不敏感）。
 * 结果是发布差异里多出一堆点开看不出区别的日期。
 */
function businessHoursSignature(hours?: RentalBusinessHours): string {
  if (!hours) return "-";
  const windows = (list?: RentalTimeWindow[]) =>
    (list ?? [])
      .map((window) => `${window.start}-${window.end}`)
      .sort()
      .join(",");
  return [windows(hours.windows), windows(hours.pickup), windows(hours.return), windows(hours.delivery)].join(";");
}

function calendarDiff(before: RentalCalendarDay[], after: RentalCalendarDay[]): RentalCalendarPublishDiff {
  const key = (day: RentalCalendarDay) =>
    [
      day.dayType,
      day.name,
      day.pricingMultiplier,
      day.closed,
      day.businessStatus ?? "",
      day.source,
      // 营业时段也纳入差异签名（需求 4.5.5/4.5.8）：只调整营业/领取/归还/配送时段时，
      // 若不比时段，发布差异会显示「没有变化」，运营看不出这次改了时段。
      businessHoursSignature(day.hours)
    ].join("|");
  const beforeMap = new Map(before.map((day) => [day.date, key(day)]));
  const afterMap = new Map(after.map((day) => [day.date, key(day)]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const [date, signature] of afterMap) {
    const previous = beforeMap.get(date);
    if (previous === undefined) added.push(date);
    else if (previous !== signature) changed.push(date);
  }
  const removed = [...beforeMap.keys()].filter((date) => !afterMap.has(date));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

function defaultRuleConfig(category: RentalCategoryDefinition, settings: TenantRentalBusinessSettings): RentalRuleConfig {
  const defaults = category.businessModel.defaults.rules;
  return {
    payment: {
      ...settings.payment,
      unpaidHoldMinutes: 15
    },
    fulfillment: {
      pickupInspectionRequired: true,
      returnInspectionRequired: true,
      evidenceRequired: defaults.evidenceRequired,
      allowDifferentReturnLocation: settings.fulfillment.allowDifferentReturnLocation
    },
    overdue: { ...settings.overdue },
    cancellation: { ...defaults.cancellation },
    qualification: {
      required: category.businessModel.supportsQualificationReview,
      documentTypes: [...defaults.qualificationDocumentTypes],
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
  /** 启动预热时按经营空间收集品类，用于业务快照行丢失后重建状态。 */
  private readonly bootstrapCategoryByWorkspace = new Map<string, RentalCategoryCode>();
  /** 运行期提交后刷新串行化，防止较旧数据库快照晚到并覆盖较新缓存。 */
  private refreshQueue: Promise<void> = Promise.resolve();

  constructor(
    @Inject(RentalBusinessConfigRepository) private readonly configStore: RentalBusinessConfigStore,
    @Inject(RentalBusinessFactRepository) private readonly factStore: RentalBusinessFactStore,
    @Inject(RentalCoreConfigRepository) private readonly coreConfigStore: RentalConfigStore,
    @Optional() private readonly stateRepository?: RentalStateRepository,
    @Optional() private readonly prisma?: PrismaService,
    // CORE-EXT-02B：报价校验节点的 Hook 运行时。可选同 RentalCoreService 的理由。
    @Optional() private readonly hooks?: CapabilityHookRuntime,
    // CORE-EXT-02D：报价生成时固化已启用能力的版本快照。可选同上。
    @Optional() private readonly capabilities?: WorkspaceCapabilityService,
    // Review P1-5：被阻止的报价要写只追加的拒绝审计。可选同上。
    @Optional() private readonly hookAudits?: CapabilityHookRepository
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

    this.bootstrapCategoryByWorkspace.clear();
    // 空间经营品类的事实源是核心档案，不能从“是否仍有定价/规则行”反推。
    // 这样即使业务快照及部分业务配置同时损坏，规范化事实仍能装载到正确品类状态。
    for (const snapshot of coreConfigs) {
      if (snapshot.profile?.categoryCode) {
        this.bootstrapCategoryByWorkspace.set(snapshot.workspaceId, snapshot.workspaceCategoryCode ?? snapshot.profile.categoryCode);
      }
    }
    for (const snapshot of configs) {
      if (snapshot.categoryCode) this.bootstrapCategoryByWorkspace.set(snapshot.workspaceId, snapshot.categoryCode);
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
      const state = this.states.get(workspaceId) ?? this.stateFromFacts(workspaceId);
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
  private stateFromFacts(workspaceId: string): RentalBusinessState | undefined {
    const categoryCode = this.bootstrapCategoryByWorkspace.get(workspaceId);
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

  private async flushBenefitAccounts(state: RentalBusinessState, customerIds: string[], tx?: RentalBusinessFactTx) {
    for (const customerId of new Set(customerIds)) {
      const account = state.benefitAccounts.find((row) => row.customerId === customerId);
      if (account) await this.factStore.upsertBenefitAccount(account, tx);
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

  async savePricingPlan(tenantId: string, context: BusinessContext, input: SaveRentalPricingPlanRequest, operator?: string) {
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
      // PRICE-03：分时/一次性覆盖的重叠在**保存**时拒绝（需求 4.4.3：重叠在确认时阻止，
      // 不留到报价时才"随机择一"）。
      assertNoPeriodicOverlap(row.periodicWindows, `${group.name} · ${row.unit}`);
      assertNoDatetimeOverrideOverlap(row.datetimeOverrides, `${group.name} · ${row.unit}`);
      for (const value of [row.baseAmount, row.weekendMultiplier, row.holidayMultiplier, row.depositAmount, row.minimumUnits]) {
        if (!Number.isFinite(value) || value < 0) throw new BadRequestException("价格、倍率、押金和最低计费单位必须是非负数");
      }
      // 阶梯档位重复会让"取最高已达档"变成看装载顺序，同一份配置解释不出唯一价格。
      const tierKeys = new Set<number>();
      for (const tier of row.tiers ?? []) {
        if (!Number.isFinite(tier.minUnits) || !Number.isFinite(tier.unitAmount) || tier.minUnits < 1 || tier.unitAmount < 0) {
          throw new BadRequestException(`${group.name} 的阶梯价档位必须是起始单位数 ≥ 1、单价非负`);
        }
        if (tierKeys.has(tier.minUnits)) throw new BadRequestException(`${group.name} 的阶梯价存在重复的起始单位数 ${tier.minUnits}`);
        tierKeys.add(tier.minUnits);
      }
      // 用 undefined 判空而不是真值判断：封顶 0 是合法配置（免租）。
      if (row.maxAmount !== undefined && (!Number.isFinite(row.maxAmount) || row.maxAmount < 0)) {
        throw new BadRequestException(`${group.name} 的封顶价必须是非负数`);
      }
      return { ...row, id: uid("rate"), itemGroupCode: group.code, itemGroupName: group.name };
    });
    const existing = input.id ? state.pricingPlans.find((plan) => plan.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException("定价计划不存在");
    if (state.pricingPlans.some((plan) => plan.code === input.code.trim() && plan.id !== input.id)) throw new ConflictException("定价计划编码已存在");
    const timestamp = stamp();
    // 需求 4.4.3/4.4.4：同一经营空间、同一商品、同一计价单位在任一时点只能有唯一生效价格。
    // 早前只在报价阶段从多个候选里"择一"，等于把冲突留到用钱的那一刻才随机决定。
    // 冲突必须在**保存/启用**时就拒绝——只检查 enabled 计划：草稿与停用不参与报价。
    this.assertNoOverlappingPricingPlan(state, input, rates, existing?.id);
    const result: RentalPricingPlanV1 = {
      id: existing?.id ?? uid("pricing"), tenantId, categoryCode: context.profile.categoryCode,
      code: input.code.trim(), name: input.name.trim(), currency: "CNY", status: input.status ?? "draft",
      version: versionAfter(existing?.version), effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
      rates,
      // 同一履约方式配两档会让"取第一条"变成看装载顺序，价格解释不唯一。
      fulfillmentFees: input.fulfillmentFees ? this.validatedFulfillmentFees(input.fulfillmentFees) : undefined,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    const prisma = this.prisma;
    const mysql = prisma && (process.env.PLATFORM_DATA_SOURCE ?? "mysql").toLowerCase() === "mysql";

    // 草稿/停用是编辑工作区状态：它们不能污染报价唯一事实源。只有明确启用时，
    // 才把「该生效时刻的空间完整价格」追加进不可变时间轴。
    if (!mysql || result.status !== "enabled") {
      await this.configStore.upsertPricingPlan(result);
      if (existing) Object.assign(existing, result); else state.pricingPlans.unshift(result);
      return result;
    }

    const workspaceId = this.workspaceOf(tenantId);
    const effectiveFrom = new Date(result.effectiveFrom);
    const wasEnabled = existing?.status === "enabled";
    const samePrice = existing
      ? RentalBusinessService.sameRates(existing.rates, rates) &&
        JSON.stringify(existing.fulfillmentFees ?? null) === JSON.stringify(result.fulfillmentFees ?? null) &&
        existing.effectiveFrom === result.effectiveFrom && existing.effectiveTo === result.effectiveTo
      : false;
    // 已发布计划的价格、有效期和履约费是价格事实，普通编辑不能覆盖它们；
    // 运营必须创建调价计划，让确认/版本/审计形成同一个闭环。名称等非价格元数据仍可改。
    if (wasEnabled && !samePrice) {
      throw new ConflictException("已启用价格不得通过普通编辑直接覆盖，请创建调价计划并在确认时生效");
    }

    // 只改已启用计划的名称等元数据，不产生空版本；其余情况是草稿/停用转启用，
    // 需要以目标生效时刻的旧版本为基线，而不是以保存时刻的现值为基线。
    if (wasEnabled && samePrice) {
      await this.configStore.upsertPricingPlan(result);
      Object.assign(existing, result);
      return result;
    }

    await prisma.$transaction(async (tx) => {
      const baseAtStart = await this.findSpaceVersionAt(tenantId, workspaceId, effectiveFrom, tx);
      const baseRates = (baseAtStart?.rates ?? []) as unknown as RentalPricingRate[];
      const withPlan = RentalBusinessService.mergeSpaceRates(baseRates, existing?.status === "enabled" ? existing.rates : [], rates);
      await this.appendSpaceVersion(tx, {
        tenantId,
        workspaceId,
        effectiveFrom,
        rates: withPlan,
        changeReason: input.changeReason.trim(),
        createdBy: operator
      });

      // effectiveTo 是真正的下线边界：从该时刻开始移除本计划费率，不能让过期价
      // 藏在上一条完整快照里继续被报价使用。其它空间价格原样保留。
      if (result.effectiveTo) {
        const effectiveTo = new Date(result.effectiveTo);
        const afterExpiry = RentalBusinessService.mergeSpaceRates(withPlan, rates, []);
        await this.appendSpaceVersion(tx, {
          tenantId,
          workspaceId,
          effectiveFrom: effectiveTo,
          rates: afterExpiry,
          changeReason: `${input.changeReason.trim()}（价格计划到期）`,
          createdBy: operator
        });
      }
      // 计划当前值与版本写入同一事务。失败时两者一起回滚，不能留下编辑行与
      // 生效事实分叉的半成品。
      await this.configStore.upsertPricingPlan(result, tx);
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("价格版本并发写入冲突，请刷新后重试");
      }
      throw error;
    });

    if (existing) Object.assign(existing, result); else state.pricingPlans.unshift(result);
    return result;
  }

  /**
   * PRICE-03：空间级价格版本的只读定位——取「生效时刻 ≤ at」里最新的一条。
   *
   * 版本时间轴是**报价取价的唯一事实**：一条版本 = 某个生效时点该空间全部有效
   * 「商品 × 计价单位」的完整结果。排序同时看 effectiveFrom 与 sequence：
   * 回填出的历史版本序号与时间同向，但应用后续追加的版本可能与回填行同刻，
   * 只按序号或只按时间都会取错。
   */
  private async findSpaceVersionAt(
    tenantId: string,
    workspaceId: string,
    at: Date,
    client?: Prisma.TransactionClient
  ) {
    const prisma = client ?? this.prisma;
    if (!prisma) return null;
    return prisma.rentalPriceVersion.findFirst({
      where: { tenantId, workspaceId, effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: "desc" }, { sequence: "desc" }]
    });
  }

  /**
   * 价格时间轴只允许**向后追加**：目标生效时刻不得早于已有的任何版本。
   *
   * 版本是不可变的完整快照，往中间插一条并不会让它后面的版本跟着变——插进去的价格
   * 会在下一个边界处凭空消失。与其产出这种「生效 3 天后又自己变回去」的时间轴，
   * 不如直接拒绝并让人改用定时调价（它生成的是时间轴末端的新版本）。
   * 唯一例外是迁移回填：那是在没有任何版本时一次性重建历史。
   */
  private async assertAppendOnlyTimeline(
    client: Prisma.TransactionClient,
    tenantId: string,
    workspaceId: string,
    at: Date
  ) {
    const future = await client.rentalPriceVersion.findFirst({
      where: { tenantId, workspaceId, effectiveFrom: { gt: at } },
      orderBy: [{ effectiveFrom: "asc" }],
      select: { sequence: true, effectiveFrom: true }
    });
    if (future) {
      throw new ConflictException(
        `目标生效时间 ${at.toISOString()} 早于已存在的价格版本 v${future.sequence}` +
          `（生效于 ${future.effectiveFrom.toISOString()}），不能插入到价格时间轴中间；` +
          `请改用调价计划把新价安排在时间轴末端`
      );
    }
  }

  /** 追加一条完整版本。序号取事务内 MAX+1，(workspaceId, sequence) 唯一键兜并发。 */
  private async appendSpaceVersion(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      workspaceId: string;
      effectiveFrom: Date;
      rates: RentalPricingRate[];
      changeReason: string;
      createdBy?: string;
    }
  ) {
    await this.assertAppendOnlyTimeline(tx, input.tenantId, input.workspaceId, input.effectiveFrom);
    const agg = await tx.rentalPriceVersion.aggregate({
      _max: { sequence: true },
      where: { tenantId: input.tenantId, workspaceId: input.workspaceId }
    });
    return tx.rentalPriceVersion.create({
      data: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        sequence: (agg._max.sequence ?? 0) + 1,
        effectiveFrom: input.effectiveFrom,
        rates: input.rates as unknown as Prisma.InputJsonValue,
        changeReason: input.changeReason,
        createdBy: input.createdBy ?? undefined
      }
    });
  }

  /** 以「商品 × 计价单位」为键合成完整集合：先移除该计划的旧键，再写入新键。 */
  private static mergeSpaceRates(
    base: RentalPricingRate[],
    remove: RentalPricingRate[],
    add: RentalPricingRate[]
  ): RentalPricingRate[] {
    const key = (rate: { itemGroupId: string; unit: string }) => `${rate.itemGroupId}:${rate.unit}`;
    const merged = new Map(base.map((row) => [key(row), row]));
    for (const row of remove) merged.delete(key(row));
    for (const row of add) merged.set(key(row), row);
    return [...merged.values()];
  }

  /** 费率是否等价。忽略 id：每次保存都会重新生成 id，比 id 会把「没改价」误判成改价。 */
  private static sameRates(left: RentalPricingRate[], right: RentalPricingRate[]) {
    const normalize = (rates: RentalPricingRate[]) =>
      JSON.stringify(
        rates
          .map(({ id: _id, ...rest }) => rest)
          .sort((a, b) => `${a.itemGroupId}:${a.unit}`.localeCompare(`${b.itemGroupId}:${b.unit}`))
      );
    return normalize(left) === normalize(right);
  }

  /**
   * 内存数据源下的空间级费率全集：与数据库里的价格版本**同一构造规则**。
   *
   * 数据库模式的一条版本 = 该时刻空间内全部启用计划的「商品 × 计价单位」全集，
   * 同键取 `effectiveFrom` 最晚者、同刻按 `code` 稳定排序（见迁移与 mergeSpaceRates）。
   * 内存模式早前取「第一个 enabled 计划」的费率，于是同一份输入两种模式可能算出
   * 不同的钱；更糟的是报价里 `pricingPlanVersion` 记的是 `resolvePricingPlan` 择定的
   * 计划，费率却来自数组里排在前面的另一个计划，快照与实际算价来源对不上。
   */
  private memorySpaceRates(tenantId: string, context: BusinessContext, rentalStartAt: string): RentalPricingRate[] {
    const at = new Date(rentalStartAt).getTime();
    const effective = this.state(tenantId, context).pricingPlans.filter(
      (plan) =>
        plan.status === "enabled" &&
        new Date(plan.effectiveFrom).getTime() <= at &&
        (plan.effectiveTo === undefined || new Date(plan.effectiveTo).getTime() > at)
    );
    // 生效早的先写、晚的后写；同刻时按 code **降序**写入，让字典序较小的计划最后
    // 覆盖同键。这与迁移回填的 `ORDER BY effectiveFrom DESC, planCode ASC` 取首条一致。
    // 早前这里同刻按 code 升序写入，实际让字典序较大的计划胜出，仍会造成内存/数据库分叉。
    const ordered = [...effective].sort((left, right) => {
      const byEffective = new Date(left.effectiveFrom).getTime() - new Date(right.effectiveFrom).getTime();
      return byEffective !== 0 ? byEffective : right.code.localeCompare(left.code);
    });
    const merged = new Map<string, RentalPricingRate>();
    for (const plan of ordered) {
      for (const rate of plan.rates) merged.set(`${rate.itemGroupId}:${rate.unit}`, rate);
    }
    return [...merged.values()];
  }

  /**
   * PRICE-03：报价取价——命中租期开始时刻的价格版本。
   *
   * 没有覆盖该时刻的版本时**明确拒绝**，不回落计划行现值：计划行是编辑工作区，
   * 用它计费等于「没有发布过的价格也能收钱」，且事后无从复算按哪一版收的。
   * 内存数据源（非 MySQL）没有版本表，属另一条链路，见下方分支。
   */
  private async resolveSpaceRates(
    tenantId: string,
    context: BusinessContext,
    rentalStartAt: string,
    client?: Prisma.TransactionClient
  ): Promise<{ versionId: string; version: string; effectiveFrom: string; rates: RentalPricingRate[] } | { rates: RentalPricingRate[] }> {
    const prisma = this.prisma;
    if (!prisma || (process.env.PLATFORM_DATA_SOURCE ?? "mysql").toLowerCase() !== "mysql") {
      // 内存数据源根本没有版本表，不存在「版本没覆盖到」这件事，因此按与版本相同的
      // 规则从启用计划现值合成空间全集。这不是 MySQL 路径上的回落——那条路径下无版本一律拒绝。
      return { rates: this.memorySpaceRates(tenantId, context, rentalStartAt) };
    }
    const workspaceId = this.workspaceOf(tenantId);
    const row = await this.findSpaceVersionAt(tenantId, workspaceId, new Date(rentalStartAt), client);
    if (!row) {
      throw new ConflictException(
        `该租期开始时（${new Date(rentalStartAt).toISOString()}）无有效价格版本，` +
          `请先发布覆盖该时间的价格版本后再报价`
      );
    }
    return {
      versionId: row.id,
      version: "v" + row.sequence,
      effectiveFrom: row.effectiveFrom.toISOString(),
      rates: row.rates as unknown as RentalPricingRate[]
    };
  }

  /** PRICE-03：空间级价格版本列表。planId 不参与查询。 */
  async listSpacePriceVersions(tenantId: string, context: BusinessContext, page = 1, pageSize = 20) {
    const prisma = this.prisma;
    if (!prisma) return { total: 0, rows: [] };
    const workspaceId = this.workspaceOf(tenantId);
    const take = Math.min(100, Math.max(1, pageSize));
    const where = { tenantId, workspaceId };
    const [total, rows] = await Promise.all([
      prisma.rentalPriceVersion.count({ where }),
      prisma.rentalPriceVersion.findMany({ where, orderBy: { sequence: "desc" }, skip: (Math.max(1, page) - 1) * take, take })
    ]);
    return { total, rows: rows.map((row) => ({ id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, sequence: row.sequence, version: `v${row.sequence}`, effectiveFrom: row.effectiveFrom.toISOString(), changeReason: row.changeReason ?? undefined, createdBy: row.createdBy ?? undefined, createdAt: row.createdAt.toISOString(), rateCount: Array.isArray(row.rates) ? (row.rates as unknown[]).length : 0 })) };
  }

  /** PRICE-03：回放某个空间版本，不需要也不接受 planId。 */
  async getSpacePriceVersion(tenantId: string, context: BusinessContext, sequence: number) {
    const prisma = this.prisma;
    if (!prisma) throw new BadRequestException("价格版本仅在 MySQL 数据源下可用");
    const workspaceId = this.workspaceOf(tenantId);
    const row = await prisma.rentalPriceVersion.findFirst({ where: { tenantId, workspaceId, sequence } });
    if (!row) throw new NotFoundException("价格版本不存在");
    return { id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, sequence: row.sequence, version: `v${row.sequence}`, effectiveFrom: row.effectiveFrom.toISOString(), changeReason: row.changeReason ?? undefined, createdBy: row.createdBy ?? undefined, createdAt: row.createdAt.toISOString(), rates: row.rates as unknown as RentalPricingRate[] };
  }

  /** PRICE-03：历史快照只能通过追加新版本恢复，原版本与中间版本均保持不可变。 */
  async restoreSpacePriceVersion(tenantId: string, context: BusinessContext, sequence: number, reason: string, operator?: string) {
    const prisma = this.prisma;
    if (!prisma) throw new BadRequestException("价格版本仅在 MySQL 数据源下可用");
    if (!reason?.trim()) throw new BadRequestException("恢复原因不能为空");
    const workspaceId = this.workspaceOf(tenantId);
    const state = this.state(tenantId, context);
    const enabledPlans = state.pricingPlans.filter((plan) => plan.status === "enabled");
    const restored = await prisma.$transaction(async (tx) => {
      const target = await tx.rentalPriceVersion.findFirst({ where: { tenantId, workspaceId, sequence } });
      if (!target) throw new NotFoundException("要恢复的价格版本不存在");
      const pending = await tx.rentalPriceAdjustmentPlan.findFirst({
        where: { tenantId, workspaceId, status: "pending" },
        select: { code: true }
      });
      if (pending) throw new ConflictException(`空间已有待生效调价 ${pending.code}，请先执行或取消后再恢复历史价格`);
      const targetRates = target.rates as unknown as RentalPricingRate[];
      const current = await this.findSpaceVersionAt(tenantId, workspaceId, new Date(), tx);
      if (current && RentalBusinessService.sameRates(current.rates as unknown as RentalPricingRate[], targetRates)) {
        throw new ConflictException(`当前价格已与 v${sequence} 相同，无需重复恢复`);
      }
      const key = (rate: { itemGroupId: string; unit: string }) => `${rate.itemGroupId}:${rate.unit}`;
      const targetByKey = new Map(targetRates.map((rate) => [key(rate), rate]));
      const activeKeys = new Set(enabledPlans.flatMap((plan) => plan.rates.map(key)));
      if (activeKeys.size !== targetByKey.size || [...activeKeys].some((item) => !targetByKey.has(item))) {
        throw new ConflictException("历史版本的商品与计价单位结构已和当前启用计划不同，请先处理新增或下线的价格行后再恢复");
      }
      const updatedPlans = enabledPlans.map((plan) => ({
        ...plan,
        version: versionAfter(plan.version),
        rates: plan.rates.map((rate) => structuredClone(targetByKey.get(key(rate))!)),
        updatedAt: stamp()
      }));
      const row = await this.appendSpaceVersion(tx, {
        tenantId,
        workspaceId,
        effectiveFrom: new Date(),
        rates: targetRates,
        changeReason: `恢复 v${sequence}：${reason.trim()}`,
        createdBy: operator
      });
      for (const plan of updatedPlans) await this.configStore.upsertPricingPlan(plan, tx);
      return { row, updatedPlans };
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("价格版本并发写入冲突，请刷新后重试");
      }
      throw error;
    });
    for (const updated of restored.updatedPlans) {
      const plan = state.pricingPlans.find((item) => item.id === updated.id);
      if (plan) Object.assign(plan, updated);
    }
    return { id: restored.row.id, sequence: restored.row.sequence, version: `v${restored.row.sequence}`, restoredFromVersion: `v${sequence}` };
  }

  /** 兼容旧入口：明确按空间级读取，planId 只作归属校验。 */
  async listPriceVersions(tenantId: string, context: BusinessContext, planId: string, page = 1, pageSize = 20) {
    const plan = this.state(tenantId, context).pricingPlans.find((row) => row.id === planId);
    if (!plan) throw new NotFoundException("定价计划不存在");
    return this.listSpacePriceVersions(tenantId, context, page, pageSize);
  }

  /** 兼容旧入口：明确按空间级读取，planId 只作归属校验。 */
  async getPriceVersion(tenantId: string, context: BusinessContext, planId: string, sequence: number) {
    const plan = this.state(tenantId, context).pricingPlans.find((row) => row.id === planId);
    if (!plan) throw new NotFoundException("定价计划不存在");
    return this.getSpacePriceVersion(tenantId, context, sequence);
  }

  /** PRICE-03：计划的调价计划列表（隔离同 listPriceVersions）。 */
  async listPriceAdjustments(tenantId: string, context: BusinessContext, planId: string) {
    const prisma = this.prisma;
    if (!prisma) return [];
    const plan = this.state(tenantId, context).pricingPlans.find((row) => row.id === planId);
    if (!plan) throw new NotFoundException("定价计划不存在");
    const workspaceId = this.workspaceOf(tenantId);
    const rows = await prisma.rentalPriceAdjustmentPlan.findMany({
      where: { tenantId, workspaceId, planId },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return rows.map((row) => ({
      id: row.id,
      planId: row.planId,
      code: row.code,
      name: row.name,
      status: row.status,
      changes: row.changes,
      scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : undefined,
      baseVersionId: row.baseVersionId ?? undefined,
      resultVersionId: row.resultVersionId ?? undefined,
      changeReason: row.changeReason,
      createdBy: row.createdBy ?? undefined,
      confirmedBy: row.confirmedBy ?? undefined,
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : undefined,
      failureReason: row.failureReason ?? undefined,
      cancelReason: row.cancelReason ?? undefined,
      createdAt: row.createdAt.toISOString()
    }));
  }

  /**
   * PRICE-03：创建调价计划（差异 + 逐行最终价预览）。scheduledAt 给定且在未来 → 确认后进待生效。
   * 隔离：planId 必须属于当前租户与空间（Codex P0）。
   */
  async createPriceAdjustment(
    tenantId: string,
    context: BusinessContext,
    planId: string,
    input: CreateRentalPriceAdjustmentRequest,
    operator?: string
  ) {
    const prisma = this.prisma;
    if (!prisma) throw new BadRequestException("调价计划仅在 MySQL 数据源下可用");
    if (!input.code?.trim()) throw new BadRequestException("调价计划编码不能为空");
    if (!input.name?.trim()) throw new BadRequestException("调价计划名称不能为空");
    if (!input.changeReason?.trim()) throw new BadRequestException("调价计划必须填写变更原因");
    const plan = this.state(tenantId, context).pricingPlans.find((row) => row.id === planId);
    if (!plan) throw new NotFoundException("定价计划不存在");
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : undefined;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new BadRequestException("定时生效时间无效");
    const targetAt = scheduledAt ?? new Date();
    const planKeys = new Set(plan.rates.map((rate) => `${rate.itemGroupId}:${rate.unit}`));
    const outsidePlan = input.changes.find((change) => !planKeys.has(`${change.itemGroupId}:${change.unit}`));
    if (outsidePlan) throw new BadRequestException("调价差异只能修改当前定价计划内的商品与计价单位");
    const base = await this.resolveSpaceRates(tenantId, context, targetAt.toISOString());
    const { rates: nextRates, preview } = applyPriceAdjustment(base.rates, input.changes);
    for (const rate of nextRates) {
      assertNoPeriodicOverlap(rate.periodicWindows, plan.name + " · " + rate.itemGroupCode);
      assertNoDatetimeOverrideOverlap(rate.datetimeOverrides, plan.name + " · " + rate.itemGroupCode);
    }
    const workspaceId = this.workspaceOf(tenantId);
    const adjustment = await prisma.rentalPriceAdjustmentPlan
      .create({
        data: {
          tenantId,
          workspaceId,
          planId,
          code: input.code.trim(),
          name: input.name.trim(),
          status: "draft",
          changes: input.changes as unknown as Prisma.InputJsonValue,
          scheduledAt: scheduledAt ?? null,
          changeReason: input.changeReason.trim(),
          createdBy: operator
        }
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictException("调价计划编码已存在");
        }
        throw error;
      });
    return { id: adjustment.id, code: adjustment.code, name: adjustment.name, status: adjustment.status, preview };
  }

  /**
   * PRICE-03：确认调价计划（Codex 复审 P1-5 确定性收口）。
   *
   * - 立即：基于当前版本生成新版本（事务内锁定序号与状态迁移）；
   * - 定时：进入待生效前**锁定基础版本 id 与完整最终费率**——到期执行直接采用
   *   确认时的结果，基础版本被其他调价推进则按失败处理（结果与确认展示一致）。
   */
  async confirmPriceAdjustment(tenantId: string, context: BusinessContext, planId: string, adjustmentId: string, operator?: string) {
    const prisma = this.prisma;
    if (!prisma) throw new BadRequestException("调价计划仅在 MySQL 数据源下可用");
    const plan = this.state(tenantId, context).pricingPlans.find((row) => row.id === planId);
    if (!plan) throw new NotFoundException("定价计划不存在");
    const workspaceId = this.workspaceOf(tenantId);
    const adjustment = await prisma.rentalPriceAdjustmentPlan.findFirst({
      where: { id: adjustmentId, tenantId, workspaceId, planId }
    });
    if (!adjustment) throw new NotFoundException("调价计划不存在");
    if (adjustment.status !== "draft") throw new ConflictException("调价计划当前状态为 " + adjustment.status + "，只有草稿可以确认");
    const scheduledAt = adjustment.scheduledAt ? adjustment.scheduledAt.getTime() : 0;
    if (scheduledAt > Date.now()) {
      // 定时计划按计划生效时点预览并锁定。一个空间同一时刻只允许一条待生效链：
      // 否则多个计划会同时基于同一旧版本，到期后只能让后执行者失败，确认页却无法说明最终价。
      await prisma.$transaction(async (tx) => {
        const otherPending = await tx.rentalPriceAdjustmentPlan.findFirst({
          where: { tenantId, workspaceId, status: "pending", id: { not: adjustmentId } },
          select: { code: true, scheduledAt: true }
        });
        if (otherPending) {
          throw new ConflictException(`空间已有待生效调价 ${otherPending.code}，请先执行或取消后再确认新的定时调价`);
        }
        const targetAt = adjustment.scheduledAt!;
        await this.assertAppendOnlyTimeline(tx, tenantId, workspaceId, targetAt);
        const base = await this.resolveSpaceRates(tenantId, context, targetAt.toISOString(), tx);
        const { rates: finalRates } = applyPriceAdjustment(base.rates, adjustment.changes as unknown as RentalPriceAdjustmentChange[]);
        const baseVersionId = "versionId" in base ? base.versionId : undefined;
        const pending = await tx.rentalPriceAdjustmentPlan.updateMany({
          where: { id: adjustmentId, tenantId, workspaceId, status: "draft" },
          data: {
            status: "pending",
            baseVersionId: baseVersionId ?? null,
            finalRates: finalRates as unknown as Prisma.InputJsonValue,
            confirmedBy: operator,
            confirmedAt: new Date()
          }
        });
        if (!pending.count) throw new ConflictException("调价计划已被其他人处理，请刷新后重试");
      });
      return { id: adjustmentId, status: "pending" as const };
    }
    const versionId = await this.applyPriceAdjustmentInternal(tenantId, context, planId, adjustmentId, operator);
    return { id: adjustmentId, status: "applied" as const, versionId };
  }

  /** PRICE-03：取消调价计划（草稿/待生效可取消，已生效不可撤回）。取消原因独立记录。 */
  async cancelPriceAdjustment(tenantId: string, context: BusinessContext, planId: string, adjustmentId: string, reason: string) {
    const prisma = this.prisma;
    if (!prisma) throw new BadRequestException("调价计划仅在 MySQL 数据源下可用");
    if (!reason?.trim()) throw new BadRequestException("取消调价计划必须填写原因");
    const plan = this.state(tenantId, context).pricingPlans.find((row) => row.id === planId);
    if (!plan) throw new NotFoundException("定价计划不存在");
    const workspaceId = this.workspaceOf(tenantId);
    const pending = await prisma.rentalPriceAdjustmentPlan.updateMany({
      where: { id: adjustmentId, tenantId, workspaceId, planId, status: { in: ["draft", "pending"] } },
      data: { status: "cancelled", cancelReason: reason.trim() }
    });
    if (!pending.count) throw new ConflictException("调价计划不存在或已生效，不可取消");
    return { id: adjustmentId, status: "cancelled" as const };
  }

  /**
   * PRICE-03：执行到期的待生效调价（需求 4.4.3：定时与立即同一版本机制）。
   *
   * 隔离与确定性（Codex P0/P1-5）：只处理**当前空间**的到期任务；执行采用确认时
   * 锁定的完整结果（finalRates）；基础版本已被推进 → 按执行失败处理（不重放差异）；
   * effectiveFrom = 计划的 scheduledAt，调度延迟不会制造错误价格区间。
   */
  async runDuePriceAdjustments(tenantId: string, context: BusinessContext) {
    const prisma = this.prisma;
    if (!prisma) throw new BadRequestException("调价计划仅在 MySQL 数据源下可用");
    const workspaceId = this.workspaceOf(tenantId);
    const workspacePlanIds = this.state(tenantId, context).pricingPlans.map((plan) => plan.id);
    const due = await prisma.rentalPriceAdjustmentPlan.findMany({
      where: {
        tenantId,
        workspaceId,
        planId: { in: workspacePlanIds },
        status: "pending",
        scheduledAt: { lte: new Date() }
      },
      take: 10
    });
    const results: Array<{ id: string; status: string; versionId?: string }> = [];
    for (const adjustment of due) {
      try {
        const versionId = await this.applyPriceAdjustmentInternal(tenantId, context, adjustment.planId, adjustment.id, adjustment.createdBy ?? undefined);
        results.push({ id: adjustment.id, status: "applied", versionId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.rentalPriceAdjustmentPlan.updateMany({
          where: { id: adjustment.id, tenantId, workspaceId, status: "pending" },
          data: { status: "failed", failureReason: message.slice(0, 191) }
        });
        results.push({ id: adjustment.id, status: "failed" });
      }
    }
    return { ranCount: results.length, results };
  }

  /**
   * PRICE-03 内部：生成完整新空间版本并把调价计划置为已生效（同一事务）。
   *
   * - sequence = 事务内 MAX+1；(workspaceId, sequence) 唯一键兜并发，P2002 → 409；
   * - 到期执行采用确认时锁定的 finalRates（基础版本被推进则失败，不重放差异）；
   *   effectiveFrom = scheduledAt（定时）或当前时刻（立即）；
   * - 计划行现值同步延后到事务提交成功之后。
   */
  private async applyPriceAdjustmentInternal(tenantId: string, context: BusinessContext, planId: string, adjustmentId: string, operator?: string): Promise<string> {
    const prisma = this.prisma;
    if (!prisma) throw new BadRequestException("调价计划仅在 MySQL 数据源下可用");
    const workspaceId = this.workspaceOf(tenantId);
    const adjustment = await prisma.rentalPriceAdjustmentPlan.findFirst({
      where: { id: adjustmentId, tenantId, workspaceId, planId }
    });
    if (!adjustment || (adjustment.status !== "draft" && adjustment.status !== "pending")) {
      throw new ConflictException("调价计划不存在或不在可执行状态");
    }
    const plan = this.state(tenantId, context).pricingPlans.find((row) => row.id === planId);
    if (!plan) throw new NotFoundException("定价计划不存在");
    const changes = adjustment.changes as unknown as RentalPriceAdjustmentChange[];
    const planKeys = new Set(plan.rates.map((rate) => `${rate.itemGroupId}:${rate.unit}`));
    if (changes.some((change) => !planKeys.has(`${change.itemGroupId}:${change.unit}`))) {
      throw new BadRequestException("调价差异只能修改当前定价计划内的商品与计价单位");
    }
    const appliedResult = await prisma.$transaction(async (tx) => {
      if (adjustment.status === "draft") {
        const pending = await tx.rentalPriceAdjustmentPlan.findFirst({
          where: { tenantId, workspaceId, status: "pending" },
          select: { code: true }
        });
        if (pending) throw new ConflictException(`空间已有待生效调价 ${pending.code}，请先执行或取消后再立即调价`);
      }
      // 到期执行必须仍基于确认时锁定的那一版。中间若有别的调价推进了版本，
      // 直接采用 finalRates 会把那次调价**静默覆盖**掉：改价的人一小时后
      // 发现自己的价格被无声还原，且没有任何失败记录。宁可失败让人重做。
      if (adjustment.status === "pending" && adjustment.finalRates) {
        const latest = await this.findSpaceVersionAt(tenantId, workspaceId, adjustment.scheduledAt ?? new Date(), tx);
        if ((latest?.id ?? null) !== (adjustment.baseVersionId ?? null)) {
          throw new StalePriceBaseError(
            `调价计划确认时基于版本 ${adjustment.baseVersionId ?? "（无）"}，但当前已是 ` +
              `${latest ? `v${latest.sequence}` : "（无版本）"}，到期执行会覆盖中间的调价，已置为执行失败`
          );
        }
      }
      const effectiveFrom =
        adjustment.status === "pending" && adjustment.scheduledAt
          ? adjustment.scheduledAt
          : new Date();
      const rates =
        adjustment.status === "pending" && adjustment.finalRates
          ? (adjustment.finalRates as unknown as RentalPricingRate[])
          : applyPriceAdjustment(
              (await this.resolveSpaceRates(tenantId, context, effectiveFrom.toISOString(), tx)).rates,
              changes
            ).rates;
      // 计划现值必须从事务内看到的数据库行和本次完整结果派生。若两条调价相邻执行，
      // 用事务外缓存计算会让后执行者把先执行者的计划现值覆盖回去，尽管空间版本是对的。
      const storedPlan = await tx.rentalPricingPlan.findFirst({ where: { id: planId, tenantId, workspaceId } });
      if (!storedPlan) throw new NotFoundException("定价计划不存在");
      const completeByKey = new Map(rates.map((rate) => [`${rate.itemGroupId}:${rate.unit}`, rate]));
      const storedRates = storedPlan.rates as unknown as RentalPricingRate[];
      const nextPlanRates = storedRates.map((rate) => {
        const updated = completeByKey.get(`${rate.itemGroupId}:${rate.unit}`);
        if (!updated) throw new ConflictException("调价后的完整版本缺少当前计划价格行，请刷新后重试");
        return structuredClone(updated);
      });
      const nextPlan: RentalPricingPlanV1 = {
        ...plan,
        version: versionAfter(storedPlan.version),
        rates: nextPlanRates,
        updatedAt: stamp()
      };
      const row = await this.appendSpaceVersion(tx, {
        tenantId,
        workspaceId,
        effectiveFrom,
        rates,
        changeReason: adjustment.changeReason,
        createdBy: operator
      });
      await this.configStore.upsertPricingPlan(nextPlan, tx);
      const applied = await tx.rentalPriceAdjustmentPlan.updateMany({
        where: { id: adjustmentId, tenantId, workspaceId, status: { in: ["draft", "pending"] } },
        data: { status: "applied", resultVersionId: row.id, confirmedBy: operator ?? undefined, confirmedAt: new Date() }
      });
      if (!applied.count) throw new ConflictException("调价计划已被其他人处理，请刷新后重试");
      return { row, nextPlan };
    }).catch((error) => {
      // 基础版本被推进 → 409。失败的落库由调用方 runDuePriceAdjustments 统一记
      // （它已按 message 写 failureReason），这里不重复写一遍。
      if (error instanceof StalePriceBaseError) throw new ConflictException(error.message);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("价格版本并发写入冲突，请刷新后重试");
      }
      throw error;
    });
    // 事务提交成功后再同步内存计划；失败时数据库和缓存都保持旧值。
    Object.assign(plan, appliedResult.nextPlan);
    return appliedResult.row.id;
  }

  /**
   * 拒绝**同刻生效**的重叠价格（需求 4.4.3/4.4.4）。
   *
   * 判据是「同一商品 × 同一计价单位 × `effectiveFrom` 完全相同」：这种组合下"哪一版生效"
   * 没有任何业务答案，报价只能靠排序兜底——而排序兜底正是 Codex 指出的问题根源
   * （早前还用 `localeCompare`，"1.10" 会排在 "1.9" 之后）。同刻冲突在保存时直接 409 后，
   * 那条兜底就不可能再被用来决定钱。
   *
   * **不**拒绝「生效时间不同的开口计划」：那是正常的排期调价（旧价无结束时间、新价从某日
   * 起生效），报价按租期开始时间取生效时间最晚者，结果唯一且可解释。把它也判成重叠会让
   * 任何一次调价都必须先手工给旧计划补结束时间。完整的不可变价格版本与「按空间×商品×
   * 计价单位×生效区间」全面查冲突属 PRICE-03 的范围，本任务不越界实现。
   *
   * 只比 `enabled`：草稿与停用计划不参与报价。样例默认价格（`*_pricing_default`）是开箱
   * 兜底、按默认单位覆盖当时全部商品，把它当成对等计划会让租户配不进任何具体价格。
   */
  private assertNoOverlappingPricingPlan(
    state: RentalBusinessState,
    input: SaveRentalPricingPlanRequest,
    rates: RentalPricingRate[],
    excludeId?: string
  ) {
    if ((input.status ?? "draft") !== "enabled") return;
    const from = new Date(input.effectiveFrom).getTime();
    const mine = new Set(rates.map((rate) => `${rate.itemGroupId}:${rate.unit}`));
    for (const plan of state.pricingPlans) {
      if (plan.id === excludeId || plan.status !== "enabled") continue;
      if (plan.id.endsWith("_pricing_default")) continue;
      if (new Date(plan.effectiveFrom).getTime() !== from) continue;
      const clash = plan.rates.find((rate) => mine.has(`${rate.itemGroupId}:${rate.unit}`));
      if (clash) {
        throw new ConflictException(
          `与已启用的定价计划 ${plan.code}（v${plan.version}）生效时间完全相同：` +
            `${clash.itemGroupName ?? clash.itemGroupId} 的 ${clash.unit} 会有两个同刻生效的版本，` +
            `报价无法确定用哪一版，请调整生效时间或停用原计划`
        );
      }
    }
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

  /**
   * 读取年度日历。`includeDraft` 决定看到的是编辑视图还是发布视图（需求 4.5.8）：
   * - 有编辑/发布权限者（`includeDraft=true`）：草稿优先，其次已发布，最后按周模板生成，
   *   以便编辑正在起草的版本；
   * - 只读的普通运营人员（`includeDraft=false`）：只看**已发布**日历，没有则回退到周模板，
   *   绝不提前看到未发布的草稿调整——需求 4.5.8 明确普通运营人员「查看已发布日历」。
   *
   * 不能像早前那样"取该年度第一条"：同年度现在可能同时存在已被替代的历史版本，
   * 数组顺序取决于装载顺序，会随机返回一个历史版本。
   */
  getCalendar(tenantId: string, context: BusinessContext, year: number, includeDraft = true) {
    if (includeDraft) return this.editableCalendar(tenantId, context, year);
    return this.publishedCalendar(tenantId, context, year) ?? this.buildCalendar(tenantId, context.settings, year);
  }

  /**
   * PRICE-02B：月历分时价格摘要（需求 4.5.9）。只读消费 PRICE-03 的当前价格版本，
   * 用与报价**同一个**命中助手计算每个日期的分时规则摘要；月历不复制价格值、
   * 不建立第二套价格事实。内存模式无价格版本事实，返回空。
   */
  async timePriceSummaryForYear(tenantId: string, context: BusinessContext, year: number): Promise<RentalCalendarTimePriceDay[]> {
    const prisma = this.prisma;
    if (!prisma || (process.env.PLATFORM_DATA_SOURCE ?? "mysql").toLowerCase() !== "mysql") return [];
    const timeZone = context.settings.calendar.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
    const calendar = this.buildCalendar(tenantId, context.settings, year);
    const plans = this.state(tenantId, context).pricingPlans.filter((plan) => plan.status === "enabled");
    const weeklyNames = ["日", "一", "二", "三", "四", "五", "六"];
    const workspaceId = this.workspaceOf(tenantId);
    // 按版本的真实生效区间生成摘要，不能拿“数据库最新一版”覆盖全年：未来版本会把
    // 尚未生效的规则提前显示，历史月份也会被当前规则改写。这里一次读取年度边界前
    // 的基准版及年度内版本，再按 [effectiveFrom, nextEffectiveFrom) 与自然日求交集。
    const yearStart = new Date(businessInstantAt(`${year}-01-01`, 0, timeZone));
    const yearEnd = new Date(businessInstantAt(`${year + 1}-01-01`, 0, timeZone));
    const [beforeYear, withinYear] = await Promise.all([
      prisma.rentalPriceVersion.findFirst({
        where: { tenantId, workspaceId, effectiveFrom: { lte: yearStart } },
        orderBy: [{ effectiveFrom: "desc" }, { sequence: "desc" }]
      }),
      prisma.rentalPriceVersion.findMany({
        where: { tenantId, workspaceId, effectiveFrom: { gt: yearStart, lt: yearEnd } },
        orderBy: [{ effectiveFrom: "asc" }, { sequence: "asc" }]
      })
    ]);
    const versions = [...(beforeYear ? [beforeYear] : []), ...withinYear];
    // 计划归属只用于展示。版本里的费率不带计划标识，按「商品 × 计价单位」回查当前
    // 拥有该价格的在用计划；查不到就留空——价格已从计划下线但版本仍是生效事实，
    // 编一个计划编码会让月历看起来仍受某个计划管辖。
    const ownerOf = new Map<string, { planId: string; planCode: string }>();
    for (const plan of plans) {
      for (const rate of plan.rates) {
        ownerOf.set(`${rate.itemGroupId}:${rate.unit}`, { planId: plan.id, planCode: plan.code });
      }
    }
    const result: RentalCalendarTimePriceDay[] = [];
    for (const day of calendar.days) {
      const entries: RentalCalendarTimePriceDay["entries"] = [];
      const dayStart = businessInstantAt(day.date, 0, timeZone);
      const nextDate = businessDateKeyFromIndex(Math.floor(Date.parse(`${day.date}T00:00:00Z`) / 86_400_000) + 1);
      const dayEnd = businessInstantAt(nextDate, 0, timeZone);
      const dayVersions = versions
        .map((row, index) => ({
          row,
          start: row.effectiveFrom.getTime(),
          end: versions[index + 1]?.effectiveFrom.getTime() ?? Number.POSITIVE_INFINITY
        }))
        .filter((range) => range.start < dayEnd && range.end > dayStart);
      for (const fact of dayVersions) {
        const version = `v${fact.row.sequence}`;
        for (const rate of fact.row.rates as unknown as RentalPricingRate[]) {
          const owner = ownerOf.get(`${rate.itemGroupId}:${rate.unit}`);
          for (const window of rate.periodicWindows ?? []) {
            if (periodicWindowCoversDate(window, day.date, timeZone)) {
              entries.push({
                planId: owner?.planId,
                planCode: owner?.planCode,
                version,
                itemGroupCodes: [rate.itemGroupCode],
                unit: rate.unit,
                timeLabel: weeklyNames[window.fromWeekday] + " " + window.fromTime + " 起",
                multiplier: window.multiplier,
                source: "periodic"
              });
            }
          }
          for (const override of rate.datetimeOverrides ?? []) {
            const startAt = new Date(override.start).getTime();
            const endAt = new Date(override.end).getTime();
            if (override.id && day.pricingOverrideRef === override.id && startAt < dayEnd && endAt > dayStart) {
              entries.push({
                planId: owner?.planId,
                planCode: owner?.planCode,
                version,
                itemGroupCodes: [rate.itemGroupCode],
                unit: rate.unit,
                timeLabel: "一次性特殊价",
                multiplier: override.multiplier,
                source: "datetime_override",
                overrideRef: override.id
              });
            }
          }
        }
      }
      if (entries.length) result.push({ date: day.date, entries });
    }
    return result;
  }

  /** 同一年度可同时存在草稿、已发布与已被替代（需求 4.5.7），因此按「年度 + 版本」定位。 */
  private cacheCalendar(state: RentalBusinessState, calendar: RentalCalendarYear) {
    const index = state.calendars.findIndex(
      (item) => item.year === calendar.year && item.version === calendar.version
    );
    if (index >= 0) state.calendars.splice(index, 1, calendar);
    else state.calendars.push(calendar);
  }

  /** 供报价使用的年度日历：只认已发布版本；没有则回退到按周模板生成。 */
  private publishedCalendar(tenantId: string, context: BusinessContext, year: number) {
    const published = this.state(tenantId, context).calendars.filter(
      (item) => item.year === year && item.status === "published"
    );
    // 正常只会有一个；若出现多个，取版本号最大的那个并保持行为确定。
    return published.sort((left, right) => compareVersions(right.version, left.version))[0];
  }

  /**
   * 供编辑使用：优先当前草稿，其次已发布版本，最后按周模板生成。
   *
   * 必须按版本号降序取：同一年度可能存在多个草稿（历史遗留数据，或早前每次导入
   * 都递增版本的实现留下的），而 `Array.find` 取的是装载顺序里的第一条，
   * 等于随机返回一个旧草稿——运营刚存的覆盖会"消失"，下一次发布也会发错版本。
   */
  private editableCalendar(tenantId: string, context: BusinessContext, year: number) {
    const list = this.state(tenantId, context).calendars.filter((item) => item.year === year);
    const latest = (status: RentalCalendarYear["status"]) =>
      list
        .filter((item) => item.status === status)
        .sort((left, right) => compareVersions(right.version, left.version))[0];
    const editable = latest("draft") ?? latest("published");
    if (editable) return editable;
    // 没有草稿也没有已发布版本时按周模板生成。版本号不能固定用 buildCalendar 的 "1.0"：
    // 该年度可能存在**已作废**的 1.0（作废后既不算 draft 也不算 published），
    // 而落库走 upsert (workspaceId, year, version)，撞号会把那条 void 行原地改回 draft，
    // 作废人/时间/原因与该行的覆盖审计一并被写成 NULL——需求 4.5.7 要求历史版本不得原地改回。
    return { ...this.buildCalendar(tenantId, context.settings, year), version: this.nextCalendarVersion(list) };
  }

  /**
   * 该年度下一个未被占用的版本号。
   *
   * 必须把 `void` 与 `superseded` 也算进已占用集合：只按当前可编辑版本 +1 会重新分配到
   * 一个历史版本号，upsert 撞号即原地改写那条历史行（作废记录或替代记录被静默销毁）。
   */
  private nextCalendarVersion(existing: RentalCalendarYear[], base?: string) {
    const taken = new Set(existing.map((item) => item.version));
    let candidate = versionAfter(base);
    while (taken.has(candidate)) candidate = versionAfter(candidate);
    return candidate;
  }

  /** 审计与差异用的日期取值快照。 */
  private static daySnapshot(day: RentalCalendarDay): RentalCalendarDaySnapshot {
    return {
      dayType: day.dayType,
      name: day.name,
      pricingMultiplier: day.pricingMultiplier,
      closed: day.closed,
      businessStatus: day.businessStatus,
      source: day.source,
      hours: day.hours,
      pricingOverrideRef: day.pricingOverrideRef
    };
  }

  /**
   * 追加一条覆盖审计。上限 500 条：审计随年度日历整行以 JSON 落库，
   * 无上限时一年内反复调整同一天会把这一行撑到 MySQL 的 JSON 长度上限，
   * 届时整个年度日历都写不进去。超出后丢最早的记录——最近的调整才是运营要查的。
   */
  /**
   * 记录一条人工覆盖/撤销审计。
   *
   * 审计写进**独立的只追加表**，不再挂在年度日历的 JSON 上：那里只能靠 `slice(-500)`
   * 截断，最早的记录被静默删除，与需求 4.5.8「完整审计」直接冲突。这里只收集，
   * 由 `writeCalendar` 与日历改动在同一事务内落库——审计留在一个被回滚的编辑上
   * （或反之）比没有审计更难排查。
   */
  private static pendingAudit(calendar: RentalCalendarYear, entry: RentalCalendarOverrideAudit) {
    return { ...entry, year: calendar.year, version: calendar.version };
  }

  /**
   * 把一个**公共官方来源版本**应用到本经营空间的年度草稿（需求 4.5.2）。
   *
   * 空间侧不再接受原始官方日期：官方数据是公共基础来源，由 SaaS 平台管理员在注册表里
   * 维护并形成来源版本，空间只能引用某一版生成/更新自己的草稿，再由有权限的人确认发布。
   * 早前空间可以直接 POST 任意 days，等于让每个租户自行编造公共数据，
   * 且「导入即生效」与需求「不得导入后自动影响全部经营空间」相反。
   */
  async importOfficialCalendar(tenantId: string, context: BusinessContext, input: ImportRentalCalendarRequest) {
    if (!/^https:\/\//.test(input.sourceUrl)) throw new BadRequestException("官方日历来源必须使用 HTTPS 地址");
    if (!input.days.length) throw new BadRequestException("官方日历数据不能为空");
    const state = this.state(tenantId, context);
    const base = this.editableCalendar(tenantId, context, input.year);
    const calendar = structuredClone(base);
    // 官方导入是**整年替换**（需求 4.5.2：官方版本是当年的完整权威数据），不是增量合并。
    // 以周模板为底重建全年，只把人工覆盖搬过来；旧版本里本次未再出现的官方节假日
    // 会随之回落到周模板默认值——否则官方删掉某个节假日后，该日期会永久残留旧安排。
    const template = this.buildCalendar(tenantId, context.settings, input.year);
    const dayMap = new Map<string, RentalCalendarDay>(template.days.map((day) => [day.date, day]));
    const templateByDate = new Map(template.days.map((day) => [day.date, day]));
    for (const day of base.days) {
      if (day.source !== "tenant_override") continue;
      // 人工覆盖搬过来时**重算** overriddenFrom：它的语义是「移除覆盖后恢复到哪里」，
      // 也就是当前的次优先级来源。整年替换后，本次官方数据未再包含的日期，其次优先级
      // 已经变成周模板；若沿用上一版官方值，撤销覆盖会恢复出一个当前官方版本里
      // 并不存在的法定节假日，并按 holidayMultiplier 计价。
      // 下面的 input.days 循环会把本次仍在官方数据里的日期改写成本次官方值。
      const carried = structuredClone(day);
      const fallback = templateByDate.get(day.date);
      carried.overriddenFrom = fallback
        ? {
            dayType: fallback.dayType,
            name: fallback.name,
            pricingMultiplier: fallback.pricingMultiplier,
            closed: fallback.closed,
            businessStatus: fallback.businessStatus,
            // 模板日恒为 week_rule；显式写死以满足 overriddenFrom 不接受 tenant_override 的类型约束。
            source: "week_rule"
          }
        : undefined;
      dayMap.set(day.date, carried);
    }
    const seen = new Set<string>();
    const preserved: string[] = [];
    for (const row of input.days) {
      // 严格日期校验：`2026-02-30` 会被 `new Date` 静默滚到 3 月 2 日，
      // 那天的节假日加价就落到了错误的日期上。
      if (!isCalendarDateKey(row.date)) throw new BadRequestException(`日历日期 ${row.date} 不是有效的 YYYY-MM-DD 日期`);
      if (!row.date.startsWith(`${input.year}-`)) throw new BadRequestException("日历日期与年度不一致");
      if (!["statutory_holiday", "makeup_workday"].includes(row.dayType)) throw new BadRequestException("官方数据只允许法定节假日或调休工作日");
      // 同一批里重复给同一天，说明来源数据本身有问题；静默取最后一条会让导入结果
      // 取决于数组顺序，运营无法解释为什么那天不是自己看到的类型。
      if (seen.has(row.date)) throw new BadRequestException(`日历日期 ${row.date} 在本次导入中重复`);
      seen.add(row.date);
      const official: RentalCalendarDay = {
        date: row.date, dayType: row.dayType, name: row.name,
        pricingMultiplier: row.pricingMultiplier ?? (row.dayType === "statutory_holiday" ? 1.25 : 1),
        closed: row.closed ?? false, source: "official_cn"
      };
      const existing = dayMap.get(row.date);
      // 人工覆盖优先于官方日历（需求 4.5.3 的来源优先级）。早前无条件 set，
      // 于是每次重导官方数据都会把运营的调整连同调整原因一起抹掉，且毫无提示。
      if (existing?.source === "tenant_override") {
        preserved.push(row.date);
        // 但 `overriddenFrom` 要换成本次的官方值：它的用途是"移除覆盖后恢复到哪里"，
        // 停在上一版官方数据会让撤销覆盖后恢复出一个已经作废的节假日安排。
        dayMap.set(row.date, {
          ...existing,
          overriddenFrom: {
            dayType: official.dayType,
            name: official.name,
            pricingMultiplier: official.pricingMultiplier,
            closed: official.closed,
            businessStatus: official.closed ? "closed" : "open",
            source: "official_cn"
          }
        });
        continue;
      }
      dayMap.set(row.date, official);
    }
    calendar.days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    calendar.region = "CN";
    // 已是草稿就原地更新，不递增版本。早前无条件 `versionAfter`，于是连续导入两次
    // 会留下两个草稿；再叠加 `find` 取首条的旧 bug，页面会随机显示其中一个。
    if (base.status !== "draft") {
      calendar.status = "draft";
      // 版本号跳过已占用的历史版本（含 void / superseded），否则 upsert 会原地改写那条历史行。
      calendar.version = this.nextCalendarVersion(
        state.calendars.filter((item) => item.year === input.year),
        base.version
      );
      calendar.previousVersion = base.version;
      // 上一版的发布记录不能被新草稿继承：草稿从未发布过，带着别人的变更原因与差异，
      // 版本历史与差异查询（需求 4.5.7）会把两次事件混在一起。
      calendar.changeReason = undefined;
      calendar.publishDiff = undefined;
    }
    calendar.sourceName = input.sourceName;
    calendar.sourceUrl = input.sourceUrl;
    calendar.sourcePublishedAt = input.sourcePublishedAt;
    // 记住引用的是哪一个公共来源版本（需求 4.5.7：发布记录必须保存官方来源版本）。
    calendar.sourceVersionId = input.sourceVersionId;
    calendar.sourceVersion = input.sourceVersion;
    calendar.importedAt = stamp();
    calendar.importPreservedOverrides = preserved.length ? preserved : undefined;
    calendar.publishedAt = undefined;
    calendar.publishedBy = undefined;
    calendar.supersededAt = undefined;
    calendar.publishDiff = undefined;
    await this.writeCalendar(state, base, calendar);
    return calendar;
  }

  /**
   * 落库一次年度日历写入，带乐观锁。
   *
   * `base` 是本次编辑读到的那一版。写同一行时以它的 `revision` 为条件更新——
   * 整年日期在同一个 JSON 字段里，两个编辑人同时改不同日期都会复制全年再写回，
   * 无条件写会让后写者整体覆盖先写者且双方都收到成功。冲突时仓储抛 409，
   * 这里顺手把内存缓存里那一版丢掉，避免后续请求继续基于陈旧副本计算。
   */
  private async writeCalendar(
    state: RentalBusinessState,
    base: RentalCalendarYear,
    next: RentalCalendarYear,
    audits: RentalCalendarOverrideAudit[] = []
  ) {
    const sameRow = next.version === base.version;
    const expectedRevision = sameRow ? base.revision ?? 0 : 0;
    next.revision = sameRow ? (base.revision ?? 0) + 1 : 1;
    try {
      await this.configStore.upsertCalendar(next, expectedRevision, audits);
    } catch (error) {
      if (error instanceof ConflictException) {
        // 缓存里那一版已经落后于库。不能只是丢弃它：下一次编辑会因为找不到草稿而走
        // 「新建版本」路径，再撞上库里已存在的版本号，于是永远修不回来。必须从库重读该年度。
        await this.refreshCalendarYear(state, base.tenantId, base.year);
      }
      throw error;
    }
    this.cacheCalendar(state, next);
  }

  /** 从库重读某年度全部版本并整体替换缓存。乐观锁冲突后的自愈路径。 */
  private async refreshCalendarYear(state: RentalBusinessState, tenantId: string, year: number) {
    const fresh = await this.configStore.loadCalendarsForYear(tenantId, year);
    const others = state.calendars.filter((item) => item.year !== year);
    state.calendars.length = 0;
    state.calendars.push(...others, ...fresh);
  }

  async saveCalendarDay(
    tenantId: string,
    context: BusinessContext,
    year: number,
    input: SaveRentalCalendarDayRequest,
    operator?: string
  ) {
    const state = this.state(tenantId, context);
    const base = this.editableCalendar(tenantId, context, year);
    // 严格校验，逐项都是能绕过的口子：
    // - `startsWith` 单独用会放过 `2026-02-30`（`new Date` 静默滚到 3 月 2 日）
    //   和带时间的 `2026-05-01T00:00:00Z`（同一天出现两个日历键）；
    // - `pricingMultiplier < 0` 放过 `NaN` 与 `Infinity`，两者会把整段租金算成 NaN；
    // - `@IsNotEmpty()` 放过纯空白原因，落库后审计栏显示为空，等于没记原因。
    if (!isCalendarDateKey(input.date)) throw new BadRequestException("日历日期必须是有效的 YYYY-MM-DD 日期");
    if (!input.date.startsWith(`${year}-`)) throw new BadRequestException("日期不属于该年度");
    if (!Number.isFinite(input.pricingMultiplier) || input.pricingMultiplier < 0) throw new BadRequestException("价格系数无效");
    const reason = input.overrideReason?.trim();
    if (!reason) throw new BadRequestException("人工覆盖必须填写调整原因");
    // 单日营业时段覆盖同样校验（需求 4.5.1）：起点早于终点、同类不重叠、
    // 领取/归还/配送落在营业时段内。放行非法时段会在报价时把时点判定算错。
    if (input.hours) {
      const hoursError = businessHoursError(input.hours, input.date);
      if (hoursError) throw new BadRequestException(hoursError);
    }
    // 已发布版本不可原地修改（需求 4.5.7），必须复制生成新草稿。
    //
    // 早前的实现直接把该行 status 改回 draft 并递增版本号——等于**把已发布版本
    // 就地抹掉**：引用该版本的历史报价从此指向一个已不存在的版本，而且该年度
    // 在新草稿发布前处于"没有已发布日历"的状态，报价会静默回落到周模板。
    const calendar = structuredClone(base);
    if (base.status !== "draft") {
      calendar.status = "draft";
      // 跳过已占用版本号（含 void / superseded），避免 upsert 原地改写历史行。
      calendar.version = this.nextCalendarVersion(
        state.calendars.filter((item) => item.year === year),
        base.version
      );
      calendar.previousVersion = base.version;
      calendar.publishedAt = undefined;
      calendar.publishedBy = undefined;
      calendar.supersededAt = undefined;
      // 新草稿不继承上一版的发布记录（变更原因与版本差异属于那一次发布事件）。
      calendar.changeReason = undefined;
      calendar.publishDiff = undefined;
    }
    // 两态与四态必须一致落库：只写一个会让同一行自相矛盾（closed=true 但 status=open），
    // 而读取口径会优先信四态，等于人工覆盖被静默忽略。
    const index = calendar.days.findIndex((item) => item.date === input.date);
    const replaced = index >= 0 ? calendar.days[index] : undefined;
    // 两态与四态必须一致落库：只写一个会让同一行自相矛盾（closed=true 但 status=open），
    // 而读取口径会优先信四态，等于人工覆盖被静默忽略。
    //
    // 未提供 businessStatus 时**不能**一律按 closed 派生：管理端覆盖抽屉只有「停业」复选框、
    // 没有四态选择器，若仅改价格就把 limited/self_service 静默降级为 open/closed，属数据丢失。
    // 因此只有当调用方真正切换了 closed（与被覆盖前不同）时才按 closed 派生，否则沿用原四态。
    const derivedFromClosed = input.closed ? "closed" : "open";
    const businessStatus =
      input.businessStatus ??
      (replaced && replaced.closed === input.closed ? replaced.businessStatus ?? derivedFromClosed : derivedFromClosed);
    // hours 同理：抽屉尚无时段编辑，未提供即沿用被覆盖前的时段，避免一次改价清空已配营业时段。
    // 需要清空时应由带时段编辑的界面显式传空数组，而不是靠"不传"表达清空。
    const hours = input.hours !== undefined ? input.hours : replaced?.hours;
    // 「限时营业」必须真的限时（需求 4.5.4：「只在指定时段提供指定履约能力」）。
    // 早前允许保存成「limited 但任何层级都没有时段」，而运行时空时段表示"不限制"，
    // 于是限时营业实际变成全天可用——配置期就自相矛盾，应在这里 fail-closed 而不是
    // 等到报价时静默放行。日级时段与每周模板任一有效即可。
    if (businessStatus === "limited") {
      const weekly = context.settings.calendar.weeklyHours;
      const weekday = new Date(`${input.date}T00:00:00.000Z`).getUTCDay();
      const effective = hours?.windows?.length ? hours : weekly?.[weekday];
      if (!effective?.windows?.length) {
        throw new BadRequestException(
          "限时营业必须配置营业时段：可在本日期上直接配时段，或先在经营设置里配置每周默认营业时段"
        );
      }
    }
    // 保留被覆盖前的原始值（需求 4.5.3）。两个用途：日期详情要展示被覆盖的原始值；
    // 移除覆盖时要恢复到下一优先级来源，而不是变成"没有来源的空白日"——
    // 若不留原始值，移除时只能凭周模板重算，官方日历里那天的节日名与类型就永久丢了。
    //
    // 反复覆盖同一天时沿用最早的非覆盖原值：`overriddenFrom` 记的是"官方或模板原本
    // 是什么"，不是"上一次人工改成了什么"，否则移除一次只会退回到另一次人工覆盖。
    const origin: RentalCalendarDayOrigin | undefined =
      replaced && replaced.source !== "tenant_override"
        ? {
            dayType: replaced.dayType,
            name: replaced.name,
            pricingMultiplier: replaced.pricingMultiplier,
            closed: replaced.closed,
            businessStatus: replaced.businessStatus,
            source: replaced.source
          }
        : replaced?.overriddenFrom;
    const day: RentalCalendarDay = {
      ...input,
      businessStatus,
      hours,
      closed: businessStatus === "closed" || businessStatus === "self_service",
      source: "tenant_override",
      overrideReason: reason,
      overrideBy: operator,
      overrideAt: stamp(),
      overriddenFrom: origin
    };
    if (index >= 0) calendar.days[index] = day; else calendar.days.push(day);
    calendar.days.sort((a, b) => a.date.localeCompare(b.date));
    const audit = RentalBusinessService.pendingAudit(calendar, {
      date: input.date,
      action: "override",
      reason,
      operator,
      at: day.overrideAt!,
      before: replaced ? RentalBusinessService.daySnapshot(replaced) : undefined,
      after: RentalBusinessService.daySnapshot(day)
    });
    await this.writeCalendar(state, base, calendar, [audit]);
    return day;
  }

  /**
   * 移除某日期的人工覆盖，恢复到下一优先级来源（需求 4.5.3）。
   *
   * 需求明确「移除人工覆盖表示恢复到下一优先级来源，**不得把该日期变成没有来源的
   * 空白日**」，因此不是简单地把那天删掉：有 `overriddenFrom` 就恢复它（官方日历或
   * 周模板的原值），没有就按周模板重算该日期。
   *
   * 与编辑同理：已发布版本不可原地改，移除覆盖也要复制生成新草稿。
   *
   * 撤销原因必填、且与前后取值一起进审计流水：撤销和建立覆盖一样是一次经营决策，
   * 只留「谁在什么时候撤销了」而不留「为什么、从什么改成了什么」，事后既无法判断
   * 是纠错还是误操作，也无法在争议订单里复原当时的日历口径。
   */
  async removeCalendarDayOverride(
    tenantId: string,
    context: BusinessContext,
    year: number,
    date: string,
    input: RemoveRentalCalendarDayOverrideRequest,
    operator?: string
  ) {
    const state = this.state(tenantId, context);
    const base = this.editableCalendar(tenantId, context, year);
    if (!isCalendarDateKey(date)) throw new BadRequestException("日历日期必须是有效的 YYYY-MM-DD 日期");
    const reason = input?.overrideReason?.trim();
    if (!reason) throw new BadRequestException("移除人工覆盖必须填写调整原因");
    if (!date.startsWith(`${year}-`)) throw new BadRequestException("日期不属于该年度");
    const target = base.days.find((item) => item.date === date);
    if (!target || target.source !== "tenant_override") {
      throw new ConflictException(`${date} 没有人工覆盖可移除`);
    }
    const calendar = structuredClone(base);
    if (base.status !== "draft") {
      calendar.status = "draft";
      calendar.version = this.nextCalendarVersion(
        state.calendars.filter((item) => item.year === year),
        base.version
      );
      calendar.previousVersion = base.version;
      calendar.publishedAt = undefined;
      calendar.publishedBy = undefined;
      calendar.supersededAt = undefined;
      // 新草稿不继承上一版的发布记录（变更原因与版本差异属于那一次发布事件）。
      calendar.changeReason = undefined;
      calendar.publishDiff = undefined;
    }
    const origin = target.overriddenFrom;
    // 没有原始值时按周模板重算该日期，而不是留空——空白日会让后续取价拿不到任何来源。
    const fallback = this.buildCalendar(tenantId, context.settings, year).days.find((item) => item.date === date);
    const restored: RentalCalendarDay = origin
      ? {
          date,
          dayType: origin.dayType,
          name: origin.name,
          pricingMultiplier: origin.pricingMultiplier,
          closed: origin.closed,
          businessStatus: origin.businessStatus ?? (origin.closed ? "closed" : "open"),
          source: origin.source
        }
      : fallback ?? {
          date,
          dayType: "workday",
          name: "工作日",
          pricingMultiplier: 1,
          closed: false,
          businessStatus: "open",
          source: "week_rule"
        };
    const index = calendar.days.findIndex((item) => item.date === date);
    calendar.days.splice(index, 1, restored);
    const audit = RentalBusinessService.pendingAudit(calendar, {
      date,
      action: "revert",
      reason,
      operator,
      at: stamp(),
      before: RentalBusinessService.daySnapshot(target),
      after: RentalBusinessService.daySnapshot(restored)
    });
    await this.writeCalendar(state, base, calendar, [audit]);
    return restored;
  }

  /**
   * 编辑已发布/已被替代版本时复制生成新草稿（需求 4.5.7：已发布版本不可原地修改）。
   * 单日编辑（saveCalendarDay/removeCalendarDayOverride）与本文件的范围编辑共用同一规则；
   * 新草稿不继承上一版的发布记录（变更原因与差异属于那一次发布事件）。
   */
  private cloneCalendarForEdit(state: RentalBusinessState, base: RentalCalendarYear, year: number): RentalCalendarYear {
    const calendar = structuredClone(base);
    if (base.status === "draft") return calendar;
    calendar.status = "draft";
    // 版本号跳过已占用的历史版本（含 void / superseded），避免 upsert 原地改写历史行。
    calendar.version = this.nextCalendarVersion(state.calendars.filter((item) => item.year === year), base.version);
    calendar.previousVersion = base.version;
    calendar.publishedAt = undefined;
    calendar.publishedBy = undefined;
    calendar.supersededAt = undefined;
    calendar.changeReason = undefined;
    calendar.publishDiff = undefined;
    return calendar;
  }

  /** 范围字段的准入校验：至少选择一个字段；数值与时点合法（需求 4.5.9：只修改明确选择的字段）。 */
  private assertRangeFields(fields: RentalCalendarRangeFields) {
    const provided = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (!provided.length) throw new BadRequestException("范围覆盖必须至少选择一个要设置的字段");
    if (fields.pricingOverrideRef !== undefined && !fields.pricingOverrideRef.trim()) throw new BadRequestException("一次性价格引用不能为空白");
    if (fields.name !== undefined && !fields.name.trim()) throw new BadRequestException("节日或调休名称不能为空白");
    if (fields.hours) {
      // 时段合法性按范围起点校验即可：周内星期只影响每周模板兜底判定，时段自身的
      // 起止/重叠/包含关系与日期无关（businessHoursError 的 label 只用于错误文案）。
      const hoursError = businessHoursError(fields.hours, fields.hours.windows?.length ? "范围覆盖时段" : "范围覆盖时段");
      if (hoursError) throw new BadRequestException(hoursError);
    }
  }

  /**
   * 「限时营业」必须真的限时（需求 4.5.4），范围覆盖逐日校验：
   * 结果日（新时段或既有时段）与每周模板任一有窗口即可，否则 400。
   */
  private assertRangeLimitedHasHours(
    context: BusinessContext,
    result: { businessStatus?: RentalCalendarBusinessStatus; hours?: RentalBusinessHours },
    date: string
  ) {
    if ((result.businessStatus ?? undefined) !== "limited") return;
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const weekly = context.settings.calendar.weeklyHours?.[weekday];
    if (!result.hours?.windows?.length && !weekly?.windows?.length) {
      throw new BadRequestException(
        `${date}：限时营业必须配置营业时段（本日期时段或每周默认营业时段至少其一）`
      );
    }
  }

  private assertBatchId(batchId?: string): string {
    if (batchId === undefined) return uid("calbatch");
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(batchId)) throw new BadRequestException("批次标识只能是 1-64 位字母数字与 . _ : -");
    return batchId;
  }

  /** 范围覆盖预览（需求 4.5.9）。纯推演：不写状态、不推进 revision、不产生审计。 */
  async previewCalendarRangeOverride(
    tenantId: string,
    context: BusinessContext,
    year: number,
    input: PreviewRentalCalendarRangeOverrideRequest
  ): Promise<RentalCalendarRangeOverridePreview> {
    const dates = expandCalendarRange(year, input.startDate, input.endDate);
    assertRangeDateTimeScope(input.startDate, input.endDate, input.startDateTime, input.endDateTime, context.settings.calendar.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE);
    this.assertRangeFields(input.fields);
    const base = this.editableCalendar(tenantId, context, year);
    const templateByDate = new Map(this.buildCalendar(tenantId, context.settings, year).days.map((day) => [day.date, day]));
    const byDate = new Map(base.days.map((day) => [day.date, day]));
    const days: RentalCalendarRangePreviewRow[] = dates.map((date) => {
      const current = byDate.get(date);
      const baseDay =
        current && current.source !== "tenant_override"
          ? current
          : templateByDate.get(date) ?? current ?? this.buildCalendar(tenantId, context.settings, year).days[0];
      // 基础值 = 下一优先级来源（有覆盖用 overriddenFrom，否则就是当前基础日）。
      const baseValue = current?.source === "tenant_override" && current.overriddenFrom
        ? { ...current.overriddenFrom, date }
        : baseDay;
      const after = applyRangeFieldsToDay(current, baseDay, input.fields, {
        kind: dates.length === 1 && !input.startDateTime ? "single" : "range",
        batchId: "preview",
        rangeStart: input.startDate,
        rangeEnd: input.endDate,
        startDateTime: input.startDateTime,
        endDateTime: input.endDateTime
      }, { reason: "preview", at: stamp() });
      const currentSnapshot = RentalBusinessService.daySnapshot(current ?? baseDay);
      const afterSnapshot = RentalBusinessService.daySnapshot(after);
      return {
        date,
        conflict: current?.source === "tenant_override",
        base: RentalBusinessService.daySnapshot(baseValue),
        current: currentSnapshot,
        after: afterSnapshot,
        changedFields: changedFieldNames(currentSnapshot, afterSnapshot)
      };
    });
    return {
      year,
      version: base.version,
      startDate: input.startDate,
      endDate: input.endDate,
      totalDays: days.length,
      conflictCount: days.filter((row) => row.conflict).length,
      days
    };
  }

  /**
   * 应用范围覆盖（需求 4.5.9）。
   *
   * 原子性由结构保证：全部日期在一次 `writeCalendar`（即一次库事务、一次 revision 推进、
   * 一批审计行）内写入，不存在"部分日期已保存"的中间状态；并发冲突由 expectedRevision
   * 预检与 upsertCalendar 的条件更新共同拦截，返回明确 409。
   * 既有覆盖必须经 `overrideConfirmed` 显式确认——预览展示冲突后由用户确认，绝不静默覆盖。
   */
  async applyCalendarRangeOverride(
    tenantId: string,
    context: BusinessContext,
    year: number,
    input: ApplyRentalCalendarRangeOverrideRequest,
    operator?: string
  ): Promise<ApplyRentalCalendarRangeOverrideResult> {
    const dates = expandCalendarRange(year, input.startDate, input.endDate);
    assertRangeDateTimeScope(input.startDate, input.endDate, input.startDateTime, input.endDateTime, context.settings.calendar.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE);
    this.assertRangeFields(input.fields);
    const reason = input.overrideReason?.trim();
    if (!reason) throw new BadRequestException("人工覆盖必须填写调整原因");
    const batchId = this.assertBatchId(input.batchId);
    const state = this.state(tenantId, context);
    const base = this.editableCalendar(tenantId, context, year);
    // 乐观并发预检：与 writeCalendar 的条件更新是两道防线，这里先给出更可读的 409。
    if (input.expectedRevision !== undefined && input.expectedRevision !== (base.revision ?? 0)) {
      throw new ConflictException(
        `${year} 年度日历已被其他人修改（当前版本 ${base.revision ?? 0}，你基于 ${input.expectedRevision}），请刷新后重试`
      );
    }
    const templateByDate = new Map(this.buildCalendar(tenantId, context.settings, year).days.map((day) => [day.date, day]));
    const byDate = new Map(base.days.map((day) => [day.date, day]));
    const conflicts = dates.filter((date) => byDate.get(date)?.source === "tenant_override");
    if (conflicts.length && !input.overrideConfirmed) {
      throw new ConflictException(
        `范围内有 ${conflicts.length} 天已存在人工覆盖（${conflicts.slice(0, 8).join("、")}${conflicts.length > 8 ? "…" : ""}），` +
          "请先预览确认后携带 overrideConfirmed 重试，不得静默覆盖"
      );
    }
    const calendar = this.cloneCalendarForEdit(state, base, year);
    const at = stamp();
    const scope: RentalCalendarOverrideScope = {
      kind: dates.length === 1 && !input.startDateTime ? "single" : "range",
      batchId,
      rangeStart: input.startDate,
      rangeEnd: input.endDate,
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime
    };
    const audits: RentalCalendarOverrideAudit[] = [];
    for (const date of dates) {
      const replaced = byDate.get(date);
      const baseDay =
        replaced && replaced.source !== "tenant_override"
          ? replaced
          : templateByDate.get(date) ?? this.buildCalendar(tenantId, context.settings, year).days[0];
      const after = applyRangeFieldsToDay(replaced, baseDay, input.fields, scope, { reason, operator, at });
      this.assertRangeLimitedHasHours(context, after, date);
      const index = calendar.days.findIndex((item) => item.date === date);
      if (index >= 0) calendar.days[index] = after; else calendar.days.push(after);
      audits.push(
        RentalBusinessService.pendingAudit(calendar, {
          date,
          action: "override",
          reason,
          operator,
          at,
          batchId,
          before: replaced ? RentalBusinessService.daySnapshot(replaced) : undefined,
          after: RentalBusinessService.daySnapshot(after)
        })
      );
    }
    calendar.days.sort((a, b) => a.date.localeCompare(b.date));
    await this.writeCalendar(state, base, calendar, audits);
    return { batchId, year, version: calendar.version, revision: calendar.revision ?? 0, appliedCount: dates.length };
  }

  /** 范围移除预览（需求 4.5.9：移除前展示恢复后的日期类型、营业状态和引用变化）。 */
  async previewCalendarRangeRemove(
    tenantId: string,
    context: BusinessContext,
    year: number,
    input: PreviewRentalCalendarRangeRemoveRequest
  ): Promise<RentalCalendarRangeRemovePreview> {
    const dates = expandCalendarRange(year, input.startDate, input.endDate);
    const base = this.editableCalendar(tenantId, context, year);
    const templateByDate = new Map(this.buildCalendar(tenantId, context.settings, year).days.map((day) => [day.date, day]));
    const byDate = new Map(base.days.map((day) => [day.date, day]));
    const days: RentalCalendarRangeRemovePreviewRow[] = dates.map((date) => {
      const current = byDate.get(date) ?? templateByDate.get(date)!;
      const hasOverride = current.source === "tenant_override";
      const { day: restored } = hasOverride
        ? deriveRestoredDay(current, templateByDate.get(date))
        : { day: current };
      return {
        date,
        hasOverride,
        current: RentalBusinessService.daySnapshot(current),
        restored: RentalBusinessService.daySnapshot(restored),
        restoredSource: hasOverride ? (restored.source === "official_cn" ? "official_cn" : "week_rule") : (current.source === "official_cn" ? "official_cn" : "week_rule")
      };
    });
    return {
      year,
      version: base.version,
      startDate: input.startDate,
      endDate: input.endDate,
      totalDays: days.length,
      overrideCount: days.filter((row) => row.hasOverride).length,
      days
    };
  }

  /**
   * 应用范围移除：只移除范围内带人工覆盖的日期（其余保持原样，不算失败），
   * 恢复到 `overriddenFrom` 或按当前每周模板重算——绝不产生空白日或恢复成过期快照
   * （需求 4.5.3/4.5.9）。同一事务、一次 revision、审计带批次号。
   */
  async applyCalendarRangeRemove(
    tenantId: string,
    context: BusinessContext,
    year: number,
    input: ApplyRentalCalendarRangeRemoveRequest,
    operator?: string
  ): Promise<ApplyRentalCalendarRangeRemoveResult> {
    const dates = expandCalendarRange(year, input.startDate, input.endDate);
    const reason = input.overrideReason?.trim();
    if (!reason) throw new BadRequestException("移除人工覆盖必须填写调整原因");
    const batchId = this.assertBatchId(input.batchId);
    const state = this.state(tenantId, context);
    const base = this.editableCalendar(tenantId, context, year);
    if (input.expectedRevision !== undefined && input.expectedRevision !== (base.revision ?? 0)) {
      throw new ConflictException(
        `${year} 年度日历已被其他人修改（当前版本 ${base.revision ?? 0}，你基于 ${input.expectedRevision}），请刷新后重试`
      );
    }
    const templateByDate = new Map(this.buildCalendar(tenantId, context.settings, year).days.map((day) => [day.date, day]));
    const byDate = new Map(base.days.map((day) => [day.date, day]));
    const removable = dates.filter((date) => byDate.get(date)?.source === "tenant_override");
    if (!removable.length) {
      throw new ConflictException("范围内没有人工覆盖可移除");
    }
    const calendar = this.cloneCalendarForEdit(state, base, year);
    const at = stamp();
    const audits: RentalCalendarOverrideAudit[] = [];
    for (const date of removable) {
      const target = byDate.get(date)!;
      const { day: restored } = deriveRestoredDay(target, templateByDate.get(date));
      const index = calendar.days.findIndex((item) => item.date === date);
      calendar.days.splice(index, 1, restored);
      audits.push(
        RentalBusinessService.pendingAudit(calendar, {
          date,
          action: "revert",
          reason,
          operator,
          at,
          batchId,
          before: RentalBusinessService.daySnapshot(target),
          after: RentalBusinessService.daySnapshot(restored)
        })
      );
    }
    await this.writeCalendar(state, base, calendar, audits);
    return {
      batchId,
      year,
      version: calendar.version,
      revision: calendar.revision ?? 0,
      removedCount: removable.length,
      unchangedCount: dates.length - removable.length
    };
  }

  /**
   * 发布年度日历：草稿转已发布，同时把原已发布版本标记为「已被替代」。
   *
   * 需求 4.5.7 要求每个经营空间每个年度只能有一个当前使用的已发布版本，
   * 且历史版本不得被删除或原地改回——因此这里是「新版本置 published +
   * 旧版本置 superseded」两步。两步必须在同一个事务里：早前是两次独立 upsert，
   * 第二次失败就会留下**两个 published 版本**，而报价按版本号取最大的那个，
   * 等于旧口径被静默弃用却没有任何替代记录；反序写又会留下"没有已发布日历"的空窗。
   */
  async publishCalendar(
    tenantId: string,
    context: BusinessContext,
    year: number,
    input: PublishRentalCalendarRequest,
    operator?: string
  ) {
    const state = this.state(tenantId, context);
    const draft = this.editableCalendar(tenantId, context, year);
    // 只有当草稿**确实引用了官方日历数据**（存在 official_cn 来源的日期）时，才要求登记官方来源。
    // 早前用「region 是 CN」判定，而任何新年度的 region 都取 settings 默认 "CN"，于是 CN 空间
    // 想提前发布一个只含人工覆盖（如装修停业）的未来年度日历会被卡住，停业覆盖进不了报价路径，
    // 客户仍能在停业当天下单——与 4.5.3/4.5.4 冲突。纯人工覆盖的未来年度允许发布。
    if (draft.region === "CN" && draft.days.some((day) => day.source === "official_cn") && !draft.sourceName) {
      throw new ConflictException("引用了官方节假日的中国大陆日历，发布前必须登记官方来源");
    }
    const changeReason = input?.changeReason?.trim();
    if (!changeReason) throw new BadRequestException("发布年度日历必须填写变更原因");
    const previous = this.publishedCalendar(tenantId, context, year);
    const calendar = structuredClone(draft);
    if (calendar.status === "published") return calendar;
    calendar.status = "published";
    calendar.publishedAt = stamp();
    calendar.publishedBy = operator;
    calendar.changeReason = changeReason;
    const replacing = previous && previous.version !== calendar.version ? previous : undefined;
    if (replacing) calendar.previousVersion = replacing.version;
    // 差异在发布时算好存下：事后重算要求被替代的旧版本仍在库里且能被定位，
    // 而报价追溯往往只拿到一个版本号。首个版本没有可比对象，此时 added 为全年日期
    // 没有信息量，因此留空。
    calendar.publishDiff = replacing ? calendarDiff(replacing.days, calendar.days) : undefined;
    const superseded = replacing
      ? { ...structuredClone(replacing), status: "superseded" as const, supersededAt: stamp() }
      : undefined;
    // 发布同样走乐观锁：两人同时发布同一年度时，后者的条件更新会失败并得到 409，
    // 而不是两次都成功、留下两个 published 版本。
    calendar.revision = (draft.revision ?? 0) + 1;
    if (superseded) superseded.revision = (replacing?.revision ?? 0) + 1;
    await this.configStore.publishCalendarVersion(calendar, superseded, {
      next: draft.revision ?? 0,
      superseded: replacing?.revision ?? 0
    });
    this.cacheCalendar(state, calendar);
    if (superseded) this.cacheCalendar(state, superseded);
    return calendar;
  }

  /**
   * 作废年度日历草稿（需求 4.5.7「已作废：人工废弃的草稿或错误版本」）。
   *
   * 只有草稿可作废，且理由必填：
   * - 已发布版本不走作废——纠错的正解是发布一版新的把它替代（`superseded`），
   *   直接作废唯一的已发布版本会让该年度回落到周模板且没有替代记录可追溯；
   * - 已被替代版本必须保留：历史报价的 `calendarVersion` 指向它，作废等于抹掉追溯依据。
   *
   * 作废是单行状态变更，用 `upsertCalendar` 即可，不涉及发布那种"两行必须原子"的约束。
   */
  /**
   * 以某个历史版本的内容生成新草稿（需求 4.5.7：「恢复旧规则也必须以旧内容生成新的
   * 发布版本，不得删除新版本或把旧版本原地改回」）。
   *
   * 只产生草稿：后续仍走发布前预检 → 填写变更原因 → 发布这条正路。被恢复的历史版本
   * 与当前已发布版本都不做任何改动——这正是「不得原地改回」的执行点。
   */
  async restoreCalendarVersion(
    tenantId: string,
    context: BusinessContext,
    year: number,
    version: string,
    input: RestoreRentalCalendarVersionRequest
  ) {
    const state = this.state(tenantId, context);
    const source = state.calendars.find((item) => item.year === year && item.version === version);
    if (!source) throw new NotFoundException("指定的年度日历版本不存在");
    const reason = input?.reason?.trim();
    if (!reason) throw new BadRequestException("恢复历史版本必须填写原因");
    const base = this.editableCalendar(tenantId, context, year);
    if (base.version === version) {
      throw new ConflictException("该版本就是当前正在编辑的版本，无需恢复");
    }
    // 存在未发布草稿时必须先处理，不能再生成第二个草稿：恢复无条件新建草稿，
    // 若该年度已有草稿 v3，恢复出的 v4 发布后 v3 仍是草稿，editableCalendar 会重新选中 v3，
    // 让已被放弃的旧修改再次进入发布路径。要求先发布或作废现有草稿，保证同年度只有一个有效草稿。
    const existingDraft = state.calendars.find((item) => item.year === year && item.status === "draft");
    if (existingDraft) {
      throw new ConflictException(
        `${year} 年度存在未发布草稿（v${existingDraft.version}），请先发布或作废后再恢复历史版本，避免同时存在两个草稿`
      );
    }
    const restored = structuredClone(source);
    restored.status = "draft";
    // 版本号跳过全部已占用号（含 void / superseded），否则 upsert 会原地改写历史行。
    restored.version = this.nextCalendarVersion(
      state.calendars.filter((item) => item.year === year),
      base.version
    );
    restored.previousVersion = base.version;
    restored.restoredFromVersion = version;
    restored.restoreReason = reason;
    // 新草稿从未发布过：不能继承被恢复版本的发布记录与差异，否则版本历史会把两次
    // 完全不同的发布事件混在一起。
    restored.publishedAt = undefined;
    restored.publishedBy = undefined;
    restored.supersededAt = undefined;
    restored.changeReason = undefined;
    restored.publishDiff = undefined;
    restored.voidedAt = undefined;
    restored.voidedBy = undefined;
    restored.voidReason = undefined;
    restored.importPreservedOverrides = undefined;
    await this.writeCalendar(state, base, restored);
    return restored;
  }

  async voidCalendarVersion(
    tenantId: string,
    context: BusinessContext,
    year: number,
    version: string,
    input: VoidRentalCalendarRequest,
    operator?: string
  ) {
    const state = this.state(tenantId, context);
    const target = state.calendars.find((item) => item.year === year && item.version === version);
    if (!target) throw new NotFoundException("指定的年度日历版本不存在");
    const reason = input?.reason?.trim();
    if (!reason) throw new BadRequestException("作废年度日历必须填写原因");
    if (target.status !== "draft") {
      throw new ConflictException(
        "只能作废草稿版本：已发布版本请发布新版本替代，已被替代版本须保留以供历史报价追溯"
      );
    }
    const voided = structuredClone(target);
    voided.status = "void";
    voided.voidedAt = stamp();
    voided.voidedBy = operator;
    voided.voidReason = reason;
    await this.writeCalendar(state, target, voided);
    return voided;
  }

  /**
   * 年度日历的全部版本**摘要**（需求 4.5.7/4.5.8：历史版本与审计可查询、可追溯）。
   *
   * 只回元数据与计数，不回逐日与审计明细：早前直接返回领域对象，于是每个版本都带上
   * 全年 365 条日期与全部覆盖审计，版本一多响应体就膨胀到不可用。逐日、发布差异
   * 与审计明细由 `getCalendarVersion` 按需返回。
   */
  async listCalendarVersions(
    tenantId: string,
    context: BusinessContext,
    year: number
  ): Promise<RentalCalendarVersionSummary[]> {
    // 审计条数来自独立表的分组计数，不把明细拉进内存。
    const auditCounts = await this.configStore.countCalendarOverrideAudits(tenantId, year);
    return this.state(tenantId, context).calendars
      .filter((item) => item.year === year)
      .sort((left, right) => compareVersions(right.version, left.version))
      .map((item) => {
        const { days, overrideAudits: _audits, publishDiff, ...rest } = item;
        return {
          ...rest,
          dayCount: days.length,
          overrideCount: days.filter((day) => day.source === "tenant_override").length,
          overrideAuditCount: auditCounts[item.version] ?? 0,
          publishDiffCounts: publishDiff
            ? {
                added: publishDiff.added.length,
                removed: publishDiff.removed.length,
                changed: publishDiff.changed.length
              }
            : undefined
        };
      });
  }

  /**
   * 发布前影响预览（需求 4.5.8）。
   *
   * 纯只读推演：不写任何状态，也不触碰未来订单——需求明确「存在未来订单时必须提示，
   * 但不得直接改变这些订单」，处置由发布人决定。
   *
   * 逐日差异按**取值**比较而不是整行比较：`overrideBy`/`overrideAt` 每次保存都会变，
   * 按整行比会把「只是重新保存了一遍」也算成变更，预览列表就失去筛选价值。
   */
  previewCalendarPublish(
    tenantId: string,
    context: BusinessContext,
    year: number,
    orders: Array<{ id: string; orderNo: string; status: string; startAt: string; endAt: string }>
  ): RentalCalendarPublishPreview {
    const draft = this.editableCalendar(tenantId, context, year);
    const published = this.publishedCalendar(tenantId, context, year);
    const replacing = published && published.version !== draft.version ? published : undefined;
    // 首次发布也必须给出受影响日期。早前 `replacing` 为空时直接返回空差异，于是首发一份
    // 含停业日、限时营业或特殊价格的日历时 `dates` 为空、未来订单一条都匹配不上，
    // 与需求 4.5.8「发布前展示受影响日期，存在未来订单时必须提示」直接冲突。
    //
    // 基准不能用「空日历」（那会把全年 365 天都列成变更，没有筛选价值），
    // 而是用**同一份每周默认模板**生成的基准年历：与它的差异恰好就是这次发布真正带来的
    // 业务变化——人工覆盖、官方节假日、停业/限时、特殊价格系数。
    const baseline = replacing ?? this.buildCalendar(tenantId, context.settings, year);
    const diff = calendarDiff(baseline.days, draft.days);
    const beforeByDate = new Map(baseline.days.map((day) => [day.date, day]));
    const afterByDate = new Map(draft.days.map((day) => [day.date, day]));

    const dates: RentalCalendarPublishPreviewDate[] = [];
    const closureChanges: string[] = [];
    const hoursChanges: string[] = [];
    const pricingChanges: string[] = [];
    for (const date of [...diff.added, ...diff.changed, ...diff.removed].sort()) {
      const before = beforeByDate.get(date);
      const after = afterByDate.get(date);
      const change: RentalCalendarPublishPreviewDate["change"] = !before
        ? "added"
        : !after
          ? "removed"
          : "changed";
      const changedFields: RentalCalendarPublishPreviewDate["changedFields"] = [];
      if (before && after) {
        if (before.dayType !== after.dayType) changedFields.push("dayType");
        if (before.name !== after.name) changedFields.push("name");
        if ((before.businessStatus ?? "") !== (after.businessStatus ?? "")) changedFields.push("businessStatus");
        if (before.closed !== after.closed) changedFields.push("closed");
        if (businessHoursSignature(before.hours) !== businessHoursSignature(after.hours)) changedFields.push("hours");
        if (before.pricingMultiplier !== after.pricingMultiplier) changedFields.push("pricingMultiplier");
        if (before.pricingOverrideRef !== after.pricingOverrideRef) changedFields.push("pricingOverrideRef");
        if (before.source !== after.source) changedFields.push("source");
      }
      if (changedFields.includes("businessStatus") || changedFields.includes("closed") || change !== "changed") {
        closureChanges.push(date);
      }
      if (changedFields.includes("hours")) hoursChanges.push(date);
      if (changedFields.includes("pricingMultiplier") || changedFields.includes("pricingOverrideRef")) pricingChanges.push(date);
      dates.push({
        date,
        change,
        before: before ? RentalBusinessService.daySnapshot(before) : undefined,
        after: after ? RentalBusinessService.daySnapshot(after) : undefined,
        changedFields
      });
    }

    // 未来订单：租期与受影响日期有重叠、且尚未走完的订单。按营业时区切日期键，
    // 与日历同一口径——用 UTC 会在跨日边界把订单算进或漏掉一天。
    const timeZone = context.settings.calendar.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
    const affected = new Set(dates.map((item) => item.date));
    const closedStatuses = new Set(["completed", "closed", "cancelled"]);
    const now = Date.now();
    const futureOrders: RentalCalendarPublishPreviewOrder[] = [];
    for (const order of orders) {
      if (closedStatuses.has(order.status)) continue;
      if (new Date(order.endAt).getTime() < now) continue;
      const overlap: string[] = [];
      for (let cursor = businessDayIndex(order.startAt, timeZone); cursor <= businessDayIndex(order.endAt, timeZone); cursor += 1) {
        const key = businessDateKeyFromIndex(cursor);
        if (affected.has(key)) overlap.push(key);
      }
      if (overlap.length) {
        futureOrders.push({
          orderId: order.id,
          orderNo: order.orderNo,
          status: order.status,
          startAt: order.startAt,
          endAt: order.endAt,
          affectedDates: overlap
        });
      }
    }

    return {
      year,
      draftVersion: draft.version,
      publishedVersion: published?.version,
      firstPublish: !replacing,
      diff,
      dates,
      closureChanges,
      hoursChanges,
      pricingChanges,
      futureOrders,
      officialSourceConfirmed:
        Boolean(draft.sourceName) && draft.days.some((day) => day.source === "official_cn")
    };
  }

  /**
   * 某年度的人工覆盖审计流水（需求 4.5.3/4.5.8）。**不截断**：审计在独立的只追加表里，
   * 早前挂在年度日历 JSON 上时只能保留最近 500 条，最早记录被静默删除。
   */
  listCalendarOverrideAudits(tenantId: string, _context: BusinessContext, year: number, version?: string) {
    return this.configStore.loadCalendarOverrideAudits(tenantId, year, version);
  }

  /**
   * 单个年度日历版本的完整内容（含逐日、`publishDiff` 发布差异与 `overrideAudits` 覆盖审计）。
   * 供「查看历史版本、差异详情、完整追溯」——只读，不改任何状态。
   */
  async getCalendarVersion(tenantId: string, context: BusinessContext, year: number, version: string) {
    const found = this.state(tenantId, context).calendars.find(
      (item) => item.year === year && item.version === version
    );
    if (!found) throw new NotFoundException("指定的年度日历版本不存在");
    // 审计按版本从独立表取回，不再随年度日历常驻内存。
    const overrideAudits = await this.configStore.loadCalendarOverrideAudits(tenantId, year, version);
    return { ...found, overrideAudits };
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
  async claimCoupon(
    tenantId: string,
    context: BusinessContext,
    templateId: string,
    customerId: string,
    tx?: RentalBusinessFactTx
  ): Promise<{ coupon: RentalCustomerCoupon; template: RentalCouponTemplate }> {
    if (!tx && this.prisma && (process.env.PLATFORM_DATA_SOURCE ?? "mysql").toLowerCase() === "mysql") {
      const result = await this.prisma.$transaction((transaction) =>
        this.claimCoupon(tenantId, context, templateId, customerId, transaction)
      );
      this.applyCouponClaimToCache(tenantId, context, result.coupon, result.template);
      return result;
    }
    const state = this.state(tenantId, context);
    const template = tx
      ? await this.coreConfigStore.lockCouponTemplateForClaim(tenantId, templateId, tx)
      : context.couponTemplates.find((item) => item.id === templateId && item.status === "enabled");
    if (!template) throw new NotFoundException("优惠券模板不存在或未启用");
    // 锁行只保证配额读写串行，不代表模板仍可投放。运营可能在领取请求
    // 等待行锁期间把模板停用；事务路径必须与内存路径使用同一准入规则。
    if (template.status !== "enabled") throw new NotFoundException("优惠券模板不存在或未启用");
    const now = Date.now();
    if (now < new Date(template.effectiveFrom).getTime() || now > new Date(template.effectiveTo).getTime()) throw new ConflictException("优惠券不在可领取有效期");
    if (template.claimedQuantity >= template.totalQuota) throw new ConflictException("优惠券已领完");
    const customerClaimCount = tx
      ? await this.factStore.countCustomerCoupons(tenantId, templateId, customerId, tx)
      : state.customerCoupons.filter((item) => item.templateId === templateId && item.customerId === customerId && item.status !== "void").length;
    if (customerClaimCount >= template.perCustomerLimit) throw new ConflictException("已达到每客限领数量");
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

  /** 订单确认事务内核销；提交后由 refreshFromDatabase 统一发布缓存。 */
  async redeemCouponInTransaction(tenantId: string, orderId: string, tx: RentalBusinessFactTx) {
    const result = await this.factStore.redeemCouponForOrder(tenantId, orderId, stamp(), tx);
    if (result === "invalid") throw new ConflictException("订单优惠券已不在锁定状态，不能确认订单");
  }

  async releaseCoupon(tenantId: string, context: BusinessContext, orderId: string) {
    const coupon = this.state(tenantId, context).customerCoupons.find((item) => item.lockedOrderId === orderId || item.redeemedOrderId === orderId);
    if (!coupon) return undefined;
    coupon.status = "claimed"; coupon.lockedOrderId = undefined; coupon.lockedAt = undefined;
    coupon.redeemedOrderId = undefined; coupon.redeemedAt = undefined; coupon.releasedAt = stamp();
    await this.factStore.upsertCustomerCoupon(coupon);
    return coupon;
  }

  /** 订单取消事务内释放；避免订单已取消而券释放失败的半完成状态。 */
  async releaseCouponInTransaction(tenantId: string, orderId: string, tx: RentalBusinessFactTx) {
    await this.factStore.releaseCouponForOrder(tenantId, orderId, stamp(), tx);
  }

  listRewards(tenantId: string, context: BusinessContext, customerId?: string) {
    return this.state(tenantId, context).rewardLedger.filter((row) => !customerId || row.customerId === customerId);
  }

  listBenefitAccounts(tenantId: string, context: BusinessContext, customerId?: string) {
    return this.state(tenantId, context).benefitAccounts.filter((row) => !customerId || row.customerId === customerId);
  }

  async grantReward(
    tenantId: string,
    context: BusinessContext,
    input: GrantRentalRewardRequest,
    tx?: RentalBusinessFactTx,
    /** MySQL 事务使用隔离副本；提交成功后再用数据库事实刷新共享缓存。 */
    workingState?: RentalBusinessState
  ): Promise<RentalRewardLedgerEntry[]> {
    if (!tx && this.prisma && (process.env.PLATFORM_DATA_SOURCE ?? "mysql").toLowerCase() === "mysql") {
      const state = this.state(tenantId, context);
      // 不能把事务中的余额、奖励券和配额直接写进进程共享缓存：在 commit 前
      // 其他请求能读到未提交数据，而失败后用旧快照恢复又会抹掉并发成功写入。
      const transactionState = structuredClone(state);
      const transactionContext: BusinessContext = {
        ...context,
        couponTemplates: structuredClone(context.couponTemplates)
      };
      try {
        const result = await this.prisma.$transaction((transaction) =>
          this.grantReward(tenantId, transactionContext, input, transaction, transactionState)
        );
        // 只在事务提交后从库重建缓存，绝不以事务开始前的快照回滚共享状态。
        await this.refreshFromDatabase();
        await this.refreshCouponTemplateCache(tenantId, context);
        return result;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const winner = await this.factStore.findRewardsByIdempotencyKey(tenantId, input.idempotencyKey);
          if (winner.length) {
            // 同键并发的落败者回放胜者；刷新来自数据库的缓存即可，不回滚
            // 或拼接任何请求开始时捕获的内存副本。
            await this.refreshFromDatabase();
            await this.refreshCouponTemplateCache(tenantId, context);
            return winner;
          }
        }
        throw error;
      }
    }
    const state = workingState ?? this.state(tenantId, context);
    if (!input.customerId || !input.idempotencyKey) throw new BadRequestException("客户和幂等键不能为空");
    // 判重以库为准，不靠内存 rewardLedger。
    //
    // 早前只查内存：库上虽有 (tenantId, idempotencyKey) 唯一约束，但那只会在写入时
    // 抛错，而不是幂等返回既有流水。缓存冷启动或多实例部署下，重复发放会变成 500。
    // 关掉内存判重跑 E2E 可复现——「重复发放应幂等返回既有流水」当场失败。
    const existing = await this.factStore.findRewardsByIdempotencyKey(tenantId, input.idempotencyKey, tx);
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
    const positivePlans = planned.filter((item) => item.amount > 0);
    if (tx) {
      // 不同幂等键也可能同时消耗同一奖励券模板；先按稳定顺序锁模板，
      // 再依据库中的最新配额和客户已领数量校验，不能只看冷缓存。
      const templateIds = [...new Set(positivePlans.filter((item) => item.type === "coupon").map((item) => item.couponTemplateId!).sort())];
      for (const templateId of templateIds) {
        const locked = await this.coreConfigStore.lockCouponTemplateForClaim(tenantId, templateId, tx);
        if (!locked) throw new NotFoundException("奖励优惠券模板不存在或未启用");
        const cached = context.couponTemplates.find((item) => item.id === templateId);
        if (cached) Object.assign(cached, locked);
        else context.couponTemplates.push(locked);
      }
    }
    await this.validateRewardBatch(tenantId, state, context, positivePlans, tx);
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
      for (const row of rows) await this.factStore.upsertRewardEntry(row, tx);
    } catch (error) {
      if (tx) throw error;
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
    for (const coupon of grantedCoupons) await this.factStore.upsertCustomerCoupon(coupon, tx);
    for (const template of touchedTemplates.values()) await this.coreConfigStore.upsertCouponTemplate(template, tx);
    // MySQL 事务不能用缓存中的绝对余额 upsert：两个不同幂等键并发时会互相覆盖。
    // 改为库侧原子增量；缓存只会在提交后由调用方重建。
    if (tx) await this.incrementRewardBenefitAccounts(tenantId, rows, tx);
    else await this.flushBenefitAccounts(state, rows.map((row) => row.customerId));
    return rows;
  }

  /** 奖励发放以数据库增量更新权益账户，避免不同幂等键并发时用旧缓存覆盖余额。 */
  private async incrementRewardBenefitAccounts(tenantId: string, rows: RentalRewardLedgerEntry[], tx: RentalBusinessFactTx) {
    const deltas = new Map<string, { points: number; marketing: number; rewardCoupons: number }>();
    for (const row of rows) {
      const delta = deltas.get(row.customerId) ?? { points: 0, marketing: 0, rewardCoupons: 0 };
      if (row.rewardType === "points") delta.points += row.amount;
      else if (row.rewardType === "balance") delta.marketing += row.amount;
      else delta.rewardCoupons += row.amount;
      deltas.set(row.customerId, delta);
    }
    for (const [customerId, delta] of deltas) await this.factStore.incrementBenefitAccount(tenantId, customerId, delta, tx);
  }

  /** 奖励会修改核心配置中的券模板配额；业务事实预热不拥有这份缓存，需在提交后单独同步。 */
  private async refreshCouponTemplateCache(tenantId: string, context: BusinessContext) {
    const workspaceId = this.workspaceOf(tenantId);
    const config = (await this.coreConfigStore.loadAll()).find((row) => row.workspaceId === workspaceId);
    if (config) context.couponTemplates.splice(0, context.couponTemplates.length, ...config.couponTemplates);
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

  /** 将订单完成奖励并入订单幂等事务，提交前不改共享缓存。 */
  async completeCustomerOrderEventInTransaction(tenantId: string, context: BusinessContext, customerId: string | undefined, tx: RentalBusinessFactTx) {
    if (!customerId) return [];
    const state = structuredClone(this.state(tenantId, context));
    const transactionContext: BusinessContext = { ...context, couponTemplates: structuredClone(context.couponTemplates) };
    const membership = transactionContext.settings.membership;
    const relation = state.referrals.find((row) => row.inviteeCustomerId === customerId);
    if (!relation || !membership.referralRewardEnabled || membership.referralTrigger !== "first_order_completed") return [];
    return this.grantReward(tenantId, transactionContext, {
      customerId: relation.referrerCustomerId,
      relatedCustomerId: customerId,
      triggerType: "first_order_completed",
      idempotencyKey: `referral:first_order_completed:${customerId}`
    }, tx, state);
  }

  /** 仅在外层事务成功返回后调用；所有运行期刷新按调用顺序串行发布。 */
  async refreshFromDatabase() {
    const next = this.refreshQueue.catch(() => undefined).then(() => this.onApplicationBootstrap());
    this.refreshQueue = next;
    await next;
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

  /**
   * 选出本次报价适用的价格计划。
   *
   * 早前只按 `status === "enabled"` 过滤，`effectiveFrom` / `effectiveTo` 存了却从不判断：
   * 有效期已过的计划照样给新报价定价，未生效的计划也会被提前使用——两者都直接算错钱。
   * 需求 4.4 明确要求「发布版本、有效期、优先级、冲突校验」。
   *
   * 未指定计划时的择一规则：**生效时间最晚的胜出**，同刻再按版本、编码排序。
   * 早前是 `find()` 取数组第一个，结果取决于装载顺序，同样的输入换次重启就可能换个价——
   * 那与"相同输入可复算"直接冲突。这里不引入新的 priority 字段，
   * 「最近生效的覆盖较早的」本身就是可解释的优先级口径。
   */
  private resolvePricingPlan(
    plans: RentalPricingPlanV1[],
    requestedId: string | undefined,
    itemGroupIds: string[],
    rentalStartAt: string
  ) {
    // 需求 4.4.4：「价格版本按**租期开始时间**匹配，而不是按报价创建时间匹配；
    // 未来租期必须使用覆盖该租期开始时点的已发布价格版本。」
    //
    // 早前用 `Date.now()`，正是需求点名不要的口径：为下个月的租期报价会按今天的
    // 价格版本算，而下月生效的新价格明明已经发布。改按租期开始时刻判定后，
    // 「今天为下月报价」与「下月当天报价」得到同一个版本，这也是可复算的前提。
    const at = new Date(rentalStartAt).getTime();
    const effective = (plan: RentalPricingPlanV1) =>
      plan.status === "enabled" &&
      new Date(plan.effectiveFrom).getTime() <= at &&
      (plan.effectiveTo === undefined || new Date(plan.effectiveTo).getTime() >= at);
    // 适用范围（需求 4.4）：计划必须覆盖本次报价的每个商品组，否则它对这张报价不适用。
    const covers = (plan: RentalPricingPlanV1) =>
      itemGroupIds.every((groupId) => plan.rates.some((rate) => rate.itemGroupId === groupId));

    if (requestedId) {
      const requested = plans.find((plan) => plan.id === requestedId);
      if (!requested) throw new NotFoundException("指定的定价计划不存在");
      if (requested.status !== "enabled") throw new ConflictException("指定的定价计划未启用");
      // 明确报错而不是静默换一个计划：调用方指名了计划，替它挑别的会让报价无从解释。
      if (!effective(requested)) throw new ConflictException("指定的定价计划在该租期开始时点不生效");
      return requested;
    }

    // 只在**覆盖全部商品组**的计划里择一。早前是 `find()` 取第一个已启用计划，
    // 于是多计划租户常常拿到一个不含所需商品组的计划，报出"尚未配置基础价格"，
    // 而真正可用的计划就在后面。
    const candidates = plans.filter((plan) => effective(plan) && covers(plan)).sort((left, right) => {
      const byEffective = new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime();
      if (byEffective !== 0) return byEffective;
      // 版本号必须按段取数值比较：`localeCompare` 下 "1.10" < "1.9"，第十次调价会被当成
      // 比第九次旧的版本而落选。同刻生效时最终由 code 兜底，保证结果稳定可复算。
      const byVersion = compareVersions(right.version, left.version);
      return byVersion !== 0 ? byVersion : left.code.localeCompare(right.code);
    });
    if (!candidates.length) {
      throw new ConflictException("当前经营空间没有覆盖所选商品、且在该租期开始时点生效的已启用定价计划");
    }
    // 报价阶段不该在多个候选里"择一"：需求要求同一空间、同一商品、同一计价单位在任一
    // 时点只有唯一生效价格。真正的收口是保存时就拒绝重叠（见 assertNoOverlappingPricingPlan），
    // 这里保留确定性排序只是为了让存量重叠数据仍能得到稳定且可解释的结果。
    return candidates[0];
  }

  private validatedFulfillmentFees(fees: NonNullable<SaveRentalPricingPlanRequest["fulfillmentFees"]>) {
    const seen = new Set<string>();
    for (const fee of fees) {
      if (seen.has(fee.mode)) throw new BadRequestException(`履约方式 ${fee.mode} 的履约费配置重复`);
      seen.add(fee.mode);
      for (const value of [fee.amount, fee.crossLocationAmount ?? 0]) {
        if (!Number.isFinite(value) || value < 0) throw new BadRequestException("履约费与异地归还附加费必须是非负数");
      }
    }
    return fees.map((fee) => ({ ...fee }));
  }

  async createQuote(tenantId: string, context: BusinessContext, input: RentalQuoteRequest) {
    const state = this.state(tenantId, context);
    // 正式经营门禁：缺品类必选能力的 production 空间不得出新报价（Review P1-4）。
    if (this.capabilities) await this.capabilities.assertWorkspaceOperable(tenantId, this.workspaceOf(tenantId));
    if (new Date(input.startAt).getTime() >= new Date(input.endAt).getTime()) throw new BadRequestException("租赁结束时间必须晚于开始时间");
    if (!input.lines.length) throw new BadRequestException("报价至少需要一个商品");
    if (new Set(input.lines.map((line) => line.itemGroupId)).size !== input.lines.length) throw new BadRequestException("同一商品在一次报价中只能出现一行");
    if (!context.settings.fulfillment.enabledModes.includes(input.fulfillmentMode)) throw new BadRequestException("当前租户未启用所选租赁履约方式");
    if (input.returnLocationId && input.returnLocationId !== input.fulfillmentLocationId && !context.settings.fulfillment.allowDifferentReturnLocation) throw new BadRequestException("当前租户未启用异地归还");
    this.validateFulfillmentLocations(context, input);
    const plan = this.resolvePricingPlan(
      state.pricingPlans,
      input.pricingPlanId,
      input.lines.map((line) => line.itemGroupId),
      input.startAt
    );
    // PRICE-03：费率取自**不可变价格版本**（按租期开始时点命中的最新版本），
    // 而不是计划行的当前值——计划行只是编辑工作区，版本链才是生效事实。
    const spaceVersion = await this.resolveSpaceRates(tenantId, context, input.startAt);
    const planRates: RentalPricingRate[] = spaceVersion.rates;
    const calendars = this.calendarsForDateRange(tenantId, context, input.startAt, input.endAt);
    // 停业只拦领取与归还时点，不拦租期跨过（需求 4.5.4）。
    this.assertFulfillmentDayOpen(
      tenantId,
      context,
      input,
      context.settings.calendar.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE,
      context.settings
    );
    const rule = this.currentRule(tenantId, context);
    if (!rule || rule.status !== "published") throw new ConflictException("当前租户没有已发布的租赁规则");
    // 营业时区解析一次，策略（自然日/夜）与日历（日期类型）必须用同一个值，
    // 否则同一张报价里两处按不同日界切分，金额与说明会互相矛盾。
    const quoteTimeZone = context.settings.calendar.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
    const groups = new Map(context.groups.map((group) => [group.id, group]));
    const chargeLines: RentalQuoteSnapshotV1["chargeLines"] = [];
    let rentalAmount = 0;
    let depositAmount = 0;
    let preAuthGross = 0;
    // 押金模式来自**已发布规则**而非当前设置：规则快照要随订单固化，
    // 用实时设置会让同一张报价在设置改动后复算出不同押金。
    // 押金与预授权**各自独立**取数（需求 4.4.7）。整组缺省时由旧的 payment.depositMode 派生，
    // 使既有已发布规则快照继续按原口径复算——历史订单不得因新增字段换一套押金口径。
    const depositRule = effectiveDepositRule(rule.config);
    const preauthRule = effectivePreauthorizationRule(rule.config);
    const depositBasis: string[] = [];
    const preAuthBasis: string[] = [];
    // 命中的费率逐条固化进报价：复算不再依赖价格计划仍以该版本存在。
    const hitRates: RentalPricingRate[] = [];
    // 逐日结构化依据（需求 4.5.6）。按「营业日期 × 商品组」聚合：
    // 日历事实与商品无关，但实际价格与商品相关——同一天不同商品的系数可以不同。
    const calendarSnapshot: RentalQuoteCalendarDay[] = [];
    for (const line of input.lines) {
      const group = groups.get(line.itemGroupId);
      if (!group || line.quantity < 1 || !Number.isInteger(line.quantity)) throw new BadRequestException("报价商品或数量无效");
      // 调用方显式指定计价单位时**不得**回退到别的单位。
      // 早前用 `?? plan.rates.find(同商品组)` 兜底：请求快照写着"按小时"、
      // 金额却按自然日算出，报价既解释不通又可能直接算错钱。
      const rate = line.pricingUnit
        ? planRates.find((item) => item.itemGroupId === line.itemGroupId && item.unit === line.pricingUnit)
        : planRates.find((item) => item.itemGroupId === line.itemGroupId);
      if (!rate) {
        throw new ConflictException(
          line.pricingUnit
            ? `${group.name} 未配置计价单位 ${line.pricingUnit} 的价格`
            : `${group.name} 尚未配置基础价格`
        );
      }
      const pricingStrategy = rentalPricingStrategy(rate.unit);
      // 计价上下文：小时粒度来自费率（需求"按价格配置的小时粒度"），
      // 班次时长与边界来自已发布规则（需求"由经营空间规则定义"），
      // 因此二者的取数来源不同，不能都塞进费率或都塞进规则。
      const pricingContext = {
        usageQuantity: line.usageQuantity,
        timeZone: quoteTimeZone,
        hourGranularityMinutes: rate.hourGranularityMinutes,
        shiftHours: rule.config.pricing?.shiftHours,
        shiftStartHours: rule.config.pricing?.shiftStartHours
      };
      const naturalUnits = pricingStrategy.billableUnits(input.startAt, input.endAt, pricingContext);
      // 最小起租量属于价格计划的职责（技术指南 5.4），因此在这里兜底而不是在策略里。
      const units = Math.max(rate.minimumUnits, naturalUnits);
      // 逐单位日期价格（需求 4.4.5 明确禁止用整段平均倍率代替）。
      //
      // 自然日与夜按每个计费日期取价；小时、班次、24 小时、周、30 日月按每个
      // 计费块开始时所在的营业日期取价。日期序列由策略给出——单位语义在策略里，
      // 日历知识在服务层，两边各管一段。
      // 兼容开关 `pricing.holidayPricingEnabled` 只关**旧的**空间级周末/节假日倍率，
      // 不关逐商品的 `dayTypePrices`，也不关时间窗规则（日期时间覆盖、周期性时段）。
      // 判定与取值都在 resolveUnitPrice 内一次算完，这里不再二次筛选。
      const legacyDayTypeMultipliers = context.settings.pricing.holidayPricingEnabled;
      const unitDates = pricingStrategy.billableUnitDates(input.startAt, input.endAt, units, pricingContext);
      // 逐单位解析价格层并记录**取价时点**（需求 4.5.6 v2.9）：分时价格按取价时点命中。
      const unitFactors = unitDates.map((unitPoint) =>
        this.resolveUnitPrice(calendars, unitPoint.date, unitPoint.at, rate, quoteTimeZone, legacyDayTypeMultipliers)
      );
      const unitMultipliers = unitFactors.map((item) => item.value);
      // 停业日不在这里拦：报价可以跨过停业日，只有领取/归还**时点**受限，
      // 那道校验在 assertFulfillmentDayOpen（需求 4.5.4）。早前此处有一个调用后
      // 丢弃结果的循环，注释声称"停业日必须拦住"，实际什么也没拦——留着会让
      // 后来者以为报价路径上还有一道停业校验。
      // 顺序按需求 4.4.5：阶梯单价 → 逐单位日期价格 → 单件封顶 → 乘商品数量。
      // 金额、说明与日历快照都消费**同一份** breakdown：早前快照里的单位价用
      // `amountPerItem(rate, 1, [1])` 现算，等于按 1 个单位选阶梯档，租 7 天命中 80 元档时
      // 快照仍记基础价 100，无法据快照复算。
      const breakdown = pricingStrategy.priceBreakdown(rate, units, unitMultipliers);
      const amount = roundMoney(breakdown.amount * line.quantity);
      rentalAmount += amount;
      // 拷贝而非引用：当前没有任何路径会就地改这些费率对象（savePricingPlan 是重建数组），
      // 因此**变异测试证明不了**这行的必要性——它是廉价的防御，防的是将来出现就地修改。
      // 真正让历史报价可复算的是"报价自带费率快照"这件事本身，那一条有断言覆盖。
      hitRates.push(structuredClone(rate));
      // 押金与预授权按各自规则独立取数（需求 4.4.7），两者可同时非零。
      // 倍数按**行租金**乘而不是整单租金再分摊，这样每行金额与该行租金一一对应、可逐行解释。
      if (depositRule.mode !== "none") {
        depositAmount +=
          depositRule.mode === "price_multiple"
            ? amount * (rate.depositMultiple ?? 0)
            : rate.depositAmount * line.quantity;
        depositBasis.push(
          depositRule.mode === "price_multiple"
            ? `${group.name} 租金 ${amount} × ${rate.depositMultiple ?? 0} 倍`
            : `${group.name} 固定 ${rate.depositAmount} × ${line.quantity}`
        );
      }
      if (preauthRule.mode !== "none") {
        // 预授权取数优先用费率的预授权字段；缺省回落到押金字段（存量费率行只配了押金）。
        const preAuthUnit = rate.preAuthAmount ?? rate.depositAmount;
        const preAuthMultiple = rate.preAuthMultiple ?? rate.depositMultiple ?? 0;
        preAuthGross +=
          preauthRule.mode === "price_multiple" ? amount * preAuthMultiple : preAuthUnit * line.quantity;
        preAuthBasis.push(
          preauthRule.mode === "price_multiple"
            ? `${group.name} 租金 ${amount} × ${preAuthMultiple} 倍`
            : `${group.name} 固定 ${preAuthUnit} × ${line.quantity}`
        );
      }
      // 计算说明必须能复算：单价来源（基础价/阶梯档/封顶）、单位数、起租量是否生效、
      // 日历系数与逐日类型、数量，缺一项客服就无法向客户解释这笔钱是怎么来的（验收：可解释来源）。
      // 需求 4.4.5：说明必须展示原始单位数、进位与最低起租、阶梯档位、
      // 各日期或计费块价格、封顶前后金额和商品数量，使运营能据快照复算。
      // 同一日期可能承载多个计费块（小时粒度），且不同计费块可能命中**不同价格层**
      // （12:00 起的日期时间覆盖只命中 12:00 之后的块），因此聚合键是
      // 「日期 × 命中层 × 系数」：层或系数不同就拆成多行，逐单位金额之和保持不变。
      const unitAmountForLine = breakdown.unitAmount;
      const perDate = new Map<string, { count: number; factor: (typeof unitFactors)[number]; priceAt: string }>();
      unitDates.slice(0, units).forEach((unitPoint, index) => {
        const factor = unitFactors[index];
        const key = `${unitPoint.date}|${factor.layer ?? "base"}|${factor.value}`;
        const existing = perDate.get(key);
        if (existing) existing.count += 1;
        else perDate.set(key, { count: 1, factor, priceAt: unitPoint.at });
      });
      for (const [key, entry] of perDate) {
        const date = key.split("|")[0];
        const multiplier = entry.factor.value;
        const hitLayer = entry.factor.layer;
        calendarSnapshot.push({
          date,
          year: entry.factor.year,
          dayType: entry.factor.type,
          businessStatus: entry.factor.businessStatus,
          source: entry.factor.source,
          calendarVersion: entry.factor.calendarVersion,
          itemGroupId: group.id,
          itemGroupCode: group.code,
          unitCount: entry.count,
          unitAmount: unitAmountForLine,
          multiplier,
          amount: roundMoney(entry.count * unitAmountForLine * multiplier),
          priceAt: entry.priceAt,
          hitLayer,
          pricingPlanVersion: plan.version
        });
      }
      const dateBreakdown = unitDates
        .slice(0, units)
        .map((unitPoint, index) => {
          const factor = unitFactors[index];
          const at = unitPoint.at ? ` @${unitPoint.at.slice(11, 16)}` : "";
          // 说明里展示的必须是**实际采用的**系数与层，而不是再按开关折算一遍：
          // 折算已在 resolveUnitPrice 内完成，这里二次判断只会让说明与金额对不上。
          return `${unitPoint.date}${at} ${factor.type}×${factor.value.toFixed(2)}${factor.overridden ? "(覆盖)" : ""}`;
        })
        .join("、");
      const detail = [
        `原始 ${naturalUnits} ${rate.unit} → 计费 ${units} ${rate.unit} × ${line.quantity} 件`,
        pricingStrategy.explain(rate, units, unitMultipliers),
        units > naturalUnits ? `起租量 ${rate.minimumUnits} 生效` : undefined,
        dateBreakdown ? `逐单位取价 ${dateBreakdown}` : undefined
      ]
        .filter(Boolean)
        .join("；");
      chargeLines.push({ code: `rental:${group.code}`, name: `${group.name}租金`, type: "rental", amount, sourceId: plan.id, sourceVersion: plan.version, detail });
    }
    rentalAmount = roundMoney(rentalAmount);
    // 押金与预授权额度独立计算（需求 4.4「同时独立计算：应付押金；预授权金额」）。
    //
    // 先算出「保证金基数」，再按模式决定它是**实收押金**还是**冻结额度**：
    // 押金与预授权是两笔**独立**的钱（需求 4.4.7）：可以只收押金、只冻结额度，
    // 也可以两者同时存在。早前用一个 `depositMode` 在二者间切换，表达不了「收 500 押金
    // 并冻结 2000 额度」；而 `fixed + preauthorizationRequired=true` 时金额进了押金与实收、
    // preAuthAmount 为 0，明细却叫「预授权额度」——名实不符。
    depositAmount = depositRule.mode === "none" ? 0 : roundMoney(depositAmount);
    if (depositRule.maxAmount !== undefined) depositAmount = Math.min(depositAmount, depositRule.maxAmount);
    let preAuthAmount = preauthRule.mode === "none" ? 0 : roundMoney(preAuthGross);
    if (preauthRule.maxAmount !== undefined) preAuthAmount = Math.min(preAuthAmount, preauthRule.maxAmount);
    // 要求预授权却取不到额度必须报错，否则会产出一张「声称要冻结却冻结 0」的报价。
    if (preauthRule.mode !== "none" && preAuthAmount <= 0) {
      throw new ConflictException("当前规则要求预授权，但所选商品未配置预授权额度");
    }
    const quotedDayTypes = new Set(this.dayTypesForRange(calendars, input.startAt, input.endAt, quoteTimeZone));
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

    // 履约费用（需求 4.4 公式的独立一项，与增值服务分开计）。
    //
    // 配在价格计划上而不是地点上：它是价格，要随计划版本发布、生效并进快照，
    // 报价才能复算"当时按哪一版履约费收的"。配在地点上会随主档改价漂移。
    //
    // 异地归还附加费按"归还地点与取件地点不同"判定，而不是按履约方式判定——
    // 门店自提也可能异地归还（规则允许时），那同样要收跨点费。
    let fulfillmentAmount = 0;
    const fee = (plan.fulfillmentFees ?? []).find((row) => row.mode === input.fulfillmentMode);
    if (fee) {
      const crossLocation = Boolean(input.returnLocationId && input.returnLocationId !== input.fulfillmentLocationId);
      const crossAmount = crossLocation ? fee.crossLocationAmount ?? 0 : 0;
      fulfillmentAmount = roundMoney(fee.amount + crossAmount);
      if (fulfillmentAmount > 0) {
        chargeLines.push({
          code: `fulfillment:${input.fulfillmentMode}`,
          name: "履约费用",
          type: "fulfillment",
          amount: fulfillmentAmount,
          sourceId: plan.id,
          sourceVersion: plan.version,
          detail: crossLocation
            ? `${input.fulfillmentMode} 基础 ${fee.amount} + 异地归还 ${crossAmount}`
            : `${input.fulfillmentMode} 基础 ${fee.amount}`
        });
      }
    }
    // 押金明细必须讲清取数方式：固定押金与倍数押金金额可能相同，
    // 只给一个数字客服无法回答"为什么是这个数"。
    if (preAuthAmount > 0) {
      chargeLines.push({
        code: "preauthorization",
        name: "预授权额度",
        type: "preauthorization",
        amount: preAuthAmount,
        sourceId: rule.id,
        sourceVersion: rule.version,
        // 说明用**预授权自己的**取数依据，而不是押金的：两者独立取数，可能不是同一个数。
        detail: `冻结额度（不计入应付）：${(preAuthBasis.length ? preAuthBasis : depositBasis).join("、")}`
      });
    }
    if (depositAmount > 0) {
      // 名称与说明必须跟着**实际入账的桶**走：这一行是实收押金，名字不能叫「预授权额度」。
      // 早前按 `preauthorizationRequired` 命名，于是「固定押金 + 要求预授权」时
      // 金额进了押金与本次实收，明细却显示「预授权额度」，名实不符。
      chargeLines.push({
        code: "deposit",
        name: "押金",
        type: "deposit",
        amount: depositAmount,
        sourceId: rule.id,
        sourceVersion: rule.version,
        detail: `${depositRule.mode === "price_multiple" ? "租金倍数押金" : "固定押金"}：${depositBasis.join("、")}`
      });
    }
    const timestamp = stamp();
    // 需求 4.5.2：命中年度的官方日历尚未确认时仍按每周默认模板报价，但必须提示。
    // 「空间日历是否发布」与「公共官方来源是否确认」是两件事，不能用一个 published 代替：
    // 一个只含人工覆盖（如装修停业）的年度日历完全可以合法发布，但该年度的官方节假日
    // 依旧没有确认，此时若因为 status=published 就不再提示，运营会以为节假日安排已经到位。
    // 仅在启用官方日历的地区（CN）提示，NONE 地区本就不依赖官方数据。
    const calendarWarnings: string[] = [];
    for (const calendar of calendars) {
      if (calendar.region !== "CN") continue;
      if (calendar.status !== "published") {
        calendarWarnings.push(`${calendar.year} 年度日历尚未发布，本次报价按每周默认营业模板计算`);
        continue;
      }
      const officialConfirmed = Boolean(calendar.sourceName) && calendar.days.some((day) => day.source === "official_cn");
      if (!officialConfirmed) {
        calendarWarnings.push(
          `${calendar.year} 年度公共官方日历尚未确认，本次报价的节假日与调休安排仅来自人工维护`
        );
      }
    }
    const quote: RentalQuoteSnapshotV1 = {
      id: uid("quote"), tenantId, quoteNo: `RQ${timestamp.replace(/\D/g, "").slice(0, 14)}${String(state.quotes.length + 1).padStart(3, "0")}`,
      categoryCode: context.profile.categoryCode, request: structuredClone(input), chargeLines,
      rentalAmount, discountAmount: roundMoney(discountAmount), couponAmount: roundMoney(couponAmount), serviceAmount,
      fulfillmentAmount,
      rateSnapshot: hitRates,
      calendarSnapshot,
      calendarWarnings,
      depositAmount,
      preAuthAmount,
      // 需求 4.4：最终应付 = 基础租金 + 使用量费用 + 履约费用 + 增值服务 + 异常费用 - 优惠 - 券。
      // 使用量费用已并入租金（由 usage 策略计），异常费用在订单侧按快照追加。
      payableAmount: roundMoney(rentalAmount - discountAmount - couponAmount + serviceAmount + fulfillmentAmount),
      // 需求 4.4.1：`本次实收 = 租赁应付 + 应付押金`；预授权只是冻结，不计入。
      receivableAmount: roundMoney(
        rentalAmount - discountAmount - couponAmount + serviceAmount + fulfillmentAmount + depositAmount
      ),
      pricingPlanVersion: plan.version, ruleVersion: rule.version, ruleSnapshot: structuredClone(rule.config), calendarVersion: calendars.map((calendar) => `${calendar.year}:${calendar.status === "published" ? calendar.version : "draft"}`).join("|"),
      // PRICE-03：记下命中的空间级价格版本。内存数据源没有版本事实，此时留空——
      // 编一个版本号会让「按哪一版算的」这条追溯线索变成假的。
      priceVersionId: "versionId" in spaceVersion ? spaceVersion.versionId : undefined,
      priceVersion: "version" in spaceVersion ? spaceVersion.version : undefined,
      appliedDiscountPlanIds: discountPlans.map((item) => item.id), customerCouponId: customerCoupon?.id,
      // CORE-EXT-02D：固化本次报价生成时该空间已启用能力的版本与配置。
      // 升级或改配置后，这张报价及由它下单的在途订单仍按此快照校验与履约。
      capabilitySnapshot: this.capabilities
        ? await this.capabilities.snapshotEnabled(tenantId, this.workspaceOf(tenantId))
        : undefined,
      expiresAt: new Date(Date.now() + rule.config.payment.unpaidHoldMinutes * 60_000).toISOString(), createdAt: timestamp
    };
    // Review P1-5：判定结果必须写进报价并返回，否则「需转接环」这类风险虽被发现，
    // 用户却无从知道要确认什么，下单侧也只能凭空重构一遍判断。
    quote.capabilityDecisions = await this.runQuoteHook(tenantId, context, quote);
    state.quotes.unshift(quote);
    await this.factStore.upsertQuote(quote);
    return quote;
  }

  /**
   * 报价校验 Hook。在报价**算完之后、落库之前**判定，并把判断记录返回给调用方固化。
   *
   * 为什么不在算之前：能力要判定的是这份报价本身（金额、日历依据、履约方式、
   * 命中的费率），算之前那些都还不存在。为什么不在落库之后：那时阻止已经晚了，
   * 报价已经可以被下单引用。
   *
   * 报价没有事务（`upsertQuote` 是独立写入），因此放行时的 Hook 审计跳过——
   * 审计必须与业务变更同事务，否则会留下与实际状态不一致的记录；判定依据由返回的
   * `capabilityDecisions` 随报价固化承接。
   *
   * 被阻止时（Review P1-5）：**不生成报价**，但写一条独立的、只追加的拒绝审计，
   * 然后把异常抛给调用方。拒绝审计不属于任何业务事务（没有业务变更要回滚），
   * 否则「为什么这单报不出价」事后完全无从追溯。
   */
  private async runQuoteHook(
    tenantId: string,
    context: BusinessContext,
    quote: RentalQuoteSnapshotV1
  ): Promise<RentalCapabilityDecisionSnapshot[] | undefined> {
    if (!this.hooks) return undefined;
    const workspaceId = this.workspaceOf(tenantId);
    // 富化走与订单、配货**同一份**公共实现（P2-1）：早前这里另写一遍，
    // 找不到商品时用 id 冒充名称、`inventoryMode as never`，与订单侧对同一条脏数据
    // 给出不同结果。现在两处的错误处理也一致——找不到商品一律明确报错。
    const groups = new Map(
      context.groups.map((group) => [
        group.id,
        { id: group.id, name: group.name, inventoryMode: group.inventoryMode, attributes: group.attributes }
      ])
    );
    const equipment = buildCapabilityEquipment(groups, quote.request.lines.map((line) => ({
      itemGroupId: line.itemGroupId,
      quantity: line.quantity
    })));
    const instances = quote.capabilitySnapshot
      ? WorkspaceCapabilityService.instancesFromSnapshot(tenantId, workspaceId, quote.capabilitySnapshot)
      : undefined;
    const at = quote.createdAt;
    try {
      const outcome = await this.hooks.evaluate({
        point: "quote_validation",
        tenantId,
        workspaceId,
        categoryCode: context.category.code,
        subjectRef: { type: "quote", id: quote.id },
        subject: { ...quote, equipment, capabilityExceptions: [] },
        at,
        // 用报价自己固化的能力快照判定，而不是当前实例。报价生成与校验之间若有并发升级，
        // 也必须按写进这张报价的版本判定——快照即事实。
        instances
      });
      if (!outcome.executed.length) return undefined;
      return CapabilityHookRuntime.toDecisionSnapshots(outcome, {
        at,
        equipment,
        idPrefix: quote.id
      });
    } catch (error) {
      if (error instanceof CapabilityBlockedException) {
        // 只追加的拒绝审计，写在事务之外——报价并未生成，没有业务变更需要回滚。
        await this.hookAudits?.recordRejection(
          tenantId,
          workspaceId,
          { type: "quote", id: quote.id },
          error.outcome,
          undefined,
          at
        );
      }
      throw error;
    }
  }
  getQuote(tenantId: string, context: BusinessContext, quoteId: string) {
    const quote = this.state(tenantId, context).quotes.find((item) => item.id === quoteId);
    if (!quote) throw new NotFoundException("报价不存在");
    return quote;
  }

  private validateFulfillmentLocations(context: BusinessContext, input: RentalQuoteRequest) {
    const requireLocation = (locationId: string, capability: RentalFulfillmentLocation["capabilities"][number]) => {
      const location = context.locations.find((row) => row.id === locationId);
      if (!location) throw new BadRequestException("履约地点不存在");
      const operator = location.operatorId ? context.operators.find((row) => row.id === location.operatorId) : undefined;
      if (location.status !== "enabled") throw new ConflictException(`${location.name}已停用`);
      if (!operator || operator.status !== "enabled") throw new ConflictException(`${location.name}所属经营主体已停用或不存在`);
      if (!location.capabilities.includes(capability)) throw new ConflictException(`${location.name}不支持${capability === "pickup" ? "领取" : capability === "return" ? "归还" : "配送"}`);
      return { location, operator };
    };
    const outboundCapability = input.fulfillmentMode === "delivery" || input.fulfillmentMode === "onsite_delivery" ? "delivery" : "pickup";
    const { operator: fulfillmentOperator } = requireLocation(input.fulfillmentLocationId, outboundCapability);
    if (input.fulfillmentMode === "partner_pickup_return" && fulfillmentOperator.type !== "partner") throw new ConflictException("合作点取还必须选择合作经营主体的地点");
    requireLocation(input.returnLocationId ?? input.fulfillmentLocationId, "return");
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
      unit: context.settings.pricing.defaultUnit,
      baseAmount: context.category.businessModel.defaults.sampleBaseAmount + index * context.category.businessModel.defaults.sampleAmountIncrement,
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

  private async validateRewardBatch(
    tenantId: string,
    state: RentalBusinessState,
    context: BusinessContext,
    planned: Array<{ customerId: string; type: RentalRewardLedgerEntry["rewardType"]; amount: number; couponTemplateId?: string }>,
    tx?: RentalBusinessFactTx
  ) {
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
      const existingCount = tx
        ? await this.factStore.countCustomerCoupons(tenantId, template.id, plan.customerId, tx)
        : state.customerCoupons.filter((row) => row.templateId === template.id && row.customerId === plan.customerId && row.status !== "void").length;
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
    const preauthorizationEnabled = effectivePreauthorizationRule(config).mode !== "none";
    if ((config.payment.preauthorizationRequired || preauthorizationEnabled) && !context.category.businessModel.supportsPreauthorization) {
      throw new BadRequestException("当前品类不支持预授权");
    }
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

  /**
   * 按营业时区的年份装载日历。
   *
   * 用 `getUTCFullYear()` 会在跨年边界装错：北京时间 2027-01-01 01:00 对应 UTC
   * 2026-12-31，于是只装 2026 年日历，而后续按营业日期查的是 2027-01-01——
   * 查不到就默认成普通工作日，把法定节假日或停业日算成平日。
   */
  private calendarsForDateRange(tenantId: string, context: BusinessContext, startAt: string, endAt: string) {
    const timeZone = context.settings.calendar.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
    const startYear = businessYearFromDateKey(businessDateKey(startAt, timeZone));
    // 结束端取"最后一刻"：结束正好落在营业日零点时不应把下一年也装进来。
    const endYear = businessYearFromDateKey(
      businessDateKey(new Date(Math.max(new Date(endAt).getTime() - 1, new Date(startAt).getTime())).toISOString(), timeZone)
    );
    const years = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
    return years.map(
      (year) => this.publishedCalendar(tenantId, context, year) ?? this.buildCalendar(tenantId, context.settings, year)
    );
  }

  /**
   * 领取与归还**时点**的营业状态校验（需求 4.5.4）。
   *
   * 与逐日取价分开：停业限制的是「当天、该地点」能不能办领取/配送/现场归还，
   * 而不是租期能不能跨过这一天。因此这里只看两个端点所在的营业日期，
   * 中间经过的停业日一概不管。
   *
   * 需求同时要求「已经在租的订单不能因临时停业而失去归还渠道」，因此归还端
   * 只在**下单时**拦截，不影响已成立订单的归还动作——归还路径不走本方法。
   */
  /**
   * 解析某营业日期的时段配置（需求 4.5.1 + 4.5.3 的优先级）。
   *
   * 具体日期覆盖 > 每周默认模板；两者都没有时返回 undefined，表示**未声明时段限制**。
   * 未声明时不校验时点：存量经营空间没有这份模板，把缺省当成"全天不营业"
   * 会让所有既有租户立刻无法下单。
   */
  private resolveBusinessHours(
    calendars: RentalCalendarYear[],
    settings: TenantRentalBusinessSettings,
    date: string
  ): RentalBusinessHours | undefined {
    const calendar = calendars.find((item) => item.year === businessYearFromDateKey(date));
    const day = calendar?.days.find((item) => item.date === date);
    if (day?.hours) return day.hours;
    const weekly = settings.calendar.weeklyHours;
    if (!weekly?.length) return undefined;
    // 下标 0=周日，与 weekendDays 同一编号口径。日期键是营业日期，用 UTC 取星期即可：
    // `YYYY-MM-DD` 本身已不含时区信息，再叠时区会把星期算错。
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return weekly[weekday];
  }

  /**
   * 时段判定的三态（需求 4.5.1）。区分「未声明」与「空数组」是本方法存在的全部理由：
   *
   * - `undefined` → `inherit`：未单独声明，由调用方决定继承哪一层；
   * - `[]` → `closed`：当天**不提供**该服务。早前与 undefined 一样被当成"不限制"，
   *   于是「今天不配送」反而变成「全天可配送」，「今天不办领取」变成「随时可领」；
   * - 非空 → 命中则 `open`，未命中则 `outside`。
   */
  private windowVerdict(
    windows: RentalTimeWindow[] | undefined,
    localTime: string
  ): "inherit" | "closed" | "open" | "outside" {
    if (windows === undefined) return "inherit";
    if (windows.length === 0) return "closed";
    return windows.some((window) => localTime >= window.start && localTime <= window.end) ? "open" : "outside";
  }

  private assertFulfillmentDayOpen(
    tenantId: string,
    context: BusinessContext,
    input: RentalQuoteRequest,
    timeZone: string,
    settings: TenantRentalBusinessSettings,
    onlyAction?: "pickup" | "return"
  ) {
    const check = (iso: string, label: string, action: "pickup" | "return") => {
      const date = businessDateKey(iso, timeZone);
      // 按端点**自己的**营业年度解析日历，而不是复用报价区间装载的那批。
      // 早前用逐日区间那批（结束端按 endAt-1ms 定年度），当归还端正好落在营业时区跨年
      // 零点（如 endAt=2027-01-01T00:00+08:00）时，该年度根本没被装载，calendar 为空、
      // day 为 undefined，下面的 `if (!day) return` 会把停业/自助/时段三道校验整段跳过。
      const year = businessYearFromDateKey(date);
      const calendar = this.publishedCalendar(tenantId, context, year) ?? this.buildCalendar(tenantId, settings, year);
      const day = calendar.days.find((item) => item.date === date);
      if (!day) return;
      const status = businessStatusOf(day);
      if (status === "closed") {
        throw new ConflictException(`${date} 停止营业，无法安排${label}；租期可以跨过停业日，但当天不办理履约`);
      }
      // 自助营业＝人工停业但允许自助方式履约（需求 4.5.4）。判定它需要地点声明
      // 自助领取/归还 capability（需求 4.5.1 明确「自助领取或归还作为地点 capability
      // 单独声明」），而地点能力当前只有 pickup/return/storage/delivery，没有自助项。
      //
      // 缺这项能力时**按拒绝处理**而不是放行：放行等于对着一个尚不存在的能力
      // fail-open，客户会拿到一张当天根本没人也没柜子能履约的报价。
      // 地点能力属 CAT-04 的模型，按分支规则只报告依赖、不跨任务顺手加。
      if (status === "self_service") {
        throw new ConflictException(
          `${date} 为自助营业日，无法安排${label}；该日仅支持自助履约，而当前地点尚未声明自助领取或归还能力`
        );
      }
      // 时段校验（需求 4.5.1/4.5.4）：正常营业「在配置时段内」提供服务，
      // 限时营业「只在指定时段」提供指定能力——两者都要按时点判定，
      // 区别只在于限时营业通常把动作时段配得比营业时段更窄。
      //
      // 营业时段与动作时段（领取/归还/配送）都是三态，判定统一交给 windowVerdict：
      // 缺省继承、空数组表示当天停用、非空按时点命中。早前只有配送分支单独处理了
      // 空数组，领取与归还的空数组、以及营业时段本身的空数组都被当成"不限制"，
      // 于是「当天不办领取」「当天不营业」反而变成随时可办。
      const hours = this.resolveBusinessHours([calendar], settings, date);
      if (hours) {
        const localTime = businessTimeOfDay(iso, timeZone);
        const isDelivery = DELIVERY_FULFILLMENT_MODES.has(input.fulfillmentMode);
        const actionLabel = isDelivery ? `${label}（配送）` : label;
        const businessVerdict = this.windowVerdict(hours.windows, localTime);
        if (businessVerdict === "closed") {
          throw new ConflictException(`${date} 当天营业时段为空（不营业），无法安排${label}`);
        }
        if (businessVerdict === "outside") {
          const shown = hours.windows.map((w) => `${w.start}-${w.end}`).join("、");
          throw new ConflictException(`${date} ${localTime} 不在营业时段内（营业：${shown}），无法安排${label}`);
        }
        const actionWindows = isDelivery ? hours.delivery : action === "pickup" ? hours.pickup : hours.return;
        const actionVerdict = this.windowVerdict(actionWindows, localTime);
        if (actionVerdict === "closed") {
          throw new ConflictException(`${date} 当天不提供${actionLabel}服务（该动作时段为空）`);
        }
        if (actionVerdict === "outside") {
          const shown = (actionWindows ?? []).map((w) => `${w.start}-${w.end}`).join("、");
          throw new ConflictException(`${date} ${localTime} 不在${actionLabel}可用时段内（可用：${shown}）`);
        }
        // actionVerdict === "inherit" 时不再单独判定：动作时段未声明即继承营业时段，
        // 而营业时段已在上面按同一时点校验过。
      }
    };
    if (onlyAction !== "return") check(input.startAt, "领取", "pickup");
    if (onlyAction !== "pickup") check(input.endAt, "归还", "return");
  }

  /**
   * 订单确认时的营业状态复查（需求 4.5.4「报价和订单必须分别校验领取与归还时点的
   * 地点能力和营业状态」）：报价之后、确认之前，运营可能把租期端点覆盖成停业日；
   * 确认动作必须按订单固化的领取/归还时点重新校验，不能只信报价时的旧判断。
   */
  assertOrderDaysOpenForConfirmation(
    tenantId: string,
    context: BusinessContext,
    order: {
      fulfillmentLocationId: string;
      returnLocationId?: string;
      startAt: string;
      endAt: string;
      fulfillmentMode: RentalQuoteRequest["fulfillmentMode"];
    }
  ) {
    this.assertFulfillmentDayOpen(
      tenantId,
      context,
      order as RentalQuoteRequest,
      context.settings.calendar.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE,
      context.settings
    );
  }

  /**
   * 领取动作时的营业状态复查（需求 4.6.4：领取前必须重新校验……营业状态）。
   * 按**实际领取时刻**判定：早取、迟取都要看当前门店是否还在办理领取。
   * 归还动作刻意不复查——停业不得让在租订单失去归还渠道（需求 4.5.4）。
   */
  assertPickupOpenAt(
    tenantId: string,
    context: BusinessContext,
    fulfillmentLocationId: string,
    at: string,
    fulfillmentMode: RentalQuoteRequest["fulfillmentMode"]
  ) {
    this.assertFulfillmentDayOpen(
      tenantId,
      context,
      { fulfillmentLocationId, startAt: at, endAt: at, fulfillmentMode } as RentalQuoteRequest,
      context.settings.calendar.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE,
      context.settings,
      "pickup"
    );
  }

  /**
   * 单个营业日期的价格系数。逐单位取价与整段明细共用同一判定，避免两处口径分叉。
   *
   * 租户逐日覆盖优先于费率的节假日倍率：判据是 `source === "tenant_override"`，
   * 只有 `saveCalendarDay` 会写这个来源，因此能区分「人工覆盖」与「导入或周规则
   * 填的默认值」（导入的法定节假日默认 1.25、周末 1.1，不加区分地优先取它
   * 等于把费率级倍率整体废掉）。
   */
  /**
   * 单个计费单位的价格解析（需求 4.4.5/4.5.5 v2.9 的四级优先级）：
   * `date_override` 具体日期时间覆盖 > `periodic` 周期性计价时段 >
   * `day_type` 商品日期类型价格 > `base` 商品基础价格。
   *
   * 与旧 `dateMultiplier` 的差别：多收 `priceAt`（取价时点），带时间边界的一次性
   * 覆盖按「取价时点是否落在 [start, end)」命中，而不是整日命中——这正是
   * 「周五 10:00 与 14:00 开始的 24 小时计费块可以得到不同价格」的解析点。
   * 停业日**不阻止**报价（需求 4.5.4）——拦领取/归还时点是 assertFulfillmentDayOpen
   * 的职责，不是逐日取价的职责。
   *
   * `legacyDayTypeMultipliers` 对应经营设置里的 `pricing.holidayPricingEnabled`，
   * 只控制**旧的** `weekendMultiplier` / `holidayMultiplier` 兼容回落：
   * 关掉后这两个字段不再参与计价，逐商品的 `dayTypePrices`、周期性时段与
   * 日期时间覆盖都照常生效。取价结论（value 与 layer）在本方法内一次算完，
   * 不留给调用方二次判断——早前调用方各写一遍三元表达式，两处口径分叉，
   * 而每个分支都返回"属于价格模块"，开关实际上从未生效。
   */
  private resolveUnitPrice(
    calendars: RentalCalendarYear[],
    date: string,
    priceAt: string | undefined,
    rate: RentalPricingRate,
    timeZone: string,
    legacyDayTypeMultipliers: boolean
  ) {
    const calendar = calendars.find((item) => item.year === businessYearFromDateKey(date));
    const day = calendar?.days.find((item) => item.date === date);
    const type: RentalDayType = day?.dayType ?? "workday";
    const overridden = day?.source === "tenant_override";
    const calendarVersion = calendar ? (calendar.status === "published" ? calendar.version : "draft") : "draft";
    const baseResult = {
      type,
      overridden,
      businessStatus: day ? businessStatusOf(day) : ("open" as RentalCalendarBusinessStatus),
      // 无该日记录时来源即为每周模板：日历只生成到已知年度，未覆盖的日期按模板处理。
      source: day?.source ?? ("week_rule" as RentalCalendarDay["source"]),
      calendarVersion,
      year: businessYearFromDateKey(date)
    };

    // 第 1 层：日历只给出稳定引用，价格值和绝对时段都来自当前价格版本。
    // 这避免把一个空间统一倍率误当成所有商品的价格事实。
    if (overridden && day?.pricingOverrideRef && priceAt) {
      const atMs = new Date(priceAt).getTime();
      const hit = rate.datetimeOverrides?.find(
        (override) =>
          override.id === day.pricingOverrideRef &&
          Number.isFinite(atMs) &&
          atMs >= new Date(override.start).getTime() &&
          atMs < new Date(override.end).getTime()
      );
      if (hit) return { ...baseResult, value: hit.multiplier, layer: "date_override" as const };
    }

    // 第 2 层：周期性计价时段（PRICE-03）。按取价时点的营业时区星期与时分命中。
    if (priceAt && rate.periodicWindows?.length) {
      const hitWindow = rate.periodicWindows.find((window) => periodicWindowHits(window, priceAt, timeZone));
      if (hitWindow) {
        return { ...baseResult, value: hitWindow.multiplier, layer: "periodic" as const };
      }
    }

    // 第 3 层：商品在该日期类型下的价格（PRICE-03 的逐类型价格）。
    // 这是显式按商品配置的价格事实，**不**受兼容开关影响：运营配了「节假日 1.5」
    // 就该按 1.5 收，否则配置只是摆设。
    const dayTypePrice = rate.dayTypePrices?.[type];
    if (dayTypePrice !== undefined) {
      return { ...baseResult, value: dayTypePrice, layer: "day_type" as const };
    }
    // 第 3 层的兼容回落：整个空间共用的旧周末/节假日倍率。它是 PRICE-03 之前的口径，
    // 由 `holidayPricingEnabled` 控制；关掉后落到基础价，而不是继续悄悄加价。
    if (legacyDayTypeMultipliers) {
      if (type === "weekend") {
        return { ...baseResult, value: rate.weekendMultiplier, layer: "day_type_legacy" as const };
      }
      if (type === "statutory_holiday" || type === "tenant_special") {
        return { ...baseResult, value: rate.holidayMultiplier, layer: "day_type_legacy" as const };
      }
    }
    // 第 4 层：商品基础价格。
    return { ...baseResult, value: 1, layer: "base" as const };
  }

  /** 与逐单位取价必须同一日界口径，否则优惠的适用日期与计价的命中日期会错开。 */
  private dayTypesForRange(calendars: RentalCalendarYear[], startAt: string, endAt: string, timeZone: string) {
    const values: RentalDayType[] = [];
    const firstIndex = businessDayIndex(startAt, timeZone);
    const lastIndex = businessDayIndex(new Date(new Date(endAt).getTime() - 1).toISOString(), timeZone);
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const date = businessDateKeyFromIndex(index);
      const calendar = calendars.find((item) => item.year === businessYearFromDateKey(date));
      values.push(calendar?.days.find((item) => item.date === date)?.dayType ?? "workday");
    }
    return values;
  }
}

export type { BusinessContext };
