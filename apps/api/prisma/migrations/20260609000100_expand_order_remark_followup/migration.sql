ALTER TABLE `OrderRemarkRecord`
  ADD COLUMN `reminderAt` DATETIME(3) NULL,
  ADD COLUMN `responsibleUserId` VARCHAR(191) NULL,
  ADD COLUMN `responsibleName` VARCHAR(191) NULL,
  ADD COLUMN `closedAt` DATETIME(3) NULL,
  ADD COLUMN `closedBy` VARCHAR(191) NULL,
  ADD COLUMN `closeNote` TEXT NULL;

CREATE INDEX `OrderRemarkRecord_orderId_reminderAt_idx`
  ON `OrderRemarkRecord`(`orderId`, `reminderAt`);

CREATE INDEX `OrderRemarkRecord_orderId_responsibleUserId_idx`
  ON `OrderRemarkRecord`(`orderId`, `responsibleUserId`);
