/** 显式装配的 CRM HTTP 适配；身份由宿主 Guard/ALS 提供，不注册到通用平台。 */
import { Body, Controller, Get, HttpCode, HttpException, Inject, Module, Param, Post,
  type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import type { CorePrincipal } from "@rental-os/core-contracts";
import { z } from "zod";
import { CrmError } from "./contracts";
import { CRM_HTTP, CRM_HTTP_BASE } from "./http";
import { CrmSettingsService } from "./service";
export interface CrmPrincipalAccessor { current(): CorePrincipal }
export interface CrmHttpApplication { service: CrmSettingsService; principals: CrmPrincipalAccessor }
const principalToken = Symbol("crm.principal"), applicationToken = Symbol("crm.application");
@Controller(CRM_HTTP_BASE)
export class CrmController {
  constructor(@Inject(CrmSettingsService) private readonly service: CrmSettingsService,
    @Inject(principalToken) private readonly principals: CrmPrincipalAccessor) {}
  @Get(CRM_HTTP.settings.path)
  settings() { return this.invoke(who => this.service.read(who)); }
  @Post(CRM_HTTP.updateSettings.path) @HttpCode(200)
  update(@Body() body: unknown) { return this.invoke(who => this.service.update(who, body)); }
  @Get(CRM_HTTP.receipt.path)
  receipt(@Param() params: unknown) {
    return this.invoke(who => this.service.receipt(who, CRM_HTTP.receipt.params.parse(params).operationId));
  }
  private async invoke<T>(work: (principal: CorePrincipal) => Promise<T>): Promise<T> {
    try { return await work(this.principals.current()); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "输入不符合 CRM 接口要求" }, 400);
      if (error instanceof CrmError) throw new HttpException({ code: error.code, message: error.message }, error.code === "denied" ? 403 : 409);
      throw error;
    }
  }
}
@Module({})
export class CrmHttpModule {
  static register(service: CrmSettingsService, principals: CrmPrincipalAccessor): DynamicModule {
    return { module: CrmHttpModule, controllers: [CrmController], providers: [
      { provide: CrmSettingsService, useValue: service }, { provide: principalToken, useValue: principals }
    ] };
  }
  static registerFactory(options: { imports?: ModuleMetadata["imports"] } & Pick<FactoryProvider<CrmHttpApplication>, "inject" | "useFactory">): DynamicModule {
    return { module: CrmHttpModule, imports: options.imports ?? [], controllers: [CrmController], providers: [
      { provide: applicationToken, inject: options.inject ?? [], useFactory: options.useFactory },
      { provide: CrmSettingsService, inject: [applicationToken], useFactory: (app: CrmHttpApplication) => app.service },
      { provide: principalToken, inject: [applicationToken], useFactory: (app: CrmHttpApplication) => app.principals }
    ] };
  }
}
