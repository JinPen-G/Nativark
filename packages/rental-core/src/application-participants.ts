/** 标准 Rental 组合的业务作业与可选 AI 源。构造后不启动计时器或调用模型。
 * 宿主只登记这里返回的一组实例；当前授权由宿主提供，原事务、算法和收据仍由业务服务维护。 */
import { AsyncLocalStorage } from "node:async_hooks";
import { RENTAL_CORE_ID, RENTAL_CORE_VERSION } from "./core-identity";
import { RentalAllocationService } from "./mysql-allocation";
import { RentalDueJobScheduler, type RentalDueJob } from "./mysql-due-jobs";
import type { RentalAllocationStorage, RentalAllocationTransaction, RentalAllocationFailureEvents } from "./allocation-storage";
import type { RentalDueJobTransaction, RentalDueJobStorage, RentalDueJobActions,
  RentalDueJobBusiness, RentalDueJobCorporateSettlement, RentalDueJobPayments, RentalDueJobServiceCapacities } from "./due-job-ports";
import type { RentalCoreService } from "./mysql-core-runtime";
import type { RentalBusinessService } from "./mysql-business-runtime";
import type { RentalCoreFactStore } from "./mysql-core-facts";
import type { IdempotentActionInput } from "./mysql-idempotent-actions";
import { createRentalBusinessTenantFence } from "./mysql-business-fence";

/** 既有作业的明确身份；版本随实际实现发布，不从队列负载或页面选择推断执行器。 */
const rentalJobDefinitions = [
  { id: "allocation_scan", purpose: "existing_fulfillment" },
  { id: "expire_pending_orders", purpose: "settlement" },
  { id: "reconcile_pickup_overdue", purpose: "settlement" },
  { id: "retry_due_notifications", purpose: "original_dispatch" },
  { id: "run_due_price_adjustments", purpose: "new_business" },
  { id: "expire_payment_intents", purpose: "settlement" },
] as const;
export const RENTAL_APPLICATION_JOB_DESCRIPTORS = Object.freeze(rentalJobDefinitions.map(descriptor =>
  Object.freeze({ ...descriptor, coreId: RENTAL_CORE_ID, implementationVersion: RENTAL_CORE_VERSION })));

export interface RentalApplicationJobRequest {
  readonly coreId: typeof RENTAL_CORE_ID;
  readonly implementationVersion: typeof RENTAL_CORE_VERSION;
  readonly jobId: typeof rentalJobDefinitions[number]["id"];
  readonly purpose: typeof rentalJobDefinitions[number]["purpose"];
  readonly tenantId: string;
  readonly workspaceId: string;
  /** 仅原逐单执行器/支付作用点提供；批次准入不代替此原事实的事务复核。 */
  readonly orderId?: string;
}

export interface RentalApplicationWorkerAuthority<TTransaction> {
  /** 查当前部署、租户 Core、原空间与具体作业政策；拒绝/查询失败必须抛出。
   * 停用后仅原登记的历史收尾闭集可用，settlement 字符串本身不授予权限。
   * 有 transaction 时复用该业务事务及原锁序，不另开事务或重新执行 unknown。 */
  assertCurrent(request: RentalApplicationJobRequest, transaction?: TTransaction): Promise<void>;
  /** Only the original Tenant/Core/deployment gates. Payment acquires Order next,
   * then calls assertCurrent before any funding/intent mutation in that same tx. */
  assertParentCurrent(request: RentalApplicationJobRequest, transaction: TTransaction): Promise<void>;
}

export type RentalApplicationParticipantTransaction = RentalDueJobTransaction & RentalAllocationTransaction;

export interface RentalApplicationParticipantDependencies<TTransaction extends RentalApplicationParticipantTransaction> {
  database: RentalAllocationStorage<TTransaction> & RentalDueJobStorage;
  facts: RentalCoreFactStore<TTransaction>;
  core: RentalCoreService<TTransaction>;
  business: RentalBusinessService<TTransaction>;
  idempotent: RentalDueJobActions<TTransaction>;
  serviceCapacities: RentalDueJobServiceCapacities<TTransaction>;
  corporateSettlement: RentalDueJobCorporateSettlement<TTransaction>;
  payments: RentalDueJobPayments;
  authority: RentalApplicationWorkerAuthority<TTransaction>;
  failureEvents?: RentalAllocationFailureEvents<TTransaction>;
}

