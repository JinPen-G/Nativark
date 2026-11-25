/** 原筛选预设请求校验，字段及可选 operator 复用正式平台合同。 */
import type { SavePlatformFilterPresetRequest, SetPlatformFilterPresetDefaultRequest } from "@rental-os/platform-contracts";
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from "class-validator";

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

export class SetPlatformFilterPresetDefaultDto implements SetPlatformFilterPresetDefaultRequest {
  @IsOptional() @IsString() @IsNotEmpty() operator?: string;
}
