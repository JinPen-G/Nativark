/**
 * 条目的Nest HTTP适配；宿主原Guard/ALS提供当前主体，输入仍由本Core唯一schema解析。
 * 模块不会绕过原全局Guard、自动授权或装配进主应用；未知路由继续默认拒绝。
 */
import { Body, Controller, Get, HttpCode, HttpException, Inject, Module, Param, Post, Query, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import type { CorePrincipal } from "@rental-os/core-contracts";
import { z } from "zod";
import { ItemError } from "./contracts";
import { HTTP, HTTP_BASE } from "./http";
import { ItemService } from "./service";

export interface ItemsPrincipalAccessor { current(): CorePrincipal }
const principalToken = Symbol("{{CORE_ID}}.current-principal");
const itemsHttpApplicationToken = Symbol("{{CORE_ID}}.http-application");
export interface ItemsHttpApplication { service: ItemService; principals: ItemsPrincipalAccessor }
const queryNumber = (value: unknown) => typeof value === "string" && /^\d+$(?![\s\S])/.test(value) ? Number(value) : value;
const listInput = (query: Record<string, unknown>) => ({ ...query,
  ...(query.offset !== undefined ? { offset: queryNumber(query.offset) } : {}),
  ...(query.limit !== undefined ? { limit: queryNumber(query.limit) } : {}) });

@Controller(HTTP_BASE)
export class ItemsController {
  constructor(@Inject(ItemService) private readonly service: ItemService,
    @Inject(principalToken) private readonly principal: ItemsPrincipalAccessor) {}

  @Get(HTTP.list.path)
  list(@Query() query: Record<string, unknown>) {
    return this.invoke(who => this.service.list(who, listInput(query)));
  }

  @Get(HTTP.get.path)
  get(@Param() params: unknown) {
    return this.invoke(who => this.service.get(who, HTTP.get.params.parse(params).itemId));
  }

  @Get(HTTP.receipt.path)
  receipt(@Param() params: unknown) {
    return this.invoke(who => this.service.receipt(who, HTTP.receipt.params.parse(params).operationId));
  }

  @Post(HTTP.create.path) @HttpCode(200)
  create(@Body() body: unknown) {
    return this.invoke(who => this.service.create(who, HTTP.create.body.parse(body)));
  }

  @Post(HTTP.update.path) @HttpCode(200)
  update(@Param() params: unknown, @Body() body: unknown) {
    return this.invoke(who => this.service.update(who, { ...HTTP.update.params.parse(params), ...HTTP.update.body.parse(body) }));
  }

  @Post(HTTP.archive.path) @HttpCode(200)
  archive(@Param() params: unknown, @Body() body: unknown) {
    return this.invoke(who => this.service.archive(who, { ...HTTP.archive.params.parse(params), ...HTTP.archive.body.parse(body) }));
  }

  private async invoke<T>(work: (principal: CorePrincipal) => Promise<T>): Promise<T> {
    try { return await work(this.principal.current()); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "输入不符合条目接口要求" }, 400);
      if (error instanceof ItemError) {
        const status = error.code === "denied" ? 403 : error.code === "not_found" ? 404 : 409;
        throw new HttpException({ code: error.code, message: error.message }, status);
      }
      throw error;
    }
  }
}

@Module({})
export class ItemsHttpModule {
  static register(service: ItemService, principal: ItemsPrincipalAccessor): DynamicModule {
    return { module: ItemsHttpModule, controllers: [ItemsController], providers: [
      { provide: ItemService, useValue: service }, { provide: principalToken, useValue: principal }
    ] };
  }

  /** 主宿主从导出的依赖创建同一个业务实例，子模块不重建数据库或公共Auth。 */
  static registerFactory(options: { imports?: ModuleMetadata["imports"] } & Pick<FactoryProvider<ItemsHttpApplication>, "inject" | "useFactory">): DynamicModule {
    return { module: ItemsHttpModule, imports: options.imports ?? [], controllers: [ItemsController], providers: [
      { provide: itemsHttpApplicationToken, inject: options.inject ?? [], useFactory: options.useFactory },
      { provide: ItemService, inject: [itemsHttpApplicationToken], useFactory: (application: ItemsHttpApplication) => application.service },
      { provide: principalToken, inject: [itemsHttpApplicationToken], useFactory: (application: ItemsHttpApplication) => application.principals }
    ] };
  }
}
