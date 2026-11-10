import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import type { AiTaskRuleDraftListInput, AiTaskRuleDraftReference, AiTaskRuleDraftReviewInput, AiTaskRuleDraftSaveInput } from '@rental-os/shared';

export class AiTaskRuleDraftListDto implements AiTaskRuleDraftListInput {
  @IsString() @IsNotEmpty() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) taskId!: string;
}
export class AiTaskRuleDraftReferenceDto extends AiTaskRuleDraftListDto implements AiTaskRuleDraftReference {
  @IsString() @IsNotEmpty() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) runId!: string;
  @IsString() @IsNotEmpty() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) stepId!: string;
}
export class AiTaskRuleDraftReviewDto extends AiTaskRuleDraftReferenceDto implements AiTaskRuleDraftReviewInput {
  @IsString() @IsNotEmpty() @MaxLength(500) changeReason!: string;
}
export class AiTaskRuleDraftSaveDto extends AiTaskRuleDraftReviewDto implements AiTaskRuleDraftSaveInput {
  @IsString() @Matches(/^[a-f0-9]{64}$/u) reviewHash!: string;
  @IsIn(['save_original_business_draft']) decision!: 'save_original_business_draft';
}
