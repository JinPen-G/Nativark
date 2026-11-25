/** Rental到期作业的唯一执行器；命名锁、租户/空间ALS和原操作键保持同一执行链。
 * 由已选Core宿主显式登记和销毁；公共底座不自动加载，付款/通知结果按原收据核对。 */
import {
  ConflictException,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { RentalCoreOrderStatus } from "./contracts";
import { createHash } from "node:crypto";
import { runWithRequestIdentity } from "@rental-os/platform-server/request-identity";
import {
  RENTAL_PENDING_PAYMENT_TIMEOUT_REASON,
} from "./mysql-core-runtime";
import type { BusinessContext } from "./mysql-business-runtime";
import type { RentalExpiredDraftOrderScan, RentalPickupOrderScan } from "./mysql-core-facts";
import type { RentalDueJobTransaction, RentalDueJobStorage, RentalDueJobCore, RentalDueJobBusiness, RentalDueJobActions, RentalDueJobServiceCapacities, RentalDueJobCorporateSettlement, RentalDueJobPayments } from "./due-job-ports";

/**
 * 到期任务注册项：`run` 在已建立租户/空间请求身份的上下文中执行，
 * 且已经持有该 job×tenant×workspace 的 MySQL 命名锁。
 */
export interface RentalDueJob {
  name: string;
  run(tenantId: string, workspaceId: string): Promise<void>;
}

/** 每 tick 每空间每个任务最多处理的订单数，与手动接口的默认 `take` 一致。 */
export const RENTAL_DUE_JOB_BATCH_SIZE = 50;
export const RENTAL_DUE_JOB_DEFAULT_INTERVAL_MS = 60_000;
export const RENTAL_DUE_JOB_OPERATOR = "due-job-scheduler";
const LOCK_PREFIX = "rental-os:due:";
const MYSQL_LOCK_NAME_MAX = 64;

/** MySQL 命名锁名上限 64 字符；超长时改用哈希，前缀保留便于 `performance_schema.metadata_locks` 排查。 */
export function rentalDueJobLockName(job: string, tenantId: string, workspaceId: string): string {
  const plain = `${LOCK_PREFIX}${job}:${tenantId}:${workspaceId}`;
  if (plain.length <= MYSQL_LOCK_NAME_MAX) return plain;
  const digest = createHash("sha256").update(plain).digest("hex").slice(0, MYSQL_LOCK_NAME_MAX - LOCK_PREFIX.length);
  return `${LOCK_PREFIX}${digest}`;
}

export function rentalDueJobsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = String(env.RENTAL_DUE_JOBS_DISABLED ?? "").trim().toLowerCase();
  return env.NODE_ENV === "test" || flag === "1" || flag === "true";
}

export function rentalDueJobIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.RENTAL_DUE_JOB_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 1_000 ? Math.floor(parsed) : RENTAL_DUE_JOB_DEFAULT_INTERVAL_MS;
}

/**
 * RULE-CLOSE-02：进程内到期任务调度器。
 *
 * 此前四个「到期」动作只能靠人工调手动接口（`orders/expire-pending`、
 * `orders/reconcile-pickup-overdue`、`notification-logs/retry-due`、
 * `pricing-plans/adjustments/run-due`）。这里按固定节拍遍历每个经营空间并执行同一套逻辑；
 * 手动接口保留给运维补偿，两者共用服务层入口与幂等键，重复触发只会回放。
 *
 * 多实例安全不改 schema：每个 job×tenant×workspace 用 MySQL `GET_LOCK` 互斥。
 * 命名锁绑定在**连接**上，Prisma 连接池会让两条独立语句落到不同连接，
 * 那样 `RELEASE_LOCK` 会释放不到锁（或永远拿不到锁直到连接回收）。
 * 因此 GET_LOCK / 任务 / RELEASE_LOCK 全部放在同一个交互式 `$transaction` 里，
 * Prisma 保证交互式事务内所有语句复用同一连接。
 */
