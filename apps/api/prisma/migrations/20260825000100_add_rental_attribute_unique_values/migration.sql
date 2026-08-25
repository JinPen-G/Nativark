CREATE TABLE `rental_attribute_unique_values` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(32) NOT NULL,
    `fieldCode` VARCHAR(64) NOT NULL,
    `normalizedHash` CHAR(64) NOT NULL,
    `normalizedValue` VARCHAR(512) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rental_attr_unique_value_key`(`workspaceId`, `entityType`, `fieldCode`, `normalizedHash`),
    UNIQUE INDEX `rental_attr_unique_entity_key`(`workspaceId`, `entityType`, `fieldCode`, `entityId`),
    INDEX `rental_attribute_unique_values_tenantId_workspaceId_entityId_idx`(`tenantId`, `workspaceId`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `rental_attribute_unique_values`
    ADD CONSTRAINT `rental_attribute_unique_values_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `rental_attribute_unique_values`
    ADD CONSTRAINT `rental_attribute_unique_values_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `rental_attribute_unique_values`
    (`id`, `tenantId`, `workspaceId`, `entityType`, `fieldCode`, `normalizedHash`, `normalizedValue`, `entityId`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('attruniq_', SHA2(CONCAT(`workspaceId`, '|asset|serialNo|', UPPER(TRIM(`serialNo`))), 256)),
    `tenantId`, `workspaceId`, 'asset', 'serialNo',
    SHA2(UPPER(TRIM(`serialNo`)), 256), UPPER(TRIM(`serialNo`)), `id`, `createdAt`, `updatedAt`
FROM `rental_assets`
WHERE NULLIF(TRIM(`serialNo`), '') IS NOT NULL;

INSERT INTO `rental_attribute_unique_values`
    (`id`, `tenantId`, `workspaceId`, `entityType`, `fieldCode`, `normalizedHash`, `normalizedValue`, `entityId`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('attruniq_', SHA2(CONCAT(asset.`workspaceId`, '|asset|', codes.`fieldCode`, '|', UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(asset.`attributes`, CONCAT('$.', codes.`fieldCode`)))))), 256)),
    asset.`tenantId`, asset.`workspaceId`, 'asset', codes.`fieldCode`,
    SHA2(UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(asset.`attributes`, CONCAT('$.', codes.`fieldCode`))))), 256),
    UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(asset.`attributes`, CONCAT('$.', codes.`fieldCode`))))),
    asset.`id`, asset.`createdAt`, asset.`updatedAt`
FROM `rental_assets` asset
CROSS JOIN (
    SELECT 'batchNo' AS `fieldCode`
    UNION ALL SELECT 'licensePlate'
    UNION ALL SELECT 'vin'
    UNION ALL SELECT 'factoryNo'
) codes
WHERE NULLIF(UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(asset.`attributes`, CONCAT('$.', codes.`fieldCode`))))), '') IS NOT NULL;
