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
} from "@rental-os/shared";
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
  workspaceId?: string;
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

  /**
   * 叶子记录的唯一约束冲突只记录分歧，不回滚整租户。
   * 有下游外键的父记录不能只跳过：backfillTenant 内会按租户业务键保留现存主档，
   * 建立快照 ID 到真实 ID 的映射，再让子记录使用映射后的外键。
   */
  private async writeOne(label: string, divergences: string[], run: () => Promise<unknown>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "P2002") throw error;
      divergences.push(label);
      return false;
    }
  }

  async run(): Promise<BackfillTenantResult[]> {
    const [coreRows, businessRows] = await Promise.all([
      this.prisma.rentalCoreStateSnapshot.findMany(),
      this.prisma.rentalBusinessStateSnapshot.findMany()
    ]);
    const snapshots = new Map<string, { tenantId: string; core: CoreSnapshotState; business: BusinessSnapshotState }>();
    for (const row of coreRows) {
      const current = snapshots.get(row.workspaceId) ?? { tenantId: row.tenantId, core: {}, business: {} };
      current.core = row.state as unknown as CoreSnapshotState;
      snapshots.set(row.workspaceId, current);
    }
    for (const row of businessRows) {
      const current = snapshots.get(row.workspaceId) ?? { tenantId: row.tenantId, core: {}, business: {} };
      current.business = row.state as unknown as BusinessSnapshotState;
      snapshots.set(row.workspaceId, current);
    }

    const results: BackfillTenantResult[] = [];
    for (const [workspaceId, snapshot] of snapshots) {
      const { tenantId, core, business } = snapshot;
      try {
        results.push(await this.backfillTenant(tenantId, workspaceId, core, business));
      } catch (error) {
        const reason = (error as Error).message;
        this.logger.error(`租户 ${tenantId} 空间 ${workspaceId} 快照回填失败，已回滚该空间：${reason}`);
        results.push({ tenantId, workspaceId, skipped: true, reason, inserted: {} });
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
   * 快路径：快照里每一条记录的**主键或完整复合键**是否都已在库中存在。
   *
   * 早前两版都不成立：第一版用「任一表非空」判定，部分填充的租户被永久跳过；
   * 第二版改成逐类比对行数，但只比数量——快照期望 A、B 而库里是 A、C 时数量相等，
   * 会被误判为已完整，缺失的 B 永远补不回。
   * 现在按键集合判定：只要有任一条快照记录的键不在库中，就重跑整轮 upsert
   * （upsert 对已存在的行无害，代价只是一次多余写入）。
   */
  private async alreadyBackfilled(
    tenantId: string,
    workspaceId: string,
    core: CoreSnapshotState,
    business: BusinessSnapshotState
  ) {
    const checks: Array<{ keys: string[]; existing: () => Promise<string[]> }> = [
      {
        keys: (core.operators ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalFulfillmentOperator.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (core.locations ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalFulfillmentLocation.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (core.itemGroups ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalItemGroup.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      { keys: (core.assets ?? []).map((row) => row.id), existing: async () =>
          (await this.prisma.rentalAsset.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id) },
      {
        keys: (core.stockBalances ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalStockBalance.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (core.couponTemplates ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalCouponTemplate.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (core.inspectionTemplates ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalInspectionTemplate.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      { keys: (core.orders ?? []).map((row) => row.id), existing: async () =>
          (await this.prisma.rentalOrder.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id) },
      {
        keys: (core.inspections ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalInspectionRecord.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      { keys: (business.quotes ?? []).map((row) => row.id), existing: async () =>
          (await this.prisma.rentalQuote.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id) },
      {
        keys: (business.customerCoupons ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalCustomerCoupon.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (business.rewardLedger ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalRewardLedgerEntry.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (business.notificationTemplates ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalNotificationTemplate.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (business.notificationLogs ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalNotificationLog.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (business.pricingPlans ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalPricingPlan.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (business.discountPlans ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalDiscountPlan.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (business.services ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalValueAddedService.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (business.ruleVersions ?? []).map((row) => row.id),
        existing: async () =>
          (await this.prisma.rentalRuleVersion.findMany({ where: { tenantId, workspaceId }, select: { id: true } }))
            .map((row) => row.id)
      },
      {
        keys: (business.benefitAccounts ?? []).map((row) => row.customerId),
        existing: async () =>
          (await this.prisma.rentalBenefitAccount.findMany({ where: { tenantId, workspaceId }, select: { customerId: true } }))
            .map((row) => row.customerId)
      },
      {
        keys: (business.referrals ?? []).map((row) => row.inviteeCustomerId),
        existing: async () =>
          (await this.prisma.rentalReferral.findMany({ where: { tenantId, workspaceId }, select: { inviteeCustomerId: true } }))
            .map((row) => row.inviteeCustomerId)
      },
      {
        keys: (business.calendars ?? []).map((row) => String(row.year)),
        existing: async () =>
          (await this.prisma.rentalBusinessCalendar.findMany({ where: { tenantId, workspaceId }, select: { year: true } }))
            .map((row) => String(row.year))
      }
    ];

    const pending = checks.filter((row) => row.keys.length > 0);
    if (!pending.length) return false;
    const existingSets = await Promise.all(pending.map((row) => row.existing()));
    return pending.every((row, index) => {
      const present = new Set(existingSets[index]);
      return row.keys.every((key) => present.has(key));
    });
  }

  private async backfillTenant(
    tenantId: string,
    workspaceId: string,
    core: CoreSnapshotState,
    business: BusinessSnapshotState
  ): Promise<BackfillTenantResult> {
    if (await this.alreadyBackfilled(tenantId, workspaceId, core, business)) {
      return { tenantId, workspaceId, skipped: true, reason: "已存在规范化数据", inserted: {} };
    }
    // 租户必须存在，否则所有外键都会失败——这属于数据不一致，应明确报错。
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new Error("Tenant 表中不存在该租户");

    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { id: workspaceId, tenantId },
      select: { id: true }
    });
    if (!workspace) throw new Error("快照所属经营空间不存在或不属于该租户");

    const inserted: Record<string, number> = {};
    const count = (key: string, n: number) => {
      if (n > 0) inserted[key] = n;
    };

    await this.prisma.$transaction(
      async (tx) => {
        const divergences: string[] = [];
        const categoryCode = core.profile?.categoryCode ?? business.categoryCode;
        const operatorIdMap = new Map<string, string>();
        const locationIdMap = new Map<string, string>();
        const itemGroupIdMap = new Map<string, string>();
        const couponTemplateIdMap = new Map<string, string>();
        const inspectionTemplateIdMap = new Map<string, string>();
        const notificationTemplateIdMap = new Map<string, string>();
        const assetIdMap = new Map<string, string>();
        const orderIdMap = new Map<string, string>();
        const orderLineIdMap = new Map<string, string>();

        // 快照主键与库中现存主键可能不同，但业务唯一键相同。此时保留库中主档，
        // 并把快照子记录的外键映射到现存主键；只“吞掉 P2002”会让子记录继续引用
        // 不存在的旧主键，随后以 P2003 回滚整租户。
        const resolveId = async (
          label: string,
          snapshotId: string,
          findExisting: () => Promise<{ id: string } | null>,
          write: () => Promise<{ id: string }>
        ): Promise<string | undefined> => {
          const existing = await findExisting();
          if (existing) {
            if (existing.id !== snapshotId) divergences.push(`${label}(${snapshotId}->${existing.id})`);
            return existing.id;
          }
          try {
            return (await write()).id;
          } catch (error) {
            const code = (error as { code?: string }).code;
            if (code !== "P2002") throw error;
            // 多实例同时回填时，另一个事务可能刚写入同一业务键。重新查询并采用它；
            // 若仍找不到，通常是快照主键撞到了其他租户的全局主键，必须安全跳过。
            const raced = await findExisting();
            if (raced) {
              divergences.push(`${label}(${snapshotId}->${raced.id})`);
              return raced.id;
            }
            divergences.push(`${label}(${snapshotId}):unresolved-unique-conflict`);
            return undefined;
          }
        };

        // 1. 品类档案：seed 可能已建，用 upsert 避免冲突。
        const snapshotProfile = core.profile;
        if (categoryCode && snapshotProfile) {
          await this.writeOne("tenantRentalProfile", divergences, () =>
            tx.tenantRentalProfile.upsert({
            where: { tenantId },
            create: {
              tenantId,
              categoryCode: upperEnum(categoryCode, "profile.categoryCode"),
              capabilities: jsonArray(snapshotProfile.capabilities),
              terminology: json(snapshotProfile.terminology),
              configVersion: snapshotProfile.configVersion ?? "0.1.0",
              initializedAt: optionalDate(snapshotProfile.initializedAt) ?? new Date()
            },
            update: {}
          }));
        }

        // 2. 业务设置
        if (categoryCode && core.businessSettings) {
          const settings = core.businessSettings as TenantRentalBusinessSettings & { updatedBy?: string };
          await this.writeOne("rentalTenantBusinessSettings", divergences, () =>
            tx.rentalTenantBusinessSettings.upsert({
            where: { workspaceId },
            create: {
              tenantId,
              workspaceId,
              categoryCode: upperEnum(categoryCode, "businessSettings.categoryCode"),
              configVersion: settings.configVersion ?? "0.1.0",
              settingsRevision: 1,
              settings: json(settings),
              updatedBy: settings.updatedBy ?? "backfill"
            },
            update: {}
          }));
          count("businessSettings", 1);
        }

        // 3. 经营主体 → 4. 履约地点（地点的 operatorId 外键依赖主体）
        for (const operator of core.operators ?? []) {
          const resolvedId = await resolveId(
            "rentalFulfillmentOperator",
            operator.id,
            () => tx.rentalFulfillmentOperator.findUnique({
              where: { workspaceId_code: { workspaceId, code: operator.code } },
              select: { id: true }
            }),
            () =>
            tx.rentalFulfillmentOperator.upsert({
            where: { workspaceId_code: { workspaceId, code: operator.code } },
            update: {},
            create: {
              id: operator.id,
              tenantId,
              workspaceId,
              code: operator.code,
              name: operator.name,
              type: operator.type,
              contactName: operator.contactName ?? null,
              contactPhone: operator.contactPhone ?? null,
              settlementMode: operator.settlementMode ?? null,
              status: operator.status ?? "enabled",
              createdAt: optionalDate(operator.createdAt) ?? new Date()
            },
            select: { id: true }
          }));
          if (resolvedId) operatorIdMap.set(operator.id, resolvedId);
        }
        count("operators", (core.operators ?? []).length);

        const operatorIds = new Set((core.operators ?? []).map((row) => row.id));
        for (const location of core.locations ?? []) {
          const resolvedId = await resolveId(
            "rentalFulfillmentLocation",
            location.id,
            () => tx.rentalFulfillmentLocation.findUnique({
              where: { workspaceId_code: { workspaceId, code: location.code } },
              select: { id: true }
            }),
            () =>
            tx.rentalFulfillmentLocation.upsert({
            where: { workspaceId_code: { workspaceId, code: location.code } },
            update: {},
            create: {
              id: location.id,
              tenantId,
              workspaceId,
              code: location.code,
              name: location.name,
              type: location.type,
              // 快照里的 operatorId 可能指向已不存在的主体，置空而不是让整个租户回填失败。
              operatorId: location.operatorId && operatorIds.has(location.operatorId)
                ? operatorIdMap.get(location.operatorId) ?? null
                : null,
              operatorType: location.operatorType ?? null,
              operatorName: location.operatorName ?? null,
              parentLocationId: location.parentLocationId
                ? locationIdMap.get(location.parentLocationId) ?? location.parentLocationId
                : null,
              capabilities: jsonArray(location.capabilities),
              address: location.address ?? null,
              contactName: location.contactName ?? null,
              contactPhone: location.contactPhone ?? null,
              businessHours: location.businessHours ?? null,
              status: location.status ?? "enabled"
            },
            select: { id: true }
          }));
          if (resolvedId) locationIdMap.set(location.id, resolvedId);
        }
        count("locations", (core.locations ?? []).length);

        // 5. 商品组（套装组成需先有全部商品组，故分两轮）
        for (const group of core.itemGroups ?? []) {
          const resolvedId = await resolveId(
            "rentalItemGroup",
            group.id,
            () => tx.rentalItemGroup.findUnique({
              where: { workspaceId_code: { workspaceId, code: group.code } },
              select: { id: true }
            }),
            () =>
            tx.rentalItemGroup.upsert({
            where: { workspaceId_code: { workspaceId, code: group.code } },
            update: {},
            create: {
              id: group.id,
              tenantId,
              workspaceId,
              categoryCode: upperEnum(group.categoryCode, `itemGroup(${group.code}).categoryCode`),
              code: group.code,
              name: group.name,
              inventoryMode: upperEnum(group.inventoryMode, `itemGroup(${group.code}).inventoryMode`),
              unit: group.unit ?? "件",
              description: group.description ?? null,
              attributes: json(group.attributes ?? {}),
              status: group.status ?? "enabled",
              createdAt: optionalDate(group.createdAt) ?? new Date()
            },
            select: { id: true }
          }));
          if (resolvedId) itemGroupIdMap.set(group.id, resolvedId);
        }
        count("itemGroups", (core.itemGroups ?? []).length);

        let components = 0;
        for (const group of core.itemGroups ?? []) {
          for (const component of group.bundleComponents ?? []) {
            const bundleItemGroupId = itemGroupIdMap.get(group.id);
            const componentItemGroupId = itemGroupIdMap.get(component.itemGroupId);
            if (!bundleItemGroupId || !componentItemGroupId) {
              divergences.push(`rentalBundleComponent(${group.id}->${component.itemGroupId})`);
              continue;
            }
            await this.writeOne("rentalBundleComponent", divergences, () =>
              tx.rentalBundleComponent.upsert({
                where: {
                  bundleItemGroupId_componentItemGroupId: {
                    bundleItemGroupId,
                    componentItemGroupId
                  }
                },
              update: {},
              create: {
                bundleItemGroupId,
                componentItemGroupId,
                quantity: component.quantity,
                optional: Boolean(component.optional),
                substitutionGroup: component.substitutionGroup ?? null
              }
            }));
            components += 1;
          }
        }
        count("bundleComponents", components);

        // 6. 资产与库存余额（itemGroupName/locationName/availableQuantity 是派生字段，表中不存）
        for (const asset of core.assets ?? []) {
          const itemGroupId = itemGroupIdMap.get(asset.itemGroupId);
          const locationId = locationIdMap.get(asset.locationId);
          if (!itemGroupId || !locationId) {
            divergences.push(`rentalAsset(${asset.id}):parent-missing`);
            continue;
          }
          const resolvedId = await resolveId(
            "rentalAsset",
            asset.id,
            () => tx.rentalAsset.findUnique({
              where: { workspaceId_assetNo: { workspaceId, assetNo: asset.assetNo } },
              select: { id: true }
            }),
            () =>
            tx.rentalAsset.upsert({
            where: { workspaceId_assetNo: { workspaceId, assetNo: asset.assetNo } },
            update: {},
            create: {
              id: asset.id,
              tenantId,
              workspaceId,
              itemGroupId,
              assetNo: asset.assetNo,
              serialNo: asset.serialNo ?? null,
              locationId,
              status: upperEnum<$Enums.RentalAssetState>(asset.status, `asset(${asset.assetNo}).status`),
              attributes: json(asset.attributes ?? {}),
              createdAt: optionalDate(asset.createdAt) ?? new Date()
            },
            select: { id: true }
          }));
          if (resolvedId) assetIdMap.set(asset.id, resolvedId);
        }
        count("assets", (core.assets ?? []).length);

        for (const stock of core.stockBalances ?? []) {
          const itemGroupId = itemGroupIdMap.get(stock.itemGroupId);
          const locationId = locationIdMap.get(stock.locationId);
          if (!itemGroupId || !locationId) {
            divergences.push(`rentalStockBalance(${stock.id}):parent-missing`);
            continue;
          }
          await this.writeOne("rentalStockBalance", divergences, () =>
            tx.rentalStockBalance.upsert({
            where: { id: stock.id },
            update: {},
            create: {
              id: stock.id,
              tenantId,
              workspaceId,
              itemGroupId,
              locationId,
              onHandQuantity: stock.onHandQuantity ?? 0,
              reservedQuantity: stock.reservedQuantity ?? 0,
              maintenanceQuantity: stock.maintenanceQuantity ?? 0
            }
          }));
        }
        count("stockBalances", (core.stockBalances ?? []).length);

        // 7. 优惠券模板 → 客户优惠券（外键依赖）
        for (const template of core.couponTemplates ?? []) {
          const resolvedId = await resolveId(
            "rentalCouponTemplate",
            template.id,
            () => tx.rentalCouponTemplate.findUnique({
              where: { workspaceId_code: { workspaceId, code: template.code } },
              select: { id: true }
            }),
            () =>
            tx.rentalCouponTemplate.upsert({
            where: { workspaceId_code: { workspaceId, code: template.code } },
            update: {},
            create: {
              id: template.id,
              tenantId,
              workspaceId,
              code: template.code,
              name: template.name,
              discountType: template.discountType,
              discountValue: amount(template.discountValue),
              minimumSpend: amount(template.minimumSpend),
              maximumDiscount: template.maximumDiscount === undefined ? null : amount(template.maximumDiscount),
              totalQuota: template.totalQuota ?? 0,
              claimedQuantity: template.claimedQuantity ?? 0,
              perCustomerLimit: template.perCustomerLimit ?? 1,
              claimFrom: date(template.claimFrom ?? template.effectiveFrom, `couponTemplate(${template.code}).claimFrom`),
              claimTo: date(template.claimTo ?? template.effectiveTo, `couponTemplate(${template.code}).claimTo`),
              effectiveFrom: date(template.effectiveFrom, `couponTemplate(${template.code}).effectiveFrom`),
              effectiveTo: date(template.effectiveTo, `couponTemplate(${template.code}).effectiveTo`),
              applicableRentalFrom: optionalDate(template.applicableRentalFrom),
              applicableRentalTo: optionalDate(template.applicableRentalTo),
              applicableItemGroupIds: jsonArray(
                (template.applicableItemGroupIds ?? []).flatMap((id) => itemGroupIdMap.get(id) ?? [])
              ),
              status: template.status ?? "draft",
              version: template.version ?? "1.0",
              createdAt: optionalDate(template.createdAt) ?? new Date()
            },
            select: { id: true }
          }));
          if (resolvedId) couponTemplateIdMap.set(template.id, resolvedId);
        }
        count("couponTemplates", (core.couponTemplates ?? []).length);

        let customerCoupons = 0;
        for (const coupon of business.customerCoupons ?? []) {
          const templateId = couponTemplateIdMap.get(coupon.templateId);
          const template = (core.couponTemplates ?? []).find((row) => row.id === coupon.templateId);
          if (!templateId) {
            divergences.push(`rentalCustomerCoupon(${coupon.id}):template-missing`);
            continue;
          }
          await this.writeOne("rentalCustomerCoupon", divergences, () =>
            tx.rentalCustomerCoupon.upsert({
            where: { id: coupon.id },
            update: {},
            create: {
              id: coupon.id,
              tenantId,
              workspaceId,
              customerId: coupon.customerId,
              templateId,
              templateCode: coupon.templateCode,
              templateName: coupon.templateName,
              templateVersion: coupon.templateVersion ?? template?.version ?? "legacy",
              discountType: coupon.discountType ?? template?.discountType ?? "fixed",
              discountValue: amount(coupon.discountValue ?? template?.discountValue ?? 0),
              minimumSpend: amount(coupon.minimumSpend ?? template?.minimumSpend ?? 0),
              maximumDiscount: (coupon.maximumDiscount ?? template?.maximumDiscount) === undefined
                ? null
                : amount(coupon.maximumDiscount ?? template?.maximumDiscount ?? 0),
              appliesTo: coupon.appliesTo ?? template?.appliesTo ?? "rental",
              stackableWithDiscountPlans: coupon.stackableWithDiscountPlans ?? template?.stackableWithDiscountPlans ?? true,
              applicableItemGroupIds: jsonArray(coupon.applicableItemGroupIds ?? template?.applicableItemGroupIds ?? []),
              grantReason: coupon.grantReason ?? "legacy_snapshot_backfill",
              status: coupon.status ?? "claimed",
              claimedAt: optionalDate(coupon.claimedAt) ?? new Date(),
              applicableRentalFrom: optionalDate(coupon.applicableRentalFrom ?? template?.applicableRentalFrom),
              applicableRentalTo: optionalDate(coupon.applicableRentalTo ?? template?.applicableRentalTo),
              effectiveFrom: date(coupon.effectiveFrom, `customerCoupon(${coupon.id}).effectiveFrom`),
              effectiveTo: date(coupon.effectiveTo, `customerCoupon(${coupon.id}).effectiveTo`),
              lockedOrderId: coupon.lockedOrderId ?? null,
              lockedAt: optionalDate(coupon.lockedAt),
              lockedDiscountAmount: coupon.lockedDiscountAmount === undefined ? null : amount(coupon.lockedDiscountAmount),
              redeemedOrderId: coupon.redeemedOrderId ?? null,
              redeemedAt: optionalDate(coupon.redeemedAt),
              releasedAt: optionalDate(coupon.releasedAt),
              releaseReason: coupon.releaseReason ?? null,
              expiredAt: optionalDate(coupon.expiredAt),
              voidedAt: optionalDate(coupon.voidedAt),
              voidReason: coupon.voidReason ?? null
            }
          }));
          customerCoupons += 1;
        }
        count("customerCoupons", customerCoupons);

        // 8. 检查模板（检查记录的外键依赖）
        for (const template of core.inspectionTemplates ?? []) {
          const resolvedId = await resolveId(
            "rentalInspectionTemplate",
            template.id,
            () => tx.rentalInspectionTemplate.findUnique({
              where: {
                workspaceId_code_version: { workspaceId, code: template.code, version: template.version ?? "1.0" }
              },
              select: { id: true }
            }),
            () =>
            tx.rentalInspectionTemplate.upsert({
            where: {
              workspaceId_code_version: { workspaceId, code: template.code, version: template.version ?? "1.0" }
            },
            update: {},
            create: {
              id: template.id,
              tenantId,
              workspaceId,
              categoryCode: upperEnum(template.categoryCode, `inspectionTemplate(${template.code}).categoryCode`),
              code: template.code,
              name: template.name,
              stage: template.stage,
              version: template.version ?? "1.0",
              fields: jsonArray(template.fields),
              enabled: template.enabled ?? true
            },
            select: { id: true }
          }));
          if (resolvedId) inspectionTemplateIdMap.set(template.id, resolvedId);
        }
        count("inspectionTemplates", (core.inspectionTemplates ?? []).length);

        // 9. 业务配置
        for (const plan of business.pricingPlans ?? []) {
          await this.writeOne("rentalPricingPlan", divergences, () =>
            tx.rentalPricingPlan.upsert({
            where: { id: plan.id },
            update: {},
            create: {
              id: plan.id,
              tenantId,
              workspaceId,
              categoryCode: upperEnum(plan.categoryCode, `pricingPlan(${plan.code}).categoryCode`),
              code: plan.code,
              name: plan.name,
              currency: plan.currency ?? "CNY",
              status: plan.status ?? "draft",
              version: plan.version ?? "1.0",
              effectiveFrom: date(plan.effectiveFrom, `pricingPlan(${plan.code}).effectiveFrom`),
              effectiveTo: optionalDate(plan.effectiveTo),
              rates: jsonArray(plan.rates.map((rate) => ({
                ...rate,
                itemGroupId: itemGroupIdMap.get(rate.itemGroupId) ?? rate.itemGroupId
              }))),
              createdAt: optionalDate(plan.createdAt) ?? new Date()
            }
          }));
        }
        count("pricingPlans", (business.pricingPlans ?? []).length);

        for (const plan of business.discountPlans ?? []) {
          await this.writeOne("rentalDiscountPlan", divergences, () =>
            tx.rentalDiscountPlan.upsert({
            where: { id: plan.id },
            update: {},
            create: {
              id: plan.id,
              tenantId,
              workspaceId,
              categoryCode: upperEnum(plan.categoryCode, `discountPlan(${plan.code}).categoryCode`),
              code: plan.code,
              name: plan.name,
              status: plan.status ?? "draft",
              discountType: plan.discountType,
              discountValue: amount(plan.discountValue),
              minimumSpend: amount(plan.minimumSpend),
              maximumDiscount: plan.maximumDiscount === undefined ? null : amount(plan.maximumDiscount),
              customerScope: plan.customerScope ?? "all",
              applicableItemGroupIds: jsonArray(
                (plan.applicableItemGroupIds ?? []).map((id) => itemGroupIdMap.get(id) ?? id)
              ),
              applicablePricingGroupIds: jsonArray(plan.applicablePricingGroupIds ?? []),
              applicableDayTypes: jsonArray(plan.applicableDayTypes),
              priority: plan.priority ?? 0,
              stackableWithCoupon: plan.stackableWithCoupon ?? true,
              effectiveFrom: date(plan.effectiveFrom, `discountPlan(${plan.code}).effectiveFrom`),
              effectiveTo: optionalDate(plan.effectiveTo),
              version: plan.version ?? "1.0",
              createdAt: optionalDate(plan.createdAt) ?? new Date()
            }
          }));
        }
        count("discountPlans", (business.discountPlans ?? []).length);

        for (const service of business.services ?? []) {
          await this.writeOne("rentalValueAddedService", divergences, () =>
            tx.rentalValueAddedService.upsert({
            where: { id: service.id },
            update: {},
            create: {
              id: service.id,
              tenantId,
              workspaceId,
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
              applicableItemGroupIds: jsonArray(
                (service.applicableItemGroupIds ?? []).map((id) => itemGroupIdMap.get(id) ?? id)
              ),
              status: service.status ?? "enabled",
              version: service.version ?? "1.0",
              createdAt: optionalDate(service.createdAt) ?? new Date()
            }
          }));
          const serviceVersion = service.version ?? "1.0";
          const termsVersion = service.termsVersion ?? "1.0";
          await this.writeOne("rentalValueAddedServiceVersion", divergences, () =>
            tx.rentalValueAddedServiceVersion.upsert({
              where: {
                serviceId_serviceVersion: {
                  serviceId: service.id,
                  serviceVersion
                }
              },
              update: {},
              create: {
                tenantId,
                workspaceId,
                serviceId: service.id,
                serviceVersion,
                termsVersion,
                snapshot: json({
                  ...service,
                  tenantId,
                  workspaceId,
                  serviceVersion,
                  termsVersion
                }),
                createdAt: optionalDate(service.updatedAt) ?? optionalDate(service.createdAt) ?? new Date()
              }
            })
          );
        }
        count("valueAddedServices", (business.services ?? []).length);

        for (const rule of business.ruleVersions ?? []) {
          await this.writeOne("rentalRuleVersion", divergences, () =>
            tx.rentalRuleVersion.upsert({
            where: { id: rule.id },
            update: {},
            create: {
              id: rule.id,
              tenantId,
              workspaceId,
              categoryCode: upperEnum(rule.categoryCode, `ruleVersion(${rule.version}).categoryCode`),
              version: rule.version,
              status: rule.status ?? "draft",
              config: json(rule.config),
              changeReason: rule.changeReason ?? "",
              createdBy: rule.createdBy ?? "backfill",
              createdAt: optionalDate(rule.createdAt) ?? new Date(),
              publishedAt: optionalDate(rule.publishedAt)
            }
          }));
        }
        count("ruleVersions", (business.ruleVersions ?? []).length);

        for (const calendar of business.calendars ?? []) {
          await this.writeOne("rentalBusinessCalendar", divergences, () =>
            tx.rentalBusinessCalendar.upsert({
            // 唯一键含 version（需求 4.5.7 要求同年度保留多版本），回填按同一键定位。
            where: {
              workspaceId_year_version: { workspaceId, year: calendar.year, version: calendar.version ?? "1.0" }
            },
            update: {},
            create: {
              tenantId,
              workspaceId,
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
          }));
        }
        count("businessCalendars", (business.calendars ?? []).length);

        for (const template of business.notificationTemplates ?? []) {
          const resolvedId = await resolveId(
            "rentalNotificationTemplate",
            template.id,
            () => tx.rentalNotificationTemplate.findUnique({
              where: {
                workspaceId_eventCode_channel_version: {
                  workspaceId,
                  eventCode: template.eventCode,
                  channel: template.channel,
                  version: template.version ?? "1.0"
                }
              },
              select: { id: true }
            }),
            () =>
            tx.rentalNotificationTemplate.upsert({
            where: {
              workspaceId_eventCode_channel_version: {
                workspaceId,
                eventCode: template.eventCode,
                channel: template.channel,
                version: template.version ?? "1.0"
              }
            },
            update: {},
            create: {
              id: template.id,
              tenantId,
              workspaceId,
              eventCode: template.eventCode,
              channel: template.channel,
              name: template.name,
              title: template.title,
              body: template.body,
              providerTemplateCode: template.providerTemplateCode ?? null,
              variableSchema: json(template.variableSchema ?? {}),
              status: template.status ?? "enabled",
              version: template.version ?? "1.0"
            },
            select: { id: true }
          }));
          if (resolvedId) notificationTemplateIdMap.set(template.id, resolvedId);
        }
        count("notificationTemplates", (business.notificationTemplates ?? []).length);

        // 10. 报价（订单引用报价号，但不建外键；报价先插以便对账）
        for (const quote of business.quotes ?? []) {
          await this.writeOne("rentalQuote", divergences, () =>
            tx.rentalQuote.upsert({
            where: { id: quote.id },
            update: {},
            create: {
              id: quote.id,
              tenantId,
              workspaceId,
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
          }));
        }
        count("quotes", (business.quotes ?? []).length);

        // 11. 订单 → 行 → 预占 → 分配
        let lines = 0;
        let reservations = 0;
        let allocations = 0;
        const compatibilityLocationSnapshot = (sourceLocationId: string, historicalName: string) => {
          const sourceLocation = (core.locations ?? []).find((row) => row.id === sourceLocationId);
          const sourceOperator = sourceLocation?.operatorId
            ? (core.operators ?? []).find((row) => row.id === sourceLocation.operatorId)
            : undefined;
          if (!sourceLocation || !sourceOperator) return undefined;
          return {
            id: locationIdMap.get(sourceLocation.id) ?? sourceLocation.id,
            code: sourceLocation.code,
            name: historicalName,
            type: sourceLocation.type,
            capabilities: sourceLocation.capabilities,
            address: sourceLocation.address,
            contactName: sourceLocation.contactName,
            contactPhone: sourceLocation.contactPhone,
            businessHours: sourceLocation.businessHours,
            operator: {
              id: operatorIdMap.get(sourceOperator.id) ?? sourceOperator.id,
              code: sourceOperator.code,
              name: sourceOperator.name,
              type: sourceOperator.type,
              settlementMode: sourceOperator.settlementMode
            }
          };
        };
        for (const order of core.orders ?? []) {
          const fulfillmentLocationId = locationIdMap.get(order.fulfillmentLocationId);
          const returnLocationId = order.returnLocationId
            ? locationIdMap.get(order.returnLocationId)
            : undefined;
          if (!fulfillmentLocationId || (order.returnLocationId && !returnLocationId)) {
            divergences.push(`rentalOrder(${order.id}):location-missing`);
            continue;
          }
          const resolvedOrderId = await resolveId(
            "rentalOrder",
            order.id,
            () => tx.rentalOrder.findUnique({
              where: { workspaceId_orderNo: { workspaceId, orderNo: order.orderNo } },
              select: { id: true }
            }),
            () =>
            tx.rentalOrder.upsert({
            where: { workspaceId_orderNo: { workspaceId, orderNo: order.orderNo } },
            update: {},
            create: {
              id: order.id,
              tenantId,
              workspaceId,
              orderNo: order.orderNo,
              categoryCode: upperEnum(order.categoryCode, `order(${order.orderNo}).categoryCode`),
              status: upperEnum<$Enums.RentalOrderV1Status>(order.status, `order(${order.orderNo}).status`),
              customerType: order.customerType,
              customerId: order.customerId ?? null,
              customerName: order.customerName,
              contactPhone: order.contactPhone ?? null,
              fulfillmentMode: order.fulfillmentMode,
              fulfillmentLocationId,
              fulfillmentLocationName: order.fulfillmentLocationName,
              fulfillmentLocationSnapshot: json(order.fulfillmentLocationSnapshot ?? compatibilityLocationSnapshot(order.fulfillmentLocationId, order.fulfillmentLocationName)),
              returnLocationId: returnLocationId ?? null,
              returnLocationName: order.returnLocationName ?? null,
              returnLocationSnapshot: json(order.returnLocationSnapshot ?? compatibilityLocationSnapshot(order.returnLocationId ?? order.fulfillmentLocationId, order.returnLocationName ?? order.fulfillmentLocationName)),
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
            },
            select: { id: true }
          }));
          if (!resolvedOrderId) continue;
          orderIdMap.set(order.id, resolvedOrderId);

          for (const line of order.lines ?? []) {
            const itemGroupId = itemGroupIdMap.get(line.itemGroupId);
            if (!itemGroupId) {
              divergences.push(`rentalOrderLine(${line.id}):item-group-missing`);
              continue;
            }
            const written = await this.writeOne("rentalOrderLine", divergences, () =>
              tx.rentalOrderLine.upsert({
              where: { id: line.id },
              update: {},
              create: {
                id: line.id,
                orderId: resolvedOrderId,
                itemGroupId,
                itemGroupCode: line.itemGroupCode,
                itemGroupName: line.itemGroupName,
                inventoryMode: upperEnum(line.inventoryMode, `orderLine(${line.id}).inventoryMode`),
                quantity: line.quantity,
                unitPrice: amount(line.unitPrice),
                amount: amount(line.amount),
                note: line.note ?? null
              }
            }));
            if (written) {
              orderLineIdMap.set(line.id, line.id);
              lines += 1;
            }
          }

          for (const reservation of order.reservations ?? []) {
            const orderLineId = orderLineIdMap.get(reservation.orderLineId);
            const itemGroupId = itemGroupIdMap.get(reservation.itemGroupId);
            const locationId = locationIdMap.get(reservation.locationId);
            if (!orderLineId || !itemGroupId || !locationId) {
              divergences.push(`rentalReservation(${reservation.id}):parent-missing`);
              continue;
            }
            await this.writeOne("rentalReservation", divergences, () =>
              tx.rentalReservation.upsert({
              where: { id: reservation.id },
              update: {},
              create: {
                id: reservation.id,
                tenantId,
                workspaceId,
                orderId: resolvedOrderId,
                orderLineId,
                itemGroupId,
                locationId,
                quantity: reservation.quantity,
                // 预占的起止期间在快照里由订单承载，回填时取订单期间。
                startAt: date(order.startAt, `reservation(${reservation.id}).startAt`),
                endAt: date(order.endAt, `reservation(${reservation.id}).endAt`),
                status: upperEnum<$Enums.RentalReservationState>(reservation.status, `reservation(${reservation.id}).status`),
                expiresAt: optionalDate(reservation.expiresAt),
                createdAt: optionalDate(reservation.createdAt) ?? new Date()
              }
            }));
            reservations += 1;
          }

          for (const allocation of order.allocations ?? []) {
            const orderLineId = orderLineIdMap.get(allocation.orderLineId);
            if (!orderLineId) {
              divergences.push(`rentalAllocation(${allocation.id}):order-line-missing`);
              continue;
            }
            await this.writeOne("rentalAllocation", divergences, () =>
              tx.rentalAllocation.upsert({
              where: { id: allocation.id },
              update: {},
              create: {
                id: allocation.id,
                orderId: resolvedOrderId,
                orderLineId,
                assetId: allocation.assetId ? assetIdMap.get(allocation.assetId) ?? null : null,
                assetNo: allocation.assetNo ?? null,
                quantity: allocation.quantity ?? 1,
                status: allocation.status ?? "allocated"
              }
            }));
            allocations += 1;
          }
        }
        count("orders", (core.orders ?? []).length);
        count("orderLines", lines);
        count("reservations", reservations);
        count("allocations", allocations);

        // 12. 检查记录
        let inspections = 0;
        for (const record of core.inspections ?? []) {
          const orderId = orderIdMap.get(record.orderId);
          const templateId = inspectionTemplateIdMap.get(record.templateId);
          if (!orderId || !templateId) {
            divergences.push(`rentalInspectionRecord(${record.id}):parent-missing`);
            continue;
          }
          await this.writeOne("rentalInspectionRecord", divergences, () =>
            tx.rentalInspectionRecord.upsert({
            where: { id: record.id },
            update: {},
            create: {
              id: record.id,
              tenantId,
              workspaceId,
              orderId,
              stage: record.stage,
              templateId,
              templateCode: record.templateCode,
              templateVersion: record.templateVersion,
              results: json(record.results ?? {}),
              exceptions: jsonArray(record.exceptions),
              attachments: jsonArray(record.attachments),
              operator: record.operator ?? "backfill",
              createdAt: optionalDate(record.createdAt) ?? new Date()
            }
          }));
          inspections += 1;
        }
        count("inspections", inspections);

        // 13. 通知发送记录（外键依赖通知模板）
        let notificationLogs = 0;
        for (const log of business.notificationLogs ?? []) {
          const templateId = notificationTemplateIdMap.get(log.templateId);
          if (!templateId) {
            divergences.push(`rentalNotificationLog(${log.id}):template-missing`);
            continue;
          }
          await this.writeOne("rentalNotificationLog", divergences, () =>
            tx.rentalNotificationLog.upsert({
            where: { id: log.id },
            update: {},
            create: {
              id: log.id,
              tenantId,
              workspaceId,
              templateId,
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
              nextAttemptAt: optionalDate(log.nextAttemptAt),
              lastAttemptAt: optionalDate(log.lastAttemptAt),
              maxAttempts: log.maxAttempts ?? 3,
              sentAt: optionalDate(log.sentAt),
              createdAt: optionalDate(log.createdAt) ?? new Date()
            }
          }));
          notificationLogs += 1;
        }
        count("notificationLogs", notificationLogs);

        // 14. 奖励流水、权益账户与邀请关系
        for (const entry of business.rewardLedger ?? []) {
          await this.writeOne("rentalRewardLedgerEntry", divergences, () =>
            tx.rentalRewardLedgerEntry.upsert({
            where: { id: entry.id },
            update: {},
            create: {
              id: entry.id,
              tenantId,
              workspaceId,
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
          }));
        }
        count("rewardLedger", (business.rewardLedger ?? []).length);

        for (const account of business.benefitAccounts ?? []) {
          await this.writeOne("rentalBenefitAccount", divergences, () =>
            tx.rentalBenefitAccount.upsert({
            where: { workspaceId_customerId: { workspaceId, customerId: account.customerId } },
            update: {},
            create: {
              tenantId,
              workspaceId,
              customerId: account.customerId,
              pointsBalance: amount(account.pointsBalance),
              marketingBalance: amount(account.marketingBalance),
              availableRewardCouponCount: account.availableRewardCouponCount ?? 0
            }
          }));
        }
        count("benefitAccounts", (business.benefitAccounts ?? []).length);

        for (const referral of business.referrals ?? []) {
          await this.writeOne("rentalReferral", divergences, () =>
            tx.rentalReferral.upsert({
            where: { workspaceId_inviteeCustomerId: { workspaceId, inviteeCustomerId: referral.inviteeCustomerId } },
            update: {},
            create: {
              tenantId,
              workspaceId,
              inviteeCustomerId: referral.inviteeCustomerId,
              referrerCustomerId: referral.referrerCustomerId,
              registeredAt: optionalDate(referral.registeredAt) ?? new Date()
            }
          }));
        }
        count("referrals", (business.referrals ?? []).length);

        if (divergences.length) {
          // 分歧必须可见：库中已有同业务键但主键不同的行，回填未覆盖它们。
          this.logger.warn(
            `租户 ${tenantId} 有 ${divergences.length} 条记录与库中现存行业务键冲突，已跳过未覆盖：` +
              [...new Set(divergences)].join("、")
          );
        }
      },
      { timeout: 60_000 }
    );

    const summary = Object.entries(inserted).map(([key, value]) => `${key}=${value}`).join(" ");
    // 计数是"本次处理的快照条目数"，不等于"新插入行数"——写入是 upsert，已存在的条目也计入。
    this.logger.log(`租户 ${tenantId} 回填完成（按快照条目计）：${summary || "无可回填数据"}`);
    return { tenantId, workspaceId, skipped: false, inserted };
  }
}
