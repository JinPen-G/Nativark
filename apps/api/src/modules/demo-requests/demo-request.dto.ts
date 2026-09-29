import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from "class-validator";
import type { CreateDemoRequestInput, DemoContactType, DemoRequestListQuery } from "@rental-os/shared";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class CreateDemoRequestDto implements CreateDemoRequestInput {
  @IsUUID("4")
  requestKey!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsIn(["phone", "email", "wechat"])
  contactType!: DemoContactType;

  @Transform(trim)
  @IsString()
  @Length(1, 160)
  contactValue!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  company?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message?: string;

  @IsIn(["zh", "en"])
  language!: "zh" | "en";
}

export class DemoRequestListQueryDto implements DemoRequestListQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
