/** 所选 Rental 宿主的唯一生命周期：先登记已核权限，再恢复和预热，最后启动原作业。
 * 停新、排空、关闭 HTTP 后断库；初始化失败也沿同一资源释放路径。
 * 不执行迁移或快照回填，不将取消/停机解释为业务回滚。应用实例不再作为独立生命周期 provider 登记。 */
import { ServiceUnavailableException, type OnApplicationBootstrap, type OnApplicationShutdown, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { RentalApplication } from "@rental-os/rental-core/application";

export class RentalApplicationLifecycle implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown {
  private initialization?: Promise<void>;
  private startup?: Promise<void>;
  private draining?: Promise<void>;
  private participantsStopping?: Promise<void>;
  private closing?: Promise<void>;
  private disconnection?: Promise<void>;
  private stopping = false;
  private readonly requests = new Set<Promise<unknown>>();

  constructor(private readonly application: RentalApplication, private readonly disconnect: () => Promise<void>,
    private readonly connect?: () => Promise<void>,
    private readonly permissions?: { initialize(): Promise<void>; stop(): void }) {}

  /** HTTP 关闭不代表原处理器完成；唯一宿主等待完整请求作用域后才允许断库。 */
  runRequest<T>(consume: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new ServiceUnavailableException("Rental 宿主正在停止新请求"));
    const request = Promise.resolve().then(consume);
    this.requests.add(request);
    return request.finally(() => { this.requests.delete(request); });
  }

  onModuleInit(): Promise<void> {
    return this.initialization ??= this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await this.connect?.();
      if (this.stopping) return;
      await this.permissions?.initialize();
      if (this.stopping) return;
      await this.application.primary.core.onModuleInit();
      if (this.stopping) return;
      await this.application.primary.business.onModuleInit();
    } catch (error) {
      await this.failStartup(error);
    }
  }

  onApplicationBootstrap(): Promise<void> {
    return this.startup ??= this.start();
  }

  private async start(): Promise<void> {
    try {
      await this.onModuleInit();
      if (this.stopping) return;
      await this.application.primary.core.onApplicationBootstrap();
      if (this.stopping) return;
      await this.application.primary.business.onApplicationBootstrap();
      if (this.stopping) return;
      const { workers, integrations, client } = this.application;
      workers.allocation.onApplicationBootstrap();
      workers.dueJobs.onApplicationBootstrap();
      integrations.fileCleanup.onApplicationBootstrap();
      client.rateLimit.onApplicationBootstrap();
    } catch (error) {
      await this.failStartup(error);
    }
  }

  private async failStartup(error: unknown): Promise<never> {
    this.stopping = true;
    this.permissions?.stop();
    try {
      await this.stopParticipantsOnce();
      await this.disconnectOnce();
    } catch (closingError) {
      throw new AggregateError([error, closingError], "Rental启动失败且资源释放未完成");
    }
    throw error;
  }

  private disconnectOnce(): Promise<void> {
    return this.disconnection ??= Promise.resolve().then(() => this.disconnect());
  }

  private stopParticipantsOnce(): Promise<void> {
    return this.participantsStopping ??= this.stopParticipants();
  }

  private async stopParticipants(): Promise<void> {
    const { workers, integrations, client } = this.application;
    // 所有入口先停止接单；即使一项失败也要等待其余原在途工作结束。
    const results = await Promise.allSettled([
      Promise.resolve().then(() => workers.allocation.onModuleDestroy()),
      Promise.resolve().then(() => workers.dueJobs.onModuleDestroy()),
      Promise.resolve().then(() => integrations.fileCleanup.onApplicationShutdown()),
      Promise.resolve().then(() => client.rateLimit.onApplicationShutdown()),
      // 请求的正常失败已交给原 HTTP 出口；排空只等待真实完成，不把业务拒绝当关停失败。
      Promise.allSettled(this.requests)
    ]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Rental 在途工作未能正常排空");
  }

  onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.permissions?.stop();
    return this.draining ??= (async () => {
      // 初始化期间关闭也不能让晚到的预热再启动计时器。
      await Promise.allSettled([this.initialization, this.startup]);
      await this.stopParticipantsOnce();
    })();
  }

  onApplicationShutdown(): Promise<void> {
    // Nest 在 dispose HTTP 之后调用此钩子；先等待原事务、回调和清理，再关闭唯一连接池。
    return this.closing ??= (async () => {
      await this.onModuleDestroy();
      await this.disconnectOnce();
    })();
  }
}
