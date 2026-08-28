import { ConflictException, Injectable, Logger } from "@nestjs/common";
import {
  RENTAL_CAPABILITY_MODULES,
  type RentalCapability,
  type RentalCapabilityHookModule,
  type RentalCapabilityHookOutcome,
  type RentalCapabilityHookPoint,
  type RentalCapabilityHookResult,
  type RentalCategoryCode,
  type WorkspaceCapabilityInstance
} from "@store-rental/shared";
import { WorkspaceCapabilityService } from "./workspace-capability.service";

const DEFINITIONS = new Map(RENTAL_CAPABILITY_MODULES.map((module) => [module.code, module]));

/**
 * 传给 Hook 的业务对象必须是**克隆后冻结**的，不能冻结活对象。
 *
 * 冻结活对象会让 Core 紧随其后的 `order.status = ...` 在严格模式下抛错；
 * 而直接传活对象则等于允许能力就地改写 Core 事实——那是本任务明确禁止的。
 * 因此这里深克隆再深冻结：能力看到的是判定时刻的快照，改它不影响任何真实事实。
 */
function frozenSnapshot<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => frozenSnapshot(item))) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (value && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = frozenSnapshot(item);
    }
    return Object.freeze(clone) as unknown as T;
  }
  return value;
}

export interface CapabilityHookRunInput<TSubject> {
  point: RentalCapabilityHookPoint;
  tenantId: string;
  workspaceId: string;
  categoryCode: RentalCategoryCode;
  subject: TSubject;
  operator?: string;
  at?: string;
  /** 已解析的启用实例。Core 在一次动作里多次触发 Hook 时传入，避免重复查库。 */
  instances?: WorkspaceCapabilityInstance[];
}

/**
 * CORE-EXT-02B：capability Hook 运行时。
 *
 * 四条口径由这一层保证，而不是靠各能力模块自觉：
 *   1. **未启用不执行**。执行名单来自 `enabledInstances`（只含 `status === "enabled"`），
 *      不是注册表也不是品类声明数组。暂停/停用的能力一律不参与判定。
 *   2. **确定性顺序**。按 `(order, code)` 升序，不用注册表下标或 Map 插入序——
 *      那两者会因为有人重排注册表而静默改变判定顺序，同样输入得出不同结论。
 *   3. **必选能力 fail-closed**。`category_required` 能力抛异常时按阻止处理；
 *      可选能力抛异常则记一条降级提示后放行。把基础设施异常一律吞成"能力不存在"
 *      是任务明确禁止的，所以异常必须留痕，不能静默跳过。
 *   4. **能力只能返回意见**。上下文里没有事务、没有仓储、业务对象是冻结快照，
 *      因此"不得改写订单金额/状态/库存/审计"是结构性的，不是一句约定。
 */
@Injectable()
export class CapabilityHookRuntime {
  private readonly logger = new Logger(CapabilityHookRuntime.name);
  private readonly modules = new Map<RentalCapability, RentalCapabilityHookModule>();

  constructor(private readonly capabilities: WorkspaceCapabilityService) {}

  /**
   * 登记一个能力的 Hook 实现。由各能力模块在自身初始化时调用。
   *
   * 只接受注册表里已登记的 code：否则一个拼错的 code 会被静默登记成一个永不执行的
   * Hook，而开发者以为已经接入。重复登记同一 code 直接失败，避免两份实现互相覆盖。
   */
  register(module: RentalCapabilityHookModule) {
    if (!DEFINITIONS.has(module.code)) {
      throw new Error(`capability Hook 引用了未注册的能力：${module.code}`);
    }
    if (this.modules.has(module.code)) {
      throw new Error(`capability ${module.code} 的 Hook 已登记，不能重复登记`);
    }
    const points = Object.keys(module.hooks) as RentalCapabilityHookPoint[];
    if (!points.length) throw new Error(`capability ${module.code} 登记了 Hook 但没有任何触发点`);
    this.modules.set(module.code, module);
  }

  /** 测试与重启用：清空登记表。生产路径不调用。 */
  reset() {
    this.modules.clear();
  }

  registeredCodes(): RentalCapability[] {
    return [...this.modules.keys()].sort();
  }

