/** 公共认证输入，原Rental和无Core宿主共用相同的运行时校验。 */
import type { ChangePasswordRequest, LoginRequest, RefreshSessionRequest } from "@rental-os/platform-contracts";
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

export class SwitchWorkspaceDto {
  @IsString() @IsNotEmpty() workspaceId!: string;
}
