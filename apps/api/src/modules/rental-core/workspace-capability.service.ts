import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  RENTAL_CAPABILITY_MODULES,
  RENTAL_CATEGORY_DEFINITIONS,
  type RentalCapability,
  type RentalCapabilityConfig,
  type RentalCategoryCode,
  type RentalCapabilityConfigField,
  type RentalCapabilityDefinition,
  type RentalCompatibilityEntityRef,
  type RentalCompatibilityRelation,
  type SaveWorkspaceCapabilityRequest,
  type UpgradeWorkspaceCapabilityRequest,
  type WorkspaceCapabilityAuditEvent,
  type WorkspaceCapabilityInstance,
  type WorkspaceCapabilityOverview,
  type WorkspaceCapabilityView,
  type RentalWorkspaceCapabilitySnapshotEntry
} from "@rental-os/shared";
import { WorkspaceCapabilityRepository } from "./workspace-capability.repository";

/** 初始化必须在调用方的事务里执行，因此显式收窄为事务客户端。 */
type CapabilityTx = Parameters<WorkspaceCapabilityRepository["initializeInstances"]>[2];

const DEFINITIONS = new Map<string, RentalCapabilityDefinition>(
  RENTAL_CAPABILITY_MODULES.map((module) => [module.code, module])
);

const stamp = () => new Date().toISOString();

/** 配置版本按整数递增，`v1`、`v2`…；字符串版本号在两位数后会被字典序排错，故只存序号。 */
function nextConfigVersion(current?: string) {
  const parsed = Number((current ?? "").replace(/^v/u, ""));
  return `v${Number.isFinite(parsed) && parsed > 0 ? parsed + 1 : 1}`;
}

/**
 * CORE-EXT-02A：capability 定义、经营空间实例、配置与版本的运行时。
 *
 * 这一层要守住的核心口径：**「品类声明了某个 code」不等于「该空间启用了该能力」**。
 * 早前空间能力直接读品类定义的数组，于是只有 code、没有可执行模块的能力也被当成可用功能。
 * 现在判定分三层：
 *   1. 声明（品类 `defaultCapabilities` 或 `shared` 能力）——只说明「可能相关」；
 *   2. 已实现（注册表带 `implementationVersion`）——只说明「有可执行模块」；
 *   3. 已启用（实例 `status === "enabled"`）——才是真正可用。
 */
@Injectable()
export class WorkspaceCapabilityService {
  constructor(private readonly repository: WorkspaceCapabilityRepository) {}

  /** 某能力在该空间是否**真正可用**。菜单与 API 门禁只能用这个判定（CORE-EXT-02C 消费）。 */
  async isEnabled(tenantId: string, code: RentalCapability, workspaceId?: string): Promise<boolean> {
    const scope = workspaceId ?? (await this.repository.currentWorkspaceId(tenantId));
    const instance = await this.repository.findInstance(tenantId, scope, code);
    return instance?.status === "enabled";
  }

  /**
   * 该空间**已启用**的能力实例。CORE-EXT-02B 的 Hook 运行时按此决定执行哪些能力。
   *
   * 刻意只返回 `enabled`：`paused` 与 `disabled` 都有实例行，若这里按"有实例"返回，
   * 暂停的能力仍会参与判定，暂停就成了只改显示的空操作。
   */
  async enabledInstances(tenantId: string, workspaceId?: string): Promise<WorkspaceCapabilityInstance[]> {
    const scope = workspaceId ?? (await this.repository.currentWorkspaceId(tenantId));
    const instances = await this.repository.listInstances(tenantId, scope);
    return instances.filter((instance) => instance.status === "enabled");
  }

  /**
   * CORE-EXT-02D：该空间已启用能力的**版本快照**，固化进报价与订单。
   *
   * 只保留判定所需的 code、实现版本、配置版本与配置本体，不含 revision/时间戳——
   * 那些会随实例变动，而快照必须是不可变历史事实。重建在途订单的 Hook 执行名单时
   * 由它构造「状态恒 enabled」的实例视图，因此能力被暂停或升级都不改写在途订单的判定。
   */
  async snapshotEnabled(
    tenantId: string,
    workspaceId?: string
  ): Promise<RentalWorkspaceCapabilitySnapshotEntry[]> {
    const enabled = await this.enabledInstances(tenantId, workspaceId);
    return enabled
      .map((instance) => ({
      code: instance.code,
      implementationVersion: instance.implementationVersion,
      configVersion: instance.configVersion,
      config: structuredClone(instance.config)
      }))
      // 稳定排序：快照要可复现比对，不能受查库返回序影响。
      .sort((left, right) => left.code.localeCompare(right.code));
  }

