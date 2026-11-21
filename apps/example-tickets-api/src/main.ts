/** 工单示范启动入口。固定部署锁由进程指定本地文件，显式运行才监听/连接业务数据库。 */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CORE_CONTRACT_VERSION, CoreDeploymentLockSchema } from "@rental-os/core-contracts";
import { requestIdentityMiddleware } from "@rental-os/platform-server";
import { ticketsApplicationModule } from "./app.module";

async function bootstrap() {
  if (!process.env.DATABASE_URL || !process.env.AUTH_TOKEN_SECRET || !process.env.CORE_DEPLOYMENT_LOCK)
    throw new Error("示范宿主须配置DATABASE_URL、AUTH_TOKEN_SECRET与固定CORE_DEPLOYMENT_LOCK路径");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(process.env.CORE_DEPLOYMENT_LOCK, "utf8")));
  if (lock.platform.versions.node !== process.versions.node || lock.platform.versions.contract !== CORE_CONTRACT_VERSION)
    throw new Error(`工单部署锁须与当前 Node ${process.versions.node} 和 Core 合同 ${CORE_CONTRACT_VERSION} 一致`);
  process.env.PLATFORM_DATA_SOURCE = "mysql";
  const port = Number(process.env.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT必须为1-65535整数");
  const app = await NestFactory.create(ticketsApplicationModule(lock));
  app.use(requestIdentityMiddleware);
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableShutdownHooks();
  await app.listen(port);
}

void bootstrap();
