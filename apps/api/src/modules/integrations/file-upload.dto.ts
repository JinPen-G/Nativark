/** 原文件请求兼容出口，公共与Rental专用DTO沿正式包复用，Staff原键观察由宿主解析。 */
import { STAFF_UPLOAD_OBSERVATION_SCHEMAS, type StaffUploadObservationRequest } from '@rental-os/shared';
import { BadRequestException } from '@nestjs/common';
import Ajv from 'ajv';
export { CompleteFileUploadDto, CreateFileUploadSessionDto } from "@rental-os/platform-server/file-dto";
export { StaffUploadObservationDto } from "@rental-os/rental-core/http-staff-uploads";
export { CreateCarrierEvidenceUploadDto, CreateCustomerIdentityUploadDto } from "@rental-os/rental-core/http-file.dto";

const validStaffObservation = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false })
  .compile<StaffUploadObservationRequest>(STAFF_UPLOAD_OBSERVATION_SCHEMAS.StaffUploadObservationRequest);
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
