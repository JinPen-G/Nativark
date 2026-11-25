/** 原实名与承运凭证的文件描述 DTO，业务对象和场景由专用 Rental 路由确定。 */
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from "class-validator";
import type { CreateCarrierEvidenceUploadRequest, CreateCustomerIdentityUploadRequest } from "./contracts";

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
