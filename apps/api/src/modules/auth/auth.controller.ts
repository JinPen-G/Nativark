import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import type { ChangePasswordRequest, RefreshSessionRequest, SwitchWorkspaceRequest } from "@store-rental/shared";
import { IsNotEmpty, IsString } from "class-validator";
import { AuthService } from "./auth.service";
import { ChangePasswordDto, RefreshSessionDto, ResetLocalDemoPasswordDto, SwitchWorkspaceDto } from "./auth-request.dto";

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

  /**
   * 本机开发登录页的兜底入口：让非技术使用者自行设置演示账号密码，
   * 不把任何可登录密码写进源码、构建产物或响应。
   */
  @Post("development/reset-demo-password")
  resetLocalDemoPassword(@Body() body: ResetLocalDemoPasswordDto) {
    return this.authService.resetLocalDemoPassword(body.password);
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
  refresh(@Body() body: RefreshSessionDto) {
    return this.authService.refresh(body);
  }

  @Post("logout")
  logout(@Body() body: RefreshSessionDto) {
    return this.authService.logout(body);
  }

  @Post("change-password")
  changePassword(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: ChangePasswordDto
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
    @Body() body: SwitchWorkspaceDto
  ) {
    return this.authService.switchWorkspace(authorization, body.workspaceId);
  }
}
