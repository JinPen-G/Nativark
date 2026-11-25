/** 公共宿主启动入口；只消费进程配置，业务Core由受控装配另外选择。导入本文件会监听端口。 */
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { requestIdentityMiddleware } from "@rental-os/platform-server";

async function bootstrap() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("公共宿主必须配置独立DATABASE_URL");
  if (!process.env.AUTH_TOKEN_SECRET?.trim()) throw new Error("公共宿主必须配置AUTH_TOKEN_SECRET");
  if (process.env.PLATFORM_DATA_SOURCE && process.env.PLATFORM_DATA_SOURCE !== "mysql")
    throw new Error("公共宿主使用持久化mysql身份与设置");
  process.env.PLATFORM_DATA_SOURCE = "mysql";
  const port = Number(process.env.API_PORT ?? 3000);
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) throw new Error("TRUST_PROXY_HOPS 须为非负整数");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT必须为1-65535的整数");
  const { PlatformAppModule } = await import("./app.module");
  const app = await NestFactory.create(PlatformAppModule);
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
    catch (closingError) { throw new AggregateError([error, closingError], "公共宿主启动失败且资源排空未完成"); }
    throw error;
  }
}

void bootstrap();
