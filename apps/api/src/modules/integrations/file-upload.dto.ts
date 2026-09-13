import { IsInt, IsObject, IsOptional, IsString, Max, Min } from "class-validator";
import type { CompleteFileUploadRequest, CreateFileUploadSessionRequest } from "@rental-os/shared";

export class CreateFileUploadSessionDto implements CreateFileUploadSessionRequest {
  @IsString() businessModule!: string;
  @IsString() businessType!: string;
  @IsOptional() @IsString() businessId?: string;
  @IsString() fileName!: string;
  @IsString() mimeType!: string;
  @IsInt() @Min(1) @Max(20 * 1024 * 1024) sizeBytes!: number;
  @IsString() uploadScene!: string;
  @IsString() idempotencyKey!: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class CompleteFileUploadDto implements CompleteFileUploadRequest {
  @IsOptional() @IsString() checksum?: string;
}
