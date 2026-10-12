-- Optional server-owned original operation proof. Legacy quotes stay NULL.
-- The proof and quote share one row/commit; this is not a budget ledger.
ALTER TABLE `rental_quotes`
  ADD COLUMN `originalOperationKey` VARCHAR(64) NULL,
  ADD COLUMN `originalInputHash` VARCHAR(64) NULL;
CREATE UNIQUE INDEX `rental_quotes_original_operation_key`
  ON `rental_quotes` (`tenantId`, `workspaceId`, `originalOperationKey`);
