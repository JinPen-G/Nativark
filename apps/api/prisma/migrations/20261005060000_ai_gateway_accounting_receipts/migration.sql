CREATE UNIQUE INDEX `ai_invocation_admission_scope_id` ON `ai_invocation_admissions` (`tenantId`, `workspaceId`, `id`);
CREATE UNIQUE INDEX `ai_budget_reservation_scope_id` ON `ai_budget_reservations` (`scopeId`, `scopeKind`, `id`);

CREATE TABLE `ai_gateway_accounting_receipts` (
  `id` VARCHAR(36) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `scopeKind` ENUM('platform','tenant','workspace') NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `invocationId` VARCHAR(36) NOT NULL,
  `reservationId` VARCHAR(36) NOT NULL,
  `admissionId` VARCHAR(36) NOT NULL,
  `dispatchToken` VARCHAR(128) NOT NULL,
  `requestHash` VARCHAR(128) NOT NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'reserved',
  `inputTokens` BIGINT UNSIGNED NULL,
  `outputTokens` BIGINT UNSIGNED NULL,
  `usageHash` CHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_gateway_accounting_receipts_invocationId_key` (`invocationId`),
  UNIQUE INDEX `ai_gateway_accounting_receipts_reservationId_key` (`reservationId`),
  UNIQUE INDEX `ai_gateway_accounting_receipts_admissionId_key` (`admissionId`),
  INDEX `ai_gateway_accounting_scope_state_idx` (`scopeId`, `state`),
  CONSTRAINT `ai_gateway_accounting_invocation_fk` FOREIGN KEY (`scopeId`, `taskId`, `invocationId`)
    REFERENCES `ai_gateway_invocations` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_gateway_accounting_reservation_fk` FOREIGN KEY (`scopeId`, `scopeKind`, `reservationId`)
    REFERENCES `ai_budget_reservations` (`scopeId`, `scopeKind`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_gateway_accounting_admission_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `admissionId`)
    REFERENCES `ai_invocation_admissions` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
