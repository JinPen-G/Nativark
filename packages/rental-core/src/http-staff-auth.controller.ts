/** 员工认证 HTTP 入口，原会话参加者签发和核验 staff audience。 */
import { Body, Controller, Get, Headers, Inject, Post } from "@nestjs/common";
import type {
  AuthUser, ChangePasswordRequest, LoginRequest, PlatformLoginResponse, PlatformSessionContextResponse, RefreshSessionRequest
} from "@rental-os/platform-contracts";
import { ChangePasswordDto, LoginDto, RefreshSessionDto, SwitchWorkspaceDto } from "@rental-os/platform-server/auth-dto";
import type { BusinessWorkspace, BusinessWorkspaceRunMode, RentalCapability } from "./contracts";

type StaffTenant = PlatformLoginResponse["tenant"] & {
  categoryCode?: string;
  categoryName?: string;
  capabilities?: RentalCapability[];
};

type StaffWorkspaceContext = {
  tenant: StaffTenant;
  workspaces?: BusinessWorkspace[];
  currentWorkspaceId?: string;
};

type StaffLoginResponse = PlatformLoginResponse & StaffWorkspaceContext;
type StaffSessionContext = PlatformSessionContextResponse & StaffWorkspaceContext & {
  locationScope?: AuthUser["locationScope"];
  missingRequiredCapabilities?: RentalCapability[];
  capabilityProductionReady?: boolean;
  workspaceRunMode?: BusinessWorkspaceRunMode;
};

export const RENTAL_STAFF_AUTH_APPLICATION = Symbol("RENTAL_STAFF_AUTH_APPLICATION");

export interface RentalStaffAuthHttpApplication {
  login(body: LoginRequest, audience: "staff"): Promise<StaffLoginResponse>;
  refresh(body: RefreshSessionRequest, audience: "staff"): Promise<StaffLoginResponse>;
  logout(body: RefreshSessionRequest, audience: "staff"): Promise<{ loggedOut: boolean }>;
  getCurrentUser(authorization: string | undefined, audience: "staff"): Promise<AuthUser>;
  getSessionContext(authorization: string | undefined, audience: "staff"): Promise<StaffSessionContext>;
  changePassword(authorization: string | undefined, body: ChangePasswordRequest, audience: "staff"): Promise<StaffLoginResponse>;
  switchWorkspace(authorization: string | undefined, workspaceId: string, audience: "staff"): Promise<StaffLoginResponse>;
}

@Controller("staff/v1/auth")
export class StaffAuthController {
  constructor(@Inject(RENTAL_STAFF_AUTH_APPLICATION) private readonly auth: RentalStaffAuthHttpApplication) {}

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
