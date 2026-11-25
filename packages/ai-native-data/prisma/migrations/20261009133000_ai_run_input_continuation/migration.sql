ALTER TABLE `ai_runs`
  ADD COLUMN `inputReceiptId` VARCHAR(36) NULL,
  ADD COLUMN `resourceOriginRunId` VARCHAR(36) NULL,
  ADD UNIQUE INDEX `ai_runs_input_receipt_key` (`scopeId`, `taskId`, `inputReceiptId`),
  ADD INDEX `ai_runs_resource_origin_idx` (`scopeId`, `taskId`, `resourceOriginRunId`),
  ADD CONSTRAINT `ai_runs_input_receipt_fkey` FOREIGN KEY (`scopeId`, `taskId`, `inputReceiptId`)
    REFERENCES `ai_task_input_receipts` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_runs_resource_origin_fkey` FOREIGN KEY (`scopeId`, `taskId`, `resourceOriginRunId`)
    REFERENCES `ai_runs` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
