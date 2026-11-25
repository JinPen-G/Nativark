/**
 * Core 包管理的真实 Nest 只读入口，原签名 Guard 粗准入后由应用复验当前 SaaS 管理权。
 * 只接受三个固定路径，未映射方法仍拒绝，部署和授权继续走各自原入口。
 */
import { Body, Controller, ForbiddenException, Get, HttpCode, HttpException, Inject, Module, Post, type DynamicModule } from "@nestjs/common";
import { CoreAccessError } from "@rental-os/core-host";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { z } from "zod";
import { CORE_PACKAGE_HTTP, CORE_PACKAGE_HTTP_BASE, type CorePackageHttpApplication } from "./core-package-ports";

export const CORE_PACKAGE_APPLICATION = Symbol("platform.core-packages.http");

export function createPlatformCorePackageHttpAccess(): RegisteredCoreHttpAccess {
  const registered = (verb: string, path: string) => Object.values(CORE_PACKAGE_HTTP).some(route =>
    route.method === (verb.toUpperCase() === "HEAD" ? "GET" : verb.toUpperCase()) && path === `/${CORE_PACKAGE_HTTP_BASE}/${route.path}`);
  return {
    registered: (verb, path, audience) => audience === "operator" && registered(verb, path),
    async authorize(verb, path) {
      const identity = getRequestIdentity(), permissions = identity?.permissions ?? [];
      if (!registered(verb, path) || !identity?.userId || identity.audience !== "operator" || !identity.isSaasAdmin
        || !permissions.includes("*") && !permissions.includes("system:tenant:manage"))
        throw new ForbiddenException("当前主体缺少 SaaS Core 包管理权限");
    }
  };
}

@Controller(CORE_PACKAGE_HTTP_BASE)
export class CorePackageController {
  constructor(@Inject(CORE_PACKAGE_APPLICATION) private readonly application: CorePackageHttpApplication) {}

  @Get(CORE_PACKAGE_HTTP.catalogue.path)
  catalogue() { return this.respond(() => this.application.catalogue()); }

  @Post(CORE_PACKAGE_HTTP.discover.path) @HttpCode(200)
  discover(@Body() body: unknown) { return this.respond(() => this.application.discover(body)); }

  @Post(CORE_PACKAGE_HTTP.repository.path) @HttpCode(200)
  repository(@Body() body: unknown) { return this.respond(() => this.application.repository(body)); }

  private async respond<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "输入不符合 Core 包查询要求" }, 400);
      if (error instanceof CoreAccessError) throw new HttpException({ code: error.code, message: error.message },
        error.code === "denied" ? 403 : error.code === "core_unavailable" ? 503 : 409);
      throw error;
    }
  }
}

@Module({})
export class CorePackageHttpModule {
  static register(application: CorePackageHttpApplication): DynamicModule {
    return { module: CorePackageHttpModule, controllers: [CorePackageController],
      providers: [{ provide: CORE_PACKAGE_APPLICATION, useValue: application }] };
  }
}
