import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type $Enums } from "@prisma/client";
import type {
  RentalAsset,
  RentalCalendarYear,
  RentalCouponTemplate,
  RentalCustomerBenefitAccount,
  RentalCustomerCoupon,
  RentalDiscountPlan,
  RentalFulfillmentLocation,
  RentalFulfillmentOperator,
  RentalInspectionRecord,
  RentalInspectionTemplate,
  RentalItemGroup,
  RentalNotificationSendLogV1,
  RentalNotificationTemplateV1,
  RentalOrder,
  RentalPricingPlanV1,
  RentalQuoteSnapshotV1,
  RentalRewardLedgerEntry,
  RentalRuleVersion,
  RentalStockBalance,
  RentalValueAddedService,
  TenantRentalBusinessSettings,
  TenantRentalProfile
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";

/**
 * 快照 JSON 是领域对象的直接序列化结果，因此按领域类型读取即可。
 * 字段可能缺失（历史快照写入时该字段还不存在），读取端必须容忍 undefined。
 */
interface CoreSnapshotState {
  profile?: TenantRentalProfile;
  businessSettings?: TenantRentalBusinessSettings;
  couponTemplates?: RentalCouponTemplate[];
  operators?: RentalFulfillmentOperator[];
  locations?: RentalFulfillmentLocation[];
  itemGroups?: RentalItemGroup[];
  assets?: RentalAsset[];
  stockBalances?: RentalStockBalance[];
  orders?: RentalOrder[];
  inspectionTemplates?: RentalInspectionTemplate[];
  inspections?: RentalInspectionRecord[];
}

interface BusinessSnapshotState {
  categoryCode?: string;
  pricingPlans?: RentalPricingPlanV1[];
  discountPlans?: RentalDiscountPlan[];
  services?: RentalValueAddedService[];
  calendars?: RentalCalendarYear[];
  ruleVersions?: RentalRuleVersion[];
  customerCoupons?: RentalCustomerCoupon[];
  rewardLedger?: RentalRewardLedgerEntry[];
  benefitAccounts?: RentalCustomerBenefitAccount[];
  referrals?: Array<{ inviteeCustomerId: string; referrerCustomerId: string; registeredAt: string }>;
  notificationTemplates?: RentalNotificationTemplateV1[];
  notificationLogs?: RentalNotificationSendLogV1[];
  quotes?: RentalQuoteSnapshotV1[];
}

export interface BackfillTenantResult {
  tenantId: string;
  skipped: boolean;
  reason?: string;
  /** 本次处理的快照条目数，按集合分组。写入是 upsert，因此不等于新插入行数。 */
  inserted: Record<string, number>;
}

/** Prisma 枚举成员名是领域小写值的大写形式（schema 中用 @map 对应）。 */
function upperEnum<T extends string>(value: string | undefined, field: string): T {
  if (!value) throw new Error(`${field} 缺失，无法映射为数据库枚举`);
  return value.toUpperCase() as T;
}

function date(value: string | undefined, field: string): Date {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${field} 不是有效时间：${String(value)}`);
  return parsed;
}

function optionalDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function json(value: unknown): Prisma.InputJsonValue {
  return (value ?? null) as Prisma.InputJsonValue;
}

function jsonArray(value: unknown): Prisma.InputJsonValue {
  return (Array.isArray(value) ? value : []) as Prisma.InputJsonValue;
}

function amount(value: number | undefined) {
  return new Prisma.Decimal(Number.isFinite(Number(value)) ? Number(value) : 0);
}

/**
 * RC-01：把历史聚合 JSON 快照里的 Rental Core 事实回填进规范化表。
 *
 * 为什么不用 SQL JSON_TABLE：订单→行→预占→分配的嵌套在纯 SQL 里极易写错且难以测试，
 * 而回填只跑一次、数据量小，放在应用层可复核、可单测、可在事务里保证整租户原子性。
 *
 * 幂等：每条写入都是按主键或唯一键的 upsert，因此整个回填可重复执行。
 * 不依赖「租户是否已回填」的守卫来保证正确性——该守卫只是避免每次启动都做无用 upsert 的快路径。
 * 早期实现只用守卫、内部用 create，一旦某张表已有数据（如 seed 写入的品类档案、
 * 或后续阶段由应用写入的配置）就会主键冲突并整租户回滚，使该租户永久无法回填。
 * 失败隔离：单个租户的快照损坏只中止该租户并记录错误，不阻断 API 启动，
 * 也不静默跳过（错误会出现在日志且计入返回结果）。
 */
@Injectable()
export class RentalSnapshotBackfillService implements OnModuleInit {
  private readonly logger = new Logger(RentalSnapshotBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  private enabled() {
    return (this.config.get<string>("PLATFORM_DATA_SOURCE") ?? "mysql").toLowerCase() === "mysql";
  }

  async onModuleInit() {
    if (!this.enabled()) return;
    try {
      await this.run();
    } catch (error) {
      // 回填整体失败不能让 API 起不来；错误必须可见，不吞掉。
      this.logger.error(`Rental Core 快照回填未完成：${(error as Error).message}`);
    }
  }

  async run(): Promise<BackfillTenantResult[]> {
    const [coreRows, businessRows] = await Promise.all([
      this.prisma.rentalCoreStateSnapshot.findMany(),
      this.prisma.rentalBusinessStateSnapshot.findMany()
    ]);
    const businessByTenant = new Map(businessRows.map((row) => [row.tenantId, row.state as unknown as BusinessSnapshotState]));
    const tenantIds = [...new Set([...coreRows.map((row) => row.tenantId), ...businessByTenant.keys()])];

    const results: BackfillTenantResult[] = [];
    for (const tenantId of tenantIds) {
      const core = (coreRows.find((row) => row.tenantId === tenantId)?.state ?? {}) as unknown as CoreSnapshotState;
      const business = businessByTenant.get(tenantId) ?? {};
      try {
        results.push(await this.backfillTenant(tenantId, core, business));
      } catch (error) {
        const reason = (error as Error).message;
        this.logger.error(`租户 ${tenantId} 快照回填失败，已回滚该租户：${reason}`);
        results.push({ tenantId, skipped: true, reason, inserted: {} });
      }
    }

    const migrated = results.filter((row) => !row.skipped);
    const failed = results.filter((row) => row.skipped && row.reason && row.reason !== "已存在规范化数据");
    // 每次都输出一行，便于运维确认回填确实执行过，而不是"没日志=没跑还是没数据"二义。
    this.logger.log(
      `Rental Core 快照回填检查完成：快照租户 ${results.length}，回填 ${migrated.length}，` +
        `跳过 ${results.length - migrated.length - failed.length}，失败 ${failed.length}`
    );
    return results;
  }

  /**
   * 快路径：该租户是否**每一类**快照里有数据的规范化表都已有行。
   *
   * 早期实现用「任一表非空」判定，导致部分填充、人工写入或历史失败的租户被永久跳过——
   * 全量 upsert 根本执行不到，"部分填充能自愈"这个说法当时是不成立的。
   * 现在要求逐类齐备才跳过：只要还有一类该有数据却为空，就重跑整轮 upsert
   * （upsert 对已存在的行是无害的，代价只是一次多余写入）。
   */
  private async alreadyBackfilled(
    tenantId: string,
    core: CoreSnapshotState,
    business: BusinessSnapshotState
  ) {
    const expectations: Array<{ expected: number; actual: () => Promise<number> }> = [
      { expected: (core.operators ?? []).length, actual: () => this.prisma.rentalFulfillmentOperator.count({ where: { tenantId } }) },
      { expected: (core.locations ?? []).length, actual: () => this.prisma.rentalFulfillmentLocation.count({ where: { tenantId } }) },
      { expected: (core.itemGroups ?? []).length, actual: () => this.prisma.rentalItemGroup.count({ where: { tenantId } }) },
      { expected: (core.assets ?? []).length, actual: () => this.prisma.rentalAsset.count({ where: { tenantId } }) },
      { expected: (core.stockBalances ?? []).length, actual: () => this.prisma.rentalStockBalance.count({ where: { tenantId } }) },
      { expected: (core.couponTemplates ?? []).length, actual: () => this.prisma.rentalCouponTemplate.count({ where: { tenantId } }) },
      { expected: (core.inspectionTemplates ?? []).length, actual: () => this.prisma.rentalInspectionTemplate.count({ where: { tenantId } }) },
      { expected: (core.orders ?? []).length, actual: () => this.prisma.rentalOrder.count({ where: { tenantId } }) },
      { expected: (core.inspections ?? []).length, actual: () => this.prisma.rentalInspectionRecord.count({ where: { tenantId } }) },
      { expected: (business.quotes ?? []).length, actual: () => this.prisma.rentalQuote.count({ where: { tenantId } }) },
      { expected: (business.customerCoupons ?? []).length, actual: () => this.prisma.rentalCustomerCoupon.count({ where: { tenantId } }) },
      { expected: (business.rewardLedger ?? []).length, actual: () => this.prisma.rentalRewardLedgerEntry.count({ where: { tenantId } }) },
      { expected: (business.benefitAccounts ?? []).length, actual: () => this.prisma.rentalBenefitAccount.count({ where: { tenantId } }) },
      { expected: (business.referrals ?? []).length, actual: () => this.prisma.rentalReferral.count({ where: { tenantId } }) },
      { expected: (business.notificationTemplates ?? []).length, actual: () => this.prisma.rentalNotificationTemplate.count({ where: { tenantId } }) },
      { expected: (business.notificationLogs ?? []).length, actual: () => this.prisma.rentalNotificationLog.count({ where: { tenantId } }) },
      { expected: (business.pricingPlans ?? []).length, actual: () => this.prisma.rentalPricingPlan.count({ where: { tenantId } }) },
      { expected: (business.discountPlans ?? []).length, actual: () => this.prisma.rentalDiscountPlan.count({ where: { tenantId } }) },
      { expected: (business.services ?? []).length, actual: () => this.prisma.rentalValueAddedService.count({ where: { tenantId } }) },
      { expected: (business.ruleVersions ?? []).length, actual: () => this.prisma.rentalRuleVersion.count({ where: { tenantId } }) },
      { expected: (business.calendars ?? []).length, actual: () => this.prisma.rentalBusinessCalendar.count({ where: { tenantId } }) }
    ];
    const pending = expectations.filter((row) => row.expected > 0);
    if (!pending.length) return false;
    const actuals = await Promise.all(pending.map((row) => row.actual()));
    return actuals.every((value, index) => value >= pending[index].expected);
  }

  private async backfillTenant(
    tenantId: string,
    core: CoreSnapshotState,
    business: BusinessSnapshotState
  ): Promise<BackfillTenantResult> {
    if (await this.alreadyBackfilled(tenantId, core, business)) {
      return { tenantId, skipped: true, reason: "已存在规范化数据", inserted: {} };
    }
    // 租户必须存在，否则所有外键都会失败——这属于数据不一致，应明确报错。
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new Error("Tenant 表中不存在该租户");

    const inserted: Record<string, number> = {};
    const count = (key: string, n: number) => {
      if (n > 0) inserted[key] = n;
    };

    await this.prisma.$transaction(
      async (tx) => {
        const categoryCode = core.profile?.categoryCode ?? business.categoryCode;

        // 1. 品类档案：seed 可能已建，用 upsert 避免冲突。
        if (categoryCode && core.profile) {
          await tx.tenantRentalProfile.upsert({
            where: { tenantId },
            create: {
              tenantId,
              categoryCode: upperEnum(categoryCode, "profile.categoryCode"),
              capabilities: jsonArray(core.profile.capabilities),
              terminology: json(core.profile.terminology),
              configVersion: core.profile.configVersion ?? "0.1.0",
              initializedAt: optionalDate(core.profile.initializedAt) ?? new Date()
            },
            update: {}
          });
        }

        // 2. 业务设置
        if (categoryCode && core.businessSettings) {
          const settings = core.businessSettings as TenantRentalBusinessSettings & { updatedBy?: string };
          await tx.rentalTenantBusinessSettings.upsert({
            where: { tenantId },
            create: {
              tenantId,
              categoryCode: upperEnum(categoryCode, "businessSettings.categoryCode"),
              configVersion: settings.configVersion ?? "0.1.0",
              settings: json(settings),
              updatedBy: settings.updatedBy ?? "backfill"
            },
            update: {}
          });
          count("businessSettings", 1);
        }

        // 3. 经营主体 → 4. 履约地点（地点的 operatorId 外键依赖主体）
        for (const operator of core.operators ?? []) {
          await tx.rentalFulfillmentOperator.upsert({
            where: { id: operator.id },
            update: {},
            create: {
              id: operator.id,
              tenantId,
              code: operator.code,
              name: operator.name,
              type: operator.type,
              contactName: operator.contactName ?? null,
              contactPhone: operator.contactPhone ?? null,
              settlementMode: operator.settlementMode ?? null,
              status: operator.status ?? "enabled",
              createdAt: optionalDate(operator.createdAt) ?? new Date()
            }
          });
        }
        count("operators", (core.operators ?? []).length);

        const operatorIds = new Set((core.operators ?? []).map((row) => row.id));
        for (const location of core.locations ?? []) {
          await tx.rentalFulfillmentLocation.upsert({
            where: { id: location.id },
            update: {},
            create: {
              id: location.id,
              tenantId,
              code: location.code,
              name: location.name,
              type: location.type,
              // 快照里的 operatorId 可能指向已不存在的主体，置空而不是让整个租户回填失败。
              operatorId: location.operatorId && operatorIds.has(location.operatorId) ? location.operatorId : null,
              operatorType: location.operatorType ?? null,
              operatorName: location.operatorName ?? null,
              parentLocationId: location.parentLocationId ?? null,
              capabilities: jsonArray(location.capabilities),
              address: location.address ?? null,
              contactName: location.contactName ?? null,
              contactPhone: location.contactPhone ?? null,
              businessHours: location.businessHours ?? null,
              status: location.status ?? "enabled"
            }
          });
        }
        count("locations", (core.locations ?? []).length);

        // 5. 商品组（套装组成需先有全部商品组，故分两轮）
        for (const group of core.itemGroups ?? []) {
          await tx.rentalItemGroup.upsert({
            where: { id: group.id },
            update: {},
            create: {
              id: group.id,
              tenantId,
              categoryCode: upperEnum(group.categoryCode, `itemGroup(${group.code}).categoryCode`),
              code: group.code,
              name: group.name,
              inventoryMode: upperEnum(group.inventoryMode, `itemGroup(${group.code}).inventoryMode`),
              unit: group.unit ?? "件",
              description: group.description ?? null,
              attributes: json(group.attributes ?? {}),
              status: group.status ?? "enabled",
              createdAt: optionalDate(group.createdAt) ?? new Date()
            }
          });
        }
        count("itemGroups", (core.itemGroups ?? []).length);

        let components = 0;
        const groupIds = new Set((core.itemGroups ?? []).map((row) => row.id));
        for (const group of core.itemGroups ?? []) {
          for (const component of group.bundleComponents ?? []) {
            if (!groupIds.has(component.itemGroupId)) continue;
            await tx.rentalBundleComponent.upsert({
              where: {
                bundleItemGroupId_componentItemGroupId: {
                  bundleItemGroupId: group.id,
                  componentItemGroupId: component.itemGroupId
                }
              },
              update: {},
              create: {
                bundleItemGroupId: group.id,
                componentItemGroupId: component.itemGroupId,
                quantity: component.quantity,
                optional: Boolean(component.optional),
                substitutionGroup: component.substitutionGroup ?? null
              }
            });
            components += 1;
          }
        }
        count("bundleComponents", components);

        // 6. 资产与库存余额（itemGroupName/locationName/availableQuantity 是派生字段，表中不存）
        for (const asset of core.assets ?? []) {
          await tx.rentalAsset.upsert({
            where: { id: asset.id },
            update: {},
            create: {
              id: asset.id,
              tenantId,
              itemGroupId: asset.itemGroupId,
              assetNo: asset.assetNo,
              serialNo: asset.serialNo ?? null,
              locationId: asset.locationId,
              status: upperEnum<$Enums.RentalAssetState>(asset.status, `asset(${asset.assetNo}).status`),
              attributes: json(asset.attributes ?? {}),
              createdAt: optionalDate(asset.createdAt) ?? new Date()
            }
          });
        }
        count("assets", (core.assets ?? []).length);

        for (const stock of core.stockBalances ?? []) {
          await tx.rentalStockBalance.upsert({
            where: { id: stock.id },
            update: {},
            create: {
              id: stock.id,
              tenantId,
              itemGroupId: stock.itemGroupId,
              locationId: stock.locationId,
              onHandQuantity: stock.onHandQuantity ?? 0,
              reservedQuantity: stock.reservedQuantity ?? 0,
              maintenanceQuantity: stock.maintenanceQuantity ?? 0
            }
          });
        }
        count("stockBalances", (core.stockBalances ?? []).length);

        // 7. 优惠券模板 → 客户优惠券（外键依赖）
        for (const template of core.couponTemplates ?? []) {
          await tx.rentalCouponTemplate.upsert({
            where: { id: template.id },
            update: {},
            create: {
              id: template.id,
              tenantId,
              code: template.code,
              name: template.name,
              discountType: template.discountType,
              discountValue: amount(template.discountValue),
              minimumSpend: amount(template.minimumSpend),
              maximumDiscount: template.maximumDiscount === undefined ? null : amount(template.maximumDiscount),
              totalQuota: template.totalQuota ?? 0,
              claimedQuantity: template.claimedQuantity ?? 0,
              perCustomerLimit: template.perCustomerLimit ?? 1,
              effectiveFrom: date(template.effectiveFrom, `couponTemplate(${template.code}).effectiveFrom`),
              effectiveTo: date(template.effectiveTo, `couponTemplate(${template.code}).effectiveTo`),
              applicableItemGroupIds: jsonArray(template.applicableItemGroupIds),
              status: template.status ?? "draft",
              version: template.version ?? "1.0",
              createdAt: optionalDate(template.createdAt) ?? new Date()
            }
          });
        }
        count("couponTemplates", (core.couponTemplates ?? []).length);

        const templateIds = new Set((core.couponTemplates ?? []).map((row) => row.id));
        let customerCoupons = 0;
        for (const coupon of business.customerCoupons ?? []) {
          if (!templateIds.has(coupon.templateId)) {
            throw new Error(`客户优惠券 ${coupon.id} 引用的模板 ${coupon.templateId} 不在快照中`);
          }
          await tx.rentalCustomerCoupon.upsert({
            where: { id: coupon.id },
            update: {},
            create: {
              id: coupon.id,
              tenantId,
              customerId: coupon.customerId,
              templateId: coupon.templateId,
              templateCode: coupon.templateCode,
              templateName: coupon.templateName,
              status: coupon.status ?? "claimed",
              claimedAt: optionalDate(coupon.claimedAt) ?? new Date(),
              effectiveFrom: date(coupon.effectiveFrom, `customerCoupon(${coupon.id}).effectiveFrom`),
              effectiveTo: date(coupon.effectiveTo, `customerCoupon(${coupon.id}).effectiveTo`),
              lockedOrderId: coupon.lockedOrderId ?? null,
              lockedAt: optionalDate(coupon.lockedAt),
              redeemedOrderId: coupon.redeemedOrderId ?? null,
              redeemedAt: optionalDate(coupon.redeemedAt),
              releasedAt: optionalDate(coupon.releasedAt)
            }
          });
          customerCoupons += 1;
        }
        count("customerCoupons", customerCoupons);

        // 8. 检查模板（检查记录的外键依赖）
        for (const template of core.inspectionTemplates ?? []) {
          await tx.rentalInspectionTemplate.upsert({
            where: { id: template.id },
            update: {},
            create: {
              id: template.id,
              tenantId,
              categoryCode: upperEnum(template.categoryCode, `inspectionTemplate(${template.code}).categoryCode`),
              code: template.code,
              name: template.name,
              stage: template.stage,
              version: template.version ?? "1.0",
              fields: jsonArray(template.fields),
              enabled: template.enabled ?? true
            }
          });
        }
        count("inspectionTemplates", (core.inspectionTemplates ?? []).length);

        // 9. 业务配置
        for (const plan of business.pricingPlans ?? []) {
          await tx.rentalPricingPlan.upsert({
            where: { id: plan.id },
            update: {},
            create: {
              id: plan.id,
              tenantId,
              categoryCode: upperEnum(plan.categoryCode, `pricingPlan(${plan.code}).categoryCode`),
              code: plan.code,
              name: plan.name,
              currency: plan.currency ?? "CNY",
              status: plan.status ?? "draft",
              version: plan.version ?? "1.0",
              effectiveFrom: date(plan.effectiveFrom, `pricingPlan(${plan.code}).effectiveFrom`),
              effectiveTo: optionalDate(plan.effectiveTo),
              rates: jsonArray(plan.rates),
              createdAt: optionalDate(plan.createdAt) ?? new Date()
            }
          });
        }
        count("pricingPlans", (business.pricingPlans ?? []).length);

        for (const plan of business.discountPlans ?? []) {
          await tx.rentalDiscountPlan.upsert({
            where: { id: plan.id },
            update: {},
            create: {
              id: plan.id,
              tenantId,
              categoryCode: upperEnum(plan.categoryCode, `discountPlan(${plan.code}).categoryCode`),
              code: plan.code,
              name: plan.name,
              status: plan.status ?? "draft",
              discountType: plan.discountType,
              discountValue: amount(plan.discountValue),
              minimumSpend: amount(plan.minimumSpend),
              maximumDiscount: plan.maximumDiscount === undefined ? null : amount(plan.maximumDiscount),
              customerScope: plan.customerScope ?? "all",
              applicableItemGroupIds: jsonArray(plan.applicableItemGroupIds),
              applicableDayTypes: jsonArray(plan.applicableDayTypes),
              priority: plan.priority ?? 0,
              stackableWithCoupon: plan.stackableWithCoupon ?? true,
              effectiveFrom: date(plan.effectiveFrom, `discountPlan(${plan.code}).effectiveFrom`),
              effectiveTo: optionalDate(plan.effectiveTo),
              version: plan.version ?? "1.0",
              createdAt: optionalDate(plan.createdAt) ?? new Date()
            }
          });
        }
        count("discountPlans", (business.discountPlans ?? []).length);

        for (const service of business.services ?? []) {
          await tx.rentalValueAddedService.upsert({
            where: { id: service.id },
            update: {},
            create: {
              id: service.id,
              tenantId,
              categoryCode: upperEnum(service.categoryCode, `service(${service.code}).categoryCode`),
              code: service.code,
              name: service.name,
              serviceType: service.serviceType,
              billingUnit: service.billingUnit,
              price: amount(service.price),
              maximumQuantity: service.maximumQuantity ?? 1,
              coverageLimit: service.coverageLimit === undefined ? null : amount(service.coverageLimit),
              deductible: service.deductible === undefined ? null : amount(service.deductible),
              termsVersion: service.termsVersion ?? "1.0",
              terms: service.terms ?? "",
              applicableItemGroupIds: jsonArray(service.applicableItemGroupIds),
              status: service.status ?? "enabled",
              version: service.version ?? "1.0",
              createdAt: optionalDate(service.createdAt) ?? new Date()
            }
          });
        }
        count("valueAddedServices", (business.services ?? []).length);

        for (const rule of business.ruleVersions ?? []) {
          await tx.rentalRuleVersion.upsert({
            where: { id: rule.id },
            update: {},
            create: {
              id: rule.id,
              tenantId,
              categoryCode: upperEnum(rule.categoryCode, `ruleVersion(${rule.version}).categoryCode`),
              version: rule.version,
              status: rule.status ?? "draft",
              config: json(rule.config),
              changeReason: rule.changeReason ?? "",
              createdBy: rule.createdBy ?? "backfill",
              createdAt: optionalDate(rule.createdAt) ?? new Date(),
              publishedAt: optionalDate(rule.publishedAt)
            }
          });
        }
        count("ruleVersions", (business.ruleVersions ?? []).length);

        for (const calendar of business.calendars ?? []) {
          await tx.rentalBusinessCalendar.upsert({
            where: { tenantId_year: { tenantId, year: calendar.year } },
            update: {},
            create: {
              tenantId,
              year: calendar.year,
              region: calendar.region ?? "CN",
              version: calendar.version ?? "1.0",
              status: calendar.status ?? "draft",
              sourceName: calendar.sourceName ?? null,
              sourceUrl: calendar.sourceUrl ?? null,
              sourcePublishedAt: optionalDate(calendar.sourcePublishedAt),
              importedAt: optionalDate(calendar.importedAt),
              publishedAt: optionalDate(calendar.publishedAt),
              days: jsonArray(calendar.days)
            }
          });
        }
        count("businessCalendars", (business.calendars ?? []).length);

        for (const template of business.notificationTemplates ?? []) {
          await tx.rentalNotificationTemplate.upsert({
            where: { id: template.id },
            update: {},
            create: {
              id: template.id,
              tenantId,
              eventCode: template.eventCode,
              channel: template.channel,
              name: template.name,
              title: template.title,
              body: template.body,
              variableSchema: json(template.variableSchema ?? {}),
              status: template.status ?? "enabled",
              version: template.version ?? "1.0"
            }
          });
        }
        count("notificationTemplates", (business.notificationTemplates ?? []).length);

        // 10. 报价（订单引用报价号，但不建外键；报价先插以便对账）
        for (const quote of business.quotes ?? []) {
          await tx.rentalQuote.upsert({
            where: { id: quote.id },
            update: {},
            create: {
              id: quote.id,
              tenantId,
              quoteNo: quote.quoteNo,
              categoryCode: upperEnum(quote.categoryCode, `quote(${quote.quoteNo}).categoryCode`),
              request: json(quote.request),
              chargeLines: jsonArray(quote.chargeLines),
              rentalAmount: amount(quote.rentalAmount),
              discountAmount: amount(quote.discountAmount),
              couponAmount: amount(quote.couponAmount),
              serviceAmount: amount(quote.serviceAmount),
              depositAmount: amount(quote.depositAmount),
              payableAmount: amount(quote.payableAmount),
              pricingPlanVersion: quote.pricingPlanVersion ?? "1.0",
              ruleVersion: quote.ruleVersion ?? "1.0",
              ruleSnapshot: json(quote.ruleSnapshot),
              calendarVersion: quote.calendarVersion ?? null,
              appliedDiscountPlanIds: jsonArray(quote.appliedDiscountPlanIds),
              customerCouponId: quote.customerCouponId ?? null,
              expiresAt: date(quote.expiresAt, `quote(${quote.quoteNo}).expiresAt`),
              consumedAt: optionalDate(quote.consumedAt),
              consumedOrderId: quote.consumedOrderId ?? null,
              createdAt: optionalDate(quote.createdAt) ?? new Date()
            }
          });
        }
        count("quotes", (business.quotes ?? []).length);

        // 11. 订单 → 行 → 预占 → 分配
        let lines = 0;
        let reservations = 0;
        let allocations = 0;
        const assetIds = new Set((core.assets ?? []).map((row) => row.id));
        for (const order of core.orders ?? []) {
          await tx.rentalOrder.upsert({
            where: { id: order.id },
            update: {},
            create: {
              id: order.id,
              tenantId,
              orderNo: order.orderNo,
              categoryCode: upperEnum(order.categoryCode, `order(${order.orderNo}).categoryCode`),
              status: upperEnum<$Enums.RentalOrderV1Status>(order.status, `order(${order.orderNo}).status`),
              customerType: order.customerType,
              customerId: order.customerId ?? null,
              customerName: order.customerName,
              contactPhone: order.contactPhone ?? null,
              fulfillmentMode: order.fulfillmentMode,
              fulfillmentLocationId: order.fulfillmentLocationId,
              fulfillmentLocationName: order.fulfillmentLocationName,
              returnLocationId: order.returnLocationId ?? null,
              returnLocationName: order.returnLocationName ?? null,
              startAt: date(order.startAt, `order(${order.orderNo}).startAt`),
              endAt: date(order.endAt, `order(${order.orderNo}).endAt`),
              quoteId: order.quoteId,
              quoteNo: order.quoteNo,
              pricingPlanVersion: order.pricingPlanVersion,
              ruleVersion: order.ruleVersion,
              ruleSnapshot: json(order.ruleSnapshot),
              calendarVersion: order.calendarVersion ?? null,
              chargeLines: jsonArray(order.chargeLines),
              rentalAmount: amount(order.rentalAmount),
              discountAmount: amount(order.discountAmount),
              couponAmount: amount(order.couponAmount),
              serviceAmount: amount(order.serviceAmount),
              depositAmount: amount(order.depositAmount),
              payableAmount: amount(order.payableAmount),
              adjustmentAmount: amount(order.adjustmentAmount),
              finalPayableAmount: amount(order.finalPayableAmount),
              totalAmount: amount(order.totalAmount),
              cancellationReason: order.cancellationReason ?? null,
              cancelledAt: optionalDate(order.cancelledAt),
              completedAt: optionalDate(order.completedAt),
              createdBy: order.createdBy ?? "backfill",
              createdAt: optionalDate(order.createdAt) ?? new Date()
            }
          });

          for (const line of order.lines ?? []) {
            await tx.rentalOrderLine.upsert({
              where: { id: line.id },
              update: {},
              create: {
                id: line.id,
                orderId: order.id,
                itemGroupId: line.itemGroupId,
                itemGroupCode: line.itemGroupCode,
                itemGroupName: line.itemGroupName,
                inventoryMode: upperEnum(line.inventoryMode, `orderLine(${line.id}).inventoryMode`),
                quantity: line.quantity,
                unitPrice: amount(line.unitPrice),
                amount: amount(line.amount),
                note: line.note ?? null
              }
            });
            lines += 1;
          }

          for (const reservation of order.reservations ?? []) {
            await tx.rentalReservation.upsert({
              where: { id: reservation.id },
              update: {},
              create: {
                id: reservation.id,
                tenantId,
                orderId: order.id,
                orderLineId: reservation.orderLineId,
                itemGroupId: reservation.itemGroupId,
                locationId: reservation.locationId,
                quantity: reservation.quantity,
                // 预占的起止期间在快照里由订单承载，回填时取订单期间。
                startAt: date(order.startAt, `reservation(${reservation.id}).startAt`),
                endAt: date(order.endAt, `reservation(${reservation.id}).endAt`),
                status: upperEnum<$Enums.RentalReservationState>(reservation.status, `reservation(${reservation.id}).status`),
                expiresAt: optionalDate(reservation.expiresAt),
                createdAt: optionalDate(reservation.createdAt) ?? new Date()
              }
            });
            reservations += 1;
          }

          for (const allocation of order.allocations ?? []) {
            await tx.rentalAllocation.upsert({
              where: { id: allocation.id },
              update: {},
              create: {
                id: allocation.id,
                orderId: order.id,
                orderLineId: allocation.orderLineId,
                assetId: allocation.assetId && assetIds.has(allocation.assetId) ? allocation.assetId : null,
                assetNo: allocation.assetNo ?? null,
                quantity: allocation.quantity ?? 1,
                status: allocation.status ?? "allocated"
              }
            });
            allocations += 1;
          }
        }
        count("orders", (core.orders ?? []).length);
        count("orderLines", lines);
        count("reservations", reservations);
        count("allocations", allocations);

        // 12. 检查记录
        const inspectionTemplateIds = new Set((core.inspectionTemplates ?? []).map((row) => row.id));
        let inspections = 0;
        for (const record of core.inspections ?? []) {
          if (!inspectionTemplateIds.has(record.templateId)) {
            throw new Error(`检查记录 ${record.id} 引用的模板 ${record.templateId} 不在快照中`);
          }
          await tx.rentalInspectionRecord.upsert({
            where: { id: record.id },
            update: {},
            create: {
              id: record.id,
              tenantId,
              orderId: record.orderId,
              stage: record.stage,
              templateId: record.templateId,
              templateCode: record.templateCode,
              templateVersion: record.templateVersion,
              results: json(record.results ?? {}),
              exceptions: jsonArray(record.exceptions),
              attachments: jsonArray(record.attachments),
              operator: record.operator ?? "backfill",
              createdAt: optionalDate(record.createdAt) ?? new Date()
            }
          });
          inspections += 1;
        }
        count("inspections", inspections);

        // 13. 通知发送记录（外键依赖通知模板）
        const notificationTemplateIds = new Set((business.notificationTemplates ?? []).map((row) => row.id));
        let notificationLogs = 0;
        for (const log of business.notificationLogs ?? []) {
          if (!notificationTemplateIds.has(log.templateId)) {
            throw new Error(`通知记录 ${log.id} 引用的模板 ${log.templateId} 不在快照中`);
          }
          await tx.rentalNotificationLog.upsert({
            where: { id: log.id },
            update: {},
            create: {
              id: log.id,
              tenantId,
              templateId: log.templateId,
              templateVersion: log.templateVersion ?? "1.0",
              eventCode: log.eventCode,
              channel: log.channel,
              recipient: log.recipient,
              renderedTitle: log.renderedTitle,
              renderedBody: log.renderedBody,
              variables: json(log.variables ?? {}),
              status: log.status ?? "queued",
              provider: log.provider ?? "mock",
              providerMessageId: log.providerMessageId ?? null,
              errorMessage: log.errorMessage ?? null,
              attempts: log.attempts ?? 0,
              sentAt: optionalDate(log.sentAt),
              createdAt: optionalDate(log.createdAt) ?? new Date()
            }
          });
          notificationLogs += 1;
        }
        count("notificationLogs", notificationLogs);

        // 14. 奖励流水、权益账户与邀请关系
        for (const entry of business.rewardLedger ?? []) {
          await tx.rentalRewardLedgerEntry.upsert({
            where: { id: entry.id },
            update: {},
            create: {
              id: entry.id,
              tenantId,
              customerId: entry.customerId,
              rewardType: entry.rewardType,
              amount: amount(entry.amount),
              triggerType: entry.triggerType,
              idempotencyKey: entry.idempotencyKey,
              relatedCustomerId: entry.relatedCustomerId ?? null,
              status: entry.status ?? "granted",
              reason: entry.reason ?? "",
              benefitReferenceIds: entry.benefitReferenceIds ? jsonArray(entry.benefitReferenceIds) : undefined,
              appliedAt: optionalDate(entry.appliedAt),
              reversedAt: optionalDate(entry.reversedAt),
              createdAt: optionalDate(entry.createdAt) ?? new Date()
            }
          });
        }
        count("rewardLedger", (business.rewardLedger ?? []).length);

        for (const account of business.benefitAccounts ?? []) {
          await tx.rentalBenefitAccount.upsert({
            where: { tenantId_customerId: { tenantId, customerId: account.customerId } },
            update: {},
            create: {
              tenantId,
              customerId: account.customerId,
              pointsBalance: amount(account.pointsBalance),
              marketingBalance: amount(account.marketingBalance),
              availableRewardCouponCount: account.availableRewardCouponCount ?? 0
            }
          });
        }
        count("benefitAccounts", (business.benefitAccounts ?? []).length);

        for (const referral of business.referrals ?? []) {
          await tx.rentalReferral.upsert({
            where: { tenantId_inviteeCustomerId: { tenantId, inviteeCustomerId: referral.inviteeCustomerId } },
            update: {},
            create: {
              tenantId,
              inviteeCustomerId: referral.inviteeCustomerId,
              referrerCustomerId: referral.referrerCustomerId,
              registeredAt: optionalDate(referral.registeredAt) ?? new Date()
            }
          });
        }
        count("referrals", (business.referrals ?? []).length);
      },
      { timeout: 60_000 }
    );

    const summary = Object.entries(inserted).map(([key, value]) => `${key}=${value}`).join(" ");
    // 计数是"本次处理的快照条目数"，不等于"新插入行数"——写入是 upsert，已存在的条目也计入。
    this.logger.log(`租户 ${tenantId} 回填完成（按快照条目计）：${summary || "无可回填数据"}`);
    return { tenantId, skipped: false, inserted };
  }
}
