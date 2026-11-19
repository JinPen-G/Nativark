/** 原文件请求兼容出口，公共与Rental专用DTO及Staff原键解析沿正式包复用。 */
export { CompleteFileUploadDto, CreateFileUploadSessionDto } from "@rental-os/platform-server/file-dto";
export { StaffUploadObservationDto } from "@rental-os/rental-core/http-staff-uploads";
export { CreateCarrierEvidenceUploadDto, CreateCustomerIdentityUploadDto } from "@rental-os/rental-core/http-file.dto";
export { parseStaffUploadObservation } from "@rental-os/rental-core/file-application-staff-observation";
