ALTER TABLE `Member`
  ADD COLUMN `referrerCustomerId` VARCHAR(191) NULL;

CREATE INDEX `Member_tenantId_referrerCustomerId_idx`
  ON `Member`(`tenantId`, `referrerCustomerId`);
