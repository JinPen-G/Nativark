/** 默认无Core的受控宿主装配，仅包含公共源码、公共数据库与公开设置。 */
import { Module } from "@nestjs/common";
import { PlatformServerModule } from "@rental-os/platform-server";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "./database";

@Module({ imports: [PlatformServerModule.register({ imports: [PlatformDatabaseModule],
  inject: [PlatformDatabaseClient], useFactory: (database: PlatformDatabaseClient) => database })] })
export class PlatformAppModule {}
