/** 公共官方来源的原输入校验，来源与版本字段按正式合同维护。 */
import type { OfficialCalendarDayInput, RegisterOfficialCalendarSourceVersionRequest, SaveOfficialCalendarSourceRequest } from "@rental-os/platform-contracts/official-calendar";
import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

const NON_BLANK_PATTERN = /\S/;
const MAX_MULTIPLIER = 10;
export class SaveOfficialCalendarSourceDto implements SaveOfficialCalendarSourceRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsIn(["CN"])
  region!: "CN";

  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "来源名称不能为空白" })
  @MaxLength(191, { message: "来源名称不能超过 191 字" })
  name!: string;

  /** 只接受 HTTPS：这份数据会被所有租户引用，来源不可验证时出错面是全平台。 */
  @IsUrl({ require_tld: false, protocols: ["https"], require_protocol: true })
  @MaxLength(191, { message: "来源地址不能超过 191 字" })
  url!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class OfficialCalendarSourceDayInputDto {
  /** 只接受 YYYY-MM-DD：带时间会让同一天出现多个键。 */
  @IsISO8601()
  date!: string;

  @IsIn(["statutory_holiday", "makeup_workday"])
  dayType!: OfficialCalendarDayInput[number]["dayType"];

  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "节日或调休名称不能为空白" })
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  pricingMultiplier?: number;

  @IsOptional()
  @IsBoolean()
  closed?: boolean;
}

export class RegisterOfficialCalendarSourceVersionDto implements RegisterOfficialCalendarSourceVersionRequest {
  @IsInt()
  @Min(2000)
  @Max(2999)
  year!: number;

  @IsISO8601()
  publishedAt!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OfficialCalendarSourceDayInputDto)
  days!: OfficialCalendarSourceDayInputDto[];
}
