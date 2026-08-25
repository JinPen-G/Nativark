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
import { getRequestWorkspaceId } from "../../common/request-identity";
import { resolveScopeWorkspaceId } from "./workspace-scope";

/**
 * 单个**经营空间**的全部配置，用于启动预热写穿缓存。
 *
 * SPACE-03：以空间为单位而不是租户——同租户两个空间各有独立配置。
 * 品类取自 `business_workspaces.categoryCode`：需求 3 规定品类由空间决定，
 * `tenant_rental_profiles` 只是升级兼容层的租户级档案。
 */
export interface TenantConfigSnapshot {
  tenantId: string;
  workspaceId: string;
  workspaceCategoryCode: RentalCategoryCode;
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
  /** 全部启用的经营空间，用于服务层按空间建状态并解析「租户 → 默认空间」。 */
  listWorkspaces(): Promise<Array<{ id: string; tenantId: string; categoryCode: RentalCategoryCode; isDefault: boolean }>>;
  upsertProfile(profile: TenantRentalProfile, tx?: RentalConfigTx): Promise<void>;
  upsertBusinessSettings(settings: TenantRentalBusinessSettings, updatedBy: string, tx?: RentalConfigTx): Promise<void>;
  upsertOperator(operator: RentalFulfillmentOperator, tx?: RentalConfigTx): Promise<void>;
  upsertLocation(location: RentalFulfillmentLocation, tx?: RentalConfigTx): Promise<void>;
  upsertItemGroup(group: RentalItemGroup, tx?: RentalConfigTx): Promise<void>;
  upsertCouponTemplate(template: RentalCouponTemplate, tx?: RentalConfigTx): Promise<void>;
  /** 在领券事务内锁定模板行，串行化不同幂等键对同一配额的竞争。 */
  lockCouponTemplateForClaim(tenantId: string, templateId: string, tx: RentalConfigTx): Promise<RentalCouponTemplate | undefined>;
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

