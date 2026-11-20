/** 固定发行预览、引用保存与原引用读取的 Nest 入口，粗准入和应用复验使用原 SaaS 权限。 */
import {
  Body, Controller, ForbiddenException, HttpCode, HttpException, Inject, Module, Post, type DynamicModule
} from "@nestjs/common";
import { CoreAccessError } from "@rental-os/core-host";
import type { RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { z } from "zod";
import { CORE_PACKAGE_HTTP_BASE } from "../core-package-ports";
import { createPlatformCorePackageHttpAccess } from "../core-package-http";
import { CORE_PACKAGE_SELECTION_HTTP } from "./protocol";
import type { CorePackageReleaseApplication } from "./ports";

export const CORE_PACKAGE_SELECTION_APPLICATION = Symbol("platform.core-packages.selection");

export function createPlatformCorePackageSelectionHttpAccess(): RegisteredCoreHttpAccess {
  const management = createPlatformCorePackageHttpAccess();
  const registered = (verb: string, path: string) => Object.values(CORE_PACKAGE_SELECTION_HTTP).some(route =>
    route.method === verb.toUpperCase() && path === `/${CORE_PACKAGE_HTTP_BASE}/${route.path}`);
  return {
    registered: (verb, path, audience) => audience === "operator" && registered(verb, path),
    async authorize(verb, path) {
      if (!registered(verb, path)) throw new ForbiddenException("发行选择路径或方法未登记");
      await management.authorize("GET", `/${CORE_PACKAGE_HTTP_BASE}/catalogue`);
    }
  };
}

@Controller(CORE_PACKAGE_HTTP_BASE)
export class CorePackageSelectionController {
  constructor(@Inject(CORE_PACKAGE_SELECTION_APPLICATION) private readonly application: CorePackageReleaseApplication) {}

  @Post(CORE_PACKAGE_SELECTION_HTTP.preview.path) @HttpCode(200)
  preview(@Body() body: unknown) { return this.respond(() => this.application.preview(body)); }

  @Post(CORE_PACKAGE_SELECTION_HTTP.select.path) @HttpCode(200)
  select(@Body() body: unknown) { return this.respond(() => this.application.select(body)); }

  @Post(CORE_PACKAGE_SELECTION_HTTP.receipt.path) @HttpCode(200)
  receipt(@Body() body: unknown) { return this.respond(() => this.application.receipt(body)); }

  private async respond<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "输入不符合固定发行选择要求" }, 400);
      if (error instanceof CoreAccessError) throw new HttpException({ code: error.code, message: error.message },
        error.code === "denied" ? 403 : error.code === "core_unavailable" ? 503 : 409);
      throw error;
    }
  }
}

@Module({})
export class CorePackageSelectionHttpModule {
  static register(application: CorePackageReleaseApplication): DynamicModule {
    return { module: CorePackageSelectionHttpModule, controllers: [CorePackageSelectionController],
      providers: [{ provide: CORE_PACKAGE_SELECTION_APPLICATION, useValue: application }] };
  }
}
