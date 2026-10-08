ALTER TABLE `rental_notification_logs`
  ADD COLUMN `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  ADD UNIQUE INDEX `rental_notification_logs_scope_id_key` (`tenantId`, `workspaceId`, `id`);
ALTER TABLE `rental_payment_refunds`
  ADD COLUMN `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  ADD UNIQUE INDEX `rental_payment_refunds_scope_id_key` (`tenantId`, `workspaceId`, `id`);

CREATE TABLE `ai_business_failure_outbox` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `eventType` VARCHAR(32) NOT NULL,
  `notificationId` VARCHAR(191) NULL,
  `refundId` VARCHAR(191) NULL,
  `resourceRevision` INTEGER UNSIGNED NOT NULL,
  `orderId` VARCHAR(191) NULL,
  `failureCode` VARCHAR(32) NOT NULL,
  `traceId` VARCHAR(191) NOT NULL,
  `causationId` VARCHAR(191) NOT NULL,
  `deduplicationKey` CHAR(64) NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `attempts` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `fence` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `leaseOwner` VARCHAR(128) NULL,
  `leaseUntil` DATETIME(3) NULL,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastErrorCode` VARCHAR(32) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_failure_outbox_dedup_key` (`tenantId`, `workspaceId`, `deduplicationKey`),
  INDEX `ai_failure_outbox_due_idx` (`tenantId`, `workspaceId`, `status`, `nextAttemptAt`),
  CONSTRAINT `ai_failure_outbox_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_failure_outbox_notification_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `notificationId`) REFERENCES `rental_notification_logs` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_failure_outbox_refund_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `refundId`) REFERENCES `rental_payment_refunds` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_failure_outbox_resource_check` CHECK (
    (`eventType` = 'notification.failed' AND `notificationId` IS NOT NULL AND `refundId` IS NULL AND `failureCode` = 'delivery_failed') OR
    (`eventType` = 'refund.failed' AND `refundId` IS NOT NULL AND `notificationId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'provider_failed')
  ),
  CONSTRAINT `ai_failure_outbox_state_check` CHECK (`status` IN ('pending', 'claimed', 'retry_scheduled', 'ready', 'expired', 'dead_letter', 'closed')),
  CONSTRAINT `ai_failure_outbox_bounds_check` CHECK (`resourceRevision` > 0 AND `attempts` <= 3 AND `expiresAt` > `occurredAt`),
  CONSTRAINT `ai_failure_outbox_lease_check` CHECK ((`status` = 'claimed' AND `leaseOwner` IS NOT NULL AND `leaseUntil` IS NOT NULL) OR (`status` <> 'claimed' AND `leaseOwner` IS NULL AND `leaseUntil` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
