import { ConflictException, Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  RENTAL_CAPABILITY_MODULES,
  type RentalCapability,
  type RentalCapabilityDefinition,
  type RentalCapabilityHookModule,
  type RentalCapabilityHookOutcome,
  type RentalCapabilityHookPoint,
  type RentalCapabilityHookResult,
  type RentalCategoryCode,
  type WorkspaceCapabilityInstance
} from "@store-rental/shared";
import { CapabilityHookRepository, type CapabilityHookSubjectType } from "./capability-hook.repository";
import { WorkspaceCapabilityService } from "./workspace-capability.service";

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

/** `evaluate` 的入参：在 `run` 之外还需要知道判定对象与调用方的事务。 */
export interface CapabilityHookEvaluateInput<TSubject> extends CapabilityHookRunInput<TSubject> {
  subjectRef: { type: CapabilityHookSubjectType; id: string };
  /**
   * 调用方的事务客户端。
   *
   * 可缺省是为了兼容 Core 里仍存在的无事务旧路径（`confirmOrder`、`cancelOrder`、
   * `createInspection` 的 `tx` 至今是可选参数）。缺事务时**仍然执行并强制阻止判定**，
   * 只跳过审计——审计必须与业务变更同事务，拿不到事务就无法保证这一点。
   * 反过来，若因为拿不到事务就连判定一起跳过，那就是一个 fail-open 缺口。
   */
  tx?: Prisma.TransactionClient;
}

/**
 * 能力阻止时抛出。带上完整结论，便于调用方或异常过滤器解释「谁、基于什么依据阻止了」。
 * 用 409 而不是 400：阻止来自当前经营空间的能力配置与业务状态，不是请求本身格式错误。
 */
export class CapabilityBlockedException extends ConflictException {
  constructor(readonly outcome: RentalCapabilityHookOutcome) {
    super(
      `操作被能力阻止：${outcome.blockReasons
        .map((reason) => `${reason.capability} - ${reason.message}`)
        .join("；")}`
    );
  }
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

  constructor(
    private readonly capabilities: WorkspaceCapabilityService,
    @Optional() private readonly audits?: CapabilityHookRepository,
    // CORE-EXT-03：可注入的能力注册表。默认取生产注册表；测试传入
    // 「生产注册表 + 测试专用能力」的候选集，以证明测试能力只靠追加注册定义即可登记并运行，
    // 且不污染生产注册表。生产装配不传此参——测试能力绝不会进入生产运行时。
    //
    // 必须 @Optional()：它是一个带默认值的普通数组，不是可注入的 provider。
    // 少了它，Nest 会把第三个位置参数当成待注入依赖去解析并在启动时抛
    // "can't resolve dependencies"。@Optional() 下 Nest 传入 undefined，默认值随即生效。
    @Optional() registry: RentalCapabilityDefinition[] = RENTAL_CAPABILITY_MODULES
  ) {
    this.definitions = new Map(registry.map((module) => [module.code, module]));
  }

  private readonly definitions: Map<RentalCapability, RentalCapabilityDefinition>;

  /**
   * 登记一个能力的 Hook 实现。由各能力模块在自身初始化时调用。
   *
   * 只接受注册表里已登记的 code：否则一个拼错的 code 会被静默登记成一个永不执行的
   * Hook，而开发者以为已经接入。重复登记同一 code 直接失败，避免两份实现互相覆盖。
   */
  register(module: RentalCapabilityHookModule) {
    if (!this.definitions.has(module.code)) {
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
      const required = this.definitions.get(instance.code)?.kind === "category_required";
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
   * Core 的唯一推荐入口：执行 → 阻止则抛 → 放行则在**调用方的事务**里落审计。
   *
   * 为什么不让七个节点各自 `run()` 后自己判断：任何一处忘了写
   * `if (outcome.blocked) throw` 就是一个 fail-open 缺口，而那种遗漏在代码评审里
   * 极难发现（少一行 if，测试照样绿）。把「阻止即抛」和「放行即审计」收进这里，
   * 调用点就无法只做一半。
   *
   * 审计用调用方的 `tx`：事务回滚时审计一并消失，不会留下
   * 「提示已记、业务已回滚」的半成品。反过来，**被阻止的判定不落审计**——
   * 它所在的事务必然回滚。阻止原因随异常返回给调用方；持久化的拒绝快照
   * 属 CORE-EXT-02D「快照足以解释当时为何放行、阻止或收费」的范围。
   */
  async evaluate<TSubject>(input: CapabilityHookEvaluateInput<TSubject>): Promise<RentalCapabilityHookOutcome> {
    const at = input.at ?? new Date().toISOString();
    const outcome = await this.run({ ...input, at });
    if (outcome.blocked) throw new CapabilityBlockedException(outcome);
    if (!outcome.executed.length) return outcome;
    if (!input.tx) {
      // 无事务的旧路径：判定已生效（阻止仍会抛），但审计无法与业务变更同事务，
      // 因此明确跳过并留日志，而不是写一条可能与业务状态不一致的审计。
      this.logger.warn(
        `节点 ${input.point} 在无事务路径上执行，已跳过 Hook 审计（判定仍生效）：${input.subjectRef.type}:${input.subjectRef.id}`
      );
      return outcome;
    }
    if (!this.audits) {
      // 生产装配里 Nest 必然注入仓储；缺失只会发生在装配被改坏时。
      // 静默跳过审计会让「可选提示可审计」变成一句空话，因此明确失败。
      throw new Error("CapabilityHookRepository 未注入，无法落 Hook 审计");
    }
    await this.audits.recordOutcome(
      input.tenantId,
      input.workspaceId,
      input.subjectRef,
      outcome,
      input.tx,
      input.operator,
      at
    );
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
