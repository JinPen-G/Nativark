-- Employee expense consent does not consume approval or confirm merchant inspection.
ALTER TABLE `enterprise_exchange_approvals`
  ADD COLUMN `employeeConfirmationOperationKey` VARCHAR(128) NULL,
  ADD COLUMN `employeeConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN `employeeConfirmationFingerprint` CHAR(64) NULL;
