/** 私有来源配置仅沿原 SaaS 包管理身份进入；请求体不进入异常、日志或响应。 */
import { Body, Controller, Get, Header, HttpCode, HttpException, Inject, Post } from "@nestjs/common";
import { CoreAccessError } from "@rental-os/core-host";
import { z } from "zod";
import type { RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { CORE_PACKAGE_HTTP_BASE } from "./core-package-ports";
import { createPlatformCorePackageHttpAccess } from "./core-package-http";
import { CORE_PACKAGE_SOURCE_HTTP } from "./core-package-source-protocol";
import type { CorePackageSourceSettingsApplication } from "./core-package-source-settings";

export const CORE_PACKAGE_SOURCE_SETTINGS = Symbol("platform.core-package-source-settings");
export function createCorePackageSourceHttpAccess(): RegisteredCoreHttpAccess {
  const management = createPlatformCorePackageHttpAccess();
  const registered = (verb: string, path: string) => Object.values(CORE_PACKAGE_SOURCE_HTTP).some(route =>
    route.method === verb.toUpperCase() && path === `/${CORE_PACKAGE_HTTP_BASE}/${route.path}`);
  return {
    registered: (verb, path, audience) => audience === "operator" && registered(verb, path),
    async authorize(verb, path) {
      if (!registered(verb, path)) throw new CoreAccessError("denied", "私有来源路径或方法未登记");
      await management.authorize("GET", `/${CORE_PACKAGE_HTTP_BASE}/catalogue`);
    }
  };
}
@Controller(CORE_PACKAGE_HTTP_BASE)
export class CorePackageSourceController {
  constructor(@Inject(CORE_PACKAGE_SOURCE_SETTINGS) private readonly application: CorePackageSourceSettingsApplication) {}
  @Get(CORE_PACKAGE_SOURCE_HTTP.read.path) @Header("Cache-Control", "no-store")
  read() { return this.respond(() => this.application.read()); }
  @Post(CORE_PACKAGE_SOURCE_HTTP.save.path) @HttpCode(200) @Header("Cache-Control", "no-store")
  save(@Body() value: unknown) { return this.respond(() => this.application.save(value)); }
  private async respond<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "私有来源配置不符合格式或范围要求" }, 400);
      if (error instanceof CoreAccessError) throw new HttpException({ code: error.code, message: error.message },
        error.code === "denied" ? 403 : error.code === "core_unavailable" ? 503 : 409);
      // 包括加密与存储错误，不回显输入、SQL参数、仓库详情或第三方错误正文。
      const status = error && typeof error === "object" && "getStatus" in error && typeof error.getStatus === "function"
        ? error.getStatus() : 503;
      throw new HttpException({ code: "source_unavailable", message: "私有来源操作未取得确定结果，请重新读取配置修订" },
        status === 401 || status === 403 ? status : 503);
    }
  }
}
