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
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) throw new Error("TRUST_PROXY_HOPS 须为非负整数");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT必须为1-65535整数");
  const app = await NestFactory.create(ticketsApplicationModule(lock));
  try {
    // 只按部署方声明的代理跳数解析客户端地址；缺省不采信转发头。
    if (trustProxyHops > 0) app.getHttpAdapter().getInstance().set("trust proxy", trustProxyHops);
    app.use(requestIdentityMiddleware);
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.enableShutdownHooks();
    await app.listen(port);
  } catch (error) {
    try { await app.close(); }
    catch (closingError) { throw new AggregateError([error, closingError], "工单启动失败且资源排空未完成"); }
    throw error;
  }
}

void bootstrap();