  /**
   * 把报价 / 订单固化的能力快照还原成 Hook 运行时能吃的实例视图。
   *
   * 状态一律填 `enabled`：快照里的能力都是下单当时启用的，在途订单必须继续按它们履约；
   * 若某能力此后被暂停，读当前实例会把它排除，等于中途改变了这张订单的判定规则。
   */
  static instancesFromSnapshot(
    tenantId: string,
    workspaceId: string,
    snapshot: RentalWorkspaceCapabilitySnapshotEntry[]
  ): WorkspaceCapabilityInstance[] {
    const now = stamp();
    return snapshot.map((entry) => ({
      tenantId,
      workspaceId,
      code: entry.code,
      status: "enabled" as const,
      implementationVersion: entry.implementationVersion,
      configVersion: entry.configVersion,
      config: structuredClone(entry.config),
      revision: 0,
      createdAt: now,
      updatedAt: now
    }));
  }

  /**
   * 品类必选能力的初始化名单。
   *
   * 名单是 `overview.missingRequired` 中**已经有实现且具备安全默认配置**的子集。
   * 未实现的必选能力仍保留在总览缺失清单里，不能为了让初始化后变绿而伪装启用。
   *
   * 未实现的必选能力不在名单里，也不得伪装启用——空间保持非生产就绪是正确结果。
   * 可选能力一律不自动启用：那是经营决策，不是系统默认。
   */
  static requiredInitializationTargets(
    categoryCode: RentalCategoryCode,
    declaredCodes: RentalCapability[],
    // 可注入的注册表。默认取生产注册表；测试传入含「未实现的必选能力」「必填配置无默认值的
    // 必选能力」的候选集，以证明这两道过滤真的生效。
    //
    // 必须可注入：真实注册表无法覆盖所有「未实现/缺默认配置」的组合，
    // 因此**用真实注册表根本构造不出**能触发这两道过滤的输入——变异测试会因此存活，
    // 那不是断言写错，而是缺少能区分的夹具。
    registry: RentalCapabilityDefinition[] = RENTAL_CAPABILITY_MODULES,
    requiredCodes: RentalCapability[] =
      RENTAL_CATEGORY_DEFINITIONS.find((category) => category.code === categoryCode)?.requiredCapabilities ?? []
  ): RentalCapabilityDefinition[] {
    const declared = new Set(declaredCodes);
    const required = new Set(requiredCodes);
    return registry.filter((definition) => {
      if (!required.has(definition.code)) return false;
      if (definition.implementationVersion === undefined) return false;
      const applicable =
        definition.applicableCategories === "all" || definition.applicableCategories.includes(categoryCode);
      if (!applicable) return false;
      // 只初始化品类**已声明**的必选能力。这与 overview 的 missingRequired 判据一致。
      // 必选性来自品类定义；同一个 shared 能力可以对一个品类必选、对另一个品类可选。
      return declared.has(definition.code);
    });
  }

