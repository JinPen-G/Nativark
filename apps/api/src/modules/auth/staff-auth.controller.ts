import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { ChangePasswordDto, RefreshSessionDto, SwitchWorkspaceDto } from "./auth-request.dto";
import { LoginDto } from "./auth.controller";

/** Staff access tokens are audience-bound and cannot be used against /api/auth or client APIs. */
@Controller("staff/v1/auth")
export class StaffAuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login") login(@Body() body: LoginDto) { return this.auth.login(body, "staff"); }
  @Post("refresh") refresh(@Body() body: RefreshSessionDto) { return this.auth.refresh(body, "staff"); }
  @Post("logout") logout(@Body() body: RefreshSessionDto) { return this.auth.logout(body, "staff"); }
  @Get("me") me(@Headers("authorization") authorization?: string) { return this.auth.getCurrentUser(authorization, "staff"); }
  @Get("session-context") sessionContext(@Headers("authorization") authorization?: string) { return this.auth.getSessionContext(authorization, "staff"); }
  @Post("change-password") changePassword(@Headers("authorization") authorization: string | undefined, @Body() body: ChangePasswordDto) {
    return this.auth.changePassword(authorization, body, "staff");
  }
  @Post("switch-workspace") switchWorkspace(@Headers("authorization") authorization: string | undefined, @Body() body: SwitchWorkspaceDto) {
    return this.auth.switchWorkspace(authorization, body.workspaceId, "staff");
  }
}
