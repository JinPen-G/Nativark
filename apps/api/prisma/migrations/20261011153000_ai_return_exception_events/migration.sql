ALTER TABLE `rental_inspection_records`
  ADD COLUMN `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD UNIQUE INDEX `rental_inspection_event_source_key` (`tenantId`, `workspaceId`, `id`, `orderId`),
  ADD CONSTRAINT `rental_inspection_revision_check` CHECK (`revision` BETWEEN 1 AND 4294967294);

ALTER TABLE `ai_business_failure_outbox`
  DROP CHECK `ai_failure_outbox_resource_check`,
  ADD COLUMN `inspectionId` VARCHAR(191) NULL,
  ADD COLUMN `exceptionId` VARCHAR(191) NULL,
  ADD INDEX `ai_failure_outbox_inspection_idx` (`tenantId`, `workspaceId`, `inspectionId`, `exceptionId`),
  ADD CONSTRAINT `ai_failure_outbox_inspection_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `inspectionId`, `orderId`)
    REFERENCES `rental_inspection_records` (`tenantId`, `workspaceId`, `id`, `orderId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_resource_check` CHECK (
    (`eventType` = 'notification.failed' AND `notificationId` IS NOT NULL AND `refundId` IS NULL AND `inspectionId` IS NULL AND `exceptionId` IS NULL AND `failureCode` = 'delivery_failed') OR
    (`eventType` = 'refund.failed' AND `refundId` IS NOT NULL AND `notificationId` IS NULL AND `inspectionId` IS NULL AND `exceptionId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'provider_failed') OR
    (`eventType` = 'inspection.return_exception' AND `inspectionId` IS NOT NULL AND `exceptionId` IS NOT NULL AND CHAR_LENGTH(`exceptionId`) > 0 AND `notificationId` IS NULL AND `refundId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'review_pending')
  );
