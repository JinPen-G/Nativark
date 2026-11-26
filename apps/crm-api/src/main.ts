/** CRM启动入口。固定部署锁由进程指定本地文件，显式运行才监听/连接业务数据库。 */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CoreDeploymentLockSchema } from "@rental-os/core-contracts";
import { requestIdentityMiddleware } from "@rental-os/platform-server";
import { crmApplicationModule } from "./app.module";
import { crmListenOptions, requireCrmRuntime } from "./configuration";

async function bootstrap() {
  if (!process.env.DATABASE_URL || !process.env.AUTH_TOKEN_SECRET || !process.env.CORE_DEPLOYMENT_LOCK)
    throw new Error("CRM 宿主须配置DATABASE_URL、AUTH_TOKEN_SECRET与固定CORE_DEPLOYMENT_LOCK路径");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(process.env.CORE_DEPLOYMENT_LOCK, "utf8")));
  requireCrmRuntime(lock);
  process.env.PLATFORM_DATA_SOURCE = "mysql";
  const { port, trustProxyHops } = crmListenOptions(process.env);
  const app = await NestFactory.create(crmApplicationModule(lock));
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
    catch (closingError) { throw new AggregateError([error, closingError], "CRM启动失败且资源排空未完成"); }
    throw error;
  }
}

void bootstrap().catch(() => {
  // 原底层异常可能含连接配置，只在进程出口报告稳定失败，不回显凭据。
  process.stderr.write("CRM_HOST_START_FAILED：核对固定包、部署锁及数据库配置。\n");
  process.exitCode = 1;
});
