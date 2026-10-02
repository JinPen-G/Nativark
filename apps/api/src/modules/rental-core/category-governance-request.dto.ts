import type { ArchiveCategoryDraftRequest, CreateCategoryDraftRequest, PatchCategoryDraftRequest, PublishCategoryDraftRequest, SaveCategoryOpeningRequest, SaveCategoryVersionPolicyRequest } from "@rental-os/shared";
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";

export class CreateCategoryDraftDto implements CreateCategoryDraftRequest {
  @IsString() @Matches(/\S/u) @MaxLength(191) sourceVersionId!: string;
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u) versionLabel!: string;
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
}
export class PatchCategoryDraftDto implements PatchCategoryDraftRequest {
  @IsInt() @Min(0) expectedRevision!: number;
  @IsObject() values!: Record<string, unknown>;
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
}
export class PublishCategoryDraftDto implements PublishCategoryDraftRequest {
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @Matches(/^[A-Za-z0-9._:-]{8,128}$/u) idempotencyKey!: string;
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
}
export class ArchiveCategoryDraftDto implements ArchiveCategoryDraftRequest {
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
}
export class SaveCategoryOpeningDto implements SaveCategoryOpeningRequest {
  @IsInt() @Min(0) expectedRevision!: number;
  @IsIn(["all", "pilot", "unopened", "stopped"]) scope!: SaveCategoryOpeningRequest["scope"];
  @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsString({ each: true }) @MaxLength(191, { each: true }) tenantIds!: string[];
  @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(191) recommendedVersionId?: string;
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
}
export class SaveCategoryVersionPolicyDto implements SaveCategoryVersionPolicyRequest {
  @IsInt() @Min(0) expectedRevision!: number;
  @IsIn(["all", "pilot", "none"]) createScope!: SaveCategoryVersionPolicyRequest["createScope"];
  @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsString({ each: true }) @MaxLength(191, { each: true }) createTenantIds!: string[];
  @IsIn(["all", "pilot", "none"]) upgradeScope!: SaveCategoryVersionPolicyRequest["upgradeScope"];
  @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsString({ each: true }) @MaxLength(191, { each: true }) upgradeTenantIds!: string[];
  @IsIn(["all", "pilot", "none"]) restoreScope!: SaveCategoryVersionPolicyRequest["restoreScope"];
  @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsString({ each: true }) @MaxLength(191, { each: true }) restoreTenantIds!: string[];
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
}
