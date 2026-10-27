CREATE TABLE `ai_model_configuration_operations` (
    `id` VARCHAR(36) NOT NULL,
    `scopeId` VARCHAR(36) NOT NULL,
    `scopeKind` ENUM('platform', 'tenant', 'workspace') NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `operationKey` VARCHAR(128) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NULL,
    `expectedRevision` INTEGER UNSIGNED NOT NULL,
    `resultRevision` INTEGER UNSIGNED NOT NULL,
    `commandHash` CHAR(64) NOT NULL,
    `result` JSON NOT NULL,
    `resultHash` CHAR(64) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ai_model_config_operation_original_key`(`scopeId`, `scopeKind`, `targetId`, `operationKey`),
    UNIQUE INDEX `ai_model_config_operation_revision_key`(`scopeId`, `scopeKind`, `targetId`, `resultRevision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_model_configuration_operations` ADD CONSTRAINT `ai_model_configuration_operations_scopeId_scopeKind_fkey`
    FOREIGN KEY (`scopeId`, `scopeKind`) REFERENCES `ai_scopes`(`id`, `kind`) ON DELETE RESTRICT ON UPDATE RESTRICT;