  /**
   * 执行某节点上全部已启用能力的 Hook，返回合并结论。
   *
   * 本方法**不写任何库**：调用方（Core）拿到结论后自行决定是否阻止，
   * 并在自己的事务里落审计与关联任务。这样事务回滚时 Hook 的产物一并消失，
   * 不会留下"提示已记、业务已回滚"的半成品。
   */
  async run<TSubject>(input: CapabilityHookRunInput<TSubject>): Promise<RentalCapabilityHookOutcome> {
    const at = input.at ?? new Date().toISOString();
    const instances =
      input.instances ?? (await this.capabilities.enabledInstances(input.tenantId, input.workspaceId));
    const outcome: RentalCapabilityHookOutcome = {
      point: input.point,
      blocked: false,
      blockReasons: [],
      notices: [],
      linkedTasks: [],
      feeBases: [],
      executed: []
    };

    // 只执行「已启用 且 登记了本节点 Hook」的能力，并按 (order, code) 固定排序。
    const runnable = instances
      .map((instance) => ({ instance, module: this.modules.get(instance.code) }))
      .filter(
        (row): row is { instance: WorkspaceCapabilityInstance; module: RentalCapabilityHookModule } =>
          Boolean(row.module?.hooks[input.point])
      )
      .sort((left, right) =>
        left.module.order !== right.module.order
          ? left.module.order - right.module.order
          : left.instance.code.localeCompare(right.instance.code)
      );

    for (const { instance, module } of runnable) {
      const handler = module.hooks[input.point]!;
      const required = DEFINITIONS.get(instance.code)?.kind === "category_required";
      let result: RentalCapabilityHookResult;
      try {
        result = await handler({
          point: input.point,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          categoryCode: input.categoryCode,
          operator: input.operator,
          at,
          subject: frozenSnapshot(input.subject) as never,
          capability: {
            code: instance.code,
            implementationVersion: instance.implementationVersion,
            configVersion: instance.configVersion,
            config: Object.freeze({ ...instance.config })
          }
        });
      } catch (error) {
        // 能力自身故障。必选能力按阻止处理（fail-closed）；可选能力降级放行但必须留痕。
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`capability ${instance.code} 在节点 ${input.point} 执行失败：${message}`);
        outcome.executed.push({
          capability: instance.code,
          implementationVersion: instance.implementationVersion,
          configVersion: instance.configVersion,
          decision: required ? "block" : "warn",
          failed: true
        });
        const notice = {
          capability: instance.code,
          code: "capability_hook_failed",
          message: `能力 ${instance.code} 判定失败：${message}`,
          evidence: { point: input.point, required }
        };
        if (required) {
          outcome.blocked = true;
          outcome.blockReasons.push(notice);
        } else {
          outcome.notices.push(notice);
        }
        continue;
      }

      this.assertWellFormed(instance.code, result);
      outcome.executed.push({
        capability: instance.code,
        implementationVersion: instance.implementationVersion,
        configVersion: instance.configVersion,
        decision: result.decision
      });
      if (result.decision === "block") {
        outcome.blocked = true;
        for (const reason of result.blockReasons ?? []) {
          outcome.blockReasons.push({ ...reason, capability: instance.code });
        }
      }
      for (const notice of result.notices ?? []) outcome.notices.push({ ...notice, capability: instance.code });
      for (const task of result.linkedTasks ?? []) outcome.linkedTasks.push({ ...task, capability: instance.code });
      for (const fee of result.feeBases ?? []) outcome.feeBases.push({ ...fee, capability: instance.code });
    }

    return outcome;
  }

  /**
   * 结果契约的运行期校验。
   *
   * 为什么运行期还要查一遍：Hook 实现可能来自后续任务或第三方模块，TypeScript 挡不住
   * 一个 `as any` 或编译边界之外的实现。`block` 不给原因、费用依据不给计算依据，
   * 都会让审计里出现一条无法解释的判定——那比直接失败更难排查。
   */
  private assertWellFormed(code: RentalCapability, result: RentalCapabilityHookResult) {
    if (!result || typeof result !== "object") {
      throw new ConflictException(`能力 ${code} 的 Hook 未返回结果`);
    }
    if (!["allow", "warn", "block"].includes(result.decision)) {
      throw new ConflictException(`能力 ${code} 的 Hook 返回了未知判定 ${String(result.decision)}`);
    }
    if (result.decision === "block" && !(result.blockReasons ?? []).length) {
      throw new ConflictException(`能力 ${code} 阻止了本次操作但没有给出原因`);
    }
    for (const fee of result.feeBases ?? []) {
      if (!fee.basis?.trim()) throw new ConflictException(`能力 ${code} 给出的费用依据缺少计算说明`);
      if (!Number.isFinite(fee.amount)) throw new ConflictException(`能力 ${code} 给出的费用金额不是有效数值`);
    }
  }
}

