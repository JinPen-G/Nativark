/** 所选 Rental 宿主的唯一生命周期：先恢复和预热，再启动原作业；停新、排空、关闭 HTTP 后断库。
 * 不执行迁移或快照回填，不将取消/停机解释为业务回滚。应用实例不再作为独立生命周期 provider 登记。 */
import type { OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { RentalApplication } from "@rental-os/rental-core/application";

export class RentalApplicationLifecycle implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown {
  private initialization?: Promise<void>;
  private startup?: Promise<void>;
  private draining?: Promise<void>;
  private closing?: Promise<void>;
  private stopping = false;

  constructor(private readonly application: RentalApplication, private readonly disconnect: () => Promise<void>) {}

  onModuleInit(): Promise<void> {
    return this.initialization ??= this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.application.primary.core.onModuleInit();
    await this.application.primary.business.onModuleInit();
  }

  onApplicationBootstrap(): Promise<void> {
    return this.startup ??= this.start();
  }

  private async start(): Promise<void> {
    await this.onModuleInit();
    if (this.stopping) return;
    await this.application.primary.core.onApplicationBootstrap();
    await this.application.primary.business.onApplicationBootstrap();
    if (this.stopping) return;
    const { workers, integrations, client } = this.application;
    try {
      workers.allocation.onApplicationBootstrap();
      workers.dueJobs.onApplicationBootstrap();
      integrations.fileCleanup.onApplicationBootstrap();
      client.rateLimit.onApplicationBootstrap();
    } catch (error) {
      this.stopping = true;
      await this.stopParticipants();
      throw error;
    }
  }

  private async stopParticipants(): Promise<void> {
    const { workers, integrations, client } = this.application;
    // 所有入口先停止接单；即使一项失败也要等待其余原在途工作结束。
    const results = await Promise.allSettled([
      Promise.resolve().then(() => workers.allocation.onModuleDestroy()),
      Promise.resolve().then(() => workers.dueJobs.onModuleDestroy()),
      Promise.resolve().then(() => integrations.fileCleanup.onApplicationShutdown()),
      Promise.resolve().then(() => client.rateLimit.onApplicationShutdown())
    ]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Rental 在途工作未能正常排空");
  }

  onModuleDestroy(): Promise<void> {
    this.stopping = true;
    return this.draining ??= (async () => {
      // 初始化期间关闭也不能让晚到的预热再启动计时器。
      await Promise.allSettled([this.initialization, this.startup]);
      await this.stopParticipants();
    })();
  }

  onApplicationShutdown(): Promise<void> {
    // Nest 在 dispose HTTP 之后调用此钩子；先等待原事务、回调和清理，再关闭唯一连接池。
    return this.closing ??= (async () => {
      await this.onModuleDestroy();
      await this.disconnect();
    })();
  }
}