  async listWorkspaces(): Promise<Array<{ id: string; tenantId: string; categoryCode: RentalCategoryCode; isDefault: boolean }>> {
    const rows = await this.prisma.businessWorkspace.findMany({
      select: { id: true, tenantId: true, categoryCode: true, isDefault: true }
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      isDefault: row.isDefault
    }));
  }

  async loadAll(): Promise<TenantConfigSnapshot[]> {
    const [workspaces, profiles, settings, operators, locations, itemGroups, couponTemplates, inspectionTemplates] =
      await Promise.all([
        this.listWorkspaces(),
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

    // SPACE-03：以**经营空间**为单位分组，而不是租户。
    // 空间集合取自 business_workspaces 而不是从配置行反推：一个刚建好、
    // 还没有任何配置的空间同样必须得到状态，否则它在读路径上会退化成
    // 「找不到状态」并沿用租户级演示配置。
    return workspaces.map((workspace) => {
      const mine = <T extends { workspaceId: string }>(rows: T[]) => rows.filter((row) => row.workspaceId === workspace.id);
      const wsOperators = mine(operators);
      const wsLocations = mine(locations);
      const wsItemGroups = mine(itemGroups);
      const wsCouponTemplates = mine(couponTemplates);
      const wsInspectionTemplates = mine(inspectionTemplates);
      const wsSettings = mine(settings)[0];
      return {
        tenantId: workspace.tenantId,
        workspaceId: workspace.id,
        workspaceCategoryCode: workspace.categoryCode,
        // 品类档案仍是租户级（升级兼容层），按 tenantId 取；品类本身以空间为准。
        profile: this.toProfile(profiles.find((row) => row.tenantId === workspace.tenantId)),
        businessSettings: this.toBusinessSettings(wsSettings),
        operators: wsOperators.map((row) => this.toOperator(row)),
        locations: wsLocations.map((row) => this.toLocation(row)),
        itemGroups: wsItemGroups.map((row) => this.toItemGroup(row)),
        couponTemplates: wsCouponTemplates.map((row) => this.toCouponTemplate(row)),
        inspectionTemplates: wsInspectionTemplates.map((row) => this.toInspectionTemplate(row)),
        // 品类档案不计入：seed 只建档案，不代表该空间的配置写过库。
        hasPersistedConfig: Boolean(
          wsSettings ||
            wsOperators.length ||
            wsLocations.length ||
            wsItemGroups.length ||
            wsCouponTemplates.length ||
            wsInspectionTemplates.length
        )
      };
    });
  }

  async upsertProfile(profile: TenantRentalProfile, tx?: RentalConfigTx): Promise<void> {
    const data = {
      categoryCode: upper<$Enums.RentalCategoryCode>(profile.categoryCode),
      capabilities: profile.capabilities as unknown as Prisma.InputJsonValue,
      terminology: profile.terminology as unknown as Prisma.InputJsonValue,
      configVersion: profile.configVersion
    };
    // 租户级档案只能由**默认空间**写入。
    //
    // 这张表主键是 tenantId 一格，而 persistConfig 会被 registerWorkspace（新建
    // 任意空间）和 factContext（任一空间首次访问经营事实）调用。不做这个判定时，
    // 第二个空间的品类会覆盖租户级档案；启动预热又把这份租户级档案灌进**每个**
    // 空间的 state.profile，于是默认空间的品类被改成另一个空间的品类。
    // 实测后果：tenant_001 默认空间是 camera，档案被 camping 空间改成了 camping，
    // 之后业务侧每个请求都判定"品类变了"并用 camping 默认值覆盖该空间的定价、
    // 优惠、规则与通知模板——vehicle 的资质审核要求也会被一并抹掉。
    //
    // 档案在需求里是「租户级升级兼容层」，不是空间的品类来源；空间品类的事实源
    // 是 business_workspaces.categoryCode。因此非默认空间一律不碰它。
    const requestWorkspaceId = getRequestWorkspaceId();
    const isDefaultWorkspaceWrite = !requestWorkspaceId || requestWorkspaceId === `ws_${profile.tenantId}`;
    if (isDefaultWorkspaceWrite) {
      await this.db(tx).tenantRentalProfile.upsert({
        where: { tenantId: profile.tenantId },
        create: { tenantId: profile.tenantId, ...data, initializedAt: new Date(profile.initializedAt) },
        update: data
      });
      await this.ensureDefaultWorkspace(profile.tenantId, data.categoryCode, tx);
      return;
    }
    // 非默认空间：确保档案存在（懒加载租户可能还没有），但绝不改既有品类。
    await this.db(tx).tenantRentalProfile.upsert({
      where: { tenantId: profile.tenantId },
      create: { tenantId: profile.tenantId, ...data, initializedAt: new Date(profile.initializedAt) },
      update: {}
    });
  }

  /**
   * SPACE-01：保证「有品类档案的租户必然有一个默认经营空间，且其所有账号都是成员」。
   *
   * 为什么挂在 upsertProfile 上而不是只放在 bootstrapTenant：品类档案有两条写入路径——
   * 租户初始化，以及懒加载租户首次访问业务事实时的自愈补落。只在 bootstrap 里建空间，
   * 懒加载出来的租户就会有档案却没有空间，与回填迁移的规则不一致（E2E 第 50 节实测到
   * 5 个有档案的租户只有 3 个空间）。把不变量钉在档案的写入点上，两条路径才一致。
   *
   * 规则与回填迁移逐字一致：id 为 ws_<tenantId>、code 为 default、品类取自档案。
   *
   * 品类**只在创建时写入**：需求 3 规定空间产生业务后不得通过普通设置切换品类，
   * 因此即使档案品类被改动，也不在这里跟着改既有空间——那需要显式迁移。
   */
  private async ensureDefaultWorkspace(
    tenantId: string,
    categoryCode: $Enums.RentalCategoryCode,
    tx?: RentalConfigTx
  ): Promise<void> {
    const client = this.db(tx);
    const workspaceId = `ws_${tenantId}`;
    const workspace = await client.businessWorkspace.upsert({
      where: { id: workspaceId },
      create: {
        id: workspaceId,
        tenantId,
        code: "default",
        name: "默认经营空间",
        categoryCode,
        isDefault: true,
        defaultMarker: "default"
      },
      // 已存在即不动：不覆盖名称，也绝不改品类。
      update: {}
    });
    // 该租户的现有账号补为默认空间成员，仅在**首次创建**该空间时执行。
    //
    // 不能每次 upsertProfile 都跑：这个方法会被 registerWorkspace（新建任意空间）
    // 和 factContext（任一空间首次访问经营事实）触发，若每次都把全部账号 upsert
    // 进默认空间，管理员刻意移除的成员关系会被静默重建——一个只该进入空间 B 的
    // 账号会重新获得默认空间 A 的读写权。`update: {}` 只保护"已存在但被停用"的行，
    // 挡不住"已被删除"的行重新出现。
    //
    // 首次创建的判定用 upsert 的返回值：createdAt === updatedAt 说明这次是 create。
    const isFreshWorkspace = workspace.createdAt.getTime() === workspace.updatedAt.getTime();
    if (!isFreshWorkspace) return;
    const users = await client.user.findMany({ where: { tenantId }, select: { id: true, isActive: true } });
    for (const user of users) {
      await client.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId, userId: user.id } },
        // roleId 留空 = 沿用租户级角色集（与回填迁移同规则）。
        // 写 user.roleId 会让 findWorkspaceScopedUser 用单个角色整体替换权限，
        // 多角色账号的授权会静默收缩。
        create: { tenantId, workspaceId, userId: user.id, roleId: null, isActive: user.isActive },
        update: {}
      });
    }
  }

  async upsertBusinessSettings(settings: TenantRentalBusinessSettings, updatedBy: string, tx?: RentalConfigTx): Promise<void> {
    const data = {
      categoryCode: upper<$Enums.RentalCategoryCode>(settings.categoryCode),
      configVersion: settings.configVersion,
      settings: settings as unknown as Prisma.InputJsonValue,
      updatedBy
    };
    const workspaceId = await resolveScopeWorkspaceId(this.db(tx), settings.tenantId);
    // 按经营空间 upsert：按 tenantId 会让同租户第二个空间覆盖第一个空间的业务设置。
    await this.db(tx).rentalTenantBusinessSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, tenantId: settings.tenantId, ...data },
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
    const workspaceId = await resolveScopeWorkspaceId(this.db(tx), operator.tenantId);
    await this.db(tx).rentalFulfillmentOperator.upsert({
      where: { id: operator.id },
      create: { workspaceId, id: operator.id, ...data, createdAt: new Date(operator.createdAt) },
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
    const workspaceId = await resolveScopeWorkspaceId(this.db(tx), location.tenantId);
    await this.db(tx).rentalFulfillmentLocation.upsert({
      where: { id: location.id },
      create: { workspaceId, id: location.id, ...data },
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
      const workspaceId = await resolveScopeWorkspaceId(client, group.tenantId);
      await client.rentalItemGroup.upsert({
        where: { id: group.id },
        create: { workspaceId, id: group.id, ...data, createdAt: new Date(group.createdAt) },
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
    const workspaceId = await resolveScopeWorkspaceId(this.db(tx), template.tenantId);
    await this.db(tx).rentalCouponTemplate.upsert({
      where: { id: template.id },
      create: { workspaceId, id: template.id, ...data, createdAt: new Date(template.createdAt) },
      update: data
    });
  }

  async lockCouponTemplateForClaim(
    tenantId: string,
    templateId: string,
    tx: RentalConfigTx
  ): Promise<RentalCouponTemplate | undefined> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\` FROM \`rental_coupon_templates\`
      WHERE \`id\` = ${templateId}
        AND \`tenantId\` = ${tenantId}
        AND \`workspaceId\` = ${workspaceId}
        AND \`status\` = 'enabled'
      FOR UPDATE
    `);
    const row = await tx.rentalCouponTemplate.findFirst({
      where: { id: templateId, tenantId, workspaceId, status: "enabled" }
    });
    return row ? this.toCouponTemplate(row) : undefined;
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
    const workspaceId = await resolveScopeWorkspaceId(this.db(tx), template.tenantId);
    await this.db(tx).rentalInspectionTemplate.upsert({
      where: { id: template.id },
      create: { workspaceId, id: template.id, ...data },
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
      fields: (row.fields ?? []) as unknown as RentalInspectionTemplate["fields"],
      enabled: row.enabled
    };
  }
}
