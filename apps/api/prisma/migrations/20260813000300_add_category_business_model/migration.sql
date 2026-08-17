ALTER TABLE `rental_category_definitions`
  ADD COLUMN `businessModel` JSON NULL;

UPDATE `rental_category_definitions`
SET `businessModel` = JSON_OBJECT()
WHERE `businessModel` IS NULL;

ALTER TABLE `rental_category_definitions`
  MODIFY COLUMN `businessModel` JSON NOT NULL;

ALTER TABLE `rental_fulfillment_locations`
  ADD COLUMN `operatorType` VARCHAR(191) NULL,
  ADD COLUMN `operatorName` VARCHAR(191) NULL,
  ADD COLUMN `parentLocationId` VARCHAR(191) NULL,
  ADD COLUMN `contactName` VARCHAR(191) NULL,
  ADD COLUMN `contactPhone` VARCHAR(191) NULL,
  ADD COLUMN `businessHours` VARCHAR(191) NULL;

CREATE TABLE `rental_coupon_templates` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `discountType` VARCHAR(191) NOT NULL,
  `discountValue` DECIMAL(12, 2) NOT NULL,
  `minimumSpend` DECIMAL(12, 2) NOT NULL,
  `maximumDiscount` DECIMAL(12, 2) NULL,
  `totalQuota` INTEGER NOT NULL,
  `claimedQuantity` INTEGER NOT NULL DEFAULT 0,
  `perCustomerLimit` INTEGER NOT NULL DEFAULT 1,
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NOT NULL,
  `applicableItemGroupIds` JSON NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
  `version` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `rental_coupon_templates_tenantId_code_key` (`tenantId`, `code`),
  INDEX `rental_coupon_templates_tenant_status_effective_idx` (`tenantId`, `status`, `effectiveFrom`, `effectiveTo`),
  PRIMARY KEY (`id`),
  CONSTRAINT `rental_coupon_templates_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
