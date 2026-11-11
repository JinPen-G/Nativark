import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { AiTaskCalendarDraftListInput, AiTaskCalendarDraftReference, AiTaskCalendarDraftReviewInput, AiTaskCalendarDraftSaveInput } from '@rental-os/shared';
import type { AiTaskCalendarDraftPreparationInput, AiTaskCalendarDraftPreparationPreviewInput,
  AiTaskCalendarDraftPrepareInput, AiTaskCalendarDraftPreparationReference, AiTaskCalendarDraftPreparationValues } from '@rental-os/shared';
import type { AiTaskCalendarDraftSourceInput, AiTaskCalendarDraftEntryInput, AiTaskCalendarDraftEntryReference } from '@rental-os/shared';

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
export class AiTaskCalendarDraftPreparationDto extends AiTaskCalendarDraftListDto implements AiTaskCalendarDraftPreparationInput {
  @IsString() @Matches(/^(19|20|21|22)\d{2}-\d{2}-\d{2}$/u) date!: string;
}
export class AiTaskCalendarDraftPreparationValuesDto implements AiTaskCalendarDraftPreparationValues {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @IsIn(['open', 'limited', 'closed', 'self_service']) businessStatus?: 'open' | 'limited' | 'closed' | 'self_service';
}
export class AiTaskCalendarDraftPreparationPreviewDto extends AiTaskCalendarDraftPreparationDto implements AiTaskCalendarDraftPreparationPreviewInput {
  @IsString() @IsNotEmpty() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) targetId!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) version!: string;
  @IsInt() @Min(0) @Max(4294967294) revision!: number;
  @ValidateNested() @Type(() => AiTaskCalendarDraftPreparationValuesDto) values!: AiTaskCalendarDraftPreparationValuesDto;
}
export class AiTaskCalendarDraftPrepareDto extends AiTaskCalendarDraftPreparationPreviewDto implements AiTaskCalendarDraftPrepareInput {
  @IsUUID() operationKey!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/u) reviewHash!: string;
  @IsISO8601({ strict: true }) expiresAt!: string;
  @IsIn(['prepare_new_calendar_ai_proposal']) decision!: 'prepare_new_calendar_ai_proposal';
}
export class AiTaskCalendarDraftPreparationReferenceDto extends AiTaskCalendarDraftListDto implements AiTaskCalendarDraftPreparationReference {
  @IsUUID() operationKey!: string;
}
export class AiTaskCalendarDraftSourceDto implements AiTaskCalendarDraftSourceInput {
  @IsString() @Matches(/^(19|20|21|22)\d{2}-\d{2}-\d{2}$/u) date!: string;
}
export class AiTaskCalendarDraftEntryDto extends AiTaskCalendarDraftSourceDto implements AiTaskCalendarDraftEntryInput {
  @IsString() @IsNotEmpty() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) targetId!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) version!: string;
  @IsInt() @Min(0) @Max(4294967294) revision!: number;
  @IsUUID() operationKey!: string;
  @IsIn(['create_original_calendar_task']) decision!: 'create_original_calendar_task';
}
export class AiTaskCalendarDraftEntryReferenceDto implements AiTaskCalendarDraftEntryReference {
  @IsUUID() operationKey!: string;
}
