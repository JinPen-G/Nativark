/** 公共HTTP输入只消费正式公共合同；Rental带品类/空间的初始化DTO继续由其原入口维护。 */
import { RoleScope, TenantStatus, type CreatePlatformTenantRequest, type SavePlatformSelfProfileRequest,
  type SaveOrganizationRequest, type SaveSystemRoleRequest, type SaveSystemUserRequest, type SystemSecurityBaselineConfig,
  type UpdateTenantRequest, type UpdateTenantStatusRequest, type ResetUserPasswordRequest, type SaveRolePermissionsRequest } from "@rental-os/platform-contracts";
import { IsArray, IsBoolean, IsEnum, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class SaveOrganizationDto implements SaveOrganizationRequest {
  @IsOptional() @IsString() @IsNotEmpty() id?: string;
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsOptional() @IsString() @IsNotEmpty() parentId?: string | null;
  @IsEnum(RoleScope) type!: RoleScope;
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsIn(["enabled", "disabled"]) status!: "enabled" | "disabled";
  @IsOptional() @IsString() @IsNotEmpty() operator?: string;
}

export class OrganizationStatusInputDto {
  @IsIn(["enabled", "disabled"]) status!: "enabled" | "disabled";
  @IsOptional() @IsString() @IsNotEmpty() operator?: string;
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
}

export class SaveSecurityBaselineInputDto {
  @IsObject() config!: SystemSecurityBaselineConfig;
  @IsOptional() @IsString() @IsNotEmpty() operator?: string;
}

export class SecondConfirmationInputDto {
  @IsString() @IsNotEmpty() action!: string;
  @IsOptional() @IsString() @IsNotEmpty() confirmationCode?: string;
}

export class CreatePlatformTenantDto implements CreatePlatformTenantRequest {
  @IsString() @IsNotEmpty() tenantCode!: string;
  @IsString() @IsNotEmpty() tenantName!: string;
  @IsOptional() @IsString() @MaxLength(64) operatorShortName?: string | null;
  @IsString() @IsNotEmpty() adminAccount!: string;
  @IsString() @IsNotEmpty() adminDisplayName!: string;
  @IsOptional() @IsString() adminPhone?: string;
}

export class UpdatePlatformTenantDto implements UpdateTenantRequest {
  @IsString() @IsNotEmpty() tenantName!: string;
  @IsOptional() @IsString() @MaxLength(64) operatorShortName?: string | null;
}

export class PlatformTenantStatusDto implements UpdateTenantStatusRequest {
  @IsEnum(TenantStatus) status!: TenantStatus;
  @IsString() @IsNotEmpty() reason!: string;
}

export class SavePlatformRoleDto implements SaveSystemRoleRequest {
  @IsOptional() @IsString() @IsNotEmpty() id?: string;
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(RoleScope) scope!: RoleScope;
  @IsArray() @IsString({ each: true }) enabledBusinessScopes!: string[];
  @IsArray() @IsString({ each: true }) permissions!: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) buttonPermissions?: string[];
  @IsOptional() @IsIn(["all", "organization", "store", "own"]) dataScope?: SaveSystemRoleRequest["dataScope"];
  @IsBoolean() isActive!: boolean;
}

export class SavePlatformUserDto implements SaveSystemUserRequest {
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
}

export class PlatformUserStatusDto implements Pick<SaveSystemUserRequest, "isActive"> {
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
}

export class PlatformUserPasswordResetDto implements ResetUserPasswordRequest {
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
}

export class PlatformRolePermissionsDto implements SaveRolePermissionsRequest {
  @IsOptional() @IsArray() @IsString({ each: true }) permissions?: string[];
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
}

export class SavePlatformSelfProfileDto implements SavePlatformSelfProfileRequest {
  @IsString() @IsNotEmpty() displayName!: string;
  @IsOptional() @IsString() phone?: string;
}
