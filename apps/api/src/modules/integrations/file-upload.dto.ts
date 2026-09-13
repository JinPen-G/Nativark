import { IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { CompleteFileUploadRequest, CreateFileUploadSessionRequest } from "@rental-os/shared";

export class CreateFileUploadSessionDto implements CreateFileUploadSessionRequest {
  @IsString() businessModule!: string;
  @IsString() businessType!: string;
  @IsString() businessId!: string;
  @IsString() fileName!: string;
  @IsString() mimeType!: string;
  @IsInt() @Min(1) @Max(20 * 1024 * 1024) sizeBytes!: number;
  @IsString() uploadScene!: string;
  @IsString() idempotencyKey!: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class CompleteFileUploadDto implements CompleteFileUploadRequest {
  @IsOptional() @IsString() @MaxLength(191) checksum?: string;
}
