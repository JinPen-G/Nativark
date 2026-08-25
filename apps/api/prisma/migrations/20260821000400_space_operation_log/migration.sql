-- SPACE-03：审计事件归属经营空间
--
-- 可空列，且**刻意不回填历史行**：
-- 升级前的审计发生在"还没有经营空间"的时代，把它们一律塞进默认空间等于
-- 伪造归属。历史行保持 NULL 表示"归属未知"，比一个看起来精确的假值更诚实。
--
-- 外键用 Restrict 而不是 Cascade：审计不能随经营空间被删而消失。
-- 产品上空间只冻结/停用、不硬删，因此不会挡住正常操作。

-- AlterTable
ALTER TABLE `OperationLog` ADD COLUMN `workspaceId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `OperationLog_tenant_workspace_created_idx` ON `OperationLog`(`tenantId`, `workspaceId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `OperationLog` ADD CONSTRAINT `OperationLog_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
