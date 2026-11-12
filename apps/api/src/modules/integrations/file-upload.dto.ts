import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { CompleteFileUploadRequest, CreateCarrierEvidenceUploadRequest, CreateCustomerIdentityUploadRequest, CreateFileUploadSessionRequest } from "@rental-os/shared";
import { STAFF_UPLOAD_OBSERVATION_SCHEMAS, type StaffUploadObservationRequest } from '@rental-os/shared';
import { BadRequestException } from '@nestjs/common';
import Ajv from 'ajv';

const validStaffObservation = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false })
  .compile<StaffUploadObservationRequest>(STAFF_UPLOAD_OBSERVATION_SCHEMAS.StaffUploadObservationRequest);
export class StaffUploadObservationDto implements StaffUploadObservationRequest {
  @IsObject() reference!: StaffUploadObservationRequest['reference'];
  @IsObject() file!: StaffUploadObservationRequest['file'];
}
/** Detach the original body before awaiting authority; never strip a supplied
 * actor, workspace or extra selector into an apparently valid observation. */
export function parseStaffUploadObservation(value: unknown): StaffUploadObservationRequest {
  try {
    const input = structuredClone(value);
    if (Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8') <= 8192 && validStaffObservation(input)) {
      if ('idempotencyKey' in input.reference) {
        // Match createUploadSession: the raw UTF-16 length is bounded before
        // trimming; a lost create response must remain findable by its old key.
        const original = input.reference.idempotencyKey;
        if (original.length > 191 || !original.trim()) throw new Error('Invalid original upload key');
        input.reference.idempotencyKey = original.trim();
      }
      return input;
    }
  } catch { /* A malformed descriptor is not an upload observation. */ }
  throw new BadRequestException('原上传会话引用或文件描述无效');
}

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
