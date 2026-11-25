/** 公共Web认证HTTP入口；受控宿主注入唯一认证实例，业务扩展另由Core适配登记。 */
import { Body, Controller, Get, Headers, Inject, Post } from "@nestjs/common";
import type { PlatformLoginResponse, PlatformSessionContextResponse } from "@rental-os/platform-contracts";
import type { AuthSessionService, PlatformAuthAccessContext } from "./auth-session.service";
import { ChangePasswordDto, LoginDto, RefreshSessionDto } from "./auth-session.dto";

export type AuthHttpApplication = Pick<
  AuthSessionService<PlatformLoginResponse, PlatformAuthAccessContext>,
  "login" | "refresh" | "logout" | "getCurrentUser" | "changePassword"
> & {
  getSessionContext(authorization?: string): Promise<PlatformSessionContextResponse>;
};
export const AUTH_HTTP_APPLICATION = Symbol("platform.auth.http");

@Controller("auth")
export class AuthSessionController {
  constructor(@Inject(AUTH_HTTP_APPLICATION) protected readonly authService: AuthHttpApplication) {}

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
    @Body() body: ChangePasswordDto,
  ) {
    return this.authService.changePassword(authorization, body);
  }
}
