/** 公共认证输入，原Rental和无Core宿主共用相同的运行时校验。 */
import type { ChangePasswordRequest, LegacySwitchWorkspaceRequest, LoginRequest, RefreshSessionRequest } from "@rental-os/platform-contracts";
import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class LoginDto implements LoginRequest {
  @IsString() @IsNotEmpty() tenantCode!: string;
  @IsString() @IsNotEmpty() account!: string;
  @IsString() @IsNotEmpty() password!: string;
}

export class RefreshSessionDto implements RefreshSessionRequest {
  @IsString() @IsNotEmpty() refreshToken!: string;
}

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString() @IsNotEmpty() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

/** 历史 Rental 控制器使用；公共 AuthSessionController 不挂载此操作。 */
export class SwitchWorkspaceDto implements LegacySwitchWorkspaceRequest {
  @IsString() @IsNotEmpty() workspaceId!: string;
}
