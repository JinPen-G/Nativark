/** Rental 操作员认证扩展，复用宿主的同一原认证实例。
 * 只承接空间切换与开发维护；会话范围、audience 和密码重置权限仍由原服务核定。 */
import { Body, Controller, Headers, Inject, Post } from "@nestjs/common";
import type { ResetLocalDemoPasswordRequest } from "@rental-os/platform-contracts";
import { SwitchWorkspaceDto } from "@rental-os/platform-server/auth-dto";
import { IsString, MinLength } from "class-validator";
import type { RentalAuthService } from "./auth-service";

export const RENTAL_AUTH_EXTENSIONS_APPLICATION = Symbol("RENTAL_AUTH_EXTENSIONS_APPLICATION");
export type RentalAuthExtensionsHttpApplication = Pick<RentalAuthService, "switchWorkspace" | "resetLocalDemoPassword">;

/** 仅本机开发环境使用；密码只在本次请求中传输并立即哈希，不返回、不记录。 */
export class ResetLocalDemoPasswordDto implements ResetLocalDemoPasswordRequest {
  @IsString() @MinLength(8) password!: string;
}

@Controller("auth")
export class RentalAuthExtensionsController {
  constructor(@Inject(RENTAL_AUTH_EXTENSIONS_APPLICATION) private readonly authService: RentalAuthExtensionsHttpApplication) {}

  /** Explicit development maintenance with current platform authentication. */
  @Post("development/reset-demo-password")
  resetLocalDemoPassword(@Body() body: ResetLocalDemoPasswordDto, @Headers("authorization") authorization?: string) {
    return this.authService.resetLocalDemoPassword(body.password, authorization);
  }

  /**
   * SPACE-02：切换当前经营空间。
   *
   * 只接受 workspaceId，其余会话范围（租户、账号）一律从令牌与会话推导——
   * 客户端不能通过请求体覆盖会话范围。切换成功后返回新的访问令牌；
   * refreshToken 不变（会话本身没换），因此响应里为空串。
   */
  @Post("switch-workspace")
  switchWorkspace(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: SwitchWorkspaceDto
  ) {
    return this.authService.switchWorkspace(authorization, body.workspaceId);
  }
}
