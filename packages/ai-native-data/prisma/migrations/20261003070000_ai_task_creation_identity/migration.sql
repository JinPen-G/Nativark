-- AIN-03/S06 creation identity; additive and unapplied.
-- AlterTable
ALTER TABLE `ai_tasks` ADD COLUMN `creationFingerprint` CHAR(64) NULL,
    ADD COLUMN `creationKey` VARCHAR(128) NULL,
    ADD COLUMN `inputHash` CHAR(64) NULL,
    ADD COLUMN `inputRevision` INTEGER UNSIGNED NULL;

-- CreateIndex
CREATE UNIQUE INDEX `ai_tasks_creation_key` ON `ai_tasks`(`scopeId`, `audience`, `ownerKind`, `ownerId`, `creationKey`);


-- New creation requests must store their complete frozen-input fingerprint bundle.
-- NULL bundles preserve pre-existing tasks; no legacy fingerprint is invented.
ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_creation_evidence` CHECK (
  (`creationKey` IS NULL AND `creationFingerprint` IS NULL AND `inputRevision` IS NULL AND `inputHash` IS NULL)
  OR (`creationKey` IS NOT NULL AND CHAR_LENGTH(`creationKey`) > 0
      AND `creationFingerprint` IS NOT NULL AND CHAR_LENGTH(`creationFingerprint`) = 64
      AND `inputRef` IS NOT NULL AND CHAR_LENGTH(`inputRef`) > 0
      AND `inputRevision` IS NOT NULL AND `inputRevision` > 0
      AND `inputHash` IS NOT NULL AND CHAR_LENGTH(`inputHash`) = 64)
);
