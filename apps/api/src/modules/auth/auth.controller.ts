import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import type { ChangePasswordRequest, RefreshSessionRequest, SwitchWorkspaceRequest } from "@store-rental/shared";
import { IsNotEmpty, IsString } from "class-validator";
import { AuthService } from "./auth.service";

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  tenantCode!: string;

  @IsString()
  @IsNotEmpty()
  account!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.getCurrentUser(authorization);
  }

  @Get("session-context")
  sessionContext(@Headers("authorization") authorization?: string) {
    return this.authService.getSessionContext(authorization);
  }

  @Post("refresh")
  refresh(@Body() body: RefreshSessionRequest) {
    return this.authService.refresh(body);
  }

  @Post("logout")
  logout(@Body() body: RefreshSessionRequest) {
    return this.authService.logout(body);
  }

  @Post("change-password")
  changePassword(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: ChangePasswordRequest
  ) {
    return this.authService.changePassword(authorization, body);
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
    @Body() body: SwitchWorkspaceRequest
  ) {
    return this.authService.switchWorkspace(authorization, body.workspaceId);
  }
}