  /**
   * 创建经营空间时自动启用品类必选能力（Review P1-3）。
   *
   * 必须在**调用方的事务里**执行：需求要求空间档案与其品类能力原子创建，
   * 任一步失败整体回滚，否则会留下「空间已建、能力没开」的半成品，
   * 而那种空间在生产模式下连报价都做不了。
   *
   * 幂等：已存在实例的 code 一律跳过（不覆盖运营后来的暂停/停用决定）。
   * 因此重复调用安全，也可以作为存量空间的显式对账入口。
   *
   * 必填配置项没有默认值的必选能力会被跳过并计入返回值的 `skipped`——
   * 编造一个配置值等于伪装启用，空间应当保持非生产就绪，由人补配置后再启用。
   */
  async initializeRequiredCapabilities(
    tenantId: string,
    workspaceId: string,
    categoryCode: RentalCategoryCode,
    declaredCodes: RentalCapability[],
    tx: CapabilityTx,
    options: {
      operator?: string;
      reason?: string;
      registry?: RentalCapabilityDefinition[];
      requiredCodes?: RentalCapability[];
    } = {}
  ): Promise<{ enabled: RentalCapability[]; skipped: Array<{ code: RentalCapability; why: string }> }> {
    const targets = WorkspaceCapabilityService.requiredInitializationTargets(
      categoryCode,
      declaredCodes,
      options.registry,
      options.requiredCodes
    );
    const existing = new Set(
      (await this.repository.listInstancesInTx(tenantId, workspaceId, tx)).map((instance) => instance.code)
    );
    const now = stamp();
    const reason = options.reason?.trim() || `创建经营空间时按品类 ${categoryCode} 自动启用必选能力`;
    const rows: WorkspaceCapabilityInstance[] = [];
    const audits: WorkspaceCapabilityAuditEvent[] = [];
    const skipped: Array<{ code: RentalCapability; why: string }> = [];

    for (const definition of targets) {
      if (existing.has(definition.code)) {
        skipped.push({ code: definition.code, why: "已存在实例，保留现状（幂等）" });
        continue;
      }
      const missingConfig = definition.configSchema.filter((field) => field.required && field.defaultValue === undefined);
      if (missingConfig.length) {
        skipped.push({
          code: definition.code,
          why: `必填配置项 ${missingConfig.map((field) => field.label).join("、")} 没有默认值，不能自动启用`
        });
        continue;
      }
      const config: RentalCapabilityConfig = {};
      for (const field of definition.configSchema) {
        if (field.defaultValue !== undefined) config[field.key] = field.defaultValue;
      }
      rows.push({
        tenantId,
        workspaceId,
        code: definition.code,
        status: "enabled",
        implementationVersion: definition.implementationVersion!,
        configVersion: "v1",
        config,
        revision: 1,
        enabledAt: now,
        updatedBy: options.operator,
        createdAt: now,
        updatedAt: now
      });
      audits.push({
        code: definition.code,
        // 与 `enable` 分开：这是系统按品类定义做的初始化，不是某个人的经营决策。
        action: "system_initialize",
        toStatus: "enabled",
        implementationVersion: definition.implementationVersion,
        configVersion: "v1",
        configSnapshot: config,
        reason,
        operator: options.operator,
        at: now
      });
    }
    const enabled = rows.length ? await this.repository.initializeInstances(rows, audits, tx) : [];
    return { enabled, skipped };
  }

  /** 空间的运行模式，供会话上下文与管理端明确标注「非生产」。 */
  async workspaceRunMode(tenantId: string, workspaceId?: string) {
    const scope = workspaceId ?? (await this.repository.currentWorkspaceId(tenantId));
    return this.repository.workspaceRunMode(tenantId, scope);
  }

  /**
   * Review P1-3：存量空间的显式对账。在自己的事务里跑一次必选能力初始化。
   *
   * 与创建空间时的初始化共用同一份实现与同一套判据，因此两条路径不会给出不同结果。
   * 事务由这里开：调用方是一个独立的运营动作，没有别的业务变更要一起提交。
   */
  async reconcileRequiredCapabilities(tenantId: string, operator?: string) {
    const workspaceId = await this.repository.currentWorkspaceId(tenantId);
    const { categoryCode, declaredCodes } = await this.repository.workspaceScope(tenantId, workspaceId);
    const result = await this.repository.runInTransaction((tx) =>
      this.initializeRequiredCapabilities(tenantId, workspaceId, categoryCode, declaredCodes, tx, {
        operator,
        reason: `运营显式对账：按品类 ${categoryCode} 初始化缺失的必选能力`
      })
    );
    const overview = await this.overview(tenantId, workspaceId);
    return {
      tenantId,
      workspaceId,
      categoryCode,
      enabled: result.enabled,
      skipped: result.skipped,
      missingRequired: overview.missingRequired,
      productionReady: overview.productionReady
    };
  }

  /**
   * 正式空间的经营门禁（Review P1-4）。
   *
   * `production` 且缺任一必选能力 → 拒绝。demo / development 放行，
   * 由响应与页面标明非生产。只在服务端判定：隐藏按钮挡不住直接调 API。
   */
  async assertWorkspaceOperable(tenantId: string, workspaceId?: string): Promise<void> {
    const scope = workspaceId ?? (await this.repository.currentWorkspaceId(tenantId));
    const runMode = await this.repository.workspaceRunMode(tenantId, scope);
    if (runMode !== "production") return;
    const overview = await this.overview(tenantId, scope);
    if (overview.productionReady) return;
    throw new ConflictException(
      `当前经营空间为正式经营模式，但尚未达到生产经营条件：缺少必选能力 ${overview.missingRequired.join("、")}。` +
        `请先在「经营空间能力」页启用这些能力，或将该空间标记为演示/开发模式。`
    );
  }

