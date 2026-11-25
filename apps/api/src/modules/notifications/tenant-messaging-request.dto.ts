/** 原 Rental 邀请保留至少一个经营空间，其余消息请求复用公共校验。 */
import type { SaveWorkspaceAccessRequest } from "@rental-os/shared";
import { InviteTenantOperatorDto as PublicInviteTenantOperatorDto } from "@rental-os/platform-server/messaging";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from "class-validator";
import { SaveWorkspaceAccessDto } from "../platform/platform-request.dto";

export class InviteTenantOperatorDto extends PublicInviteTenantOperatorDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SaveWorkspaceAccessDto)
  declare workspaceAccesses: SaveWorkspaceAccessRequest[];
}

export {
  TenantDispatchQueryDto,
  CheckTenantOperatorEmailDto,
  InspectTenantOperatorInvitationDto,
  AcceptTenantOperatorInvitationDto,
  TenantSupportEmailQueryDto
} from "@rental-os/platform-server/messaging";
