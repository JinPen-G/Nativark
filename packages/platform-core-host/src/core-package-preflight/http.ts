/** 固定包检查、安装规划与独立更新的 Nest 入口，粗准入委托原 Core 包管理权限。
 * 应用在来源读取后继续核原主体、会话、实际部署与数据，候选以 pending 返回。 */
import { Body, Controller, ForbiddenException, HttpCode, HttpException, Inject, Module, Post, type DynamicModule } from "@nestjs/common";
import { CoreAccessError } from "@rental-os/core-host";
import type { RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { z } from "zod";
import { CORE_PACKAGE_HTTP_BASE } from "../core-package-ports";
import { createPlatformCorePackageHttpAccess } from "../core-package-http";
import { CORE_PACKAGE_PREFLIGHT_HTTP, type CorePackagePreflightApplication } from "./ports";

export const CORE_PACKAGE_PREFLIGHT_APPLICATION = Symbol("platform.core-packages.preflight");

export function createPlatformCorePackagePreflightHttpAccess(): RegisteredCoreHttpAccess {
  const management = createPlatformCorePackageHttpAccess();
  const registered = (verb: string, path: string) => Object.values(CORE_PACKAGE_PREFLIGHT_HTTP).some(route =>
    route.method === verb.toUpperCase() && path === `/${CORE_PACKAGE_HTTP_BASE}/${route.path}`);
  return {
    registered: (verb, path, audience) => audience === "operator" && registered(verb, path),
    async authorize(verb, path) {
      if (!registered(verb, path)) throw new ForbiddenException("包预检路径或方法未登记");
      await management.authorize("GET", `/${CORE_PACKAGE_HTTP_BASE}/catalogue`);
    }
  };
}

@Controller(CORE_PACKAGE_HTTP_BASE)
export class CorePackagePreflightController {
  constructor(@Inject(CORE_PACKAGE_PREFLIGHT_APPLICATION) private readonly application: CorePackagePreflightApplication) {}

  @Post(CORE_PACKAGE_PREFLIGHT_HTTP.inspect.path) @HttpCode(200)
  inspect(@Body() body: unknown) { return this.respond(() => this.application.inspect(body)); }

  @Post(CORE_PACKAGE_PREFLIGHT_HTTP.install.path) @HttpCode(200)
  install(@Body() body: unknown) { return this.respond(() => this.application.install(body)); }

  @Post(CORE_PACKAGE_PREFLIGHT_HTTP.update.path) @HttpCode(200)
  update(@Body() body: unknown) { return this.respond(() => this.application.update(body)); }

  private async respond<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "输入不符合包预检要求" }, 400);
      if (error instanceof CoreAccessError) throw new HttpException({ code: error.code, message: error.message },
        error.code === "denied" ? 403 : error.code === "core_unavailable" ? 503 : 409);
      throw error;
    }
  }
}

@Module({})
export class CorePackagePreflightHttpModule {
  static register(application: CorePackagePreflightApplication): DynamicModule {
    return { module: CorePackagePreflightHttpModule, controllers: [CorePackagePreflightController],
      providers: [{ provide: CORE_PACKAGE_PREFLIGHT_APPLICATION, useValue: application }] };
  }
}
