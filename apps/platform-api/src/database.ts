/** 公共宿主唯一Prisma实例，只由公共schema生成。导入不读环境文件或连接数据库。 */
import { Global, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { integrationTestWhere, type IntegrationTestUpdate } from "@rental-os/platform-server/integration-store";
import { mapPrismaNullInputs } from "@rental-os/platform-server/prisma-runtime";
import { PrismaClient, Prisma } from "../generated/client";

export type PublicDatabaseTransaction = Prisma.TransactionClient;

@Injectable()
export class PlatformDatabaseClient extends PrismaClient implements OnModuleInit, OnModuleDestroy {
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

  async onModuleInit() {
    if (process.env.DATABASE_CONNECT_ON_START === "true") await this.$connect();
  }
  async onModuleDestroy() { await this.$disconnect(); }
}

@Global()
@Module({ providers: [{ provide: PlatformDatabaseClient, useFactory: () => new PlatformDatabaseClient() }],
  exports: [PlatformDatabaseClient] })
export class PlatformDatabaseModule {}
