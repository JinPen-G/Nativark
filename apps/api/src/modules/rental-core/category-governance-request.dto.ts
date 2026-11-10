import { RENTAL_CATEGORY_TEMPLATE_IDS, RENTAL_CATEGORY_CODE_PATTERN, RENTAL_CAPABILITY_CODES, RENTAL_PRICING_UNIT_CODES, RENTAL_FULFILLMENT_MODES, RentalInventoryMode,
  type PreviewRentalCategoryCreationRequest, type CreateRentalCategoryRequest,
  type ArchiveCategoryDraftRequest, type CreateCategoryDraftRequest, type PatchCategoryDraftRequest, type PublishCategoryDraftRequest, type SaveCategoryOpeningRequest, type SaveCategoryVersionPolicyRequest } from "@rental-os/shared";
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";

export class PreviewRentalCategoryCreationDto implements PreviewRentalCategoryCreationRequest {
  @IsString() @Matches(new RegExp(RENTAL_CATEGORY_CODE_PATTERN, "u")) code!: string;
  @IsString() @Matches(/\S/u) @MaxLength(100) name!: string;
  @IsOptional() @IsIn(RENTAL_CATEGORY_TEMPLATE_IDS) templateId?: PreviewRentalCategoryCreationRequest["templateId"];
  @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(191) sourceVersionId?: string;
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?![\s\S])/u) versionLabel!: string;
  @IsArray() @ArrayMaxSize(4) @ArrayUnique() @IsIn(Object.values(RentalInventoryMode), { each: true }) inventoryModes!: PreviewRentalCategoryCreationRequest["inventoryModes"];
  @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsIn(RENTAL_PRICING_UNIT_CODES, { each: true }) pricingUnits!: PreviewRentalCategoryCreationRequest["pricingUnits"];
  @IsIn(RENTAL_PRICING_UNIT_CODES) defaultPricingUnit!: PreviewRentalCategoryCreationRequest["defaultPricingUnit"];
  @IsArray() @ArrayMaxSize(16) @ArrayUnique() @IsIn(RENTAL_FULFILLMENT_MODES, { each: true }) fulfillmentModes!: PreviewRentalCategoryCreationRequest["fulfillmentModes"];
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsIn(RENTAL_CAPABILITY_CODES, { each: true }) capabilityCodes!: PreviewRentalCategoryCreationRequest["capabilityCodes"];
}
export class CreateRentalCategoryDto implements CreateRentalCategoryRequest {
  @IsString() @Matches(new RegExp(RENTAL_CATEGORY_CODE_PATTERN, "u")) code!: string;
  @IsString() @Matches(/\S/u) @MaxLength(100) name!: string;
  @IsOptional() @IsIn(RENTAL_CATEGORY_TEMPLATE_IDS) templateId?: PreviewRentalCategoryCreationRequest["templateId"];
  @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(191) sourceVersionId?: string;
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?![\s\S])/u) versionLabel!: string;
  @IsArray() @ArrayMaxSize(4) @ArrayUnique() @IsIn(Object.values(RentalInventoryMode), { each: true }) inventoryModes!: PreviewRentalCategoryCreationRequest["inventoryModes"];
  @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsIn(RENTAL_PRICING_UNIT_CODES, { each: true }) pricingUnits!: PreviewRentalCategoryCreationRequest["pricingUnits"];
  @IsIn(RENTAL_PRICING_UNIT_CODES) defaultPricingUnit!: PreviewRentalCategoryCreationRequest["defaultPricingUnit"];
  @IsArray() @ArrayMaxSize(16) @ArrayUnique() @IsIn(RENTAL_FULFILLMENT_MODES, { each: true }) fulfillmentModes!: PreviewRentalCategoryCreationRequest["fulfillmentModes"];
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsIn(RENTAL_CAPABILITY_CODES, { each: true }) capabilityCodes!: PreviewRentalCategoryCreationRequest["capabilityCodes"];
  @IsString() @Matches(/^[a-f0-9]{64}(?![\s\S])/u) expectedDefinitionHash!: string;
  @IsString() @Matches(/^[A-Za-z0-9._:-]{8,128}(?![\s\S])/u) idempotencyKey!: string;
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
}

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
