CREATE TABLE `OrderEventSnapshot` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `snapshotRef` VARCHAR(191) NOT NULL,
  `eventType` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `triggerReason` VARCHAR(512) NULL,
  `settlementTarget` VARCHAR(191) NULL,
  `amount` DECIMAL(12, 2) NULL,
  `beforeJson` JSON NULL,
  `afterJson` JSON NULL,
  `amountJson` JSON NULL,
  `payload` JSON NULL,
  `operator` VARCHAR(191) NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `OrderEventSnapshot_orderId_snapshotRef_key` ON `OrderEventSnapshot`(`orderId`, `snapshotRef`);
CREATE INDEX `OrderEventSnapshot_orderId_occurredAt_idx` ON `OrderEventSnapshot`(`orderId`, `occurredAt`);

ALTER TABLE `OrderEventSnapshot`
  ADD CONSTRAINT `OrderEventSnapshot_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