function jobRequest(jobId: string, tenantId: string, workspaceId: string): RentalApplicationJobRequest {
  const descriptor = RENTAL_APPLICATION_JOB_DESCRIPTORS.find(job => job.id === jobId);
  if (!descriptor || !tenantId || !workspaceId) throw new Error("Rental 作业缺少已登记的执行器或原业务范围");
  return Object.freeze({ coreId: descriptor.coreId, implementationVersion: descriptor.implementationVersion,
    jobId: descriptor.id, purpose: descriptor.purpose, tenantId, workspaceId });
}

/** 这里只缩窄启动和作业准入，super 保留原命名锁、租户 ALS、节拍及原五项动作。 */
class StandardRentalDueJobs<TTransaction extends RentalApplicationParticipantTransaction>
  extends RentalDueJobScheduler<TTransaction> {
  private stopping = false;
  private readonly active = new Set<Promise<boolean>>();
  private readonly ticks = new Set<Promise<void>>();
  private readonly dispatchFence: ReturnType<typeof createRentalBusinessTenantFence>;
  private readonly registeredJobs = new Map<RentalDueJob, Readonly<RentalDueJob>>();
  constructor(dependencies: RentalApplicationParticipantDependencies<TTransaction>,
    private readonly jobContext: AsyncLocalStorage<RentalApplicationJobRequest>,
    private readonly current: (transaction?: TTransaction, orderId?: string) => Promise<void>) {
    const requireJob = (jobId: RentalApplicationJobRequest["jobId"], tenantId: string) => {
      const request = jobContext.getStore();
      if (this.stopping || !request || request.jobId !== jobId || request.tenantId !== tenantId) {
        throw new Error("Rental 作业动作不属于原登记执行器和租户");
      }
      return request;
    };
    const protect = <T>(input: IdempotentActionInput<T, TTransaction>): IdempotentActionInput<T, TTransaction> => {
      const request = jobContext.getStore(), { tenantId, orderId, action } = input;
      const allowed = request?.jobId === "expire_pending_orders" ? ["order.expire_pending"]
        : request?.jobId === "reconcile_pickup_overdue"
          ? ["order.mark_pickup_overdue", "order.no_show_notice", "order.confirm_no_show"] : [];
      if (this.stopping || !request || request.tenantId !== tenantId || !allowed.includes(action)
        || typeof orderId !== "string" || !orderId.trim()) {
        throw new Error("Rental 逐单作业缺少原订单或动作不属于登记的收尾执行器");
      }
      return {
        ...input,
        run: async transaction => {
          if (this.stopping) throw new Error("Rental 作业正在退出，不能开始下一笔订单动作");
          // 当前准入会锁经营空间，必须沿原履约的订单→空间锁序，不能与续租或换货形成反向等待。
          await dependencies.facts.lockOrder(tenantId, orderId, transaction);
          await current(transaction, orderId);
          if (this.stopping) throw new Error("Rental 作业准入等待期间已停止，不能开始订单动作");
          return input.run(transaction);
        },
        replay: async response => {
          await current(undefined, orderId);
          const result = await input.replay(response);
          await current(undefined, orderId);
          return result;
        },
      };
    };
    const actions: RentalDueJobActions<TTransaction> = {
      execute: input => dependencies.idempotent.execute(protect(input)),
      executeWithReplayFlag: input => dependencies.idempotent.executeWithReplayFlag(protect(input)),
    };
    // 领取逾期的原附属通知在订单提交后独立入队/派发；每个原通知事务仍核同一订单。
    // 此 scope 不包原订单事务，也不把通知失败改为订单失败或自动重做 unknown。
    const eventContext = new AsyncLocalStorage<Readonly<{ orderId: string }>>();
    const eventFence = createRentalBusinessTenantFence(async (transaction: TTransaction, tenantId: string) => {
      requireJob("reconcile_pickup_overdue", tenantId);
      const original = eventContext.getStore();
      if (!original) throw new Error("Rental 逾期通知缺少原订单");
      await current(transaction, original.orderId);
      requireJob("reconcile_pickup_overdue", tenantId);
    });
    const business: RentalDueJobBusiness<TTransaction> = {
      persist: dependencies.business.persist.bind(dependencies.business),
      refreshCouponTemplateCache: dependencies.business.refreshCouponTemplateCache.bind(dependencies.business),
      refreshFromDatabase: dependencies.business.refreshFromDatabase.bind(dependencies.business),
      refreshWorkspaceContext: dependencies.business.refreshWorkspaceContext.bind(dependencies.business),
      releaseCouponInTransaction: dependencies.business.releaseCouponInTransaction.bind(dependencies.business),
      retryDueNotifications: async (...args) => {
        requireJob("retry_due_notifications", args[0]);
        await current();
        // 原实现只消费已保存的 queued/确定失败记录。认领、限频和 begin 各自走 dispatchFence；
        // begin 先提交不可重发的 uncertain，再运输；结果 observation 不重新要求新准入。
        return dependencies.business.retryDueNotifications(...args);
      },
      runDuePriceAdjustments: async (...args) => {
        requireJob("run_due_price_adjustments", args[0]);
        await current();
        return dependencies.business.runDuePriceAdjustments(...args);
      },
      emitNotificationEvent: async (...args) => {
        requireJob("reconcile_pickup_overdue", args[0]);
        const eventCode = args[2], original = args[5];
        if (!["order.pickup_overdue", "order.no_show"].includes(eventCode)
          || original?.type !== "order" || !original.id.trim()) {
          throw new Error("Rental 逾期作业只能发送原订单的逾期或未到通知");
        }
        const orderId = original.id;
        await current(undefined, orderId);
        return eventContext.run(Object.freeze({ orderId }), () =>
          eventFence.run(() => dependencies.business.emitNotificationEvent(...args)));
      },
    };
    const payments: RentalDueJobPayments = {
      expireStalePaymentIntents: async (tenantId, workspaceId, take) => {
        const request = requireJob("expire_payment_intents", tenantId);
        if (request.workspaceId !== workspaceId) throw new Error("Rental 支付到期作业不能切换原经营空间");
        await current();
        return dependencies.payments.expireStalePaymentIntents(tenantId, workspaceId, take);
      },
    };
    super(dependencies.database, dependencies.core, business, actions, dependencies.serviceCapacities,
      dependencies.corporateSettlement, payments);
    for (const job of this.jobs) this.registeredJobs.set(job, Object.freeze({ ...job }));
    this.dispatchFence = createRentalBusinessTenantFence(async (transaction: TTransaction, tenantId: string) => {
      const request = jobContext.getStore();
      if (this.stopping || !request || request.tenantId !== tenantId) {
        throw new Error("Rental 派发作业已停止或不属于原租户，不能开始新动作");
      }
      if (request.jobId === "expire_payment_intents") await dependencies.authority.assertParentCurrent(request, transaction);
      else await current(transaction);
      if (this.stopping) throw new Error("Rental 派发作业正在退出，不能开始新动作");
    }, undefined, async (transaction: TTransaction, tenantId: string, workspaceId: string, orderId?: string) => {
      const request = jobContext.getStore();
      if (this.stopping || !request || request.tenantId !== tenantId || request.workspaceId !== workspaceId) {
        throw new Error("Rental 派发动作已停止或偏离原作业空间");
      }
      if (request.jobId !== "expire_payment_intents" || !orderId?.trim()) {
        throw new Error("Rental 支付运输或入账缺少原订单作用点");
      }
      await current(transaction, orderId);
      if (this.stopping) throw new Error("Rental 派发作业正在退出，不能开始新动作");
    });
  }

  override onApplicationBootstrap(): void {
    this.stopping = false;
    if (!this.started) super.onApplicationBootstrap();
  }

  override async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    super.onModuleDestroy();
    // Tick 的空间枚举也使用同一连接池；不能只等待已进入 runLocked 的事务。
    // stopping 先阻止后续任务，已在等待的枚举/命名锁/原业务全部返回后才可断库。
    // 不取消已进入的原业务、改变其超时或换键重做未知结果。
    await Promise.allSettled([...this.ticks, ...this.active]);
  }

  override runTick(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    const running = super.runTick();
    this.ticks.add(running);
    return running.finally(() => { this.ticks.delete(running); });
  }

  override runLocked(job: RentalDueJob, tenantId: string, workspaceId: string): Promise<boolean> {
    if (this.stopping) return Promise.resolve(false);
    const registered = this.registeredJobs.get(job);
    if (!registered || registered.name !== job.name || registered.run !== job.run) {
      return Promise.reject(new Error("Rental 标准作业必须使用原登记执行器，不能仅按名称替换动作"));
    }
    const request = jobRequest(registered.name, tenantId, workspaceId);
    const running = super.runLocked({ name: registered.name, run: (currentTenant, currentWorkspace) =>
      this.jobContext.run(request, () => {
        const consume = async () => {
          if (this.stopping) throw new Error("Rental 作业正在退出，本次执行尚未开始");
          await this.current();
          return registered.run(currentTenant, currentWorkspace);
        };
        // 通知短事务复核完整作业权威；payment 父锁只查 Tenant/Core，
        // 原 provider 前短事务/入账 Order 锁后再复核完整空间权威。
        // 逐单作业保留 facts.lockOrder→current(tx)：完整权威会锁空间，
        // 若提前绑定到幂等执行器的 Tenant fence，就会颠倒原订单→空间锁序。
        // 嵌套 HTTP scope 由 fence 明确拒绝，不能改绑为系统作业身份。
        return request.jobId === "retry_due_notifications" || request.jobId === "expire_payment_intents"
          ? this.dispatchFence.run(consume) : consume();
      }) }, tenantId, workspaceId);
    this.active.add(running);
    return running.finally(() => { this.active.delete(running); });
  }
}

