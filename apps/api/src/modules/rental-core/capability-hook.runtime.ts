import { ConflictException, Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  RENTAL_CAPABILITY_MODULES,
  RENTAL_CATEGORY_DEFINITIONS,
  type RentalCapability,
  type RentalCapabilityDefinition,
  type RentalCapabilityHookModule,
  type RentalCapabilityHookOutcome,
  type RentalCapabilityHookPoint,
  type RentalCapabilityHookResult,
  type RentalCapabilityDecisionSnapshot,
  type RentalCapabilityEquipmentLine,
  type RentalCategoryCode,
  type WorkspaceCapabilityInstance
} from "@rental-os/shared";
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
  /** 服务端从本次采用/历史明确版本解析；空数组是明确政策，不是缺省。 */
  requiredCapabilities?: RentalCapability[];
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
 *   3. **必选能力 fail-closed**。按当前品类 `requiredCapabilities` 判定必选；
 *      可选能力抛异常则记一条降级提示后放行。把基础设施异常一律吞成"能力不存在"
 *      是任务明确禁止的，所以异常必须留痕，不能静默跳过。
 *   4. **能力只能返回意见**。上下文里没有事务、没有仓储、业务对象是冻结快照，
 *      因此"不得改写订单金额/状态/库存/审计"是结构性的，不是一句约定。
 */
@Injectable()
export class CapabilityHookRuntime {
  private readonly logger = new Logger(CapabilityHookRuntime.name);
  /**
   * 登记表按 `code@implementationVersion` 索引。
   *
   * 只按 code 索引是不够的：报价与订单固化了下单当时的实现版本，运行时必须调用
   * **那个版本**的实现。只按 code 解析会让升级后的历史订单执行新规则，
   * 而上下文里仍标着旧版本号——快照看起来对了，行为已经被改写。
   */
  private readonly modules = new Map<string, RentalCapabilityHookModule>();
  /** 每个 code 已登记的版本集合，用于区分「本来就没有 Hook」与「缺这个版本」。 */
  private readonly versionsByCode = new Map<RentalCapability, Set<string>>();

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

  private requiredForCategory(categoryCode: RentalCategoryCode, code: RentalCapability): boolean {
    const category = RENTAL_CATEGORY_DEFINITIONS.find((item) => item.code === categoryCode);
    // 测试或未来动态品类尚未进入生产注册表时，保留模块级 category_required 作为兜底。
    return category
      ? category.requiredCapabilities.includes(code)
      : this.definitions.get(code)?.kind === "category_required";
  }

  private static key(code: RentalCapability, implementationVersion: string) {
    return `${code}@${implementationVersion}`;
  }

  /**
   * 登记某个能力**某一版本**的 Hook 实现。由各能力模块在自身初始化时调用。
   *
   * 只接受注册表里已登记的 code：否则一个拼错的 code 会被静默登记成一个永不执行的
   * Hook，而开发者以为已经接入。同一 `(code, version)` 重复登记直接失败，
   * 避免两份实现互相覆盖。
   *
   * 刻意**允许**登记非当前版本：仍有在途订单引用的旧版本必须继续可执行，
   * 否则升级就等于把在途业务推到「快照版本找不到」的失败分支上。
   */
  register(module: RentalCapabilityHookModule) {
    if (!this.definitions.has(module.code)) {
      throw new Error(`capability Hook 引用了未注册的能力：${module.code}`);
    }
    if (!module.implementationVersion?.trim()) {
      throw new Error(`capability ${module.code} 的 Hook 必须声明 implementationVersion`);
    }
    const key = CapabilityHookRuntime.key(module.code, module.implementationVersion);
    if (this.modules.has(key)) {
      throw new Error(
        `capability ${module.code} 的 ${module.implementationVersion} 版 Hook 已登记，不能重复登记`
      );
    }
    const points = Object.keys(module.hooks) as RentalCapabilityHookPoint[];
    if (!points.length) throw new Error(`capability ${module.code} 登记了 Hook 但没有任何触发点`);
    this.modules.set(key, module);
    const versions = this.versionsByCode.get(module.code) ?? new Set<string>();
    versions.add(module.implementationVersion);
    this.versionsByCode.set(module.code, versions);
  }

