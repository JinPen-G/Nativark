/** 公共与 Rental 使用本宿主组合 schema 的唯一 Client；公共令牌别名不创建第二个连接池。
 * 导入不读环境文件或连接，生成客户端只归本宿主 generated/client。 */
import { Global, Injectable, Module } from "@nestjs/common";
import { PlatformDatabaseClient } from "@rental-os/platform-api/database";
import { integrationTestWhere, type IntegrationTestUpdate } from "@rental-os/platform-server/integration-store";
import { PrismaClient, Prisma } from "../generated/client";

export type RentalDatabaseTransaction = Prisma.TransactionClient;

@Injectable()
export class RentalDatabaseClient extends PrismaClient {
  updateTestConfiguration({ where, data }: IntegrationTestUpdate) {
    return this.tenantIntegrationConfig.updateMany({ where: integrationTestWhere(where, Prisma.JsonNull), data });
  }

  // 同一 Client 经多个 HTTP/公共令牌注入，不能由这些 provider 重复触发生命周期。
  // 显式连接及所有参与者排空、HTTP 关闭后的断开均由 RentalApplicationLifecycle 唯一负责。
}

@Global()
@Module({ providers: [RentalDatabaseClient, { provide: PlatformDatabaseClient, useExisting: RentalDatabaseClient }],
  exports: [RentalDatabaseClient, PlatformDatabaseClient] })
export class RentalDatabaseModule {}
