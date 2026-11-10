/** Strict transport for inspection preparation, not fulfillment or expense consent. */
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, Min, Max, ValidateNested, Equals } from "class-validator";
import type { PrepareRentalExchangeInspectionRequest, RentalExchangeInspectionRequirementsRequest, RentalExchangeInspectionIntent, RentalExchangeInspectionResult, CreateRentalExchangeInspectionMediaRequest } from "@rental-os/shared";
export class RentalExchangeInspectionIntentDto implements RentalExchangeInspectionIntent {
  @IsString() @IsNotEmpty() @MaxLength(191) orderLineId!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) allocationId!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) replacementItemGroupId!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) replacementAssetId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) replacementPricingGroupId?: string;
  @IsIn(["original_order_price", "replacement_current_price"]) priceBasis!: RentalExchangeInspectionIntent["priceBasis"];
  @IsIn(["return_to_warehouse", "off_shelf"]) originalDisposition!: RentalExchangeInspectionIntent["originalDisposition"];
}
export class RentalExchangeInspectionRequirementsDto implements RentalExchangeInspectionRequirementsRequest {
  @IsISO8601({ strict: true }) expectedOrderUpdatedAt!: string;
  @ValidateNested() @Type(() => RentalExchangeInspectionIntentDto) exchange!: RentalExchangeInspectionIntentDto;
}
export class CreateRentalExchangeInspectionMediaDto implements CreateRentalExchangeInspectionMediaRequest {
  @IsISO8601({ strict: true }) expectedOrderUpdatedAt!: string;
  @ValidateNested() @Type(() => RentalExchangeInspectionIntentDto) exchange!: RentalExchangeInspectionIntentDto;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/u) operationKey!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/u) requirementsHash!: string;
  @IsIn(["original_return", "replacement_pickup"]) side!: CreateRentalExchangeInspectionMediaRequest["side"];
  @IsString() @Matches(/\S/u) @MaxLength(180) templateId!: string;
  @IsString() @Matches(/\S/u) @MaxLength(180) templateVersion!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/u) fieldCode!: string;
  @IsString() @Matches(/\S/u) @MaxLength(180) fileName!: string;
  @IsIn(["image/png", "image/jpeg"]) mimeType!: CreateRentalExchangeInspectionMediaRequest["mimeType"];
  @IsInt() @Min(1) @Max(20 * 1024 * 1024) sizeBytes!: number;
}
export class RentalExchangeInspectionResultDto implements RentalExchangeInspectionResult {
  @IsIn(["original_return", "replacement_pickup"]) side!: RentalExchangeInspectionResult["side"];
  @IsString() @IsNotEmpty() @MaxLength(191) templateId!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) templateVersion!: string;
  @IsObject() results!: Record<string, string | number | boolean>;
}
export class RentalExchangeInspectionExceptionInputDto {
  @IsString() @Matches(/\S/u) @MaxLength(128) code!: string;
  @IsString() @Matches(/\S/u) @MaxLength(500) description!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) allocationId!: string;
}
export class PrepareRentalExchangeInspectionDto implements PrepareRentalExchangeInspectionRequest {
  @IsISO8601({ strict: true }) expectedOrderUpdatedAt!: string;
  @ValidateNested() @Type(() => RentalExchangeInspectionIntentDto) exchange!: RentalExchangeInspectionIntentDto;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/u) operationKey!: string;
  @IsInt() @Equals(0) expectedRevision!: 0;
  @IsString() @Matches(/\S/u) @MaxLength(500) reason!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/u) requirementsHash!: string;
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => RentalExchangeInspectionResultDto) inspections!: RentalExchangeInspectionResultDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RentalExchangeInspectionExceptionInputDto) exceptions?: RentalExchangeInspectionExceptionInputDto[];
}
