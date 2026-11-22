import {
  RENTAL_CURRENCY_CODES,
  RentalCategoryCode,
  RENTAL_CATEGORY_CODE_PATTERN,
  RoleScope,
  type RentalCurrency,
  type SavePlatformFilterPresetRequest,
  type SystemRulesConfig,
  type SaveSystemUserAccessRequest,
  type SaveWorkspaceAccessRequest,
  type TenantBootstrapRequest
} from "@rental-os/shared";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
// 公共账号/角色/租户字段由平台包单源维护，行业初始化和业务字段继续保留在本适配。
export { UpdatePlatformTenantDto as UpdateTenantDto, PlatformTenantStatusDto as UpdateTenantStatusDto,
  SavePlatformRoleDto as SaveSystemRoleDto, SavePlatformUserDto as SaveSystemUserDto,
  SaveOrganizationDto, OrganizationStatusInputDto, SaveSecurityBaselineInputDto,
  SecondConfirmationInputDto } from "@rental-os/platform-server/management-dto";

const DATA_SCOPES = ["all", "organization", "store", "own"] as const;
const DICTIONARY_DATE_PATTERNS = ["yyyyMMdd", "yyyyMM", "yyMMdd", "none"] as const;
const RESET_CYCLES = ["daily", "monthly", "yearly", "never"] as const;

export class SaveSystemRuleSectionBodyInputDto {
  @IsObject() config!: SystemRulesConfig;
  @IsString() @IsNotEmpty() operator!: string;
}

export class OperatorInputDto {
  @IsOptional() @IsString() @IsNotEmpty() operator?: string;
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

export class TenantBootstrapDto implements TenantBootstrapRequest {
  @IsString() @IsNotEmpty() tenantCode!: string;
  @IsString() @IsNotEmpty() tenantName!: string;
  @IsOptional() @IsString() @MaxLength(64) operatorShortName?: string | null;
  @IsString() @Matches(RENTAL_CATEGORY_CODE_PATTERN) categoryCode!: RentalCategoryCode;
  @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(191) categoryVersionId?: string;
  // 结算币种（需求 §948）。只收登记过的两位小数币种；省略按人民币。
  @IsOptional() @IsIn(RENTAL_CURRENCY_CODES) currency?: RentalCurrency;
  // 兼容既有 API：省略时由 PlatformService 写入默认操作人；传入则必须是非空字符串。
  @IsOptional() @IsString() @IsNotEmpty() operator?: string;
  @IsString() @IsNotEmpty() adminAccount!: string;
  @IsString() @IsNotEmpty() adminDisplayName!: string;
  @IsOptional() @IsString() @IsNotEmpty() adminPhone?: string;
  @IsOptional() @IsString() @IsNotEmpty() storeName?: string;
  @IsOptional() @IsString() @IsNotEmpty() storeCode?: string;
}
export class SaveRolePermissionsInputDto {
  @IsOptional() @IsArray() @IsString({ each: true }) permissions?: string[];
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
}

export class SetUserStatusInputDto {
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
}

export class ResetUserPasswordInputDto {
  @IsOptional() @IsString() @IsNotEmpty() tenantId?: string;
}

export { SavePlatformDictionaryBodyInputDto, PlatformDictionaryItemInputDto, SavePlatformNumberRuleBodyInputDto, GeneratePlatformNumberDto } from "@rental-os/platform-server/tools-dto";

export { SaveWorkspaceAccessDto, SaveSystemUserAccessDto, RentalCategoryOpeningOptionsQueryDto } from "@rental-os/rental-core/http-workspace-management-dto";
