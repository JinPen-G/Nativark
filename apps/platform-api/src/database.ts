/** 公共宿主唯一Prisma实例，只由公共schema生成。导入不读环境文件或连接数据库。 */
import { Global, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "../generated/client";

@Injectable()
export class PlatformDatabaseClient extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    if (process.env.DATABASE_CONNECT_ON_START === "true") await this.$connect();
  }
  async onModuleDestroy() { await this.$disconnect(); }
}

@Global()
@Module({ providers: [PlatformDatabaseClient], exports: [PlatformDatabaseClient] })
export class PlatformDatabaseModule {}
