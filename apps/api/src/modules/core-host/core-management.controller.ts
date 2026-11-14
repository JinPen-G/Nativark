/**
 * Core管理正式HTTP消费独立应用服务，原Guard负责签名身份/路由准入，各服务复核当前权限。
 * 模块由受控AppModule组合登记，路径和接口资料复用同一公共合同。
 */
import { Body, Controller, Get, HttpCode, HttpException, Inject, Module, Post, type DynamicModule } from "@nestjs/common";
import { CORE_MANAGEMENT_HTTP, CORE_MANAGEMENT_HTTP_BASE } from "@rental-os/core-contracts";
import { CoreAccessError } from "@rental-os/core-host";
import { z } from "zod";
import type { composeOriginalCoreBindings } from "./original-core-bindings";
import type { composeOriginalCoreManagement } from "./original-core-management";

export interface CoreManagementHttpApplication {
  management: ReturnType<typeof composeOriginalCoreManagement>;
  bindings: ReturnType<typeof composeOriginalCoreBindings>;
  registered(): Promise<z.infer<typeof CORE_MANAGEMENT_HTTP.registered.response>>;
  reads: {
    tenantGrant(input: unknown): Promise<z.infer<typeof CORE_MANAGEMENT_HTTP.readTenantGrant.response>>;
    memberAssignment(input: unknown): Promise<z.infer<typeof CORE_MANAGEMENT_HTTP.readMemberAssignment.response>>;
    binding(input: unknown): Promise<z.infer<typeof CORE_MANAGEMENT_HTTP.readBinding.response>>;
  };
}
const applicationToken = Symbol("platform.core-management.http");

@Controller(CORE_MANAGEMENT_HTTP_BASE)
export class CoreManagementController {
  constructor(@Inject(applicationToken) private readonly application: CoreManagementHttpApplication) {}

  @Get(CORE_MANAGEMENT_HTTP.registered.path)
  registered() {
    return this.respond(() => this.application.registered());
  }

  @Post(CORE_MANAGEMENT_HTTP.tenantGrant.path) @HttpCode(200)
  tenantGrant(@Body() body: unknown) {
    return this.respond(() => this.application.management.service.changeTenantGrant(this.application.management.principals.current(), body));
  }

  @Post(CORE_MANAGEMENT_HTTP.memberAssignment.path) @HttpCode(200)
  memberAssignment(@Body() body: unknown) {
    return this.respond(() => this.application.management.service.changeMemberAssignment(this.application.management.principals.current(), body));
  }

  @Post(CORE_MANAGEMENT_HTTP.bind.path) @HttpCode(200)
  bind(@Body() body: unknown) {
    return this.respond(() => this.application.bindings.service.bind(this.application.bindings.principals.current(), body));
  }

  @Post(CORE_MANAGEMENT_HTTP.bindingOperation.path) @HttpCode(200)
  bindingOperation(@Body() body: unknown) {
    return this.respond(() => this.application.bindings.service.readOperation(this.application.bindings.principals.current(), body));
  }

  @Post(CORE_MANAGEMENT_HTTP.readTenantGrant.path) @HttpCode(200)
  readTenantGrant(@Body() body: unknown) {
    return this.respond(() => this.application.reads.tenantGrant(body));
  }

  @Post(CORE_MANAGEMENT_HTTP.readMemberAssignment.path) @HttpCode(200)
  readMemberAssignment(@Body() body: unknown) {
    return this.respond(() => this.application.reads.memberAssignment(body));
  }

  @Post(CORE_MANAGEMENT_HTTP.readBinding.path) @HttpCode(200)
  readBinding(@Body() body: unknown) {
    return this.respond(() => this.application.reads.binding(body));
  }

  private async respond<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpException({ code: "input_invalid", message: "输入不符合Core管理要求" }, 400);
      if (error instanceof CoreAccessError) {
        const status = error.code === "denied" ? 403 : error.code === "core_unavailable" ? 503 : 409;
        throw new HttpException({ code: error.code, message: error.message }, status);
      }
      throw error;
    }
  }
}

@Module({})
export class CoreManagementHttpModule {
  static register(application: CoreManagementHttpApplication): DynamicModule {
    return { module: CoreManagementHttpModule, controllers: [CoreManagementController],
      providers: [{ provide: applicationToken, useValue: application }] };
  }
}
