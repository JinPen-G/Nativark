-- CreateTable
CREATE TABLE `rental_category_preparation_batches` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `preparationId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(128) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `inputFingerprint` CHAR(64) NOT NULL,
    `result` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_category_preparation_batches_tenant_ws_time_idx`(`tenantId`, `workspaceId`, `createdAt`),
    UNIQUE INDEX `rental_category_preparation_batches_prep_batch_key`(`preparationId`, `batchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `rental_category_preparations_tenant_ws_id_key` ON `rental_category_adoption_preparations`(`tenantId`, `workspaceId`, `id`);

-- AddForeignKey
ALTER TABLE `rental_category_preparation_batches` ADD CONSTRAINT `rental_category_preparation_batches_tenantId_workspaceId_pr_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `preparationId`) REFERENCES `rental_category_adoption_preparations`(`tenantId`, `workspaceId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
