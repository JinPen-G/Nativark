/** 当前成员的Core范围只读入口；原Guard显式准入，真实范围和就绪由原组合及Core提供。 */
import { Body, Controller, HttpCode, HttpException, Inject, Module, Post, type DynamicModule } from "@nestjs/common";
import { CORE_SCOPE_HTTP, type CoreScopeObservation } from "@rental-os/core-contracts";
import { CoreAccessError } from "@rental-os/core-host";
import { z } from "zod";

export const CORE_SCOPE_READER = Symbol("platform.core-scope.reader");
@Controller()
export class CoreScopeController {
  constructor(@Inject(CORE_SCOPE_READER) private readonly readScope: (value: unknown) => Promise<CoreScopeObservation>) {}
  @Post(CORE_SCOPE_HTTP.path) @HttpCode(200)
  async read(@Body() body: unknown) {
    try { return await this.readScope(body); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "Core范围读取不符合正式合同" }, 400);
      if (error instanceof CoreAccessError) throw new HttpException({ code: error.code, message: error.message },
        error.code === "denied" ? 403 : error.code === "core_unavailable" ? 503 : 409);
      throw error;
    }
  }
}
@Module({})
export class CoreScopeHttpModule {
  static register(readScope: (value: unknown) => Promise<CoreScopeObservation>): DynamicModule {
    return { module: CoreScopeHttpModule, controllers: [CoreScopeController], providers: [{ provide: CORE_SCOPE_READER, useValue: readScope }] };
  }
}