  /**
   * 空间能力总览。品类与声明集由仓储从空间行解析，**不做参数**：
   * 让调用方传品类等于允许请求方自选判定口径。
   */
  async overview(tenantId: string, workspaceId?: string): Promise<WorkspaceCapabilityOverview> {
    const scope = workspaceId ?? (await this.repository.currentWorkspaceId(tenantId));
    const { categoryCode, declaredCodes } = await this.repository.workspaceScope(tenantId, scope);
    const instances = new Map(
      (await this.repository.listInstances(tenantId, scope)).map((instance) => [instance.code, instance])
    );
    const declared = new Set(declaredCodes);
    const required = new Set(
      RENTAL_CATEGORY_DEFINITIONS.find((category) => category.code === categoryCode)?.requiredCapabilities ?? []
    );
    const capabilities: WorkspaceCapabilityView[] = RENTAL_CAPABILITY_MODULES.map((definition) => {
      const instance = instances.get(definition.code);
      const implemented = definition.implementationVersion !== undefined;
      const applicable =
        definition.applicableCategories === "all" || definition.applicableCategories.includes(categoryCode);
      return {
        definition,
        requiredForCategory: required.has(definition.code),
        declaredByCategory: declared.has(definition.code) || definition.kind === "shared",
        implemented,
        applicable,
        instance,
        state: instance
          ? instance.status
          : implemented
            ? "not_enabled"
            : "declared_not_implemented",
        upgradeAvailable: Boolean(
          instance &&
            definition.implementationVersion !== undefined &&
            instance.implementationVersion !== definition.implementationVersion
        )
      };
    });
    // 这里只判断“强制扩展模块”是否就绪。Rental Core 的库存、地点、定价、订单、
    // 履约等基础条件由开业配置与各业务入口的事实门禁检查，不能要求运营再建一套
    // capability 实例，否则基础经营会被尚未开发的品类增强模块反向卡死。
    const missingRequired = capabilities
      .filter(
        (view) =>
          required.has(view.definition.code) &&
          view.applicable &&
          view.declaredByCategory &&
          view.state !== "enabled"
      )
      .map((view) => view.definition.code);
    return {
      tenantId,
      workspaceId: scope,
      categoryCode,
      capabilities,
      missingRequired,
      productionReady: missingRequired.length === 0
    };
  }

  async listAudits(tenantId: string, code?: RentalCapability, workspaceId?: string) {
    const scope = workspaceId ?? (await this.repository.currentWorkspaceId(tenantId));
    return this.repository.listAudits(tenantId, scope, code);
  }

