/** 原工作空间与账号复合授权 DTO；字段、嵌套验证及运行时装饰器由同一实现提供。 */
import type { SaveWorkspaceAccessRequest } from "@rental-os/platform-contracts";
import { BUSINESS_WORKSPACE_RUN_MODES, RENTAL_CATEGORY_CODE_PATTERN,
  type CreateBusinessWorkspaceRequest, type SaveWorkspaceMemberRequest, type UpdateBusinessWorkspaceRequest,
  type SaveSystemUserAccessRequest } from "./contracts";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested } from "class-validator";
const WORKSPACE_STATUSES = ["active", "frozen", "disabled"] as const;
const DATA_SCOPES = ["all", "organization", "store", "own"] as const;
const RUN_MODES = BUSINESS_WORKSPACE_RUN_MODES;


export class CreateBusinessWorkspaceDto implements CreateBusinessWorkspaceRequest {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @Matches(RENTAL_CATEGORY_CODE_PATTERN) categoryCode!: CreateBusinessWorkspaceRequest["categoryCode"];
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) categoryVersionId?: string;
  @IsOptional() @IsIn(RUN_MODES) runMode?: CreateBusinessWorkspaceRequest["runMode"];
}

export class UpdateBusinessWorkspaceDto implements UpdateBusinessWorkspaceRequest {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn(WORKSPACE_STATUSES) status?: UpdateBusinessWorkspaceRequest["status"];
  @IsOptional() @IsIn(RUN_MODES) runMode?: UpdateBusinessWorkspaceRequest["runMode"];
}

export class SaveWorkspaceMemberDto implements SaveWorkspaceMemberRequest {
  @IsString() @IsNotEmpty() userId!: string;
  @IsOptional() @IsString() @IsNotEmpty() roleId?: string;
  @IsOptional() @IsIn(DATA_SCOPES) dataScope?: SaveWorkspaceMemberRequest["dataScope"];
  @IsOptional() @IsObject() locationScope?: SaveWorkspaceMemberRequest["locationScope"];
  @IsOptional() @IsBoolean() isActive?: boolean;
}


export class SaveWorkspaceAccessDto implements SaveWorkspaceAccessRequest {
  @IsString() @IsNotEmpty() workspaceId!: string;
  @IsOptional() @IsString() @IsNotEmpty() roleId?: string;
  @IsOptional() @IsIn(DATA_SCOPES) dataScope?: SaveWorkspaceAccessRequest["dataScope"];
  @IsOptional() @IsObject() locationScope?: SaveWorkspaceAccessRequest["locationScope"];
  @IsBoolean() isActive!: boolean;
}


export class SaveSystemUserAccessDto implements SaveSystemUserAccessRequest {
  @IsOptional() @IsString() @IsNotEmpty() id?: string;
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
  @IsString() @IsNotEmpty() account!: string;
  @IsString() @IsNotEmpty() displayName!: string;
  @IsOptional() @IsString() @IsNotEmpty() phone?: string;
  @IsOptional() @IsString() @IsNotEmpty() organizationId?: string;
  @IsArray() @IsString({ each: true }) roleIds!: string[];
  @IsOptional() @IsBoolean() isPlatformAdmin?: boolean;
  @IsOptional() @IsBoolean() isSaasAdmin?: boolean;
  @IsBoolean() isActive!: boolean;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveWorkspaceAccessDto)
  workspaceAccesses!: SaveWorkspaceAccessRequest[];
}
