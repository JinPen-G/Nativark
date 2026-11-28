/** 有界部署入口沿原 SaaS Guard；宿主未装配可信执行器时明确 unavailable。 */
import { Body, Controller, HttpCode, HttpException, Inject, Post, Header } from "@nestjs/common";
import { z } from "zod";
import { CoreAccessError } from "@rental-os/core-host";
import type { RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { CORE_PACKAGE_HTTP_BASE } from "../core-package-ports";
import { createPlatformCorePackageHttpAccess } from "../core-package-http";
import type { CorePackageDeploymentApplication } from "./deployment-ports";
import { CORE_PACKAGE_DEPLOYMENT_HTTP } from "./deployment-protocol";

export const CORE_PACKAGE_DEPLOYMENT_APPLICATION = Symbol("platform.core-packages.deployment");
export function createCorePackageDeploymentHttpAccess(): RegisteredCoreHttpAccess {
  const management = createPlatformCorePackageHttpAccess();
  const matches = (method: string, path: string) => Object.values(CORE_PACKAGE_DEPLOYMENT_HTTP).some(route =>
    route.method === method.toUpperCase() && path === `/${CORE_PACKAGE_HTTP_BASE}/${route.path}`);
  return { registered: (method, path, audience) => audience === "operator" && matches(method, path),
    async authorize(method, path) {
      if (!matches(method, path)) throw new CoreAccessError("denied", "部署路径或方法未登记");
      await management.authorize("GET", `/${CORE_PACKAGE_HTTP_BASE}/catalogue`);
    } };
}
@Controller(CORE_PACKAGE_HTTP_BASE)
export class CorePackageDeploymentController {
  constructor(@Inject(CORE_PACKAGE_DEPLOYMENT_APPLICATION) private readonly application: CorePackageDeploymentApplication) {}
  @Post(CORE_PACKAGE_DEPLOYMENT_HTTP.dispatch.path) @HttpCode(200) @Header("Cache-Control", "no-store")
  dispatch(@Body() value: unknown) { return this.respond(() => this.application.dispatch(value)); }
  @Post(CORE_PACKAGE_DEPLOYMENT_HTTP.receipt.path) @HttpCode(200) @Header("Cache-Control", "no-store")
  receipt(@Body() value: unknown) { return this.respond(() => this.application.receipt(value)); }
  private async respond<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "部署请求须携带原候选、批准及派发 ID" }, 400);
      if (error instanceof CoreAccessError) throw new HttpException({ code: error.code,
        message: "当前部署权限、批准或候选状态不允许继续，请核对原派发 ID" },
        error.code === "denied" ? 403 : error.code === "core_unavailable" ? 503 : 409);
      throw new HttpException({ code: "deployment_unavailable", message: "部署未取得确定结果，请按原候选和派发 ID 核对" }, 503);
    }
  }
}
