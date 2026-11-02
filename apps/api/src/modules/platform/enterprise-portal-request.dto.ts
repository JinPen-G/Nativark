import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, MaxLength, Min, ValidateNested } from "class-validator";
import { ENTERPRISE_PORTAL_ACTIONS, type EnterprisePortalGrant, type SaveEnterprisePortalConfigurationRequest, type SaveEnterpriseTenantSettingsRequest } from "@rental-os/shared";

export class SaveEnterpriseTenantSettingsDto implements SaveEnterpriseTenantSettingsRequest {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
export class EnterprisePortalGrantDto implements EnterprisePortalGrant {
  @IsString() @IsNotEmpty() @MaxLength(191) membershipId!: string;
  @IsArray() @ArrayMaxSize(ENTERPRISE_PORTAL_ACTIONS.length) @ArrayUnique() @IsIn(ENTERPRISE_PORTAL_ACTIONS, { each: true })
  actions!: EnterprisePortalGrant["actions"];
}
export class SaveEnterprisePortalConfigurationDto implements SaveEnterprisePortalConfigurationRequest {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => EnterprisePortalGrantDto)
  grants!: EnterprisePortalGrantDto[];
}
