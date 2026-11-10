import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { RENTAL_CAPABILITY_CODES, type AdoptRentalCategoryRequest, type CategoryCapabilityPreparationPatch, type CategoryEntityPreparationPatch, type CategoryEntityPreparationRemoval, type CategoryPreparationEntitiesQuery, type SaveCategoryPreparationBatchRequest, type SaveCategoryPreparationRequest } from "@rental-os/shared";

export class AdoptRentalCategoryDto implements AdoptRentalCategoryRequest {
  @IsString() @Matches(/\S/u) @MaxLength(191) expectedSourceVersionId!: string;
  @IsInt() @Min(0) @Max(2147483646) expectedSourceRevision!: number;
  @IsInt() @Min(1) @Max(2147483646) expectedPreparationRevision!: number;
  @IsInt() @Min(0) @Max(2147483646) expectedTargetPolicyRevision!: number;
  @IsIn(["upgrade", "restore"]) operation!: "upgrade" | "restore";
  @IsString() @Matches(/^[A-Za-z0-9._:-]{8,128}(?![\s\S])/u) idempotencyKey!: string;
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
}

export class CategoryEntityPreparationPatchDto implements CategoryEntityPreparationPatch {
  @IsIn(["item_group", "asset"]) entityType!: "item_group" | "asset";
  @IsString() @Matches(/\S/u) @MaxLength(191) entityId!: string;
  @IsString() @MaxLength(32) expectedUpdatedAt!: string;
  @IsObject() values!: CategoryEntityPreparationPatch["values"];
}
export class CategoryCapabilityPreparationPatchDto implements CategoryCapabilityPreparationPatch {
  @IsOptional() @IsIn(["configure", "enable_new"]) intent?: CategoryCapabilityPreparationPatch["intent"];
  @IsString() @Matches(/\S/u) @MaxLength(191) code!: CategoryCapabilityPreparationPatch["code"];
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @Matches(/\S/u) @MaxLength(191) expectedImplementationVersion!: string;
  @IsObject() config!: CategoryCapabilityPreparationPatch["config"];
}
export class SaveCategoryPreparationDto implements SaveCategoryPreparationRequest {
  @IsString() @Matches(/\S/u) @MaxLength(191) expectedSourceVersionId!: string;
  @IsInt() @Min(0) expectedSourceRevision!: number;
  @IsInt() @Min(0) expectedPreparationRevision!: number;
  @IsIn(["upgrade", "restore"]) operation!: "upgrade" | "restore";
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => CategoryEntityPreparationPatchDto) patches!: CategoryEntityPreparationPatchDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CategoryCapabilityPreparationPatchDto) capabilityPatches?: CategoryCapabilityPreparationPatchDto[];
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
}
export class CategoryEntityPreparationRemovalDto implements CategoryEntityPreparationRemoval {
  @IsIn(["item_group", "asset"]) entityType!: "item_group" | "asset";
  @IsString() @Matches(/\S/u) @MaxLength(191) entityId!: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique()
  @Matches(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u, { each: true }) fieldCodes?: string[];
}
export class SaveCategoryPreparationBatchDto implements SaveCategoryPreparationBatchRequest {
  @IsString() @Matches(/\S/u) @MaxLength(191) expectedSourceVersionId!: string;
  @IsInt() @Min(0) expectedSourceRevision!: number;
  @IsInt() @Min(0) expectedPreparationRevision!: number;
  @IsIn(["upgrade", "restore"]) operation!: "upgrade" | "restore";
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => CategoryEntityPreparationPatchDto) patches!: CategoryEntityPreparationPatchDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CategoryCapabilityPreparationPatchDto) capabilityPatches?: CategoryCapabilityPreparationPatchDto[];
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u) batchId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => CategoryEntityPreparationRemovalDto)
  removals?: CategoryEntityPreparationRemovalDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsIn(RENTAL_CAPABILITY_CODES, { each: true })
  removeCapabilityCodes?: SaveCategoryPreparationBatchRequest["removeCapabilityCodes"];
  @IsOptional() @IsBoolean() resetPreparation?: boolean;
}
export class CategoryPreparationEntitiesQueryDto implements CategoryPreparationEntitiesQuery {
  @IsOptional() @IsIn(["upgrade", "restore"]) operation?: "upgrade" | "restore";
  @IsIn(["item_group", "asset"]) entityType!: "item_group" | "asset";
  @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(191) entityId?: string;
  @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(191) after?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