  /**
   * 启用 / 暂停 / 停用 / 改配置。六道校验全部 fail-closed：
   * 未注册、未实现、不适用于当前品类、依赖未启用、存在已启用的互斥能力、配置不合法。
   */
  async save(
    tenantId: string,
    input: SaveWorkspaceCapabilityRequest,
    operator?: string
  ): Promise<WorkspaceCapabilityInstance> {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("变更能力状态必须填写原因");
    const definition = DEFINITIONS.get(input.code);
    if (!definition) throw new NotFoundException(`未注册的 capability：${input.code}`);
    const workspaceId = await this.repository.currentWorkspaceId(tenantId);
    const { categoryCode } = await this.repository.workspaceScope(tenantId, workspaceId);
    const existing = await this.repository.findInstance(tenantId, workspaceId, input.code);

    if (input.status === "enabled") {
      // 适用性先判：品类不适用是**更根本**的原因。dispatch 之于 camera 即使将来补上了
      // 可执行模块也依旧不可用，先报「尚无模块」会把人引向错误的方向（去等模块上线）。
      if (definition.applicableCategories !== "all" && !definition.applicableCategories.includes(categoryCode)) {
        throw new ConflictException(`能力 ${input.code} 不适用于当前经营品类 ${categoryCode}`);
      }
      // 未实现的能力不得启用：那会让菜单和 API 对着一个不存在的模块放行。
      if (definition.implementationVersion === undefined) {
        throw new ConflictException(`能力 ${input.code} 已声明但尚无可执行模块，不能启用`);
      }
      for (const dependency of definition.dependsOn) {
        if (!(await this.isEnabled(tenantId, dependency, workspaceId))) {
          throw new ConflictException(`能力 ${input.code} 依赖 ${dependency}，请先启用它`);
        }
      }
      for (const conflict of definition.conflictsWith) {
        if (await this.isEnabled(tenantId, conflict, workspaceId)) {
          throw new ConflictException(`能力 ${input.code} 与已启用的 ${conflict} 互斥`);
        }
      }
    }

    const config = this.validatedConfig(definition, input.config ?? existing?.config ?? {});
    const configChanged = JSON.stringify(config) !== JSON.stringify(existing?.config ?? {});
    const now = stamp();
    const action: WorkspaceCapabilityAuditEvent["action"] =
      existing && existing.status === input.status && configChanged
        ? "configure"
        : input.status === "enabled"
          ? "enable"
          : input.status === "paused"
            ? "pause"
            : "disable";
    const instance: WorkspaceCapabilityInstance = {
      tenantId,
      workspaceId,
      code: input.code,
      status: input.status,
      // 启用时锁定注册表当前实现版本；已有实例保持原版本，升级走独立入口以便留审计。
      implementationVersion:
        existing?.implementationVersion ?? definition.implementationVersion ?? "unimplemented",
      configVersion: configChanged ? nextConfigVersion(existing?.configVersion) : existing?.configVersion ?? "v1",
      config,
      revision: (existing?.revision ?? 0) + 1,
      enabledAt: input.status === "enabled" ? now : existing?.enabledAt,
      pausedAt: input.status === "paused" ? now : existing?.pausedAt,
      disabledAt: input.status === "disabled" ? now : existing?.disabledAt,
      updatedBy: operator,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    // 乐观并发：`expectedRevision` 是「我读到的版本」。
    //
    // 没有实例行时只有 `undefined` 或 `0` 合法（0 = 我确认它还不存在）。带着一个非零版本
    // 号却查不到行，说明调用方读到的是**别的空间或已被删除的行**——早前这里因为
    // `&& existing` 的短路而直接放行并新建，等于在冲突检查里开了个 fail-open 缺口。
    if (input.expectedRevision !== undefined) {
      const currentRevision = existing?.revision ?? 0;
      if (input.expectedRevision !== currentRevision) {
        throw new ConflictException(
          `能力 ${input.code} 已被其他人修改（当前版本 ${currentRevision}，你基于 ${input.expectedRevision}），请刷新后重试`
        );
      }
    }
    return this.repository.saveInstance(
      instance,
      {
        code: input.code,
        action,
        fromStatus: existing?.status,
        toStatus: input.status,
        implementationVersion: instance.implementationVersion,
        configVersion: instance.configVersion,
        configSnapshot: instance.config,
        reason,
        operator,
        at: now
      },
      existing ? existing.revision : undefined
    );
  }

  /** 升级到注册表当前实现版本。历史报价与在途订单按各自快照执行（CORE-EXT-02D 验收）。 */
  async upgrade(
    tenantId: string,
    code: RentalCapability,
    input: UpgradeWorkspaceCapabilityRequest,
    operator?: string
  ): Promise<WorkspaceCapabilityInstance> {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("升级能力必须填写原因");
    const definition = DEFINITIONS.get(code);
    if (!definition) throw new NotFoundException(`未注册的 capability：${code}`);
    if (definition.implementationVersion === undefined) {
      throw new ConflictException(`能力 ${code} 尚无可执行模块，无法升级`);
    }
    const workspaceId = await this.repository.currentWorkspaceId(tenantId);
    const existing = await this.repository.findInstance(tenantId, workspaceId, code);
    if (!existing) throw new NotFoundException(`能力 ${code} 尚未在本经营空间启用，无法升级`);
    if (existing.implementationVersion === definition.implementationVersion) {
      throw new ConflictException(`能力 ${code} 已是最新实现版本 ${definition.implementationVersion}`);
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) {
      throw new ConflictException(
        `能力 ${code} 已被其他人修改（当前版本 ${existing.revision}，你基于 ${input.expectedRevision}），请刷新后重试`
      );
    }
    const now = stamp();
    return this.repository.saveInstance(
      {
        ...existing,
        implementationVersion: definition.implementationVersion,
        revision: existing.revision + 1,
        updatedBy: operator,
        updatedAt: now
      },
      {
        code,
        action: "upgrade",
        fromStatus: existing.status,
        toStatus: existing.status,
        implementationVersion: definition.implementationVersion,
        configVersion: existing.configVersion,
        configSnapshot: existing.config,
        reason,
        operator,
        at: now
      },
      existing.revision
    );
  }

  /** 按注册表的 configSchema 逐字段校验。缺必填、类型不符、枚举越界、越界数值一律拒绝。 */
  private validatedConfig(
    definition: RentalCapabilityDefinition,
    input: RentalCapabilityConfig
  ): RentalCapabilityConfig {
    const result: RentalCapabilityConfig = {};
    const known = new Map<string, RentalCapabilityConfigField>(
      definition.configSchema.map((field) => [field.key, field])
    );
    for (const key of Object.keys(input)) {
      if (!known.has(key)) throw new BadRequestException(`能力 ${definition.code} 不接受配置项 ${key}`);
    }
    for (const field of definition.configSchema) {
      const value = input[field.key];
      if (value === undefined || value === null || value === "") {
        if (field.required) throw new BadRequestException(`能力 ${definition.code} 缺少必填配置项 ${field.label}`);
        continue;
      }
      if (field.type === "number") {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) throw new BadRequestException(`配置项 ${field.label} 必须是数值`);
        if (field.min !== undefined && numeric < field.min) {
          throw new BadRequestException(`配置项 ${field.label} 不能小于 ${field.min}`);
        }
        if (field.max !== undefined && numeric > field.max) {
          throw new BadRequestException(`配置项 ${field.label} 不能大于 ${field.max}`);
        }
        result[field.key] = numeric;
        continue;
      }
      if (field.type === "boolean") {
        if (typeof value !== "boolean") throw new BadRequestException(`配置项 ${field.label} 必须是布尔值`);
        result[field.key] = value;
        continue;
      }
      if (field.type === "compatibility_relations") {
        if (!Array.isArray(value)) throw new BadRequestException(`配置项 ${field.label} 必须是关系数组`);
        const ids = new Set<string>();
        result[field.key] = value.map((row, index) => this.validatedRelation(row, index, ids));
        continue;
      }
      if (typeof value !== "string") throw new BadRequestException(`配置项 ${field.label} 必须是字符串`);
      if (field.type === "enum" && !(field.options ?? []).includes(value)) {
        throw new BadRequestException(`配置项 ${field.label} 只能是 ${(field.options ?? []).join("、")}`);
      }
      result[field.key] = value;
    }
    return result;
  }

