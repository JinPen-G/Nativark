-- Private original protocol-call receipts only. No old result/usage backfill,
-- new grant, retry, second financial ledger or existing task mutation.
CREATE TABLE `ai_gateway_tool_call_bindings` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `invocationId` VARCHAR(36) NOT NULL,
  `callIndex` TINYINT UNSIGNED NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `stepId` VARCHAR(36) NOT NULL,
  `actionId` VARCHAR(191) NOT NULL,
  `stepFingerprint` CHAR(64) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `configurationHash` CHAR(64) NOT NULL,
  `inputHash` CHAR(64) NOT NULL,
  `bindingHash` CHAR(64) NOT NULL,
  `encryptedPayload` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`scopeId`, `taskId`, `invocationId`, `callIndex`),
  INDEX `ai_gateway_tool_calls_step_idx` (`scopeId`, `taskId`, `runId`, `stepId`),
  CONSTRAINT `ai_gateway_tool_calls_index_check` CHECK (`callIndex` BETWEEN 0 AND 7),
  CONSTRAINT `ai_gateway_tool_calls_invocation_fkey`
    FOREIGN KEY (`scopeId`, `taskId`, `invocationId`)
    REFERENCES `ai_gateway_invocations` (`scopeId`, `taskId`, `id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