  /** 测试与重启用：清空登记表。生产路径不调用。 */
  reset() {
    this.modules.clear();
    this.versionsByCode.clear();
  }

  registeredCodes(): RentalCapability[] {
    return [...this.versionsByCode.keys()].sort();
  }

  /** 已登记的 `code@version` 全集，供启动自检与排查。 */
  registeredVersions(): string[] {
    return [...this.modules.keys()].sort();
  }

  /**
   * 启动自检：凡是**已经有 Hook 实现**的能力，注册表当前声明的实现版本必须也有实现。
   *
   * 捕捉的是「把注册表的 implementationVersion 升到了 v2，却忘了发 v2 的实现」这类发布事故。
   * 那种情况下新报价会固化 v2，随后每次判定都落到「快照版本找不到」的 fail-closed 分支，
   * 等于该能力对新业务全面瘫痪——必须在启动时就暴露，而不是等第一张订单。
   */
  assertCurrentVersionsRegistered() {
    for (const [code, versions] of this.versionsByCode) {
      const current = this.definitions.get(code)?.implementationVersion;
      if (!current) continue;
      if (!versions.has(current)) {
        throw new Error(
          `capability ${code} 的注册表当前实现版本是 ${current}，但只登记了 ${[...versions].sort().join("、")}；` +
            `新业务会固化一个没有实现的版本`
        );
      }
    }
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

    // 执行名单的三道解析，顺序与理由见各分支注释。
    const runnable: Array<{ instance: WorkspaceCapabilityInstance; module: RentalCapabilityHookModule }> = [];
    for (const instance of instances) {
      const definition = this.definitions.get(instance.code);
      const required = input.requiredCapabilities?.includes(instance.code) ?? this.requiredForCategory(input.categoryCode, instance.code);

      // 1) 适用品类。`save()` 启用时已校验过，因此这里为真只可能是数据不一致
      //    （错误的快照、手工改库、或品类定义事后收窄）。运行时必须独立兜底：
      //    只靠启用接口校验的话，一条错误的快照就能让能力在它根本不适用的品类上判定。
      //    不适用一律 fail-closed 并给出明确错误，而不是静默跳过——静默跳过会让
      //    「为什么这个能力没生效」变成无从排查的问题。
      if (definition && definition.applicableCategories !== "all" &&
          !definition.applicableCategories.includes(input.categoryCode)) {
        outcome.blocked = true;
        outcome.blockReasons.push({
          capability: instance.code,
          code: "capability_not_applicable_to_category",
          message:
            `能力 ${instance.code} 不适用于经营品类 ${input.categoryCode}，` +
            `却出现在本次判定的执行名单里（数据不一致，已拒绝本次操作）`,
          evidence: {
            point: input.point,
            categoryCode: input.categoryCode,
            applicableCategories: definition.applicableCategories.join("、")
          }
        });
        outcome.executed.push({
          capability: instance.code,
          implementationVersion: instance.implementationVersion,
          configVersion: instance.configVersion,
          decision: "block",
          failed: true
        });
        continue;
      }

      // 2) 该能力有没有 Hook 实现。完全没有登记过任何版本 = 这个能力不参与 Hook
      //    （四种库存、取还等由 Core 主流程实现的能力就是这一类），静默跳过是正确的。
      const versions = this.versionsByCode.get(instance.code);
      if (!versions?.size) continue;

      // 3) 有实现，但缺**快照固化的那个版本**。这是发布事故（旧版本被删、新版本没发），
      //    不是「能力不存在」。退回最新版会悄悄用新规则重放历史订单，正是本轮要消除的问题；
      //    吞成"跳过"则把基础设施异常伪装成业务事实。因此一律 fail-closed。
      const module = this.modules.get(CapabilityHookRuntime.key(instance.code, instance.implementationVersion));
      if (!module) {
        outcome.blocked = true;
        outcome.blockReasons.push({
          capability: instance.code,
          code: "capability_implementation_version_missing",
          message:
            `能力 ${instance.code} 需要 ${instance.implementationVersion} 版实现，` +
            `但当前只登记了 ${[...versions].sort().join("、")}；` +
            `为避免用其他版本改写该业务的判定，已拒绝本次操作`,
          evidence: {
            point: input.point,
            requested: instance.implementationVersion,
            registered: [...versions].sort().join("、"),
            required
          }
        });
        outcome.executed.push({
          capability: instance.code,
          implementationVersion: instance.implementationVersion,
          configVersion: instance.configVersion,
          decision: "block",
          failed: true
        });
        continue;
      }

      // 4) 该版本存在，但没实现这个节点 —— 正常情况，跳过。
      if (!module.hooks[input.point]) continue;
      runnable.push({ instance, module });
    }

    // 按 (order, code) 固定排序，不依赖登记序或实例数组序。
    runnable.sort((left, right) =>
      left.module.order !== right.module.order
        ? left.module.order - right.module.order
        : left.instance.code.localeCompare(right.instance.code)
    );

    for (const { instance, module } of runnable) {
      const handler = module.hooks[input.point]!;
      const required = input.requiredCapabilities?.includes(instance.code) ?? this.requiredForCategory(input.categoryCode, instance.code);
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
            // 配置现在可包含结构化关系数组；浅冻结只挡得住顶层赋值，挡不住
            // `relations.push()`。必须和业务 subject 一样深克隆、深冻结，避免 Hook
            // 污染能力实例或订单中固化的历史配置快照。
            config: frozenSnapshot(instance.config)
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
   * Review P1-5：把一次判定结果转成可固化的**判断记录**。
   *
   * 报价与订单存的就是这个结构：能力、实现版本、配置版本、规则集版本、判定、
   * 风险代码、提示、证据、费用依据与当时器材组合，并带一个 id 供下单引用。
   * 静态 helper 而非实例方法：它是纯映射，不依赖任何运行时状态。
   */
  static toDecisionSnapshots(
    outcome: RentalCapabilityHookOutcome,
    options: { at?: string; equipment?: RentalCapabilityEquipmentLine[]; idPrefix?: string } = {}
  ): RentalCapabilityDecisionSnapshot[] {
    const at = options.at ?? new Date().toISOString();
    const prefix = options.idPrefix ?? "dec";
    return outcome.executed.map((executed, index) => {
      const blockReasons = outcome.blockReasons.filter((row) => row.capability === executed.capability);
      const notices = outcome.notices.filter((row) => row.capability === executed.capability);
      const feeBases = outcome.feeBases.filter((row) => row.capability === executed.capability);
      return {
        id: `${prefix}_${executed.capability}_${outcome.point}_${index + 1}`,
        point: outcome.point,
        capability: executed.capability,
        implementationVersion: executed.implementationVersion,
        configVersion: executed.configVersion,
        // 规则集版本与实现版本同源；单列一份是为了让能力可以在证据里给出更细的规则集标识。
        rulesetVersion: executed.implementationVersion,
        decision: executed.decision,
        // 风险代码取自两类产物的 code：程序判定与例外确认都按它引用。
        riskCodes: [...new Set([...blockReasons, ...notices].map((row) => row.code))],
        blockReasons: blockReasons.map(({ capability: _capability, ...rest }) => rest),
        notices: notices.map(({ capability: _capability, ...rest }) => rest),
        feeBases: feeBases.map(({ capability: _capability, ...rest }) => rest),
        equipment: options.equipment,
        at
      };
    });
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
