import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  BusinessWorkspaceRunMode,
  RentalCapability,
  RentalCapabilityLifecycleStatus,
  RentalCategoryCode,
  WorkspaceCapabilityAuditEvent,
  WorkspaceCapabilityInstance
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { RentalCategoryResolver } from "./rental-category-resolver.service";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { lockActiveCategoryBinding, type CategoryWriteBinding } from "./category-active-write";
import { RENTAL_CAPABILITY_MODULES, RENTAL_CORE_CAPABILITY_CODES } from "@rental-os/shared";
import { readRentalCategoryCode } from "./category-identity";

/**
 * CORE-EXT-02A：经营空间 capability 实例与生命周期审计的持久化。
 *
 * 两条不变量由这一层保证，而不是靠调用方自觉：
 *   1. 实例写入以读到的 `revision` 为条件（乐观并发）。两个管理员同时改同一能力时，
 *      后写者不会静默覆盖先写者，而是拿到 409。
 *   2. 审计与实例在**同一事务**内落库。审计留在一个被回滚的变更上（或反之）
 *      比没有审计更难排查。
 */
@Injectable()
export class WorkspaceCapabilityRepository {
  constructor(private readonly prisma: PrismaService, private readonly categoryResolver?: RentalCategoryResolver) {}

  /** 当前会话空间；无会话时取该租户默认空间（初始化/回填路径）。 */
  async currentWorkspaceId(tenantId: string): Promise<string> {
    return resolveScopeWorkspaceId(this.prisma, tenantId);
  }

  /**
   * 空间的品类与「品类声明的 code」。
   *
   * 只从 `business_workspaces` 行读取，**不接受调用方传入品类**：品类决定哪些能力可启用，
   * 若能由请求体覆盖，调用方就能声明一个自己空间并不适用的品类来绕开适用性校验。
   * 查不到空间时拒绝而不是回退到租户档案——租户档案的品类是「最后一个持久化的空间」的品类，
   * 回退等于用另一个空间的口径判定当前空间。
   */
  async workspaceScope(
    tenantId: string,
    workspaceId: string,
    tx?: Prisma.TransactionClient
  ): Promise<{ categoryCode: RentalCategoryCode; declaredCodes: RentalCapability[]; requiredCodes?: RentalCapability[]; binding?: CategoryWriteBinding }> {
    if (this.categoryResolver) {
      const resolved = tx
        ? await lockActiveCategoryBinding(tx, tenantId, workspaceId)
        : await this.categoryResolver.forWorkspace(tenantId, workspaceId);
      const { definition } = resolved;
      return {
        categoryCode: definition.code,
        declaredCodes: [...definition.defaultCapabilities],
        requiredCodes: [...definition.requiredCapabilities],
        binding: "binding" in resolved ? resolved.binding : { categoryVersionId: resolved.categoryVersionId, adoptionRevision: resolved.adoptionRevision }
      };
    }
    const workspace = await (tx ?? this.prisma).businessWorkspace.findFirst({
      where: { tenantId, id: workspaceId },
      include: { category: { select: { defaultCapabilities: true } } }
    });
    if (!workspace) {
      throw new ForbiddenException("当前经营空间不存在或经营品类缺失，请重新选择经营空间");
    }
    // 品类关联行可能查不到（品类定义尚未落库、或启动期回填还没跑完）。
    // 直接取 `workspace.category.defaultCapabilities` 会抛 TypeError 并变成 500，
    // 而调用方（登录、会话上下文）拿到的是一个无法解释的内部错误。明确成 Forbidden：
    // 语义上确实是「这个空间此刻不可用」，且调用方能按业务异常处理。
    if (!workspace.category) {
      throw new ForbiddenException(
        `经营空间 ${workspaceId} 的品类 ${workspace.categoryCode} 尚未登记，无法解析能力范围`
      );
    }
    return {
      categoryCode: readRentalCategoryCode(workspace.categoryCode),
      declaredCodes: (workspace.category.defaultCapabilities ?? []) as RentalCapability[]
    };
  }

