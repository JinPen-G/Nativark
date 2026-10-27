-- Entitlements/approval receipts only; all consumption stays in the original ledger.
ALTER TABLE `ai_budget_reservations` ADD COLUMN `billingMode` VARCHAR(24) NOT NULL DEFAULT 'legacy_unknown';
-- Classify ONLY exact original invocation/accounting bindings. Unmatched money
-- records remain unknown and held; no amount, status or ledger entry is erased.
UPDATE `ai_budget_reservations` r
JOIN `ai_gateway_accounting_receipts` a ON a.reservationId = r.id AND a.scopeId = r.scopeId AND a.scopeKind = r.scopeKind
JOIN `ai_gateway_invocations` i ON i.id = a.invocationId AND i.scopeId = a.scopeId AND i.taskId = a.taskId
SET r.billingMode = JSON_UNQUOTE(JSON_EXTRACT(i.configuration, '$.serviceMode'))
WHERE r.billingMode = 'legacy_unknown' AND r.actorId = i.actorId AND r.callId = i.callId
  AND r.configurationHash = i.configurationHash
  AND JSON_UNQUOTE(JSON_EXTRACT(i.configuration, '$.serviceMode')) IN ('platform_managed', 'tenant_managed');

CREATE TABLE `ai_tenant_ai_allowances` (
  `tenantId` VARCHAR(191) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `grantedAmount` DECIMAL(24,6) NOT NULL DEFAULT 0,
  `allocationsJson` JSON NOT NULL,
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`, `currency`),
  CONSTRAINT `ai_tenant_ai_allowances_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_tenant_ai_credit_requests` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `requestedBy` VARCHAR(191) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `requestedAmount` DECIMAL(24,6) NOT NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `grantedAmount` DECIMAL(24,6) NULL,
  `decidedBy` VARCHAR(191) NULL,
  `decisionOperationKey` VARCHAR(128) NULL,
  `decisionHash` CHAR(64) NULL,
  `decidedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_credit_request_operation_key` (`tenantId`, `requestedBy`, `operationKey`),
  UNIQUE INDEX `ai_credit_decision_operation_key` (`decidedBy`, `decisionOperationKey`),
  INDEX `ai_credit_request_tenant_state_idx` (`tenantId`, `state`, `createdAt`),
  INDEX `ai_credit_request_pending_idx` (`state`, `createdAt`),
  CONSTRAINT `ai_tenant_ai_credit_requests_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ai_budget_reservation_credit_idx` ON `ai_budget_reservations` (`tenantId`, `unitKind`, `moneyCurrency`, `status`);
CREATE INDEX `ai_gateway_invocations_created_idx` ON `ai_gateway_invocations` (`scopeId`, `createdAt`, `id`);