export class RentalDueJobScheduler<TTransaction extends RentalDueJobTransaction = RentalDueJobTransaction> implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stoppingDueJobs = false;
  private activeTick?: Promise<void>;
  private closing?: Promise<void>;
  private readonly activeJobs = new Set<Promise<boolean>>();
  private readonly expiredOrderScans = new Map<string, RentalExpiredDraftOrderScan>();
  private readonly pickupOrderScans = new Map<string, RentalPickupOrderScan>();
  private notificationDispatchLifetime = new AbortController();
  private readonly logger = new Logger(RentalDueJobScheduler.name);

  /**
   * 固定注册表，按此顺序执行，包含五项原业务任务。
   * 标准宿主同时核定已登记的原执行器和当前作业权威。
   * 公开可写只为让无库测试替换成 fake；业务代码不得在运行期改动它。
   */
  jobs: RentalDueJob[];

  constructor(
    private readonly prisma: RentalDueJobStorage,
    private readonly core: RentalDueJobCore<TTransaction>,
    private readonly business: RentalDueJobBusiness<TTransaction>,
    private readonly idempotent: RentalDueJobActions<TTransaction>,
    private readonly serviceCapacities: RentalDueJobServiceCapacities<TTransaction>,
    private readonly corporateSettlement?: RentalDueJobCorporateSettlement<TTransaction>,
    // 支付意图过期核对沿原支付执行器。可选仅为保留旧离线测试直接构造调度器；
    // 完整标准宿主在参加者工厂核定该依赖；旧构造未传入时跳过此任务。
    private readonly payments?: RentalDueJobPayments,
  ) {
    this.jobs = [
      { name: "expire_pending_orders", run: (tenantId, workspaceId) => this.expirePendingOrders(tenantId, workspaceId) },
      { name: "reconcile_pickup_overdue", run: (tenantId, workspaceId) => this.reconcilePickupOverdue(tenantId, workspaceId) },
      { name: "retry_due_notifications", run: (tenantId) => this.retryDueNotifications(tenantId) },
      { name: "run_due_price_adjustments", run: (tenantId) => this.runDuePriceAdjustments(tenantId) },
      { name: "expire_payment_intents", run: (tenantId, workspaceId) => this.expirePaymentIntents(tenantId, workspaceId) },
    ];
  }

  onApplicationBootstrap() {
    if (this.stoppingDueJobs) return;
    if (this.notificationDispatchLifetime.signal.aborted) this.notificationDispatchLifetime = new AbortController();
    if (rentalDueJobsDisabled()) return;
    this.timer = setInterval(() => {
      void this.runTick().catch(() => this.logger.error("到期任务 tick 失败，请检查数据库连接"));
    }, rentalDueJobIntervalMs());
    this.timer.unref();
  }

  onModuleDestroy(): void {
    this.stopScheduling();
  }

  private stopScheduling(): void {
    this.stoppingDueJobs = true;
    this.notificationDispatchLifetime.abort();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 旧宿主在进入 Nest 销毁钩子前调用，枚举和命名锁等待也属于原在途工作。 */
  stop(): Promise<void> {
    this.stopScheduling();
    return this.closing ??= (async () => {
      const results = await Promise.allSettled([this.activeTick, ...this.activeJobs]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "到期作业排空失败");
    })();
  }

  /** 是否已启动定时器；测试用。 */
  get started(): boolean {
    return this.timer !== undefined;
  }

  /**
   * 一次节拍：遍历所有经营空间（与自动分配扫描同源：业务设置表一行即一个空间），
   * 逐任务加锁执行。任一任务/空间失败只记日志，不阻断其余。
   */
  runTick(): Promise<void> {
    if (this.running || this.stoppingDueJobs) return Promise.resolve();
    this.running = true;
    const running = this.executeTick();
    this.activeTick = running;
    return running;
  }

  private async executeTick(): Promise<void> {
    try {
      const scopes = await this.prisma.rentalTenantBusinessSettings.findMany({ select: { tenantId: true, workspaceId: true } });
      for (const scope of scopes) {
        for (const job of this.jobs) {
          if (this.stoppingDueJobs) return;
          try {
            await this.runLocked(job, scope.tenantId, scope.workspaceId);
          } catch (error) {
            // 只记标识，不记金额与客户信息。
            this.logger.error(
              `到期任务失败 job=${job.name} tenant=${scope.tenantId} workspace=${scope.workspaceId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } finally {
      this.running = false;
      this.activeTick = undefined;
    }
  }

  /** 拿不到锁（其他实例正在跑）时静默跳过；返回是否实际执行。 */
  async runLocked(job: RentalDueJob, tenantId: string, workspaceId: string): Promise<boolean> {
    if (this.stoppingDueJobs) return Promise.resolve(false);
    const lockName = rentalDueJobLockName(job.name, tenantId, workspaceId);
    const running = Promise.resolve(this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ acquired: number | bigint | null }>>`SELECT GET_LOCK(${lockName}, 0) AS acquired`;
        if (Number(rows[0]?.acquired ?? 0) !== 1) return false;
        try {
          if (this.stoppingDueJobs) return false;
          await runWithRequestIdentity(
            { tenantId, workspaceId, userId: RENTAL_DUE_JOB_OPERATOR },
            () => job.run(tenantId, workspaceId),
          );
        } finally {
          await tx.$queryRaw`SELECT RELEASE_LOCK(${lockName}) AS released`;
        }
        return true;
      },
      // 任务本身会开启自己的短事务；这个外层事务只是锁的连接载体，允许跑得更久。
      { maxWait: 5_000, timeout: 10 * 60_000 },
    ));
    this.activeJobs.add(running);
    return running.finally(() => { this.activeJobs.delete(running); });
  }

  private async context(tenantId: string): Promise<BusinessContext> {
    if (typeof this.core.readBusinessContext === "function") return this.business.refreshWorkspaceContext(tenantId, await this.core.readBusinessContext(tenantId));
    const profile = await this.core.getProfile(tenantId);
    const category = await this.core.getWorkspaceCategory(tenantId);
    return {
      profile,
      category,
      settings: await this.core.getBusinessSettings(tenantId),
      groups: this.core.listItemGroups(tenantId),
      pricingGroups: this.core.listPricingGroups(tenantId),
      couponTemplates: this.core.listCouponTemplates(tenantId),
      locations: this.core.listLocations(tenantId),
      operators: this.core.listOperators(tenantId),
    };
  }

  private async releaseCancelledOrderResources(tenantId: string, orderId: string, tx: TTransaction, reason: string) {
    await this.business.releaseCouponInTransaction(tenantId, orderId, tx);
    await this.serviceCapacities.releaseForOrder(tenantId, orderId, reason, new Date().toISOString(), tx);
    await this.corporateSettlement?.settleCancelledOrderCredit(tenantId, orderId, reason, tx);
  }

  private async emitOrderEvent(
    tenantId: string,
    eventCode: string,
    order: { id: string; orderNo: string; customerName: string; contactPhone?: string; customerId?: string },
  ) {
    return await this.business.emitNotificationEvent(
      tenantId,
      (await this.context(tenantId)),
      eventCode,
      order.contactPhone ?? order.customerId,
      { customerName: order.customerName, orderNo: order.orderNo },
      { type: "order", id: order.id },
    );
  }

  private async commitScope(tenantId: string) {
    await this.business.refreshFromDatabase("committed_order");
    await this.business.refreshCouponTemplateCache(tenantId, () => this.context(tenantId));
    await this.core.persist(tenantId);
  }

  /** 沿原逐单幂等、期限和资金核验；Conflict跳过并保留原状态与收据。 */
  private async expirePendingOrders(tenantId: string, workspaceId: string) {
    const key = JSON.stringify([tenantId, workspaceId]);
    const previous = this.expiredOrderScans.get(key);
    const scan: RentalExpiredDraftOrderScan = { after: previous?.after };
    const candidates = await this.core.listExpiredPendingOrderIds(tenantId, new Date().toISOString(), RENTAL_DUE_JOB_BATCH_SIZE, scan);
    // 只共享调度位置。读取失败保留旧对象，迟到读取不能覆盖已经续读或回绕的位置。
    if (this.expiredOrderScans.get(key) === previous) this.expiredOrderScans.set(key, scan);
    if (!candidates.length) return;
    for (const orderId of candidates) {
      try {
        await this.idempotent.executeWithReplayFlag({
          tenantId,
          action: "order.expire_pending",
          key: undefined,
          fallbackKey: `order.expire_pending:${orderId}`,
          request: { orderId, reason: RENTAL_PENDING_PAYMENT_TIMEOUT_REASON },
          orderId,
          run: async (tx) => {
            const expired = await this.core.expirePendingOrder(tenantId, orderId, tx, RENTAL_DUE_JOB_OPERATOR);
            await this.releaseCancelledOrderResources(tenantId, orderId, tx, "order_payment_timeout");
            return expired;
          },
          replay: async () => {
            const latest = await this.core.getOrder(tenantId, orderId);
            return latest.status === RentalCoreOrderStatus.Cancelled && latest.cancellationReason === RENTAL_PENDING_PAYMENT_TIMEOUT_REASON
              ? latest
              : undefined;
          },
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    await this.commitScope(tenantId);
  }

  /** 与 `POST orders/reconcile-pickup-overdue` 同源：宽限到期标记逾期并发爽约通知，最终时限到期确认爽约。 */
  private async reconcilePickupOverdue(tenantId: string, workspaceId: string) {
    const at = new Date().toISOString();
    const overdueKey = JSON.stringify([tenantId, workspaceId, "overdue"]);
    const noShowKey = JSON.stringify([tenantId, workspaceId, "no_show"]);
    const previousOverdue = this.pickupOrderScans.get(overdueKey);
    const previousNoShow = this.pickupOrderScans.get(noShowKey);
    const overdueScan: RentalPickupOrderScan = { after: previousOverdue?.after };
    const noShowScan: RentalPickupOrderScan = { after: previousNoShow?.after };
    const overdueCandidates = await this.core.listPickupOverdueOrderIds(tenantId, at, RENTAL_DUE_JOB_BATCH_SIZE, overdueScan);
    const noShowCandidates = await this.core.listNoShowCandidateIds(tenantId, at, RENTAL_DUE_JOB_BATCH_SIZE, noShowScan);
    // 两队列读取均成功后记录各自位置；迟到批次不能覆盖已推进或回绕的对象。
    if (this.pickupOrderScans.get(overdueKey) === previousOverdue) this.pickupOrderScans.set(overdueKey, overdueScan);
    if (this.pickupOrderScans.get(noShowKey) === previousNoShow) this.pickupOrderScans.set(noShowKey, noShowScan);
    if (!overdueCandidates.length && !noShowCandidates.length) return;
    for (const orderId of overdueCandidates) {
      try {
        const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
          tenantId,
          action: "order.mark_pickup_overdue",
          key: undefined,
          fallbackKey: `order.mark_pickup_overdue:${orderId}`,
          request: { orderId },
          orderId,
          run: (tx) => this.core.markPickupOverdueOrder(tenantId, orderId, tx, RENTAL_DUE_JOB_OPERATOR),
          replay: async () => {
            const latest = await this.core.getOrder(tenantId, orderId);
            return latest.status === RentalCoreOrderStatus.PickupOverdue ? latest : undefined;
          },
        });
        if (!order.noShowNoticeAt) {
          const logs = await this.emitOrderEvent(tenantId, "order.pickup_overdue", order);
          if (logs.length) {
            await this.idempotent.execute({
              tenantId,
              action: "order.no_show_notice",
              key: undefined,
              fallbackKey: `order.no_show_notice:${orderId}`,
              request: { orderId },
              orderId,
              run: (tx) => this.core.recordNoShowNotice(tenantId, orderId, new Date().toISOString(), tx),
              replay: async () => {
                const latest = await this.core.getOrder(tenantId, orderId);
                return latest.noShowNoticeAt ? latest : undefined;
              },
            });
          }
        }
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    for (const orderId of noShowCandidates) {
      try {
        const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
          tenantId,
          action: "order.confirm_no_show",
          key: undefined,
          fallbackKey: `order.confirm_no_show:${orderId}`,
          request: { orderId, reason: "领取超时且最终时限已到" },
          orderId,
          run: async (tx) => {
            const confirmed = await this.core.confirmNoShowOrder(tenantId, orderId, "领取超时且最终时限已到", tx, RENTAL_DUE_JOB_OPERATOR);
            await this.releaseCancelledOrderResources(tenantId, orderId, tx, "order_no_show");
            return confirmed;
          },
          replay: async () => {
            const latest = await this.core.getOrder(tenantId, orderId);
            return latest.status === RentalCoreOrderStatus.NoShow ? latest : undefined;
          },
        });
        if (!replayed) await this.emitOrderEvent(tenantId, "order.no_show", order);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    await this.commitScope(tenantId);
  }

  /** 与 `POST notification-logs/retry-due` 同源。 */
  private async retryDueNotifications(tenantId: string) {
    const signal = this.notificationDispatchLifetime.signal;
    await this.business.retryDueNotifications(tenantId, (await this.context(tenantId)), RENTAL_DUE_JOB_BATCH_SIZE, signal);
    await Promise.all([this.business.persist(tenantId), this.core.persist(tenantId)]);
  }

  /** 与 `POST pricing-plans/adjustments/run-due` 同源。 */
  private async runDuePriceAdjustments(tenantId: string) {
    await this.business.runDuePriceAdjustments(tenantId, (await this.context(tenantId)));
    await Promise.all([this.business.persist(tenantId), this.core.persist(tenantId)]);
  }

  /**
   * 支付意图过期核对：对本空间已过期仍 pending 的原支付单逐笔先查平台再处理关闭，
   * 平台确认已付则按同一入账路径补入账，绝不因本地过期把已收的钱标成关闭。
   * 未定关单沿原持久化收据查询恢复；旧离线构造未传支付参加者时跳过本项。
   */
  private async expirePaymentIntents(tenantId: string, workspaceId: string) {
    if (!this.payments) return;
    await this.payments.expireStalePaymentIntents(tenantId, workspaceId, RENTAL_DUE_JOB_BATCH_SIZE);
  }
}
