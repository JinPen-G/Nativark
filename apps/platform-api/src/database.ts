/** 公共宿主唯一Prisma实例，只由公共schema生成。导入不读环境文件或连接数据库。
 * 所选宿主可在初始化前显式接管生命周期；默认零Core也由唯一宿主接管，独立初始化命令沿本模块原连接/断开钩子。 */
import { Global, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { integrationTestWhere, type IntegrationTestUpdate } from "@rental-os/platform-server/integration-store";
import { mapPrismaNullInputs } from "@rental-os/platform-server/prisma-runtime";
import { PrismaClient, Prisma } from "../generated/client";

export type PublicDatabaseTransaction = Prisma.TransactionClient;

/** 接管者负责等待原初始化/请求，HTTP关闭后再断开同一连接池。 */
export interface PlatformDatabaseHostLifecycle {
  onModuleInit(): Promise<void>;
  onModuleDestroy(): Promise<void>;
}

@Injectable()
export class PlatformDatabaseClient extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private hostLifecycle?: PlatformDatabaseHostLifecycle;
  private lifecycleHooksStarted = false;

  constructor(options?: Prisma.PrismaClientOptions) {
    super(options);
    this.$use((parameters, next) => {
      parameters.args = mapPrismaNullInputs(parameters.args, Prisma);
      return next(parameters);
    });
  }

  updateTestConfiguration({ where, data }: IntegrationTestUpdate) {
    return this.tenantIntegrationConfig.updateMany({ where: integrationTestWhere(where, Prisma.JsonNull), data });
  }

  /** 只接受一个启动前确定的实际宿主；不能在已有连接钩子运行后改变断库归属。 */
  manageLifecycle(lifecycle: PlatformDatabaseHostLifecycle): void {
    if (this.hostLifecycle === lifecycle) return;
    if (this.hostLifecycle || this.lifecycleHooksStarted) throw new Error("公共数据库生命周期已经确定");
    this.hostLifecycle = lifecycle;
  }

  async onModuleInit() {
    this.lifecycleHooksStarted = true;
    if (this.hostLifecycle) return this.hostLifecycle.onModuleInit();
    if (process.env.DATABASE_CONNECT_ON_START === "true") await this.$connect();
  }
  async onModuleDestroy() {
    this.lifecycleHooksStarted = true;
    if (this.hostLifecycle) return this.hostLifecycle.onModuleDestroy();
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [{ provide: PlatformDatabaseClient, useFactory: () => new PlatformDatabaseClient() }],
  exports: [PlatformDatabaseClient] })
export class PlatformDatabaseModule {}
