import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { AiTaskRuleDraftListInput, AiTaskRuleDraftReference, AiTaskRuleDraftReviewInput, AiTaskRuleDraftSaveInput,
  AiTaskRuleDraftPreparationPreviewInput, AiTaskRuleDraftPrepareInput, AiTaskRuleDraftPreparationReference } from '@rental-os/shared';
import type { AiTaskRuleSourceInput, AiTaskRuleSourceEntryInput, AiTaskRuleSourceEntryReference } from '@rental-os/shared';

export class AiTaskRuleDraftListDto implements AiTaskRuleDraftListInput {
  @IsString() @IsNotEmpty() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) taskId!: string;
}
export class AiTaskRuleDraftReferenceDto extends AiTaskRuleDraftListDto implements AiTaskRuleDraftReference {
  @IsString() @IsNotEmpty() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) runId!: string;
  @IsString() @IsNotEmpty() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) stepId!: string;
}
export class AiTaskRuleDraftPreparationDto extends AiTaskRuleDraftListDto {
  @IsOptional() @IsObject() @ValidateNested() @Type(() => AiTaskRuleDraftReferenceDto) rejected?: AiTaskRuleDraftReferenceDto;
}
export class AiTaskRuleDraftReviewDto extends AiTaskRuleDraftReferenceDto implements AiTaskRuleDraftReviewInput {
  @IsString() @IsNotEmpty() @MaxLength(500) changeReason!: string;
}
export class AiTaskRuleDraftSaveDto extends AiTaskRuleDraftReviewDto implements AiTaskRuleDraftSaveInput {
  @IsString() @Matches(/^[a-f0-9]{64}$/u) reviewHash!: string;
  @IsIn(['save_original_business_draft']) decision!: 'save_original_business_draft';
}
export class AiTaskRuleDraftPreparationValuesDto {
  @IsBoolean() 'fulfillment.pickupInspectionRequired'!: boolean;
  @IsBoolean() 'fulfillment.returnInspectionRequired'!: boolean;
  @IsBoolean() 'fulfillment.evidenceRequired'!: boolean;
  @IsBoolean() 'fulfillment.allowDifferentReturnLocation'!: boolean;
  @IsBoolean() 'damage.manualReviewRequired'!: boolean;
  @IsBoolean() 'cancellation.weatherExceptionEnabled'!: boolean;
}
export class AiTaskRuleDraftPreparationPreviewDto extends AiTaskRuleDraftPreparationDto implements AiTaskRuleDraftPreparationPreviewInput {
  @IsString() @IsNotEmpty() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) targetId!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) version!: string;
  @IsObject() @ValidateNested() @Type(() => AiTaskRuleDraftPreparationValuesDto) values!: AiTaskRuleDraftPreparationValuesDto;
}
export class AiTaskRuleDraftPrepareDto extends AiTaskRuleDraftPreparationPreviewDto implements AiTaskRuleDraftPrepareInput {
  @IsUUID() operationKey!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/u) reviewHash!: string;
  @IsDateString() expiresAt!: string;
  @IsIn(['prepare_new_rule_ai_proposal']) decision!: 'prepare_new_rule_ai_proposal';
}
export class AiTaskRuleDraftPreparationReferenceDto extends AiTaskRuleDraftListDto implements AiTaskRuleDraftPreparationReference {
  @IsUUID() operationKey!: string;
}
export class AiTaskRuleSourceDto implements AiTaskRuleSourceInput {
  @IsString() @IsNotEmpty() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) targetId!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) version!: string;
}
export class AiTaskRuleSourceEntryDto extends AiTaskRuleSourceDto implements AiTaskRuleSourceEntryInput {
  @IsString() @Matches(/^[a-f0-9]{64}$/u) sourceHash!: string;
  @IsUUID() operationKey!: string;
  @IsIn(['create_original_rule_task']) decision!: 'create_original_rule_task';
}
export class AiTaskRuleSourceEntryReferenceDto implements AiTaskRuleSourceEntryReference {
  @IsUUID() operationKey!: string;
}
