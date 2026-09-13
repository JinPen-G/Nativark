ALTER TABLE `rental_stock_ledger_entries`
    ADD COLUMN `batchNo` VARCHAR(100) NULL,
    ADD COLUMN `sourceDocumentNo` VARCHAR(100) NULL;

CREATE INDEX `rental_stock_ledger_batch_idx`
    ON `rental_stock_ledger_entries` (`tenantId`, `workspaceId`, `batchNo`, `createdAt`);

CREATE INDEX `rental_stock_ledger_document_idx`
    ON `rental_stock_ledger_entries` (`tenantId`, `workspaceId`, `sourceDocumentNo`, `createdAt`);
