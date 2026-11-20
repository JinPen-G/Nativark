/** 候选预览、文件准备及原固定回执的三个 Nest 入口，使用同一 SaaS 管理粗准入。
 * 当前主体与原组合由应用核验，准备返回 pending，unknown 继续读取原摘要。 */
import { Body, Controller, ForbiddenException, HttpCode, HttpException, Inject, Module, Post, type DynamicModule } from "@nestjs/common";
import { CoreAccessError } from "@rental-os/core-host";
import type { RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { z } from "zod";
import { CORE_PACKAGE_HTTP_BASE } from "../core-package-ports";
import { createPlatformCorePackageHttpAccess } from "../core-package-http";
import { CORE_PACKAGE_PREPARATION_HTTP, type CorePackagePreparationApplication } from "./ports";

export const CORE_PACKAGE_PREPARATION_APPLICATION = Symbol("platform.core-packages.preparation");
export function createPlatformCorePackagePreparationHttpAccess(): RegisteredCoreHttpAccess {
  const management = createPlatformCorePackageHttpAccess();
  const registered = (verb: string, path: string) => Object.values(CORE_PACKAGE_PREPARATION_HTTP).some(route =>
    route.method === verb.toUpperCase() && path === `/${CORE_PACKAGE_HTTP_BASE}/${route.path}`);
  return {
    registered: (verb, path, audience) => audience === "operator" && registered(verb, path),
    async authorize(verb, path) {
      if (!registered(verb, path)) throw new ForbiddenException("候选准备路径或方法未登记");
      await management.authorize("GET", `/${CORE_PACKAGE_HTTP_BASE}/catalogue`);
    }
  };
}
@Controller(CORE_PACKAGE_HTTP_BASE)
export class CorePackagePreparationController {
  constructor(@Inject(CORE_PACKAGE_PREPARATION_APPLICATION) private readonly application: CorePackagePreparationApplication) {}
  @Post(CORE_PACKAGE_PREPARATION_HTTP.preview.path) @HttpCode(200)
  preview(@Body() body: unknown) { return this.respond(() => this.application.preview(body)); }
  @Post(CORE_PACKAGE_PREPARATION_HTTP.prepare.path) @HttpCode(200)
  prepare(@Body() body: unknown) { return this.respond(() => this.application.prepare(body)); }
  @Post(CORE_PACKAGE_PREPARATION_HTTP.receipt.path) @HttpCode(200)
  receipt(@Body() body: unknown) { return this.respond(() => this.application.receipt(body)); }
  private async respond<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "输入不符合候选准备要求" }, 400);
      if (error instanceof CoreAccessError) throw new HttpException({ code: error.code, message: error.message },
        error.code === "denied" ? 403 : error.code === "core_unavailable" ? 503 : 409);
      throw error;
    }
  }
}
@Module({})
export class CorePackagePreparationHttpModule {
  static register(application: CorePackagePreparationApplication): DynamicModule {
    return { module: CorePackagePreparationHttpModule, controllers: [CorePackagePreparationController],
      providers: [{ provide: CORE_PACKAGE_PREPARATION_APPLICATION, useValue: application }] };
  }
}
