ALTER TABLE `ai_budget_reservations`
  ADD COLUMN `configurationHash` CHAR(64) NULL COMMENT 'Complete configuration binding; legacy NULL requires trusted reconciliation';
