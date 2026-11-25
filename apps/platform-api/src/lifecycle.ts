/** 零Core宿主的唯一生命周期：初始化、Guard及完整处理器都结束后才允许断库。
 * 数据库早到的destroy只触发同一次排空，shutdown在HTTP dispose之后释放同一池。
 * 断线只弃置响应，不取消原事务或把unknown视为可重发；不登记角色、执行迁移或启动新业务。 */
import { ServiceUnavailableException, type CallHandler, type ExecutionContext, type NestInterceptor,
  type OnApplicationShutdown, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { PlatformDatabaseClient } from "./database";
import { Observable } from "rxjs";

export class PlatformApplicationLifecycle implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown, NestInterceptor {
  private initialization?: Promise<void>;
  private draining?: Promise<void>;
  private closing?: Promise<void>;
  private disconnection?: Promise<void>;
  private stopping = false;
  private readonly requests = new Set<Promise<unknown>>();

  constructor(private readonly database: PlatformDatabaseClient) {
    database.manageLifecycle(this);
  }

  onModuleInit(): Promise<void> {
    return this.initialization ??= this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      if (this.stopping) return;
      if (process.env.DATABASE_CONNECT_ON_START === "true") await this.database.$connect();
    } catch (error) {
      this.stop();
      // 启动入口在init/listen失败后关闭同一个Nest应用，保持HTTP dispose先于断库。
      throw error;
    }
  }

  /** Guard与处理器各等待原工作；停止后的下一阶段在派发前拒绝。 */
  runRequest<T>(consume: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new ServiceUnavailableException("公共宿主正在停止新请求"));
    const request = Promise.resolve().then(consume);
    this.requests.add(request);
    return request.finally(() => { this.requests.delete(request); });
  }

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    let dispatched = false;
    return new Observable(subscriber => {
      if (dispatched) {
        subscriber.error(new Error("公共请求不能重复派发"));
        return;
      }
      dispatched = true;
      void this.runRequest(() => new Promise<void>((resolve, reject) => {
        // 原源只订阅一次；响应unsubscribe之后仍等原complete/error，保留多值及文件对象。
        next.handle().subscribe({
          next: value => subscriber.next(value),
          error: error => { reject(error); subscriber.error(error); },
          complete: () => { resolve(); subscriber.complete(); }
        });
      })).catch(error => subscriber.error(error));
    });
  }

  private stop(): void {
    this.stopping = true;
  }

  onModuleDestroy(): Promise<void> {
    this.stop();
    return this.draining ??= (async () => {
      await Promise.allSettled([this.initialization]);
      // 原拒绝仍交HTTP出口；排空只等真实完成，不把业务403/409解释为关停失败。
      await Promise.allSettled([...this.requests]);
    })();
  }

  onApplicationShutdown(): Promise<void> {
    return this.closing ??= (async () => {
      await this.onModuleDestroy();
      await (this.disconnection ??= Promise.resolve().then(() => this.database.$disconnect()));
    })();
  }
}
