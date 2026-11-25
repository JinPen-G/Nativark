/** 原组合与 AI 消费者的兼容入口，共用公共 S3 签名及 Rental 检查对象读取。 */
export { s3ObjectReadRequest } from '@rental-os/platform-server/files';
export { TenantInspectionObjectReader } from '@rental-os/rental-core/inspection-object-reader';
