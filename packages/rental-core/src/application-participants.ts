/** 标准 Rental 组合的业务作业与可选 AI 源。构造后不启动计时器或调用模型。
 * 宿主只登记这里返回的一组实例；当前授权由宿主提供，原事务、算法和收据仍由业务服务维护。 */
import { AsyncLocalStorage } from "node:async_hooks";
import { RENTAL_CORE_ID, RENTAL_CORE_VERSION } from "./core-identity";
import { RentalAllocationService } from "./mysql-allocation";
import { RentalDueJobScheduler, type RentalDueJob } from "./mysql-due-jobs";
import type { RentalAllocationStorage, RentalAllocationTransaction, RentalAllocationFailureEvents } from "./allocation-storage";
import type { RentalDueJobTransaction, RentalDueJobStorage, RentalDueJobActions,
  RentalDueJobCorporateSettlement, RentalDueJobPayments, RentalDueJobServiceCapacities } from "./due-job-ports";
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
}

export interface RentalApplicationWorkerAuthority<TTransaction> {
  /** 查当前部署、租户 Core、原空间与具体作业政策；拒绝/查询失败必须抛出。
   * settlement 只标明原作业用途，不能据此默认授予停用后的善后权限。
   * 有 transaction 时复用该业务事务及原锁序，不另开事务或重新执行 unknown。 */
  assertCurrent(request: RentalApplicationJobRequest, transaction?: TTransaction): Promise<void>;
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

/** 保持原服务的 this 和缓存；只为此作业消费者在真实副作用前复核当前准入。 */
function guardedMethods<T extends object>(service: T, methods: readonly (keyof T)[], assertCurrent: () => Promise<void>): T {
  const checked = new Set<PropertyKey>(methods), bound = new Map<PropertyKey, unknown>();
  return new Proxy(service, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (!bound.has(key)) bound.set(key, checked.has(key)
        ? async (...args: unknown[]) => { await assertCurrent(); return Reflect.apply(value, target, args); }
        : value.bind(target));
      return bound.get(key);
    }
  });
}

/** 这里只缩窄启动和作业准入，super 保留原命名锁、租户 ALS、节拍及原五项动作。 */
class StandardRentalDueJobs<TTransaction extends RentalApplicationParticipantTransaction>
  extends RentalDueJobScheduler<TTransaction> {
  private stopping = false;
  private readonly active = new Set<Promise<boolean>>();
  private readonly dispatchFence: ReturnType<typeof createRentalBusinessTenantFence>;
  constructor(dependencies: RentalApplicationParticipantDependencies<TTransaction>,
    private readonly jobContext: AsyncLocalStorage<RentalApplicationJobRequest>,
    private readonly current: (transaction?: TTransaction) => Promise<void>) {
    const protect = <T>(input: IdempotentActionInput<T, TTransaction>): IdempotentActionInput<T, TTransaction> => ({
      ...input,
      run: async transaction => {
        if (typeof input.orderId !== "string" || !input.orderId.trim()) {
          throw new Error("Rental 逐单作业缺少原订单，无法按原锁序复核当前授权");
        }
        // 当前准入会锁经营空间，必须沿原履约的订单→空间锁序，不能与续租或换货形成反向等待。
        await dependencies.facts.lockOrder(input.tenantId, input.orderId, transaction);
        await current(transaction);
        return input.run(transaction);
      },
      replay: async response => {
        await current();
        const result = await input.replay(response);
        await current();
        return result;
      },
    });
    const actions: RentalDueJobActions<TTransaction> = {
      execute: input => dependencies.idempotent.execute(protect(input)),
      executeWithReplayFlag: input => dependencies.idempotent.executeWithReplayFlag(protect(input)),
    };
    super(dependencies.database, dependencies.core,
      guardedMethods(dependencies.business, ["retryDueNotifications", "runDuePriceAdjustments", "emitNotificationEvent"], () => current()),
      actions, dependencies.serviceCapacities, dependencies.corporateSettlement,
      guardedMethods(dependencies.payments, ["expireStalePaymentIntents"], () => current()));
    this.dispatchFence = createRentalBusinessTenantFence(async (transaction: TTransaction, tenantId: string) => {
      const request = jobContext.getStore();
      if (this.stopping || !request || request.tenantId !== tenantId) {
        throw new Error("Rental 派发作业已停止或不属于原租户，不能开始新动作");
      }
      await current(transaction);
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
    // 不取消已进入的原业务或换键重做；等其返回后才让宿主释放数据库。
    await Promise.allSettled([...this.active]);
  }

  override runTick(): Promise<void> {
    return this.stopping ? Promise.resolve() : super.runTick();
  }

  override runLocked(job: RentalDueJob, tenantId: string, workspaceId: string): Promise<boolean> {
    if (this.stopping) return Promise.resolve(false);
    const request = jobRequest(job.name, tenantId, workspaceId);
    const running = super.runLocked({ name: job.name, run: (currentTenant, currentWorkspace) =>
      this.jobContext.run(request, () => {
        const consume = async () => {
          if (this.stopping) throw new Error("Rental 作业正在退出，本次执行尚未开始");
          await this.current();
          return job.run(currentTenant, currentWorkspace);
        };
        // 通知/payment 的短事务在每次认领或运输前重核同一作业权威。
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
    [dependencies.authority, "assertCurrent"], [dependencies.corporateSettlement, "settleCancelledOrderCredit"],
    [dependencies.payments, "expireStalePaymentIntents"], [dependencies.idempotent, "execute"],
    [dependencies.idempotent, "executeWithReplayFlag"],
  ] as const) if (typeof (service as unknown as Record<string, unknown>)[method] !== "function")
    throw new Error(`Rental 作业装配缺少实际方法: ${method}`);

  const context = new AsyncLocalStorage<RentalApplicationJobRequest>();
  const current = async (transaction?: TTransaction) => {
    const request = context.getStore();
    if (!request) throw new Error("Rental 作业缺少当前执行范围");
    await dependencies.authority.assertCurrent(request, transaction);
  };
  const allocation = new RentalAllocationService<TTransaction>(dependencies.database, dependencies.facts,
    dependencies.core, dependencies.failureEvents, {
      assertCurrent: (scope, transaction) => dependencies.authority.assertCurrent(
        jobRequest("allocation_scan", scope.tenantId, scope.workspaceId), transaction),
    });
  const dueJobs = new StandardRentalDueJobs(dependencies, context, current);
  return Object.freeze({ allocation, dueJobs, descriptors: RENTAL_APPLICATION_JOB_DESCRIPTORS });
}
