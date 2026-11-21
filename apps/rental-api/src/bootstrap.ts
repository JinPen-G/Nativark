/** 独立启动只读取进程配置与明确的部署锁。导入不监听、不读 .env；bootstrap 的调用者负责执行授权。
 * 原 body/身份/员工路由/Guard/请求作用域依序装配，退出交给唯一生命周期排空。 */
import "reflect-metadata";
import { ValidationPipe, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { requestIdentityMiddleware } from "@rental-os/platform-server";
import { createRentalStaffApiRouting } from "@rental-os/rental-core/staff-routing";
import { AI_STAFF_INSPECTION_HTTP_DRAFT, AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT } from "@rental-os/shared";
import type { createRentalHttpRequestScope } from "./http-request-scope";
import { attachRentalBootstrapIngress, type RentalBootstrapIngress } from "./bootstrap-ingress";

export interface RentalBootstrapExtension {
  createIngress(application: NestExpressApplication): RentalBootstrapIngress | Promise<RentalBootstrapIngress>;
}

/** 与原宿主相同的完整 origin 约束；CORS 从不代替业务权限。 */
export function rentalCorsOrigins(value = ""): Array<string | RegExp> {
  const origins: Array<string | RegExp> = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
  for (const entry of value.split(",").map(part => part.trim()).filter(Boolean)) {
    const url = new URL(entry), local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*")) {
      throw new Error("CORS_ALLOWED_ORIGINS 必须是完整 HTTPS origin，不含路径或通配符");
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return origins;
}

export function readRentalStartupConfiguration<Mode extends "enabled" | "disabled" = "disabled">(
  environment: NodeJS.ProcessEnv, aiMode: Mode = "disabled" as Mode) {
  for (const key of ["PLATFORM_DATA_SOURCE", "RENTAL_OS_DATA_SOURCE", "INFRA_DATA_SOURCE"]) {
    if (environment[key] !== undefined && environment[key]?.trim().toLowerCase() !== "mysql")
      throw new Error(`${key} 须使用 mysql，独立 Rental 宿主不回退内存模式`);
  }
  try {
    const database = new URL(environment.DATABASE_URL ?? "");
    if (database.protocol !== "mysql:" || !database.hostname || database.pathname.length < 2) throw new Error();
  } catch { throw new Error("Rental 宿主须提供明确的 MySQL DATABASE_URL"); }
  if (!environment.AUTH_TOKEN_SECRET?.trim()) throw new Error("Rental 宿主须提供 AUTH_TOKEN_SECRET");
  if (environment.RENTAL_AI_MODE !== aiMode) throw new Error(`当前独立启动须显式选择 RENTAL_AI_MODE=${aiMode}`);
  const lockPath = environment.RENTAL_DEPLOYMENT_LOCK?.trim();
  if (!lockPath || !isAbsolute(lockPath)) throw new Error("RENTAL_DEPLOYMENT_LOCK 须指定实际固定部署锁的绝对路径");
  const port = Number(environment.API_PORT ?? 3000), trustProxyHops = Number(environment.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT 须为 1-65535 的整数");
  if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) throw new Error("TRUST_PROXY_HOPS 须为非负整数");
  return { lockPath, port, trustProxyHops, origins: rentalCorsOrigins(environment.CORS_ALLOWED_ORIGINS), aiMode };
}

export async function bootstrapRental() {
  return bootstrapRentalComposition("disabled", async lock => {
    const { RentalAppModule } = await import("./app.module.js");
    return RentalAppModule.register({ lock, aiMode: "disabled" });
  });
}

/** 同一 HTTP/生命周期实现，选择由源码入口固定。包路径、请求和环境不能加载任意模块。 */
export async function bootstrapRentalComposition(aiMode: "enabled" | "disabled",
  register: (lock: CoreDeploymentLock) => DynamicModule | Promise<DynamicModule>,
  extension?: RentalBootstrapExtension) {
  const settings = readRentalStartupConfiguration(process.env, aiMode);
  const stat = statSync(settings.lockPath);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error("Rental 部署锁须为不超过 8 MiB 的实际文件");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(settings.lockPath, "utf8")));
  const { RENTAL_HTTP_REQUEST_SCOPE } = await import("./app.module.js");
  // 注册全量原路由前核定各接点，失败发生在 Client 构造/连接/监听之前。
  const module = await register(lock);
  const app = await NestFactory.create<NestExpressApplication>(module, { rawBody: true });
  try {
    // 选装入口先消费原始流，再进入 Nest 的 body parser、CORS 或业务中间件。
    // 它与原请求使用同一模块实例，在 app.close / 进程信号时先于 Native 和 DB 排空。
    const ingress = await extension?.createIngress(app);
    if (ingress) attachRentalBootstrapIngress(app, ingress);
    if (settings.trustProxyHops > 0) app.set("trust proxy", settings.trustProxyHops);
    app.use(requestIdentityMiddleware);
    app.use(createRentalStaffApiRouting({ AI_STAFF_INSPECTION_HTTP_DRAFT, AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT }));
    const scope = app.get<ReturnType<typeof createRentalHttpRequestScope>>(RENTAL_HTTP_REQUEST_SCOPE);
    app.use(scope.middleware.use.bind(scope.middleware));
    // 已注册的公共 RequestIdInterceptor 在外层；作用域看到原处理器值，随后才包响应信封。
    app.useGlobalInterceptors(scope.interceptor);
    app.setGlobalPrefix("api");
    app.enableCors({ credentials: true, origin: settings.origins });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    if (!ingress) app.enableShutdownHooks();
    await app.listen(settings.port);
    return app;
  } catch (error) {
    try { await app.close(); }
    catch (closingError) { throw new AggregateError([error, closingError], "Rental 启动失败且资源排空未完成"); }
    throw error;
  }
}
