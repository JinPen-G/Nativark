import type { ChangePasswordRequest, RefreshSessionRequest, SwitchWorkspaceRequest } from "@store-rental/shared";
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
