import { Injectable } from "@nestjs/common";
import { Prisma, type $Enums } from "@prisma/client";
import type {
  RentalBundleComponent,
  RentalCategoryCode,
  RentalCouponTemplate,
  RentalFulfillmentLocation,
  RentalFulfillmentOperator,
  RentalInspectionTemplate,
  RentalInventoryMode,
  RentalItemGroup,
  RentalLocationType,
  TenantRentalBusinessSettings,
  TenantRentalProfile
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";

/** 单个租户的全部配置，用于启动预热写穿缓存。 */
export interface TenantConfigSnapshot {
  tenantId: string;
  profile?: TenantRentalProfile;
  businessSettings?: TenantRentalBusinessSettings;
  operators: RentalFulfillmentOperator[];
  locations: RentalFulfillmentLocation[];
  itemGroups: RentalItemGroup[];
  couponTemplates: RentalCouponTemplate[];
  inspectionTemplates: RentalInspectionTemplate[];
  /**
   * 该租户的配置是否真的写过库（存在品类档案之外的任一配置行）。
   *
   * 需要这个标记是因为租户集合里包含只有 `tenant_rental_profiles` 行的租户——
   * seed 会建品类档案但不建商品组和地点。缺少它就无法区分两种情况：
   * 「库里合法为空」应当覆盖缓存，而「库还没写过」必须保留 seedState 的内存配置，
   * 否则冷启动会把演示商品组直接抹掉。
   */
  hasPersistedConfig: boolean;
}

/**
 * 事务客户端。租户初始化必须把品类配置写在 `bootstrapTenant` 的同一事务内（需求 4.1），
 * 因此每个写方法都允许调用方传入外层事务；不传时各自独立提交。
 */
export type RentalConfigTx = Prisma.TransactionClient;

/**
 * 服务层只依赖这个接口，不依赖 Prisma。
 *
 * 这样做的目的不是"方便 mock"：不连库的单元测试注入一个**吸收式 stub**
 * （读返回空、写丢弃），让配置读取继续由内存写穿缓存提供，从而保住那批
 * 只验证品类 schema 形状与领域算法的断言。真正依赖持久化语义的断言
 * （租户隔离、外键、唯一约束、过期预占过滤）只在 MySQL E2E 里才有意义，
 * 不得靠在 stub 上重写一遍查询逻辑来"覆盖"。
 */
export interface RentalConfigStore {
  loadAll(): Promise<TenantConfigSnapshot[]>;
  upsertProfile(profile: TenantRentalProfile, tx?: RentalConfigTx): Promise<void>;
  upsertBusinessSettings(settings: TenantRentalBusinessSettings, updatedBy: string, tx?: RentalConfigTx): Promise<void>;
  upsertOperator(operator: RentalFulfillmentOperator, tx?: RentalConfigTx): Promise<void>;
  upsertLocation(location: RentalFulfillmentLocation, tx?: RentalConfigTx): Promise<void>;
  upsertItemGroup(group: RentalItemGroup, tx?: RentalConfigTx): Promise<void>;
  upsertCouponTemplate(template: RentalCouponTemplate, tx?: RentalConfigTx): Promise<void>;
  upsertInspectionTemplate(template: RentalInspectionTemplate, tx?: RentalConfigTx): Promise<void>;
}

function iso(value: Date): string {
  return value.toISOString();
}

function num(value: Prisma.Decimal): number {
  return Number(value);
}

function lower<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

function upper<T extends string>(value: string): T {
  return value.toUpperCase() as T;
}

/** RC-01 阶段 2：Rental Core 配置的库侧实现。库是事实源，服务层内存副本是写穿缓存。 */
@Injectable()
export class RentalCoreConfigRepository implements RentalConfigStore {
  constructor(private readonly prisma: PrismaService) {}

  /** 有外层事务就用它，否则用连接自身——写方法据此既能独立提交，也能并入 bootstrap 事务。 */
  private db(tx?: RentalConfigTx) {
    return tx ?? this.prisma;
  }

  async loadAll(): Promise<TenantConfigSnapshot[]> {
    const [profiles, settings, operators, locations, itemGroups, couponTemplates, inspectionTemplates] =
      await Promise.all([
        this.prisma.tenantRentalProfile.findMany(),
        this.prisma.rentalTenantBusinessSettings.findMany(),
        this.prisma.rentalFulfillmentOperator.findMany({ orderBy: { createdAt: "desc" } }),
        this.prisma.rentalFulfillmentLocation.findMany({ orderBy: { createdAt: "desc" } }),
        this.prisma.rentalItemGroup.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            bundleComponents: {
              include: { componentItemGroup: { select: { code: true, name: true } } }
            }
          }
        }),
        this.prisma.rentalCouponTemplate.findMany({ orderBy: { createdAt: "desc" } }),
        this.prisma.rentalInspectionTemplate.findMany({ orderBy: { createdAt: "desc" } })
      ]);

    const tenantIds = new Set<string>([
      ...profiles.map((row) => row.tenantId),
      ...settings.map((row) => row.tenantId),
      ...operators.map((row) => row.tenantId),
      ...locations.map((row) => row.tenantId),
      ...itemGroups.map((row) => row.tenantId),
      ...couponTemplates.map((row) => row.tenantId),
      ...inspectionTemplates.map((row) => row.tenantId)
    ]);

    return [...tenantIds].map((tenantId) => ({
      tenantId,
      profile: this.toProfile(profiles.find((row) => row.tenantId === tenantId)),
      businessSettings: this.toBusinessSettings(settings.find((row) => row.tenantId === tenantId)),
      operators: operators.filter((row) => row.tenantId === tenantId).map((row) => this.toOperator(row)),
      locations: locations.filter((row) => row.tenantId === tenantId).map((row) => this.toLocation(row)),
      itemGroups: itemGroups.filter((row) => row.tenantId === tenantId).map((row) => this.toItemGroup(row)),
      couponTemplates: couponTemplates
        .filter((row) => row.tenantId === tenantId)
        .map((row) => this.toCouponTemplate(row)),
      inspectionTemplates: inspectionTemplates
        .filter((row) => row.tenantId === tenantId)
        .map((row) => this.toInspectionTemplate(row)),
      // 品类档案不计入：seed 只建档案，不代表配置写过库。
      hasPersistedConfig:
        settings.some((row) => row.tenantId === tenantId) ||
        operators.some((row) => row.tenantId === tenantId) ||
        locations.some((row) => row.tenantId === tenantId) ||
        itemGroups.some((row) => row.tenantId === tenantId) ||
        couponTemplates.some((row) => row.tenantId === tenantId) ||
        inspectionTemplates.some((row) => row.tenantId === tenantId)
    }));
  }

  async upsertProfile(profile: TenantRentalProfile, tx?: RentalConfigTx): Promise<void> {
    const data = {
      categoryCode: upper<$Enums.RentalCategoryCode>(profile.categoryCode),
      capabilities: profile.capabilities as unknown as Prisma.InputJsonValue,
      terminology: profile.terminology as unknown as Prisma.InputJsonValue,
      configVersion: profile.configVersion
    };
    await this.db(tx).tenantRentalProfile.upsert({
      where: { tenantId: profile.tenantId },
      create: { tenantId: profile.tenantId, ...data, initializedAt: new Date(profile.initializedAt) },
      update: data
    });
  }

  async upsertBusinessSettings(settings: TenantRentalBusinessSettings, updatedBy: string, tx?: RentalConfigTx): Promise<void> {
    const data = {
      categoryCode: upper<$Enums.RentalCategoryCode>(settings.categoryCode),
      configVersion: settings.configVersion,
      settings: settings as unknown as Prisma.InputJsonValue,
      updatedBy
    };
    await this.db(tx).rentalTenantBusinessSettings.upsert({
      where: { tenantId: settings.tenantId },
      create: { tenantId: settings.tenantId, ...data },
      update: data
    });
  }

  async upsertOperator(operator: RentalFulfillmentOperator, tx?: RentalConfigTx): Promise<void> {
    const data = {
      tenantId: operator.tenantId,
      code: operator.code,
      name: operator.name,
      type: operator.type,
      contactName: operator.contactName ?? null,
      contactPhone: operator.contactPhone ?? null,
      settlementMode: operator.settlementMode ?? null,
      status: operator.status
    };
    await this.db(tx).rentalFulfillmentOperator.upsert({
      where: { id: operator.id },
      create: { id: operator.id, ...data, createdAt: new Date(operator.createdAt) },
      update: data
    });
  }

  async upsertLocation(location: RentalFulfillmentLocation, tx?: RentalConfigTx): Promise<void> {
    const data = {
      tenantId: location.tenantId,
      code: location.code,
      name: location.name,
      type: location.type,
      operatorId: location.operatorId ?? null,
      operatorType: location.operatorType ?? null,
      operatorName: location.operatorName ?? null,
      parentLocationId: location.parentLocationId ?? null,
      capabilities: location.capabilities as unknown as Prisma.InputJsonValue,
      address: location.address ?? null,
      contactName: location.contactName ?? null,
      contactPhone: location.contactPhone ?? null,
      businessHours: location.businessHours ?? null,
      status: location.status
    };
    await this.db(tx).rentalFulfillmentLocation.upsert({
      where: { id: location.id },
      create: { id: location.id, ...data },
      update: data
    });
  }

  /** 套装组成是独立表，整组替换以免留下已被移除的组件行。 */
  async upsertItemGroup(group: RentalItemGroup, tx?: RentalConfigTx): Promise<void> {
    const data = {
      tenantId: group.tenantId,
      categoryCode: upper<$Enums.RentalCategoryCode>(group.categoryCode),
      code: group.code,
      name: group.name,
      inventoryMode: upper<$Enums.RentalInventoryMode>(group.inventoryMode),
      unit: group.unit,
      description: group.description ?? null,
      attributes: group.attributes as Prisma.InputJsonValue,
      status: group.status
    };
    // 商品组与套装组成必须一起提交，否则会留下"组已改、组成还是旧的"的中间态。
    // 有外层事务时直接复用它——Prisma 不支持嵌套交互式事务，自己再开一个会报错。
    const write = async (client: RentalConfigTx) => {
      await client.rentalItemGroup.upsert({
        where: { id: group.id },
        create: { id: group.id, ...data, createdAt: new Date(group.createdAt) },
        update: data
      });
      await client.rentalBundleComponent.deleteMany({ where: { bundleItemGroupId: group.id } });
      for (const component of group.bundleComponents) {
        await client.rentalBundleComponent.create({
          data: {
            bundleItemGroupId: group.id,
            componentItemGroupId: component.itemGroupId,
            quantity: component.quantity,
            optional: Boolean(component.optional),
            substitutionGroup: component.substitutionGroup ?? null
          }
        });
      }
    };
    if (tx) {
      await write(tx);
      return;
    }
    await this.prisma.$transaction(write);
  }

  async upsertCouponTemplate(template: RentalCouponTemplate, tx?: RentalConfigTx): Promise<void> {
    const data = {
      tenantId: template.tenantId,
      code: template.code,
      name: template.name,
      discountType: template.discountType,
      discountValue: new Prisma.Decimal(template.discountValue),
      minimumSpend: new Prisma.Decimal(template.minimumSpend),
      maximumDiscount: template.maximumDiscount === undefined ? null : new Prisma.Decimal(template.maximumDiscount),
      totalQuota: template.totalQuota,
      claimedQuantity: template.claimedQuantity,
      perCustomerLimit: template.perCustomerLimit,
      effectiveFrom: new Date(template.effectiveFrom),
      effectiveTo: new Date(template.effectiveTo),
      applicableItemGroupIds: template.applicableItemGroupIds as unknown as Prisma.InputJsonValue,
      status: template.status,
      version: template.version
    };
    await this.db(tx).rentalCouponTemplate.upsert({
      where: { id: template.id },
      create: { id: template.id, ...data, createdAt: new Date(template.createdAt) },
      update: data
    });
  }

  async upsertInspectionTemplate(template: RentalInspectionTemplate, tx?: RentalConfigTx): Promise<void> {
    const data = {
      tenantId: template.tenantId,
      categoryCode: upper<$Enums.RentalCategoryCode>(template.categoryCode),
      code: template.code,
      name: template.name,
      stage: template.stage,
      version: template.version,
      fields: template.fields as unknown as Prisma.InputJsonValue,
      enabled: template.enabled
    };
    await this.db(tx).rentalInspectionTemplate.upsert({
      where: { id: template.id },
      create: { id: template.id, ...data },
      update: data
    });
  }

  /* ---------- 行 → 领域对象 ---------- */

  private toProfile(row?: { tenantId: string; categoryCode: string; capabilities: Prisma.JsonValue; terminology: Prisma.JsonValue; configVersion: string; initializedAt: Date; updatedAt: Date }) {
    if (!row) return undefined;
    return {
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      capabilities: (row.capabilities ?? []) as TenantRentalProfile["capabilities"],
      terminology: (row.terminology ?? {}) as unknown as TenantRentalProfile["terminology"],
      configVersion: row.configVersion,
      initializedAt: iso(row.initializedAt),
      updatedAt: iso(row.updatedAt)
    } satisfies TenantRentalProfile;
  }

  private toBusinessSettings(row?: { settings: Prisma.JsonValue }) {
    if (!row) return undefined;
    // 嵌套配置块整体以 JSON 明细存放，读回即为领域对象。
    return row.settings as unknown as TenantRentalBusinessSettings;
  }

  private toOperator(row: {
    id: string; tenantId: string; code: string; name: string; type: string;
    contactName: string | null; contactPhone: string | null; settlementMode: string | null;
    status: string; createdAt: Date; updatedAt: Date;
  }): RentalFulfillmentOperator {
    return {
      id: row.id,
      tenantId: row.tenantId,
      code: row.code,
      name: row.name,
      type: row.type as RentalFulfillmentOperator["type"],
      contactName: row.contactName ?? undefined,
      contactPhone: row.contactPhone ?? undefined,
      settlementMode: (row.settlementMode ?? undefined) as RentalFulfillmentOperator["settlementMode"],
      status: row.status as RentalFulfillmentOperator["status"],
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toLocation(row: {
    id: string; tenantId: string; code: string; name: string; type: string;
    operatorId: string | null; operatorType: string | null; operatorName: string | null;
    parentLocationId: string | null; capabilities: Prisma.JsonValue; address: string | null;
    contactName: string | null; contactPhone: string | null; businessHours: string | null; status: string;
  }): RentalFulfillmentLocation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      code: row.code,
      name: row.name,
      type: row.type as RentalLocationType,
      operatorId: row.operatorId ?? undefined,
      operatorType: (row.operatorType ?? undefined) as RentalFulfillmentLocation["operatorType"],
      operatorName: row.operatorName ?? undefined,
      parentLocationId: row.parentLocationId ?? undefined,
      capabilities: (row.capabilities ?? []) as RentalFulfillmentLocation["capabilities"],
      address: row.address ?? undefined,
      contactName: row.contactName ?? undefined,
      contactPhone: row.contactPhone ?? undefined,
      businessHours: row.businessHours ?? undefined,
      status: row.status as RentalFulfillmentLocation["status"]
    };
  }

  private toItemGroup(row: {
    id: string; tenantId: string; categoryCode: string; code: string; name: string;
    inventoryMode: string; unit: string; description: string | null; attributes: Prisma.JsonValue;
    status: string; createdAt: Date; updatedAt: Date;
    bundleComponents: Array<{
      componentItemGroupId: string; quantity: number; optional: boolean; substitutionGroup: string | null;
      componentItemGroup: { code: string; name: string };
    }>;
  }): RentalItemGroup {
    const bundleComponents: RentalBundleComponent[] = row.bundleComponents.map((component) => ({
      itemGroupId: component.componentItemGroupId,
      itemGroupCode: component.componentItemGroup.code,
      itemGroupName: component.componentItemGroup.name,
      quantity: component.quantity,
      optional: component.optional || undefined,
      substitutionGroup: component.substitutionGroup ?? undefined
    }));
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      inventoryMode: lower<RentalInventoryMode>(row.inventoryMode),
      unit: row.unit,
      description: row.description ?? undefined,
      attributes: (row.attributes ?? {}) as Record<string, unknown>,
      bundleComponents,
      status: row.status as RentalItemGroup["status"],
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toCouponTemplate(row: {
    id: string; tenantId: string; code: string; name: string; discountType: string;
    discountValue: Prisma.Decimal; minimumSpend: Prisma.Decimal; maximumDiscount: Prisma.Decimal | null;
    totalQuota: number; claimedQuantity: number; perCustomerLimit: number;
    effectiveFrom: Date; effectiveTo: Date; applicableItemGroupIds: Prisma.JsonValue;
    status: string; version: string; createdAt: Date; updatedAt: Date;
  }): RentalCouponTemplate {
    return {
      id: row.id,
      tenantId: row.tenantId,
      code: row.code,
      name: row.name,
      discountType: row.discountType as RentalCouponTemplate["discountType"],
      discountValue: num(row.discountValue),
      minimumSpend: num(row.minimumSpend),
      maximumDiscount: row.maximumDiscount === null ? undefined : num(row.maximumDiscount),
      totalQuota: row.totalQuota,
      claimedQuantity: row.claimedQuantity,
      perCustomerLimit: row.perCustomerLimit,
      effectiveFrom: iso(row.effectiveFrom),
      effectiveTo: iso(row.effectiveTo),
      applicableItemGroupIds: (row.applicableItemGroupIds ?? []) as string[],
      status: row.status as RentalCouponTemplate["status"],
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toInspectionTemplate(row: {
    id: string; tenantId: string; categoryCode: string; code: string; name: string;
    stage: string; version: string; fields: Prisma.JsonValue; enabled: boolean;
  }): RentalInspectionTemplate {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      stage: row.stage as RentalInspectionTemplate["stage"],
      version: row.version,
      fields: (row.fields ?? []) as RentalInspectionTemplate["fields"],
      enabled: row.enabled
    };
  }
}
