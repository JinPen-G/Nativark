/** 原签名operator会话的自助Core目录；公共Guard须明确登记，空Core不会开放通用工具。 */
import { Controller, Get, Inject, Module, type DynamicModule } from "@nestjs/common";
import { CORE_SESSION_HTTP, type CoreSessionContext } from "@rental-os/core-contracts";

const readerToken = Symbol("platform.core-session.reader");
@Controller()
export class CoreSessionController {
  constructor(@Inject(readerToken) private readonly readContext: () => Promise<CoreSessionContext>) {}
  @Get(CORE_SESSION_HTTP.path)
  context() { return this.readContext(); }
}

@Module({})
export class CoreSessionHttpModule {
  static register(readContext: () => Promise<CoreSessionContext>): DynamicModule {
    return { module: CoreSessionHttpModule, controllers: [CoreSessionController], providers: [{ provide: readerToken, useValue: readContext }] };
  }
}
