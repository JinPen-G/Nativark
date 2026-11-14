/**
 * 工单的Nest HTTP适配；宿主原Guard/ALS提供当前主体，输入仍由本Core唯一schema解析。
 * 模块不会绕过原全局Guard、自动授权或装配进主应用；未知路由继续默认拒绝。
 */
import { Body, Controller, Get, HttpCode, HttpException, Inject, Module, Param, Post, Query, type DynamicModule } from "@nestjs/common";
import type { CorePrincipal } from "@rental-os/core-contracts";
import { z } from "zod";
import { TicketError } from "./contracts";
import { TICKETS_HTTP, TICKETS_HTTP_BASE } from "./http";
import { TicketsService } from "./service";

export interface TicketsPrincipalAccessor { current(): CorePrincipal }
const principalToken = Symbol("example-tickets.current-principal");
const queryNumber = (value: unknown) => typeof value === "string" && /^\d+$(?![\s\S])/.test(value) ? Number(value) : value;

@Controller(TICKETS_HTTP_BASE)
export class TicketsController {
  constructor(@Inject(TicketsService) private readonly service: TicketsService,
    @Inject(principalToken) private readonly principal: TicketsPrincipalAccessor) {}

  @Get(TICKETS_HTTP.list.path)
  list(@Query() query: Record<string, unknown>) {
    return this.invoke(who => this.service.list(who, { ...query,
      ...(query.offset !== undefined ? { offset: queryNumber(query.offset) } : {}),
      ...(query.limit !== undefined ? { limit: queryNumber(query.limit) } : {}) }));
  }

  @Get(TICKETS_HTTP.get.path)
  get(@Param() params: unknown) {
    return this.invoke(who => this.service.get(who, TICKETS_HTTP.get.params.parse(params).ticketId));
  }

  @Get(TICKETS_HTTP.receipt.path)
  receipt(@Param() params: unknown) {
    return this.invoke(who => this.service.receipt(who, TICKETS_HTTP.receipt.params.parse(params).operationId));
  }

  @Post(TICKETS_HTTP.create.path) @HttpCode(200)
  create(@Body() body: unknown) {
    return this.invoke(who => this.service.create(who, TICKETS_HTTP.create.body.parse(body)));
  }

  @Post(TICKETS_HTTP.assign.path) @HttpCode(200)
  assign(@Param() params: unknown, @Body() body: unknown) {
    return this.invoke(who => this.service.assign(who, { ...TICKETS_HTTP.assign.params.parse(params), ...TICKETS_HTTP.assign.body.parse(body) }));
  }

  @Post(TICKETS_HTTP.start.path) @HttpCode(200)
  start(@Param() params: unknown, @Body() body: unknown) {
    return this.invoke(who => this.service.start(who, { ...TICKETS_HTTP.start.params.parse(params), ...TICKETS_HTTP.start.body.parse(body) }));
  }

  @Post(TICKETS_HTTP.close.path) @HttpCode(200)
  close(@Param() params: unknown, @Body() body: unknown) {
    return this.invoke(who => this.service.close(who, { ...TICKETS_HTTP.close.params.parse(params), ...TICKETS_HTTP.close.body.parse(body) }));
  }

  private async invoke<T>(work: (principal: CorePrincipal) => Promise<T>): Promise<T> {
    try { return await work(this.principal.current()); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "输入不符合工单接口要求" }, 400);
      if (error instanceof TicketError) {
        const status = error.code === "denied" ? 403 : error.code === "not_found" ? 404 : 409;
        throw new HttpException({ code: error.code, message: error.message }, status);
      }
      throw error;
    }
  }
}

@Module({})
export class TicketsHttpModule {
  static register(service: TicketsService, principal: TicketsPrincipalAccessor): DynamicModule {
    return { module: TicketsHttpModule, controllers: [TicketsController], providers: [
      { provide: TicketsService, useValue: service }, { provide: principalToken, useValue: principal }
    ] };
  }
}
