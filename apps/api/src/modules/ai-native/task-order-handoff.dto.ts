import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { AiTaskOrderHandoffQuery } from '@rental-os/shared';
export class AiTaskOrderHandoffQueryDto implements AiTaskOrderHandoffQuery {
  @IsString() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) taskId!: string;
  @IsOptional() @IsString() @MaxLength(36) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) runId?: string;
}