  private validatedRelation(value: unknown, index: number, ids: Set<string>): RentalCompatibilityRelation {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(`兼容关系第 ${index + 1} 条必须是对象`);
    }
    const row = value as Partial<RentalCompatibilityRelation>;
    const relationTypes = new Set(["equipment_target", "mount_adapter", "battery_support", "storage_support", "port_support", "model_fit"]);
    const outcomes = new Set(["allow", "warn", "block"]);
    if (!row.id?.trim() || ids.has(row.id.trim())) throw new BadRequestException(`兼容关系第 ${index + 1} 条 id 为空或重复`);
    ids.add(row.id.trim());
    if (!row.relationType || !relationTypes.has(row.relationType)) throw new BadRequestException(`兼容关系 ${row.id} 的 relationType 无效`);
    if (!row.outcome || !outcomes.has(row.outcome)) throw new BadRequestException(`兼容关系 ${row.id} 的 outcome 无效`);
    if (!row.sourceName?.trim() || !row.reason?.trim()) throw new BadRequestException(`兼容关系 ${row.id} 必须填写来源和原因`);
    return {
      id: row.id.trim(),
      relationType: row.relationType,
      source: this.validatedRelationRef(row.source, row.id, "source"),
      target: this.validatedRelationRef(row.target, row.id, "target"),
      outcome: row.outcome,
      sourceName: row.sourceName.trim(),
      reason: row.reason.trim()
    };
  }

  private validatedRelationRef(value: unknown, id: string, side: string): RentalCompatibilityEntityRef {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`兼容关系 ${id} 的 ${side} 无效`);
    const ref = value as Partial<RentalCompatibilityEntityRef>;
    if (!ref.kind || !["item_group", "asset", "attribute"].includes(ref.kind)) throw new BadRequestException(`兼容关系 ${id} 的 ${side}.kind 无效`);
    if ((ref.kind === "item_group" || ref.kind === "asset") && !ref.id?.trim()) throw new BadRequestException(`兼容关系 ${id} 的 ${side}.id 不能为空`);
    if (ref.kind === "attribute" && (!ref.field?.trim() || !ref.value?.trim())) throw new BadRequestException(`兼容关系 ${id} 的 ${side} 属性和值不能为空`);
    return ref.kind === "attribute"
      ? { kind: ref.kind, field: ref.field!.trim(), value: ref.value!.trim() }
      : { kind: ref.kind, id: ref.id!.trim() };
  }
}
