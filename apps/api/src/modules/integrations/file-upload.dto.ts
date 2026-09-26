import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { CompleteFileUploadRequest, CreateCarrierEvidenceUploadRequest, CreateCustomerIdentityUploadRequest, CreateFileUploadSessionRequest } from "@rental-os/shared";

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

/** 文件业务归属由专用实名路由固定，客户端不能伪造 customerId / scene。 */
export class CreateCustomerIdentityUploadDto implements CreateCustomerIdentityUploadRequest {
  @IsString() @MaxLength(180) fileName!: string;
  @IsIn(["image/jpeg", "image/png", "image/webp", "application/pdf"]) mimeType!: string;
  @IsInt() @Min(1) @Max(20 * 1024 * 1024) sizeBytes!: number;
  @IsString() @MaxLength(191) idempotencyKey!: string;
}

/** 承运凭证上传不接受客户端指定业务归属、空间或场景。 */
export class CreateCarrierEvidenceUploadDto implements CreateCarrierEvidenceUploadRequest {
  @IsString() @MaxLength(180) fileName!: string;
  @IsIn(["image/jpeg", "image/png", "image/webp", "application/pdf"]) mimeType!: CreateCarrierEvidenceUploadRequest["mimeType"];
  @IsInt() @Min(1) @Max(20 * 1024 * 1024) sizeBytes!: number;
  @IsString() @MaxLength(191) idempotencyKey!: string;
}
