import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { assertCategoryAdoptionAllowed } from "./category-governance-policy";
import { lockActiveCategoryBinding, validateActiveCategoryWrite, type CategoryWriteBinding } from "./category-active-write";
import { Prisma, type $Enums, type RentalCouponTemplate as CouponTemplateRow } from "@prisma/client";
import type {
  RentalBundleComponent,
  RentalCategoryCode,
  RentalCouponTemplate,
  RentalFulfillmentLocation,
  RentalFulfillmentOperator,
  RentalInspectionTemplate,
  RentalInventoryMode,
  RentalItemGroup,
  RentalPricingGroup,
  RentalLocationType,
  TenantRentalBusinessSettings,
  TenantRentalProfile
} from "@rental-os/shared";
import { RENTAL_CATEGORY_WORKSPACE_NAMES } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { getRequestWorkspaceId } from "../../common/request-identity";
import { assertScopedWrite, resolveScopeWorkspaceId } from "./workspace-scope";
import type { RentalUniqueAttributeClaim } from "./rental-core-fact.repository";
import type { VersionedBusinessSettings } from './approved-settings-change.ports';

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
  pricingGroups?: RentalPricingGroup[];
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
/** Bounded configuration read, not pricing or inventory reservation. */
export interface RentalItemGroupPageQuery { limit: number; cursor?: string; itemGroupId?: string; name?: string; }
export interface RentalItemGroupPage {
  rows: RentalItemGroup[]; nextCursor: string | null; truncated: boolean;
  configurationVersion: string; source: 'persisted_workspace_configuration';
}
export function parseRentalItemGroupPageQuery(value: RentalItemGroupPageQuery): RentalItemGroupPageQuery {
  const input = structuredClone(value), id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['limit', 'cursor', 'itemGroupId', 'name'].includes(key))
    || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100
    || (input.cursor !== undefined && (typeof input.cursor !== 'string' || !id.test(input.cursor)))
    || (input.itemGroupId !== undefined && (typeof input.itemGroupId !== 'string' || !id.test(input.itemGroupId)))
    || (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 191)))
    throw new BadRequestException('商品分页查询参数无效');
  if (input.name !== undefined) input.name = input.name.trim();
  return input;
}

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
  loadWorkspace?(tenantId: string, workspaceId: string, tx: RentalConfigTx): Promise<TenantConfigSnapshot>;
  listItemGroupsPage?(tenantId: string, workspaceId: string, query: RentalItemGroupPageQuery): Promise<RentalItemGroupPage>;
  listInspectionTemplates?(tenantId: string, workspaceId: string): Promise<RentalInspectionTemplate[]>;
  listCouponTemplates?(tenantId: string, workspaceId: string): Promise<RentalCouponTemplate[]>;
  /** 全部启用的经营空间，用于服务层按空间建状态并解析「租户 → 默认空间」。 */
  listWorkspaces(): Promise<Array<{ id: string; tenantId: string; categoryCode: RentalCategoryCode; isDefault: boolean }>>;
  upsertProfile(profile: TenantRentalProfile, tx?: RentalConfigTx): Promise<void>;
  readVersionedBusinessSettings(tenantId: string, tx?: RentalConfigTx): Promise<VersionedBusinessSettings | null>;
  upsertBusinessSettings(settings: TenantRentalBusinessSettings, updatedBy: string, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding, expectedSettingsRevision?: number): Promise<number>;
  upsertOperator(operator: RentalFulfillmentOperator, tx?: RentalConfigTx): Promise<void>;
  upsertLocation(location: RentalFulfillmentLocation, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding): Promise<void>;
  upsertItemGroup(group: RentalItemGroup, tx?: RentalConfigTx, uniqueAttributes?: RentalUniqueAttributeClaim[], expectedBinding?: CategoryWriteBinding, allowMediaWrite?: boolean): Promise<void>;
  upsertPricingGroup?(group: RentalPricingGroup, tx?: RentalConfigTx): Promise<void>;
  upsertCouponTemplate(template: RentalCouponTemplate, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding): Promise<void>;
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

  async listItemGroupsPage(tenantId: string, workspaceId: string, value: RentalItemGroupPageQuery): Promise<RentalItemGroupPage> {
    const query = parseRentalItemGroupPageQuery(value);
    // Reuse the original server request-space/tenant check, not a caller scope.
    const currentSpace = await resolveScopeWorkspaceId(this.prisma, tenantId);
    if (currentSpace !== workspaceId) throw new ConflictException('商品读取经营空间变化');
    const rows = await this.prisma.rentalItemGroup.findMany({ where: { tenantId, workspaceId,
      ...(query.itemGroupId ? { id: query.itemGroupId } : {}), ...(query.name ? { name: query.name } : {}),
      ...(query.cursor ? { AND: [{ id: { gt: query.cursor } }] } : {}) }, orderBy: { id: 'asc' }, take: query.limit + 1,
      include: { bundleComponents: { take: 257, include: { componentItemGroup: {
        select: { code: true, name: true, tenantId: true, workspaceId: true } } } } } });
    // Even the pagination sentinel must have the requested ownership. Bundle
    // joins are bounded and cannot disclose names from another workspace.
    if (rows.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId || row.bundleComponents.length > 256
      || row.bundleComponents.some(component => component.componentItemGroup.tenantId !== tenantId
        || component.componentItemGroup.workspaceId !== workspaceId))) throw new ConflictException('商品配置来源无效或超出读取上限');
    if ((await resolveScopeWorkspaceId(this.prisma, tenantId)) !== workspaceId) throw new ConflictException('商品读取经营空间变化');
    const truncated = rows.length > query.limit, page = rows.slice(0, query.limit);
    return { rows: page.map(row => this.toItemGroup(row)), nextCursor: truncated ? page[page.length - 1].id : null,
      truncated, source: 'persisted_workspace_configuration',
      configurationVersion: createHash('sha256').update(JSON.stringify(page)).digest('hex') };
  }

  async listInspectionTemplates(tenantId: string, workspaceId: string): Promise<RentalInspectionTemplate[]> {
    const rows = await this.prisma.rentalInspectionTemplate.findMany({
      where: { tenantId, workspaceId, enabled: true }, orderBy: { id: "asc" }
    });
    return rows.map((row) => this.toInspectionTemplate(row));
  }

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
    const [workspaces, profiles, settings, operators, locations, itemGroups, pricingGroups, couponTemplates, inspectionTemplates] =
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
        this.prisma.rentalPricingGroup.findMany({
          orderBy: { createdAt: "desc" },
          include: { members: { orderBy: { sortOrder: "asc" }, include: { itemGroup: true } } }
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
      const wsPricingGroups = mine(pricingGroups);
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
        pricingGroups: wsPricingGroups.map((row) => this.toPricingGroup(row)),
        couponTemplates: wsCouponTemplates.map((row) => this.toCouponTemplate(row)),
        inspectionTemplates: wsInspectionTemplates.map((row) => this.toInspectionTemplate(row)),
        // 品类档案不计入：seed 只建档案，不代表该空间的配置写过库。
        hasPersistedConfig: Boolean(
          wsSettings ||
            wsOperators.length ||
            wsLocations.length ||
            wsItemGroups.length ||
            wsPricingGroups.length ||
            wsCouponTemplates.length ||
            wsInspectionTemplates.length
        )
      };
    });
  }

  /** Scoped transaction read for new expense validation, with no seed/cache fallback. */
  async loadWorkspace(tenantId: string, workspaceId: string, tx: RentalConfigTx): Promise<TenantConfigSnapshot> {
    const workspace = await tx.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId }, select: { categoryCode: true, status: true } });
    if (!workspace || workspace.status !== "ACTIVE") throw new ConflictException("当前经营空间不可用");
    const where = { tenantId, workspaceId };
    const [profile, settings, groups, pricingGroups, locations, coupons] = await Promise.all([
      tx.tenantRentalProfile.findFirst({ where: { tenantId } }), tx.rentalTenantBusinessSettings.findFirst({ where }),
      tx.rentalItemGroup.findMany({ where, include: { bundleComponents: { include: { componentItemGroup: { select: { code: true, name: true } } } } } }),
      tx.rentalPricingGroup.findMany({ where, include: { members: { orderBy: { sortOrder: "asc" }, include: { itemGroup: true } } } }),
      tx.rentalFulfillmentLocation.findMany({ where }), tx.rentalCouponTemplate.findMany({ where }),
    ]);
    return { tenantId, workspaceId, workspaceCategoryCode: lower<RentalCategoryCode>(workspace.categoryCode), profile: this.toProfile(profile ?? undefined),
      businessSettings: this.toBusinessSettings(settings ?? undefined), itemGroups: groups.map(row => this.toItemGroup(row)), pricingGroups: pricingGroups.map(row => this.toPricingGroup(row)),
      locations: locations.map(row => this.toLocation(row)), couponTemplates: coupons.map(row => this.toCouponTemplate(row)), operators: [], inspectionTemplates: [], hasPersistedConfig: Boolean(settings) };
  }

  async upsertProfile(profile: TenantRentalProfile, tx?: RentalConfigTx): Promise<void> {
    // The opening-policy lock must live through profile and workspace creation.
    // Autocommit SELECT FOR UPDATE would release it before the protected write.
    if (!tx) {
      await this.prisma.$transaction((client) => this.upsertProfile(profile, client), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      return;
    }
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
    await client.$queryRaw(Prisma.sql`SELECT code FROM rental_category_definitions WHERE code = ${categoryCode.toLowerCase()} FOR UPDATE`);
    const existingWorkspace = await client.businessWorkspace.findUnique({ where: { id: workspaceId } });
    const category = await client.rentalCategoryDefinition.findUnique({ where: { code: categoryCode } });
    const version = category?.recommendedVersionId
      ? await client.rentalCategoryVersion.findUnique({ where: { id: category.recommendedVersionId } })
      : null;
    if (!version || version.categoryCode !== categoryCode ||
        !["published", "legacy_baseline"].includes(version.status)) {
      throw new ConflictException("默认经营空间缺少可采用的品类版本");
    }
    if (!existingWorkspace) await assertCategoryAdoptionAllowed(client, tenantId, categoryCode, version.id, "create");
    const workspace = await client.businessWorkspace.upsert({
      where: { id: workspaceId },
      create: {
        id: workspaceId,
        tenantId,
        code: "default",
        name: RENTAL_CATEGORY_WORKSPACE_NAMES[String(categoryCode).toLowerCase() as RentalCategoryCode] ?? "租赁空间",
        categoryCode,
        categoryVersionId: version.id,
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
    // 旧空间也可能没有初始化审计；只按其实际绑定补记，不把当前推荐版误写为旧空间版本。
    if (workspace.categoryVersionId && workspace.categoryAdoptionRevision === 0) {
      await client.rentalCategoryAdoptionAudit.upsert({
        where: { workspaceId_toRevision: { workspaceId, toRevision: 0 } },
        update: {},
        create: {
          tenantId, workspaceId, toVersionId: workspace.categoryVersionId,
          fromRevision: 0, toRevision: 0, action: "create",
          actorId: "system", reason: "初始化默认经营空间品类版本"
        }
      });
    }
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

  async readVersionedBusinessSettings(tenantId: string, tx?: RentalConfigTx): Promise<VersionedBusinessSettings | null> {
    const client = this.db(tx), workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    if (tx) await lockActiveCategoryBinding(tx, tenantId, workspaceId);
    const row = await client.rentalTenantBusinessSettings.findUnique({ where: { workspaceId } });
    if (!row) return null;
    if (row.tenantId !== tenantId || row.workspaceId !== workspaceId || !Number.isSafeInteger(row.settingsRevision)
      || row.settingsRevision < 1 || !row.settings || typeof row.settings !== 'object' || Array.isArray(row.settings)) throw new ConflictException('经营设置版本不可用');
    return { settings: structuredClone(row.settings) as unknown as TenantRentalBusinessSettings, settingsRevision: row.settingsRevision };
  }

  async upsertBusinessSettings(settings: TenantRentalBusinessSettings, updatedBy: string, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding, expectedSettingsRevision?: number): Promise<number> {
    if (expectedSettingsRevision !== undefined && (!Number.isSafeInteger(expectedSettingsRevision)
      || expectedSettingsRevision < 1 || expectedSettingsRevision >= 4294967295)) throw new BadRequestException('经营设置版本无效');
    const data = {
      categoryCode: upper<$Enums.RentalCategoryCode>(settings.categoryCode),
      configVersion: settings.configVersion,
      settings: settings as unknown as Prisma.InputJsonValue,
      updatedBy
    };
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, settings.tenantId);
      const { definition } = await lockActiveCategoryBinding(client, settings.tenantId, workspaceId, expectedBinding, settings.categoryCode);
      const model = definition.businessModel;
      if (!settings.pricing.enabledUnits.length || settings.pricing.enabledUnits.some((unit) => !model.pricingUnits.includes(unit)) || !settings.pricing.enabledUnits.includes(settings.pricing.defaultUnit)) throw new BadRequestException("当前经营品类不支持该计价设置");
      if (!settings.fulfillment.enabledModes.length || settings.fulfillment.enabledModes.some((mode) => !model.fulfillmentModes.includes(mode))) throw new BadRequestException("当前经营品类不支持该履约设置");
      if (!model.supportsHolidayPricing && (settings.pricing.holidayPricingEnabled || settings.calendar.holidayPricingEnabled)) throw new BadRequestException("当前经营品类不支持节假日差异定价");
      if (expectedSettingsRevision !== undefined) {
        const changed = await client.rentalTenantBusinessSettings.updateMany({
          where: { workspaceId, tenantId: settings.tenantId, settingsRevision: expectedSettingsRevision },
          data: { ...data, settingsRevision: { increment: 1 } }
        });
        if (changed.count !== 1) throw new ConflictException('经营设置版本已变化，请重新准备');
        return expectedSettingsRevision + 1;
      }
      const saved = await client.rentalTenantBusinessSettings.upsert({
        where: { workspaceId },
        create: { workspaceId, tenantId: settings.tenantId, ...data, settingsRevision: 1 },
        update: { ...data, settingsRevision: { increment: 1 } },
        select: { settingsRevision: true }
      });
      return saved.settingsRevision;
    };
    // Scope lookup can happen before waiting for the space lock. READ COMMITTED
    // prevents that lookup from pinning an old MySQL snapshot for later reads.
    return tx ? write(tx) : this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
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
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, operator.tenantId);
      await lockActiveCategoryBinding(client, operator.tenantId, workspaceId);
      const existing = await client.rentalFulfillmentOperator.findUnique({ where: { id: operator.id }, select: { tenantId: true, workspaceId: true } });
      assertScopedWrite(existing, operator.tenantId, workspaceId, "经营主体");
      await client.rentalFulfillmentOperator.upsert({
        where: { id: operator.id },
        create: { workspaceId, id: operator.id, ...data, createdAt: new Date(operator.createdAt) },
        update: data
      });
    };
    if (tx) await write(tx); else await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async upsertLocation(location: RentalFulfillmentLocation, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding): Promise<void> {
    const data = {
      tenantId: location.tenantId,
      organizationId: location.organizationId ?? null,
      code: location.code,
      name: location.name,
      type: location.type,
      operatorId: location.operatorId ?? null,
      operatorType: location.operatorType ?? null,
      operatorName: location.operatorName ?? null,
      parentLocationId: location.parentLocationId ?? null,
      capabilities: location.capabilities as unknown as Prisma.InputJsonValue,
      address: location.address ?? null,
      province: location.province ?? null,
      city: location.city ?? null,
      district: location.district ?? null,
      timezone: location.timezone ?? null,
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      contactName: location.contactName ?? null,
      contactPhone: location.contactPhone ?? null,
      businessHours: location.businessHours ?? null,
      status: location.status
    };
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, location.tenantId);
      const { definition } = await lockActiveCategoryBinding(client, location.tenantId, workspaceId, expectedBinding);
      if (!definition.businessModel.locationTypes.includes(location.type)) throw new BadRequestException("当前经营品类不支持该履约地点类型");
      const existing = await client.rentalFulfillmentLocation.findUnique({ where: { id: location.id }, select: { tenantId: true, workspaceId: true } });
      assertScopedWrite(existing, location.tenantId, workspaceId, "履约地点");
      if (location.operatorId) {
        const operator = await client.rentalFulfillmentOperator.findFirst({ where: { id: location.operatorId, tenantId: location.tenantId, workspaceId }, select: { id: true } });
        if (!operator) throw new ConflictException("履约地点引用了其他租户或经营空间的经营主体");
      }
      if (location.organizationId) {
        const organization = await client.organizationUnit.findFirst({
          where: { id: location.organizationId, tenantId: location.tenantId, status: "enabled" },
          select: { id: true }
        });
        if (!organization) throw new ConflictException("履约地点只能归属当前租户内已启用的组织");
      }
      if (location.parentLocationId) {
        const parent = await client.rentalFulfillmentLocation.findFirst({ where: { id: location.parentLocationId, tenantId: location.tenantId, workspaceId }, select: { id: true } });
        if (!parent) throw new ConflictException("履约地点引用了其他租户或经营空间的上级地点");
      }
      await client.rentalFulfillmentLocation.upsert({
        where: { id: location.id },
        create: { workspaceId, id: location.id, ...data },
        update: data
      });
    };
    if (tx) await write(tx); else await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** 套装组成是独立表，整组替换以免留下已被移除的组件行。 */
  async upsertItemGroup(group: RentalItemGroup, tx?: RentalConfigTx, uniqueAttributes?: RentalUniqueAttributeClaim[], expectedBinding?: CategoryWriteBinding, allowMediaWrite = false): Promise<void> {
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
      const activeWrite = await validateActiveCategoryWrite(client, group.tenantId, workspaceId, {
        id: group.id, scope: "item_group", attributes: group.attributes, inventoryMode: group.inventoryMode, categoryCode: group.categoryCode
      }, expectedBinding, allowMediaWrite);
      const existing = await client.rentalItemGroup.findUnique({ where: { id: group.id }, select: { tenantId: true, workspaceId: true } });
      assertScopedWrite(existing, group.tenantId, workspaceId, "产品型号");
      const componentIds = [...new Set(group.bundleComponents.map((component) => component.itemGroupId))];
      if (componentIds.length) {
        const components = await client.rentalItemGroup.findMany({ where: { id: { in: componentIds }, tenantId: group.tenantId, workspaceId }, select: { id: true } });
        if (components.length !== componentIds.length) throw new ConflictException("套装组成引用了其他租户或经营空间的产品型号");
      }
      {
        await client.rentalAttributeUniqueValue.deleteMany({
          where: { tenantId: group.tenantId, workspaceId, entityType: "item_group", entityId: group.id }
        });
        for (const claim of activeWrite.claims) {
          try {
            await client.rentalAttributeUniqueValue.create({ data: {
              id: `attruniq_${createHash("sha256").update(`${workspaceId}|item_group|${claim.fieldCode}|${claim.normalizedValue}`).digest("hex")}`,
              tenantId: group.tenantId, workspaceId, entityType: "item_group",
              fieldCode: claim.fieldCode,
              normalizedHash: createHash("sha256").update(claim.normalizedValue).digest("hex"),
              normalizedValue: claim.normalizedValue, entityId: group.id
            } });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
              throw new ConflictException(`${claim.label}已存在`);
            }
            throw error;
          }
        }
      }
      await client.rentalItemGroup.upsert({
        where: { id: group.id },
        create: { workspaceId, id: group.id, ...data, attributes: activeWrite.attributes as Prisma.InputJsonValue, createdAt: new Date(group.createdAt) },
        update: { ...data, attributes: activeWrite.attributes as Prisma.InputJsonValue }
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
    try {
      await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (uniqueAttributes?.length && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException(`${uniqueAttributes[0].label}已存在`);
      }
      throw error;
    }
  }

  /** 定价分组与成员一次提交，避免主档已更新但成员范围仍是旧值。 */
  async upsertPricingGroup(group: RentalPricingGroup, tx?: RentalConfigTx): Promise<void> {
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, group.tenantId);
      const existing = await client.rentalPricingGroup.findUnique({ where: { id: group.id }, select: { tenantId: true, workspaceId: true } });
      assertScopedWrite(existing, group.tenantId, workspaceId, "定价分组");
      if (group.memberItemGroupIds.length) {
        const members = await client.rentalItemGroup.findMany({ where: { id: { in: group.memberItemGroupIds }, tenantId: group.tenantId, workspaceId }, select: { id: true } });
        if (members.length !== new Set(group.memberItemGroupIds).size) throw new ConflictException("定价分组引用了其他租户或经营空间的产品型号");
      }
      await client.rentalPricingGroup.upsert({
        where: { id: group.id },
        create: {
          id: group.id,
          tenantId: group.tenantId,
          workspaceId,
          categoryCode: upper<$Enums.RentalCategoryCode>(group.categoryCode),
          code: group.code,
          name: group.name,
          description: group.description ?? null,
          defaultPricingUnit: group.defaultPricingUnit ?? null,
          status: group.status,
          version: group.version,
          createdAt: new Date(group.createdAt)
        },
        update: {
          code: group.code,
          name: group.name,
          description: group.description ?? null,
          defaultPricingUnit: group.defaultPricingUnit ?? null,
          status: group.status,
          version: group.version
        }
      });
      await client.rentalPricingGroupMember.deleteMany({ where: { pricingGroupId: group.id } });
      if (group.memberItemGroupIds.length) {
        await client.rentalPricingGroupMember.createMany({
          data: group.memberItemGroupIds.map((itemGroupId, sortOrder) => ({ pricingGroupId: group.id, itemGroupId, sortOrder }))
        });
      }
    };
    if (tx) return void await write(tx);
    await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async listCouponTemplates(tenantId: string, workspaceId: string): Promise<RentalCouponTemplate[]> {
    const rows = await this.prisma.rentalCouponTemplate.findMany({
      where: { tenantId, workspaceId }, orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => this.toCouponTemplate(row));
  }

  async upsertCouponTemplate(template: RentalCouponTemplate, tx?: RentalConfigTx, expectedBinding?: CategoryWriteBinding): Promise<void> {
    const data = {
      tenantId: template.tenantId,
      code: template.code,
      name: template.name,
      discountType: template.discountType,
      discountValue: new Prisma.Decimal(template.discountValue),
      minimumSpend: new Prisma.Decimal(template.minimumSpend),
      maximumDiscount: template.maximumDiscount === undefined ? null : new Prisma.Decimal(template.maximumDiscount),
      appliesTo: template.appliesTo,
      stackableWithDiscountPlans: template.stackableWithDiscountPlans,
      totalQuota: template.totalQuota,
      claimedQuantity: template.claimedQuantity,
      perCustomerLimit: template.perCustomerLimit,
      perCustomerUseLimit: template.perCustomerUseLimit,
      totalBudget: template.totalBudget === undefined ? null : new Prisma.Decimal(template.totalBudget),
      lockedBudget: new Prisma.Decimal(template.lockedBudget),
      redeemedBudget: new Prisma.Decimal(template.redeemedBudget),
      claimFrom: new Date(template.claimFrom),
      claimTo: new Date(template.claimTo),
      effectiveFrom: new Date(template.effectiveFrom),
      effectiveTo: new Date(template.effectiveTo),
      applicableRentalFrom: template.applicableRentalFrom ? new Date(template.applicableRentalFrom) : null,
      applicableRentalTo: template.applicableRentalTo ? new Date(template.applicableRentalTo) : null,
      applicableItemGroupIds: template.applicableItemGroupIds as unknown as Prisma.InputJsonValue,
      status: template.status,
      version: template.version
    };
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, template.tenantId);
      await lockActiveCategoryBinding(client, template.tenantId, workspaceId, expectedBinding);
      // Locking reads must provide the values too: a caller's outer transaction may
      // already have a REPEATABLE READ snapshot from before a concurrent claim.
      const rows = await client.$queryRaw<CouponTemplateRow[]>(Prisma.sql`
        SELECT * FROM rental_coupon_templates WHERE id = ${template.id} FOR UPDATE
      `);
      const existing = rows[0];
      assertScopedWrite(existing, template.tenantId, workspaceId, "优惠券模板");
      if (existing) {
        if ((!tx || expectedBinding) && (existing.claimedQuantity !== template.claimedQuantity
          || Number(existing.lockedBudget) !== template.lockedBudget || Number(existing.redeemedBudget) !== template.redeemedBudget)) {
          throw new ConflictException("优惠券配额或预算已变化，请刷新后重新保存");
        }
        if (template.totalQuota < existing.claimedQuantity) throw new BadRequestException("发行量不能低于已领取数量");
        if (template.totalBudget !== undefined && template.totalBudget < Number(existing.lockedBudget) + Number(existing.redeemedBudget)) {
          throw new BadRequestException("总预算不能低于已锁定与已核销预算");
        }
        if (expectedBinding && template.version !== `${Number(existing.version.split(".")[0]) + 1}.0`) {
          throw new ConflictException("优惠券模板已被其他人员修改，请刷新后重新保存");
        }
      }
      await client.rentalCouponTemplate.upsert({
        where: { id: template.id },
        create: { workspaceId, id: template.id, ...data, createdAt: new Date(template.createdAt) },
        update: data
      });
    };
    if (tx) await write(tx);
    else await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async lockCouponTemplateForClaim(
    tenantId: string,
    templateId: string,
    tx: RentalConfigTx
  ): Promise<RentalCouponTemplate | undefined> {
    const workspaceId = await resolveScopeWorkspaceId(tx, tenantId);
    await lockActiveCategoryBinding(tx, tenantId, workspaceId);
    const rows = await tx.$queryRaw<CouponTemplateRow[]>(Prisma.sql`
      SELECT * FROM \`rental_coupon_templates\`
      WHERE \`id\` = ${templateId}
        AND \`tenantId\` = ${tenantId}
        AND \`workspaceId\` = ${workspaceId}
        AND \`status\` = 'active'
      FOR UPDATE
    `);
    const row = rows[0];
    return row ? this.toCouponTemplate({ ...row, stackableWithDiscountPlans: Boolean(row.stackableWithDiscountPlans) }) : undefined;
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
    const write = async (client: RentalConfigTx) => {
      const workspaceId = await resolveScopeWorkspaceId(client, template.tenantId);
      await lockActiveCategoryBinding(client, template.tenantId, workspaceId, undefined, template.categoryCode);
      const existing = await client.rentalInspectionTemplate.findUnique({ where: { id: template.id }, select: { tenantId: true, workspaceId: true } });
      assertScopedWrite(existing, template.tenantId, workspaceId, "检查模板");
      await client.rentalInspectionTemplate.upsert({
        where: { id: template.id },
        create: { workspaceId, id: template.id, ...data },
        update: data
      });
    };
    if (tx) await write(tx); else await this.prisma.$transaction(write, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
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
    organizationId: string | null;
    operatorId: string | null; operatorType: string | null; operatorName: string | null;
    parentLocationId: string | null; capabilities: Prisma.JsonValue; address: string | null;
    province: string | null; city: string | null; district: string | null; timezone: string | null;
    latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null;
    contactName: string | null; contactPhone: string | null; businessHours: string | null; status: string;
  }): RentalFulfillmentLocation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId ?? undefined,
      code: row.code,
      name: row.name,
      type: row.type as RentalLocationType,
      operatorId: row.operatorId ?? undefined,
      operatorType: (row.operatorType ?? undefined) as RentalFulfillmentLocation["operatorType"],
      operatorName: row.operatorName ?? undefined,
      parentLocationId: row.parentLocationId ?? undefined,
      capabilities: (row.capabilities ?? []) as RentalFulfillmentLocation["capabilities"],
      address: row.address ?? undefined,
      province: row.province ?? undefined,
      city: row.city ?? undefined,
      district: row.district ?? undefined,
      timezone: row.timezone ?? undefined,
      latitude: row.latitude === null ? undefined : Number(row.latitude),
      longitude: row.longitude === null ? undefined : Number(row.longitude),
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
    const attributes = (row.attributes ?? {}) as Record<string, unknown>;
    const media = attributes.__itemGroupMedia;
    const storedImages = media && typeof media === "object" && !Array.isArray(media) && Array.isArray((media as { images?: unknown }).images)
      ? (media as { images: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; isCover: boolean }> }).images
      : [];
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      inventoryMode: lower<RentalInventoryMode>(row.inventoryMode),
      unit: row.unit,
      description: row.description ?? undefined,
      attributes,
      images: storedImages.map((image) => ({ ...image, url: `/api/rental/v1/item-groups/${encodeURIComponent(row.id)}/images/${encodeURIComponent(image.id)}` })),
      bundleComponents,
      status: row.status as RentalItemGroup["status"],
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toPricingGroup(row: {
    id: string; tenantId: string; categoryCode: string; code: string; name: string;
    description: string | null; defaultPricingUnit: string | null; status: string; version: number;
    createdAt: Date; updatedAt: Date;
    members: Array<{ itemGroupId: string; itemGroup: {
      id: string; code: string; name: string; inventoryMode: string; unit: string; status: string;
    } }>;
  }): RentalPricingGroup {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryCode: lower<RentalCategoryCode>(row.categoryCode),
      code: row.code,
      name: row.name,
      description: row.description ?? undefined,
      defaultPricingUnit: (row.defaultPricingUnit ?? undefined) as RentalPricingGroup["defaultPricingUnit"],
      memberItemGroupIds: row.members.map((member) => member.itemGroupId),
      members: row.members.map(({ itemGroup }) => ({
        id: itemGroup.id,
        code: itemGroup.code,
        name: itemGroup.name,
        inventoryMode: lower<RentalInventoryMode>(itemGroup.inventoryMode),
        unit: itemGroup.unit,
        status: itemGroup.status as RentalItemGroup["status"]
      })),
      status: row.status as RentalPricingGroup["status"],
      version: row.version,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt)
    };
  }

  private toCouponTemplate(row: {
    id: string; tenantId: string; code: string; name: string; discountType: string;
    discountValue: Prisma.Decimal; minimumSpend: Prisma.Decimal; maximumDiscount: Prisma.Decimal | null;
    appliesTo: string; stackableWithDiscountPlans: boolean;
    totalQuota: number; claimedQuantity: number; perCustomerLimit: number; perCustomerUseLimit: number;
    totalBudget: Prisma.Decimal | null; lockedBudget: Prisma.Decimal; redeemedBudget: Prisma.Decimal;
    claimFrom: Date; claimTo: Date;
    effectiveFrom: Date; effectiveTo: Date; applicableItemGroupIds: Prisma.JsonValue;
    applicableRentalFrom: Date | null; applicableRentalTo: Date | null;
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
      appliesTo: row.appliesTo as RentalCouponTemplate["appliesTo"],
      stackableWithDiscountPlans: row.stackableWithDiscountPlans,
      totalQuota: row.totalQuota,
      claimedQuantity: row.claimedQuantity,
      perCustomerLimit: row.perCustomerLimit,
      perCustomerUseLimit: row.perCustomerUseLimit,
      totalBudget: row.totalBudget === null ? undefined : num(row.totalBudget),
      lockedBudget: num(row.lockedBudget),
      redeemedBudget: num(row.redeemedBudget),
      claimFrom: iso(row.claimFrom),
      claimTo: iso(row.claimTo),
      effectiveFrom: iso(row.effectiveFrom),
      effectiveTo: iso(row.effectiveTo),
      applicableRentalFrom: row.applicableRentalFrom ? iso(row.applicableRentalFrom) : undefined,
      applicableRentalTo: row.applicableRentalTo ? iso(row.applicableRentalTo) : undefined,
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
