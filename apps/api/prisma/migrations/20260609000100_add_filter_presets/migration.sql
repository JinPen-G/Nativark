-- CreateTable
CREATE TABLE `FilterPreset` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `scopeKey` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `filters` JSON NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `operator` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FilterPreset_tenantId_scopeKey_name_key`(`tenantId`, `scopeKey`, `name`),
    INDEX `FilterPreset_tenantId_scopeKey_isDefault_idx`(`tenantId`, `scopeKey`, `isDefault`),
    INDEX `FilterPreset_tenantId_scopeKey_updatedAt_idx`(`tenantId`, `scopeKey`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FilterPreset` ADD CONSTRAINT `FilterPreset_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
