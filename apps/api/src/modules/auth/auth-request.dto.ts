import type { ResetLocalDemoPasswordRequest } from "@rental-os/shared";
import { IsString, MinLength } from "class-validator";
export { LoginDto, RefreshSessionDto, ChangePasswordDto, SwitchWorkspaceDto } from "./auth-session.dto";

/** 仅本机开发环境使用；密码只在本次请求中传输并立即哈希，不返回、不记录。 */
export class ResetLocalDemoPasswordDto implements ResetLocalDemoPasswordRequest {
  @IsString() @MinLength(8) password!: string;
}