  async listInstances(tenantId: string, workspaceId: string): Promise<WorkspaceCapabilityInstance[]> {
    const rows = await this.prisma.workspaceCapabilityInstance.findMany({
      where: { tenantId, workspaceId },
      orderBy: { code: "asc" }
    });
    return rows.map((row) => this.toInstance(row));
  }

  /** 同上，但在调用方的事务里读。空间创建时的初始化必须与建空间同事务。 */
  async listInstancesInTx(
    tenantId: string,
    workspaceId: string,
    tx: Prisma.TransactionClient
  ): Promise<WorkspaceCapabilityInstance[]> {
    const rows = await tx.workspaceCapabilityInstance.findMany({
      where: { tenantId, workspaceId },
      orderBy: { code: "asc" }
    });
    return rows.map((row) => this.toInstance(row));
  }

  /**
   * 供显式对账使用：开一个事务并把客户端交给回调，保持「初始化必须在事务里」的约束。
   *
   * 对账是幂等的「只补缺项」操作；两个请求同时补同一批唯一键时，MySQL 可能把落败事务
   * 以 P2034（死锁/写冲突）回滚。这里最多重试两次，让落败方在赢家提交后重新读取，
   * 随后按「已存在则跳过」正常返回。只重试数据库已整体回滚的 P2034，不重试其他异常。
   */
  async runInTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(run);
      } catch (error) {
        if ((error as { code?: string }).code !== "P2034" || attempt === 3) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 25 * attempt));
      }
    }
    throw new Error("能力对账事务重试状态异常");
  }

  /** 空间的运行模式。查不到空间时按最保守的 production 处理，宁可挡住也不放开。 */
  async workspaceRunMode(tenantId: string, workspaceId: string): Promise<BusinessWorkspaceRunMode> {
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { tenantId, id: workspaceId },
      select: { runMode: true }
    });
    if (!workspace) return "production";
    return (workspace.runMode as BusinessWorkspaceRunMode) ?? "production";
  }

  /**
   * 创建空间时批量初始化必选能力实例与其审计（Review P1-3）。
   *
   * 只接受事务客户端：空间档案与能力实例必须原子创建。`skipDuplicates` 让并发或重放
   * 不会因唯一键失败——已存在的实例保持原状，不覆盖运营后来的暂停/停用决定。
   */
  async initializeInstances(
    instances: WorkspaceCapabilityInstance[],
    audits: WorkspaceCapabilityAuditEvent[],
    tx: Prisma.TransactionClient
  ): Promise<RentalCapability[]> {
    if (!instances.length) return [];
    const scope = instances[0];
    const { definition } = await lockActiveCategoryBinding(tx, scope.tenantId, scope.workspaceId);
    for (const instance of instances) {
      if (instance.tenantId !== scope.tenantId || instance.workspaceId !== scope.workspaceId || !definition.requiredCapabilities.includes(instance.code)) throw new ConflictException("能力初始化范围或品类必选声明已变化，请重新对账");
    }
    const inserted: RentalCapability[] = [];
    for (const instance of instances) {
      const result = await tx.workspaceCapabilityInstance.createMany({
        data: [{
        tenantId: instance.tenantId,
        workspaceId: instance.workspaceId,
        code: instance.code,
        status: instance.status,
        implementationVersion: instance.implementationVersion,
        configVersion: instance.configVersion,
        config: instance.config as unknown as Prisma.InputJsonValue,
        revision: instance.revision,
        enabledAt: instance.enabledAt ? new Date(instance.enabledAt) : null,
        updatedBy: instance.updatedBy ?? null
        }],
        skipDuplicates: true
      });
      if (result.count === 1) inserted.push(instance.code);
    }
    const insertedSet = new Set(inserted);
    const insertedAudits = audits.filter((audit) => insertedSet.has(audit.code));
    if (insertedAudits.length) {
      await tx.workspaceCapabilityAuditEntry.createMany({
        data: insertedAudits.map((audit) => ({
          tenantId: instances[0].tenantId,
          workspaceId: instances[0].workspaceId,
          code: audit.code,
          action: audit.action,
          fromStatus: audit.fromStatus ?? null,
          toStatus: audit.toStatus,
          implementationVersion: audit.implementationVersion ?? null,
          configVersion: audit.configVersion ?? null,
          configSnapshot: audit.configSnapshot
            ? (audit.configSnapshot as unknown as Prisma.InputJsonValue)
            : undefined,
          reason: audit.reason,
          operator: audit.operator ?? null,
          at: new Date(audit.at)
        }))
      });
    }
    return inserted;
  }

  async findInstance(
    tenantId: string,
    workspaceId: string,
    code: RentalCapability
  ): Promise<WorkspaceCapabilityInstance | undefined> {
    const row = await this.prisma.workspaceCapabilityInstance.findFirst({
      where: { tenantId, workspaceId, code }
    });
    return row ? this.toInstance(row) : undefined;
  }

  async listAudits(
    tenantId: string,
    workspaceId: string,
    code?: RentalCapability
  ): Promise<WorkspaceCapabilityAuditEvent[]> {
    const rows = await this.prisma.workspaceCapabilityAuditEntry.findMany({
      where: { tenantId, workspaceId, ...(code ? { code } : {}) },
      orderBy: [{ at: "asc" }, { createdAt: "asc" }]
    });
    return rows.map((row) => ({
      code: row.code as RentalCapability,
      action: row.action as WorkspaceCapabilityAuditEvent["action"],
      fromStatus: (row.fromStatus ?? undefined) as RentalCapabilityLifecycleStatus | undefined,
      toStatus: row.toStatus as RentalCapabilityLifecycleStatus,
      implementationVersion: row.implementationVersion ?? undefined,
      configVersion: row.configVersion ?? undefined,
      configSnapshot: (row.configSnapshot ?? undefined) as WorkspaceCapabilityAuditEvent["configSnapshot"],
      reason: row.reason,
      operator: row.operator ?? undefined,
      at: row.at.toISOString()
    }));
  }

  /**
   * 写入实例并追加审计。`expectedRevision` 为 undefined 表示「该行应当还不存在」（首次启用）。
   *
   * 撞唯一键（P2002）或写事务死锁（P2034）一律转 409：并发下「先查后写」必然有窗口，
   * 落败方应当收到「请刷新后重试」，而不是 500。
   */
  async saveInstance(
    instance: WorkspaceCapabilityInstance,
    audit: WorkspaceCapabilityAuditEvent,
    expectedRevision?: number,
    expectedBinding?: CategoryWriteBinding
  ): Promise<WorkspaceCapabilityInstance> {
    const data = {
      status: instance.status,
      implementationVersion: instance.implementationVersion,
      configVersion: instance.configVersion,
      config: instance.config as unknown as Prisma.InputJsonValue,
      revision: instance.revision,
      enabledAt: instance.enabledAt ? new Date(instance.enabledAt) : null,
      pausedAt: instance.pausedAt ? new Date(instance.pausedAt) : null,
      disabledAt: instance.disabledAt ? new Date(instance.disabledAt) : null,
      updatedBy: instance.updatedBy ?? null
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { definition } = await lockActiveCategoryBinding(tx, instance.tenantId, instance.workspaceId, expectedBinding);
        if (audit.code !== instance.code) throw new ConflictException("能力审计与实例编码不一致");
        const modules = new Map(RENTAL_CAPABILITY_MODULES.map((row) => [row.code, row]));
        const core = new Set<RentalCapability>(RENTAL_CORE_CAPABILITY_CODES);
        const declared = new Set(definition.defaultCapabilities);
        const rows = await tx.workspaceCapabilityInstance.findMany({ where: { tenantId: instance.tenantId, workspaceId: instance.workspaceId } });
        const active = new Set(rows.filter((row) => row.status === "enabled" && !core.has(row.code as RentalCapability)).map((row) => row.code));
        if (instance.status === "enabled") active.add(instance.code); else active.delete(instance.code);
        const enabled = (code: RentalCapability) => core.has(code)
          ? Boolean(declared.has(code) && modules.get(code) && (modules.get(code)!.applicableCategories === "all" || modules.get(code)!.applicableCategories.includes(definition.code)))
          : active.has(code);
        const module = modules.get(instance.code);
        if (instance.status === "enabled") {
          if (!module || !module.implementationVersion || (module.applicableCategories !== "all" && !module.applicableCategories.includes(definition.code)) || (module.kind !== "shared" && !declared.has(instance.code))) throw new ConflictException("能力未实现或不适用于当前品类声明");
          for (const dependency of module.dependsOn) if (!enabled(dependency)) throw new ConflictException(`能力 ${instance.code} 依赖 ${dependency}，请先启用它`);
          for (const conflict of module.conflictsWith) if (enabled(conflict)) throw new ConflictException(`能力 ${instance.code} 与已启用的 ${conflict} 互斥`);
        } else {
          for (const code of active) if (modules.get(code as RentalCapability)?.dependsOn.includes(instance.code)) throw new ConflictException(`已启用能力 ${code} 依赖 ${instance.code}，请先处理依赖能力`);
        }
        if (expectedRevision === undefined) {
          await tx.workspaceCapabilityInstance.create({
            data: {
              tenantId: instance.tenantId,
              workspaceId: instance.workspaceId,
              code: instance.code,
              ...data
            }
          });
        } else {
          const updated = await tx.workspaceCapabilityInstance.updateMany({
            where: {
              tenantId: instance.tenantId,
              workspaceId: instance.workspaceId,
              code: instance.code,
              revision: expectedRevision
            },
            data
          });
          if (updated.count === 0) {
            throw new ConflictException(
              `能力 ${instance.code} 已被其他人修改（你基于版本 ${expectedRevision}），请刷新后重试`
            );
          }
        }
        await tx.workspaceCapabilityAuditEntry.create({
          data: {
            tenantId: instance.tenantId,
            workspaceId: instance.workspaceId,
            code: audit.code,
            action: audit.action,
            fromStatus: audit.fromStatus ?? null,
            toStatus: audit.toStatus,
            implementationVersion: audit.implementationVersion ?? null,
            configVersion: audit.configVersion ?? null,
            configSnapshot: audit.configSnapshot
              ? (audit.configSnapshot as unknown as Prisma.InputJsonValue)
              : undefined,
            reason: audit.reason,
            operator: audit.operator ?? null,
            at: new Date(audit.at)
          }
        });
        const row = await tx.workspaceCapabilityInstance.findFirst({
          where: { tenantId: instance.tenantId, workspaceId: instance.workspaceId, code: instance.code }
        });
        return this.toInstance(row!);
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "P2002" || code === "P2034") {
        throw new ConflictException(`能力 ${instance.code} 正被并发修改，请刷新后重试`);
      }
      throw error;
    }
  }

  private toInstance(row: {
    tenantId: string;
    workspaceId: string;
    code: string;
    status: string;
    implementationVersion: string;
    configVersion: string;
    config: unknown;
    revision: number;
    enabledAt: Date | null;
    pausedAt: Date | null;
    disabledAt: Date | null;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): WorkspaceCapabilityInstance {
    return {
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      code: row.code as RentalCapability,
      status: row.status as RentalCapabilityLifecycleStatus,
      implementationVersion: row.implementationVersion,
      configVersion: row.configVersion,
      config: (row.config ?? {}) as WorkspaceCapabilityInstance["config"],
      revision: row.revision,
      enabledAt: row.enabledAt?.toISOString(),
      pausedAt: row.pausedAt?.toISOString(),
      disabledAt: row.disabledAt?.toISOString(),
      updatedBy: row.updatedBy ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
