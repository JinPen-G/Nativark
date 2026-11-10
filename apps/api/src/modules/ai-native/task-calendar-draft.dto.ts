import { IsBoolean, IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import type { AiTaskCalendarDraftListInput, AiTaskCalendarDraftReference, AiTaskCalendarDraftReviewInput, AiTaskCalendarDraftSaveInput } from '@rental-os/shared';

export class AiTaskCalendarDraftListDto implements AiTaskCalendarDraftListInput {
  @IsString() @IsNotEmpty() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) taskId!: string;
}
export class AiTaskCalendarDraftReferenceDto extends AiTaskCalendarDraftListDto implements AiTaskCalendarDraftReference {
  @IsString() @IsNotEmpty() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) runId!: string;
  @IsString() @IsNotEmpty() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) stepId!: string;
}
export class AiTaskCalendarDraftReviewDto extends AiTaskCalendarDraftReferenceDto implements AiTaskCalendarDraftReviewInput {
  @IsString() @IsNotEmpty() @MaxLength(1000) overrideReason!: string;
  @IsBoolean() overrideConfirmed!: boolean;
}
export class AiTaskCalendarDraftSaveDto extends AiTaskCalendarDraftReviewDto implements AiTaskCalendarDraftSaveInput {
  @IsString() @Matches(/^[a-f0-9]{64}$/u) reviewHash!: string;
  @IsIn(['save_original_business_draft']) decision!: 'save_original_business_draft';
}
