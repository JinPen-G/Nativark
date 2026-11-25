/** 原字典/编号请求校验，路径编码由Controller覆盖body编码。 */
import type { GeneratePlatformNumberRequest, PlatformDictionaryItem } from "@rental-os/platform-contracts";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { PLATFORM_NUMBER_DATE_PATTERNS, PLATFORM_NUMBER_RESET_CYCLES } from "./platform-tools.values";

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
  @IsIn(PLATFORM_NUMBER_DATE_PATTERNS) datePattern!: "yyyyMMdd" | "yyyyMM" | "yyMMdd" | "none";
  @IsInt() @Min(1) sequenceLength!: number;
  @IsOptional() @IsInt() @Min(0) currentSequence?: number;
  @IsIn(PLATFORM_NUMBER_RESET_CYCLES) resetCycle!: "daily" | "monthly" | "yearly" | "never";
  @IsBoolean() enabled!: boolean;
  @IsString() @IsNotEmpty() operator!: string;
}

export class GeneratePlatformNumberDto implements GeneratePlatformNumberRequest {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() operator!: string;
}
