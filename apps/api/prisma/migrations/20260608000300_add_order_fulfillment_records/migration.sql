CREATE TABLE `OrderContractDocument` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `documentNo` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `signMethod` VARCHAR(191) NULL,
  `signerName` VARCHAR(191) NULL,
  `signedAt` DATETIME(3) NULL,
  `fileUrl` VARCHAR(191) NULL,
  `payload` JSON NULL,
  `operator` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `OrderContractDocument_orderId_documentNo_key`(`orderId`, `documentNo`),
  INDEX `OrderContractDocument_orderId_status_idx`(`orderId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderNotificationRecord` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `scene` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(191) NOT NULL,
  `target` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `payload` JSON NULL,
  `operator` VARCHAR(191) NULL,
  `sentAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `OrderNotificationRecord_orderId_scene_createdAt_idx`(`orderId`, `scene`, `createdAt`),
  INDEX `OrderNotificationRecord_orderId_idempotencyKey_idx`(`orderId`, `idempotencyKey`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderRemarkRecord` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `visibility` VARCHAR(191) NOT NULL,
  `operator` VARCHAR(191) NULL,
  `followUpAt` DATETIME(3) NULL,
  `status` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `OrderRemarkRecord_orderId_category_createdAt_idx`(`orderId`, `category`, `createdAt`),
  INDEX `OrderRemarkRecord_orderId_status_idx`(`orderId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderOperationLock` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `stage` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `operator` VARCHAR(191) NULL,
  `startedAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NULL,
  `releasedAt` DATETIME(3) NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `payload` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `OrderOperationLock_orderId_stage_status_idx`(`orderId`, `stage`, `status`),
  INDEX `OrderOperationLock_orderId_idempotencyKey_idx`(`orderId`, `idempotencyKey`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderIdempotencyRecord` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `requestHash` VARCHAR(191) NULL,
  `responseSnapshot` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `OrderIdempotencyRecord_orderId_action_key_key`(`orderId`, `action`, `key`),
  INDEX `OrderIdempotencyRecord_orderId_status_updatedAt_idx`(`orderId`, `status`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrderContractDocument`
  ADD CONSTRAINT `OrderContractDocument_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `OrderNotificationRecord`
  ADD CONSTRAINT `OrderNotificationRecord_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `OrderRemarkRecord`
  ADD CONSTRAINT `OrderRemarkRecord_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `OrderOperationLock`
  ADD CONSTRAINT `OrderOperationLock_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `OrderIdempotencyRecord`
  ADD CONSTRAINT `OrderIdempotencyRecord_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
