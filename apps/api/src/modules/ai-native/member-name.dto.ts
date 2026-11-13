import { Type } from 'class-transformer';
import { Equals, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import type { AiMemberNameQuery, AiMemberNameLocator, AiMemberNameSelection, AiMemberNameIntent,
  AiMemberNamePrepareInput, AiMemberNameExecuteInput } from '@rental-os/shared';
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, hash = /^[a-f0-9]{64}$/u;
export class AiMemberNameAvailabilityDto {}
export class AiMemberNameQueryDto implements AiMemberNameQuery {
  @IsInt() @Min(1) @Max(50) limit!: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191) @Matches(id) customerId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191) @Matches(id) cursor?: string;
}
export class AiMemberNameLocatorDto implements AiMemberNameLocator {
  @IsString() @MinLength(1) @MaxLength(191) @Matches(id) customerId!: string;
  @IsString() @MinLength(1) @MaxLength(128) @Matches(id) requestKey!: string;
  @IsOptional() @Equals('reconfirmed') kind?: 'reconfirmed';
}
export class AiMemberNameDiscoverDto {
  @ValidateNested() @Type(() => AiMemberNameQueryDto) query!: AiMemberNameQueryDto;
}
export class AiMemberNameSelectionDto extends AiMemberNameLocatorDto implements AiMemberNameSelection {
  @ValidateNested() @Type(() => AiMemberNameQueryDto) query!: AiMemberNameQueryDto;
  @IsString() @Matches(hash) selectionHash!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
}
export class AiMemberNameIntentDto extends AiMemberNameSelectionDto implements AiMemberNameIntent {
  @IsISO8601({ strict: true }) expiresAt!: string;
}
export class AiMemberNamePrepareDto implements AiMemberNamePrepareInput {
  @ValidateNested() @Type(() => AiMemberNameIntentDto) intent!: AiMemberNameIntentDto;
  @IsString() @Matches(hash) reviewHash!: string;
  @Equals('prepare_original_member_name_review') decision!: 'prepare_original_member_name_review';
}
export class AiMemberNameReadDto {
  @ValidateNested() @Type(() => AiMemberNameLocatorDto) locator!: AiMemberNameLocatorDto;
}
export class AiMemberNameExecuteDto extends AiMemberNameReadDto implements AiMemberNameExecuteInput {
  @IsString() @Matches(hash) confirmationHash!: string;
  @Equals('approve_and_execute_original_member_name') decision!: 'approve_and_execute_original_member_name';
}
export class AiMemberNameReconfirmationInspectDto extends AiMemberNameReadDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
}
export class AiMemberNameReconfirmationPrepareDto extends AiMemberNameReconfirmationInspectDto {
  @IsISO8601({ strict: true }) expiresAt!: string;
  @IsString() @Matches(hash) reviewHash!: string;
  @Equals('prepare_reconfirmed_member_name_change') decision!: 'prepare_reconfirmed_member_name_change';
}
export class AiMemberNameStartReviewDto extends AiMemberNameReadDto {
  @Equals('start_original_member_name_review') decision!: 'start_original_member_name_review';
}
