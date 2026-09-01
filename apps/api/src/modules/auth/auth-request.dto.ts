import type { ChangePasswordRequest, RefreshSessionRequest, ResetLocalDemoPasswordRequest, SwitchWorkspaceRequest } from "@store-rental/shared";
import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class RefreshSessionDto implements RefreshSessionRequest {
  @IsString() @IsNotEmpty() refreshToken!: string;
}

export class SwitchWorkspaceDto implements SwitchWorkspaceRequest {
  @IsString() @IsNotEmpty() workspaceId!: string;
}

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString() @IsNotEmpty() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

/** 仅本机开发环境使用；密码只在本次请求中传输并立即哈希，不返回、不记录。 */
export class ResetLocalDemoPasswordDto implements ResetLocalDemoPasswordRequest {
  @IsString() @MinLength(8) password!: string;
}
