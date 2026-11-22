/**
 * 启动旧组合宿主并配置请求边界和原工作排空。
 * 信号和显式 close 共用一次关闭，先停新并等待原文件/到期工作，再关闭 HTTP 和数据库。
 * 加载本文件会执行 bootstrap，离线验证须提取关闭配置，不能直接导入启动应用。
 */
import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { resolve } from "node:path";
import { loadProjectEnvironment, validateApiEnvironment } from "../../../config/environment.cjs";
import { requestIdentityMiddleware } from "./common/request-identity";
import { staffApiRoutingMiddleware } from "./common/staff-api-routing";
import { apiCorsOrigins } from "./common/cors-origins";
import type { FileStorageRuntimeService } from "./modules/integrations/file-storage.runtime.service";
import type { RentalDueJobScheduler } from "./modules/rental-core/rental-due-job.scheduler";
import type { RentalAllocationService } from "./modules/rental-core/rental-allocation.service";
import type { ClientApiRateLimitService } from "./modules/client/client-api-rate-limit.service";

function configureShutdown(
  app: NestExpressApplication,
  files: Pick<FileStorageRuntimeService, "stop">,
  dueJobs: Pick<RentalDueJobScheduler, "stop">,
  allocation: Pick<RentalAllocationService, "onModuleDestroy" | "onApplicationBootstrap">,
  rateLimit: Pick<ClientApiRateLimitService, "onApplicationShutdown">
): void {
  // Nest 10 的实际 close 支持信号参数，公共应用类型仅声明无参调用。
  const nativeClose = app.close.bind(app) as (signal?: string) => Promise<void>;
  const nativeListen = app.listen.bind(app) as (port: number | string, ...args: unknown[]) => ReturnType<NestExpressApplication["listen"]>;
  let startup: ReturnType<NestExpressApplication["listen"]> | undefined;
  let stopping = false;
  let closing: Promise<void> | undefined;
  let receivedSignal = false;
  const startAllocation = allocation.onApplicationBootstrap.bind(allocation);
  // 原配货实例允许 bootstrap 重开。旧宿主退出期间阻止晚到的同实例启动。
  allocation.onApplicationBootstrap = () => {
    if (!stopping) startAllocation();
  };

  app.use((
    _request: unknown,
    response: { status(code: number): { json(body: unknown): void } },
    next: () => void
  ) => {
    if (stopping) {
      response.status(503).json({ message: "应用正在关闭，请按原操作核对结果" });
      return;
    }
    next();
  });

  app.listen = (port: number | string, ...args: unknown[]) => {
    if (stopping) return Promise.reject(new Error("应用正在关闭，不能重新开始监听"));
    startup = nativeListen(port, ...args);
    return startup;
  };

  const closeApplication = (signal?: string): Promise<void> => {
    stopping = true;
    return closing ??= (async () => {
      // Prisma 的销毁钩子先于 HTTP disposal。排空必须发生在进入 Nest close 之前。
      const results = await Promise.allSettled([
        Promise.resolve().then(() => files.stop()),
        Promise.resolve().then(() => dueJobs.stop()),
        Promise.resolve().then(() => allocation.onModuleDestroy()),
        Promise.resolve().then(() => rateLimit.onApplicationShutdown()),
        // listen 包含 Nest 初始化，关闭期间晚到的启动也必须完整返回。
        startup
      ]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "旧宿主在途工作排空失败");
      // 让已接收的 HTTP 请求完整返回后才触发 Prisma 销毁。Nest 随后关闭其余原资源。
      await app.getHttpAdapter().close();
      await nativeClose(signal);
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    })();
  };

  app.close = closeApplication;

  const onSignal = (signal: NodeJS.Signals) => {
    if (receivedSignal) return;
    receivedSignal = true;
    void closeApplication(signal).then(() => process.kill(process.pid, signal), error => {
      Logger.error("旧宿主关闭失败", error instanceof Error ? error.stack : String(error));
      process.exit(1);
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

async function bootstrap() {
  Object.assign(process.env, validateApiEnvironment(loadProjectEnvironment({
    appDirectory: resolve(__dirname, ".."),
    mode: process.env.NODE_ENV
  })));
  // Configuration is ready before business modules evaluate their runtime switches.
  const [{ AppModule }, { FileStorageRuntimeService }, { RentalDueJobScheduler }, { RentalAllocationService }, { ClientApiRateLimitService }] = await Promise.all([
    import("./app.module"),
    import("./modules/integrations/file-storage.runtime.service"),
    import("./modules/rental-core/rental-due-job.scheduler"),
    import("./modules/rental-core/rental-allocation.service"),
    import("./modules/client/client-api-rate-limit.service")
  ]);
  // 微信支付 v3 验签必须使用原始请求体；Express 解析后的 JSON 可能改变空白与字段顺序。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureShutdown(app, app.get(FileStorageRuntimeService), app.get(RentalDueJobScheduler),
    app.get(RentalAllocationService), app.get(ClientApiRateLimitService));

  // 客户端限流按来源地址计数（见 client-api-rate-limit.service.ts 的 clientAddress）。
  // 部署在反向代理之后时必须声明可信跳数，否则 request.ip 永远是代理地址，
  // 全部客户端会共用一个限流桶；不设或为 0 表示直连、不信任任何 X-Forwarded-For。
  const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "0", 10);
  if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) app.set("trust proxy", trustProxyHops);

  app.use(requestIdentityMiddleware);
  app.use(staffApiRoutingMiddleware);
  app.setGlobalPrefix("api");
  app.enableCors({
    credentials: true,
    origin: apiCorsOrigins(process.env.CORS_ALLOWED_ORIGINS)
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true
    })
  );

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
