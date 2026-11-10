import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { ENTERPRISE_ORDER_GROUPS, type EnterpriseOrderExportQuery, type EnterpriseOrderGroup, type EnterpriseOrdersQuery } from "@rental-os/shared";

export class EnterpriseOrderExportQueryDto implements EnterpriseOrderExportQuery {
  @IsOptional() @IsIn(ENTERPRISE_ORDER_GROUPS)
  group?: EnterpriseOrderGroup;

  @IsOptional() @IsString() @MaxLength(120)
  keyword?: string;
}

export class EnterpriseOrdersQueryDto implements EnterpriseOrdersQuery {
  @IsOptional() @IsIn(ENTERPRISE_ORDER_GROUPS)
  group?: EnterpriseOrderGroup;

  @IsOptional() @IsString() @MaxLength(120)
  keyword?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  pageSize?: number;
}
