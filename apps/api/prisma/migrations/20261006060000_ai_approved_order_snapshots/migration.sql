-- CreateTable
CREATE TABLE `ai_approved_order_snapshots` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `proposalId` VARCHAR(36) NOT NULL,
    `proposalRevision` INTEGER UNSIGNED NOT NULL,
    `actionId` VARCHAR(191) NOT NULL,
    `actionFingerprint` CHAR(64) NOT NULL,
    `kind` ENUM('input', 'preview') NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `revision` INTEGER UNSIGNED NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `actorKind` ENUM('saas_admin', 'user', 'customer', 'automation') NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `audience` ENUM('operator', 'staff', 'client', 'automation') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_approved_order_snapshots_action_kind`(`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `actionId`, `kind`),
    PRIMARY KEY (`scopeId`, `recordId`, `revision`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_approved_order_snapshots` ADD CONSTRAINT `ai_approved_order_snapshots_action_fkey` FOREIGN KEY (`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `actionId`, `actionFingerprint`) REFERENCES `ai_proposal_actions`(`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `actionId`, `requestFingerprint`) ON DELETE RESTRICT ON UPDATE RESTRICT;
