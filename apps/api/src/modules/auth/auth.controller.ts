import { Body, Controller, Headers, Inject, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthSessionController } from "./auth-session.controller";
import { RentalAuthExtensionsController, ResetLocalDemoPasswordDto } from "@rental-os/rental-core/http-auth-extensions";
import { SwitchWorkspaceDto } from "./auth-session.dto";
export { LoginDto } from "./auth-session.dto";

/** Rental组合的认证扩展；公共HTTP方法继承唯一实现，不重复登记两套Controller。 */
@Controller("auth")
export class AuthController extends AuthSessionController {
  private readonly extensions: RentalAuthExtensionsController;

  constructor(@Inject(AuthService) protected readonly authService: AuthService) {
    super(authService);
    this.extensions = new RentalAuthExtensionsController(authService);
  }

  /** Explicit development maintenance with current platform authentication. */
  @Post("development/reset-demo-password")
  resetLocalDemoPassword(@Body() body: ResetLocalDemoPasswordDto, @Headers("authorization") authorization?: string) {
    return this.extensions.resetLocalDemoPassword(body, authorization);
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
    return this.extensions.switchWorkspace(authorization, body);
  }
}
