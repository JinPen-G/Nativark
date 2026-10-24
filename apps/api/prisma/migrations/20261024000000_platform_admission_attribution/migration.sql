-- Explicit platform attribution for gateway admissions and accounting receipts.
-- Workspace rows keep their tenant attribution and all existing unique keys;
-- platform rows carry NULL tenant/workspace, scopeKind PLATFORM and a
-- non-null platformDedupKey so single-admission dedup stays DB-enforced.

ALTER TABLE `ai_invocation_admissions` MODIFY `tenantId` VARCHAR(191) NULL;
ALTER TABLE `ai_invocation_admissions` MODIFY `workspaceId` VARCHAR(191) NULL;
ALTER TABLE `ai_invocation_admissions` ADD COLUMN `scopeKind` ENUM('PLATFORM', 'TENANT', 'WORKSPACE') NOT NULL DEFAULT 'WORKSPACE';
ALTER TABLE `ai_invocation_admissions` ADD COLUMN `platformDedupKey` VARCHAR(191) NULL;
ALTER TABLE `ai_invocation_admissions` ADD UNIQUE INDEX `ai_invocation_admission_platform_dedup_key` (`platformDedupKey`);
ALTER TABLE `ai_invocation_admissions` ADD INDEX `ai_invocation_admission_scope_kind_idx` (`scopeKind`, `tenantId`, `workspaceId`);

ALTER TABLE `ai_gateway_accounting_receipts` MODIFY `tenantId` VARCHAR(191) NULL;
ALTER TABLE `ai_gateway_accounting_receipts` MODIFY `workspaceId` VARCHAR(191) NULL;
