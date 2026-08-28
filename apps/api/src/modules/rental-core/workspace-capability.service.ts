import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  RENTAL_CAPABILITY_MODULES,
  type RentalCapability,
  type RentalCapabilityConfigField,
  type RentalCapabilityDefinition,
  type SaveWorkspaceCapabilityRequest,
  type UpgradeWorkspaceCapabilityRequest,
  type WorkspaceCapabilityAuditEvent,
  type WorkspaceCapabilityInstance,
  type WorkspaceCapabilityOverview,
  type WorkspaceCapabilityView
} from "@store-rental/shared";
import { WorkspaceCapabilityRepository } from "./workspace-capability.repository";

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
    const capabilities: WorkspaceCapabilityView[] = RENTAL_CAPABILITY_MODULES.map((definition) => {
      const instance = instances.get(definition.code);
      const implemented = definition.implementationVersion !== undefined;
      const applicable =
        definition.applicableCategories === "all" || definition.applicableCategories.includes(categoryCode);
      return {
        definition,
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
    // 生产就绪：该品类声明的、必选的、且**有可执行模块**的能力全部处于 enabled。
    // 只有 code 没有模块的必选能力同样算缺失——否则「已声明」会被当成「已具备」。
    const missingRequired = capabilities
      .filter(
        (view) =>
          view.definition.kind === "category_required" &&
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
    input: Record<string, string | number | boolean>
  ): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};
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
      if (typeof value !== "string") throw new BadRequestException(`配置项 ${field.label} 必须是字符串`);
      if (field.type === "enum" && !(field.options ?? []).includes(value)) {
        throw new BadRequestException(`配置项 ${field.label} 只能是 ${(field.options ?? []).join("、")}`);
      }
      result[field.key] = value;
    }
    return result;
  }
}
