-- CAT-GOV-02: additive version foundation. Keep the four-value category ENUM until
-- every reader can handle a dynamic code; do not open dynamic writes here.
ALTER TABLE `rental_category_definitions`
  ADD COLUMN `openingScope` VARCHAR(24) NOT NULL DEFAULT 'all',
  ADD COLUMN `openingTenantIds` JSON NULL,
  ADD COLUMN `openingRevision` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `recommendedVersionId` VARCHAR(191) NULL;

CREATE TABLE `rental_category_versions` (
  `id` VARCHAR(191) NOT NULL,
  `categoryCode` ENUM('vehicle','camera','camping','construction') NOT NULL,
  `versionLabel` VARCHAR(64) NOT NULL,
  `structureVersion` INTEGER NOT NULL DEFAULT 1,
  `sourceVersionId` VARCHAR(191) NULL,
  `sourceKind` VARCHAR(32) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `definition` JSON NOT NULL,
  `dependencyDigest` JSON NULL,
  `publishedAt` DATETIME(3) NULL,
  `publishedBy` VARCHAR(191) NULL,
  `publishReason` VARCHAR(512) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_category_versions_code_id_key` (`categoryCode`,`id`),
  UNIQUE INDEX `rental_category_versions_code_label_key` (`categoryCode`,`versionLabel`),
  INDEX `rental_category_versions_code_status_idx` (`categoryCode`,`status`),
  CONSTRAINT `rental_category_versions_categoryCode_fkey`
    FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions` (`code`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_category_version_policies` (
  `versionId` VARCHAR(191) NOT NULL,
  `createScope` VARCHAR(24) NOT NULL DEFAULT 'all',
  `createTenantIds` JSON NULL,
  `upgradeScope` VARCHAR(24) NOT NULL DEFAULT 'all',
  `upgradeTenantIds` JSON NULL,
  `restoreScope` VARCHAR(24) NOT NULL DEFAULT 'all',
  `restoreTenantIds` JSON NULL,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`versionId`),
  CONSTRAINT `rental_category_version_policies_versionId_fkey`
    FOREIGN KEY (`versionId`) REFERENCES `rental_category_versions` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_category_governance_audits` (
  `id` VARCHAR(191) NOT NULL,
  `categoryCode` ENUM('vehicle','camera','camping','construction') NOT NULL,
  `versionId` VARCHAR(191) NULL,
  `action` VARCHAR(48) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(512) NOT NULL,
  `before` JSON NULL,
  `after` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `rental_category_governance_audits_code_time_idx` (`categoryCode`,`createdAt`),
  CONSTRAINT `rental_category_governance_audits_categoryCode_fkey`
    FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions` (`code`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `business_workspaces`
  ADD COLUMN `categoryVersionId` VARCHAR(191) NULL,
  ADD COLUMN `categoryAdoptionRevision` INTEGER NOT NULL DEFAULT 0,
  ADD INDEX `business_workspaces_categoryCode_categoryVersionId_idx` (`categoryCode`,`categoryVersionId`),
  ADD CONSTRAINT `business_workspaces_categoryCode_categoryVersionId_fkey`
    FOREIGN KEY (`categoryCode`,`categoryVersionId`)
    REFERENCES `rental_category_versions` (`categoryCode`,`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `rental_category_adoption_audits` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `fromVersionId` VARCHAR(191) NULL,
  `toVersionId` VARCHAR(191) NOT NULL,
  `fromRevision` INTEGER NOT NULL,
  `toRevision` INTEGER NOT NULL,
  `action` VARCHAR(24) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(512) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_category_adoptions_workspace_revision_key` (`workspaceId`,`toRevision`),
  INDEX `rental_category_adoptions_tenant_ws_time_idx` (`tenantId`,`workspaceId`,`createdAt`),
  CONSTRAINT `rental_category_adoption_audits_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_category_adoption_preparations` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `targetVersionId` VARCHAR(191) NOT NULL,
  `sourceRevision` INTEGER NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `patches` JSON NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_category_preparations_ws_version_key` (`workspaceId`,`targetVersionId`),
  INDEX `rental_category_preparations_tenant_ws_idx` (`tenantId`,`workspaceId`),
  CONSTRAINT `rental_category_adoption_preparations_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_category_adoption_preparations_targetVersionId_fkey`
    FOREIGN KEY (`targetVersionId`) REFERENCES `rental_category_versions` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- These rows freeze the CURRENT DATABASE definition, not a reconstructed
-- historical order definition. Existing quotes/orders remain legacy-unproven.
INSERT INTO `rental_category_versions`
  (`id`,`categoryCode`,`versionLabel`,`structureVersion`,`sourceVersionId`,
   `sourceKind`,`status`,`revision`,`definition`,`dependencyDigest`,
   `publishedAt`,`publishedBy`,`publishReason`,`createdAt`,`updatedAt`)
SELECT CONCAT('legacy:',`code`),`code`,LEFT(`version`,64),1,NULL,
       'current_db_snapshot','legacy_baseline',0,
       JSON_OBJECT('code',`code`,'name',`name`,'description',`description`,
                   'supportedInventoryModes',`supportedInventoryModes`,
                   'defaultCapabilities',`defaultCapabilities`,
                   'terminology',`terminology`,'attributeSchema',`attributeSchema`,
                   'businessModel',`businessModel`,'version',`version`),
       NULL,NOW(3),'migration','Current DB definition only; not historical order evidence',
       NOW(3),NOW(3)
FROM `rental_category_definitions`;

INSERT INTO `rental_category_version_policies`
  (`versionId`,`createScope`,`upgradeScope`,`restoreScope`,`revision`,`updatedAt`)
SELECT `id`,'all','all','all',0,NOW(3) FROM `rental_category_versions`;

UPDATE `rental_category_definitions`
SET `recommendedVersionId`=CONCAT('legacy:',`code`)
WHERE `recommendedVersionId` IS NULL;

ALTER TABLE `rental_category_definitions`
  ADD INDEX `rental_category_definitions_code_recommendedVersionId_idx` (`code`,`recommendedVersionId`),
  ADD CONSTRAINT `rental_category_definitions_code_recommendedVersionId_fkey`
    FOREIGN KEY (`code`,`recommendedVersionId`)
    REFERENCES `rental_category_versions` (`categoryCode`,`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE `business_workspaces`
SET `categoryVersionId`=CONCAT('legacy:',`categoryCode`)
WHERE `categoryVersionId` IS NULL;

INSERT INTO `rental_category_adoption_audits`
  (`id`,`tenantId`,`workspaceId`,`fromVersionId`,`toVersionId`,`fromRevision`,
   `toRevision`,`action`,`actorId`,`reason`,`createdAt`)
SELECT UUID(),`tenantId`,`id`,NULL,`categoryVersionId`,0,0,
       'legacy_bind','migration','Current-space baseline; no claim about historical orders',NOW(3)
FROM `business_workspaces` WHERE `categoryVersionId` IS NOT NULL;
