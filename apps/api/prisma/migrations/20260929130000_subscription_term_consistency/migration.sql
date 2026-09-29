ALTER TABLE `tenant_subscriptions` ADD COLUMN `currentTaxInclusive` BOOLEAN NULL;
ALTER TABLE `tenant_subscription_segments`
  ADD COLUMN `taxInclusive` BOOLEAN NULL,
  ADD COLUMN `billingAnniversary` DATETIME(3) NULL;
ALTER TABLE `subscription_requests`
  ADD COLUMN `handledTaxInclusive` BOOLEAN NULL,
  ADD COLUMN `linkedEventId` VARCHAR(191) NULL;