/** 供标准宿主一次构造并将同一 allocation 同时交给 HTTP、AI 与作业。
 * 企业结算和支付在原类中为兼容测试而可选；完整宿主必须供给它们，不能让这两步静默跳过。 */
export function createRentalApplicationParticipants<TTransaction extends RentalApplicationParticipantTransaction>(
  dependencies: RentalApplicationParticipantDependencies<TTransaction>
) {
  for (const name of ["database", "facts", "core", "business", "idempotent", "serviceCapacities",
    "corporateSettlement", "payments", "authority"] as const) {
    if (!dependencies?.[name]) throw new Error(`Rental 作业装配缺少依赖: ${name}`);
  }
  for (const [service, method] of [
    [dependencies.authority, "assertCurrent"], [dependencies.authority, "assertParentCurrent"],
    [dependencies.corporateSettlement, "settleCancelledOrderCredit"],
    [dependencies.payments, "expireStalePaymentIntents"], [dependencies.idempotent, "execute"],
    [dependencies.idempotent, "executeWithReplayFlag"],
  ] as const) if (typeof (service as unknown as Record<string, unknown>)[method] !== "function")
    throw new Error(`Rental 作业装配缺少实际方法: ${method}`);

  const context = new AsyncLocalStorage<RentalApplicationJobRequest>();
  const current = async (transaction?: TTransaction, orderId?: string) => {
    const request = context.getStore();
    if (!request) throw new Error("Rental 作业缺少当前执行范围");
    await dependencies.authority.assertCurrent(orderId === undefined ? request : Object.freeze({ ...request, orderId }), transaction);
  };
  const allocation = new RentalAllocationService<TTransaction>(dependencies.database, dependencies.facts,
    dependencies.core, dependencies.failureEvents, {
      assertCurrent: (scope, transaction) => dependencies.authority.assertCurrent(
        Object.freeze({ ...jobRequest("allocation_scan", scope.tenantId, scope.workspaceId), orderId: scope.orderId }), transaction),
    });
  const dueJobs = new StandardRentalDueJobs(dependencies, context, current);
  return Object.freeze({ allocation, dueJobs, descriptors: RENTAL_APPLICATION_JOB_DESCRIPTORS });
}
