/** 原签名operator会话的自助Core目录；公共Guard须明确登记，空Core不会开放通用工具。 */
import { Controller, Get, Inject, Module, type DynamicModule } from "@nestjs/common";
import { CORE_SESSION_HTTP, type CoreSessionContext } from "@rental-os/core-contracts";

export const CORE_SESSION_READER = Symbol("platform.core-session.reader");
@Controller()
export class CoreSessionController {
  constructor(@Inject(CORE_SESSION_READER) private readonly readContext: () => Promise<CoreSessionContext>) {}
  @Get(CORE_SESSION_HTTP.path)
  context() { return this.readContext(); }
}

@Module({})
export class CoreSessionHttpModule {
  static register(readContext: () => Promise<CoreSessionContext>): DynamicModule {
    return { module: CoreSessionHttpModule, controllers: [CoreSessionController], providers: [{ provide: CORE_SESSION_READER, useValue: readContext }] };
  }
}
