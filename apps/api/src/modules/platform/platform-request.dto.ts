import {
  RentalCategoryCode,
  RoleScope,
  TenantStatus,
  type GeneratePlatformNumberRequest,
  type PlatformDictionaryItem,
  type SaveOrganizationRequest,
  type SavePlatformFilterPresetRequest,
  type SaveSystemRoleRequest,
  type SystemRulesConfig,
  type SystemSecurityBaselineConfig,
  type SaveSystemUserRequest,
  type TenantBootstrapRequest,
  type UpdateTenantRequest,
  type UpdateTenantStatusRequest
} from "@store-rental/shared";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min, ValidateNested } from "class-validator";

const DATA_SCOPES = ["all", "organization", "store", "own"] as const;
const DICTIONARY_DATE_PATTERNS = ["yyyyMMdd", "yyyyMM", "yyMMdd", "none"] as const;
const RESET_CYCLES = ["daily", "monthly", "yearly", "never"] as const;

export class UpdateTenantDto implements UpdateTenantRequest {
  @IsString() @IsNotEmpty() tenantName!: string;
}

export class UpdateTenantStatusDto implements UpdateTenantStatusRequest {
  @IsEnum(TenantStatus) status!: TenantStatus;
  @IsString() @IsNotEmpty() reason!: string;
}

export class SaveOrganizationDto implements SaveOrganizationRequest {
  @IsOptional() @IsString() @IsNotEmpty() id?: string;
  @IsString() @IsNotEmpty() tenantId!: string;
  @IsOptional() @IsString() @IsNotEmpty() parentId?: string;
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

export class SaveSystemRuleSectionBodyInputDto {
  @IsObject() config!: SystemRulesConfig;
  @IsString() @IsNotEmpty() operator!: string;
}

export class OperatorInputDto {
  @IsOptional() @IsString() @IsNotEmpty() operator?: string;
}

export class SaveSecurityBaselineInputDto {
  @IsObject() config!: SystemSecurityBaselineConfig;
  @IsOptional() @IsString() @IsNotEmpty() operator?: string;
}

export class SecondConfirmationInputDto {
  @IsString() @IsNotEmpty() action!: string;
  @IsOptional() @IsString() @IsNotEmpty() confirmationCode?: string;
}

export class SavePlatformFilterPresetDto implements SavePlatformFilterPresetRequest {
  @IsOptional() @IsString() @IsNotEmpty() id?: string;
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
  @IsString() @IsNotEmpty() scopeKey!: SavePlatformFilterPresetRequest["scopeKey"];
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsObject() filters!: Record<string, unknown>;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() operator?: string;
}

export class SavePlatformDictionaryBodyInputDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() module!: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PlatformDictionaryItemInputDto) items!: PlatformDictionaryItemInputDto[];
  @IsString() @IsNotEmpty() operator!: string;
}

export class PlatformDictionaryItemInputDto implements PlatformDictionaryItem {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() label!: string;
  @IsString() value!: string;
  @IsInt() sortNo!: number;
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() remark?: string;
}

export class SavePlatformNumberRuleBodyInputDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() module!: string;
  @IsString() prefix!: string;
  @IsIn(DICTIONARY_DATE_PATTERNS) datePattern!: "yyyyMMdd" | "yyyyMM" | "yyMMdd" | "none";
  @IsInt() @Min(1) sequenceLength!: number;
  @IsOptional() @IsInt() @Min(0) currentSequence?: number;
  @IsIn(RESET_CYCLES) resetCycle!: "daily" | "monthly" | "yearly" | "never";
  @IsBoolean() enabled!: boolean;
  @IsString() @IsNotEmpty() operator!: string;
}

export class GeneratePlatformNumberDto implements GeneratePlatformNumberRequest {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() operator!: string;
}

export class TenantBootstrapDto implements TenantBootstrapRequest {
  @IsString() @IsNotEmpty() tenantCode!: string;
  @IsString() @IsNotEmpty() tenantName!: string;
  @IsEnum(RentalCategoryCode) categoryCode!: RentalCategoryCode;
  // 兼容既有 API：省略时由 PlatformService 写入默认操作人；传入则必须是非空字符串。
  @IsOptional() @IsString() @IsNotEmpty() operator?: string;
  @IsString() @IsNotEmpty() adminAccount!: string;
  @IsString() @IsNotEmpty() adminDisplayName!: string;
  @IsOptional() @IsString() @IsNotEmpty() adminPhone?: string;
  @IsOptional() @IsString() @IsNotEmpty() storeName?: string;
  @IsOptional() @IsString() @IsNotEmpty() storeCode?: string;
}

export class SaveSystemRoleDto implements SaveSystemRoleRequest {
  @IsOptional() @IsString() @IsNotEmpty() id?: string;
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(RoleScope) scope!: RoleScope;
  @IsArray() @IsString({ each: true }) enabledBusinessScopes!: string[];
  @IsArray() @IsString({ each: true }) permissions!: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) buttonPermissions?: string[];
  @IsOptional() @IsIn(DATA_SCOPES) dataScope?: SaveSystemRoleRequest["dataScope"];
  @IsBoolean() isActive!: boolean;
}

export class SaveRolePermissionsInputDto {
  @IsOptional() @IsArray() @IsString({ each: true }) permissions?: string[];
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
}

export class SaveSystemUserDto implements SaveSystemUserRequest {
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

export class SetUserStatusInputDto {
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
}

export class ResetUserPasswordInputDto {
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
}
